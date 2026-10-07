"""Low-latency live DroidCam FFmpeg DirectShow stream with YOLO11s-Pose inference.

Optimized for ultra-low latency:
- Low-latency FFmpeg flags (-fflags nobuffer, -flags low_delay).
- DirectShow capture parameters explicitly configured at 1280x720 @ 30 FPS.
- Dedicated background reader thread continuously drains the stdout pipe.
- Always delivers the freshest frame to YOLO11s-Pose, completely eliminating
  stale frame accumulation and pipe backlog.
- Renders the 17-keypoint skeleton overlay, bounding boxes, and diagnostic HUD.
- Exits on 'Q' or ESC, cleanly terminating the FFmpeg subprocess and reader thread.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import List, Tuple

# Suppress noisy OpenCV logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np

# Ensure backend package is in python path
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.pose.pose_detector import DetectionResult, PoseDetector, PoseResult

WIDTH = 1280
HEIGHT = 720
CHANNELS = 3
FRAME_SIZE = WIDTH * HEIGHT * CHANNELS
DEVICE_NAME = "video=DroidCam Video"
FPS_TARGET = 30

# Optimized low-latency FFmpeg DirectShow capture command
FFMPEG_CMD = [
    "ffmpeg",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
    "-f", "dshow",
    "-rtbufsize", "100M",
    "-framerate", str(FPS_TARGET),
    "-video_size", f"{WIDTH}x{HEIGHT}",
    "-i", DEVICE_NAME,
    "-f", "rawvideo",
    "-pix_fmt", "bgr24",
    "pipe:1",
]

# 16 COCO skeleton edges connecting the 17 standard keypoints:
#  0: nose, 1: left_eye, 2: right_eye, 3: left_ear, 4: right_ear,
#  5: left_shoulder, 6: right_shoulder, 7: left_elbow, 8: right_elbow,
#  9: left_wrist, 10: right_wrist, 11: left_hip, 12: right_hip,
# 13: left_knee, 14: right_knee, 15: left_ankle, 16: right_ankle
SKELETON_EDGES: List[Tuple[int, int]] = [
    # Head / Face
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
    # Upper Body / Arms
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    # Torso
    (5, 11),
    (6, 12),
    (11, 12),
    # Lower Body / Legs
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
]

EDGE_COLORS: dict[Tuple[int, int], Tuple[int, int, int]] = {
    # Face (lavender / light blue)
    (0, 1): (255, 180, 100),
    (0, 2): (255, 180, 100),
    (1, 3): (255, 180, 100),
    (2, 4): (255, 180, 100),
    # Torso (bright yellow)
    (5, 6): (0, 255, 255),
    (5, 11): (0, 255, 255),
    (6, 12): (0, 255, 255),
    (11, 12): (0, 255, 255),
    # Left limbs (vibrant cyan)
    (5, 7): (255, 215, 0),
    (7, 9): (255, 215, 0),
    (11, 13): (255, 215, 0),
    (13, 15): (255, 215, 0),
    # Right limbs (vibrant orange)
    (6, 8): (0, 140, 255),
    (8, 10): (0, 140, 255),
    (12, 14): (0, 140, 255),
    (14, 16): (0, 140, 255),
}


def read_exact(stream, n_bytes: int) -> bytes | None:
    """Read exactly n_bytes from a binary stream or return None on EOF."""
    buffer = bytearray(n_bytes)
    view = memoryview(buffer)
    bytes_read = 0
    while bytes_read < n_bytes:
        chunk = stream.readinto(view[bytes_read:])
        if not chunk:
            return None
        bytes_read += chunk
    return bytes(buffer)


class LatestFrameGrabber:
    """Asynchronously drains the FFmpeg stdout pipe in a background thread.
    
    Stores the most recently received frame so the main inference loop
    always works on real-time data, preventing stale backlog build-up.
    """

    def __init__(
        self,
        proc: subprocess.Popen,
        frame_size: int,
        width: int,
        height: int,
        channels: int,
    ) -> None:
        self.proc = proc
        self.frame_size = frame_size
        self.width = width
        self.height = height
        self.channels = channels

        self._lock = threading.Lock()
        self._new_frame_event = threading.Event()
        self._stop_event = threading.Event()

        self._latest_frame: np.ndarray | None = None
        self.total_received = 0
        self.stream_ended = False

        self._thread = threading.Thread(target=self._reader_loop, daemon=True, name="FFmpegReader")
        self._thread.start()

    def _reader_loop(self) -> None:
        stdout = self.proc.stdout
        if stdout is None:
            self.stream_ended = True
            self._new_frame_event.set()
            return

        while not self._stop_event.is_set():
            raw_bytes = read_exact(stdout, self.frame_size)
            if raw_bytes is None:
                self.stream_ended = True
                self._new_frame_event.set()
                break

            # Reconstruct into a writable NumPy frame
            frame = (
                np.frombuffer(raw_bytes, dtype=np.uint8)
                .reshape((self.height, self.width, self.channels))
                .copy()
            )

            with self._lock:
                self._latest_frame = frame
                self.total_received += 1

            self._new_frame_event.set()

    def get_latest_frame(self, timeout: float = 1.0) -> Tuple[np.ndarray | None, bool]:
        """Wait for the newest available frame.
        
        Returns:
            Tuple of (frame, stream_ended). If timed out or ended, frame is None.
        """
        if not self._new_frame_event.wait(timeout=timeout):
            return None, self.stream_ended

        self._new_frame_event.clear()
        with self._lock:
            frame = self._latest_frame
        return frame, self.stream_ended

    def stop(self) -> None:
        """Signal the reader loop to stop."""
        self._stop_event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=0.5)


def terminate_process(proc: subprocess.Popen | None, grabber: LatestFrameGrabber | None = None) -> None:
    """Cleanly terminate the FFmpeg subprocess and background reader."""
    if grabber is not None:
        grabber.stop()

    if proc is None:
        return

    print("Cleaning up FFmpeg subprocess...")
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=2.0)
            print("FFmpeg process terminated gracefully.")
        except subprocess.TimeoutExpired:
            print("FFmpeg process timed out on terminate. Killing...")
            proc.kill()
            proc.wait(timeout=1.0)
            print("FFmpeg process killed.")

    if proc.stdout:
        try:
            proc.stdout.close()
        except Exception:
            pass


def draw_skeleton(
    frame: np.ndarray,
    pose: PoseResult,
    conf_thresh: float = 0.25,
) -> None:
    """Draw 17-keypoint skeleton lines and joint dots on the frame."""
    keypoints = pose.keypoints

    # 1. Draw skeleton limb edges
    for edge in SKELETON_EDGES:
        idx1, idx2 = edge
        if idx1 < len(keypoints) and idx2 < len(keypoints):
            kp1 = keypoints[idx1]
            kp2 = keypoints[idx2]

            if (
                kp1.confidence >= conf_thresh
                and kp2.confidence >= conf_thresh
                and (kp1.x_px > 0 or kp1.y_px > 0)
                and (kp2.x_px > 0 or kp2.y_px > 0)
            ):
                pt1 = (int(round(kp1.x_px)), int(round(kp1.y_px)))
                pt2 = (int(round(kp2.x_px)), int(round(kp2.y_px)))
                color = EDGE_COLORS.get(edge, (0, 255, 0))
                cv2.line(frame, pt1, pt2, color, 3, cv2.LINE_AA)

    # 2. Draw keypoint joint circles
    for kp in keypoints:
        if kp.confidence >= conf_thresh and (kp.x_px > 0 or kp.y_px > 0):
            pt = (int(round(kp.x_px)), int(round(kp.y_px)))
            # Outer dark ring for contrast
            cv2.circle(frame, pt, 5, (20, 20, 20), -1, cv2.LINE_AA)
            # Inner bright joint dot
            cv2.circle(frame, pt, 3, (0, 255, 128), -1, cv2.LINE_AA)


def draw_bounding_box(
    frame: np.ndarray,
    pose: PoseResult,
    is_primary: bool = True,
) -> None:
    """Draw a bounding box and label around the detected person."""
    x1, y1, x2, y2 = [int(round(v)) for v in pose.bbox_xyxy]
    color = (0, 230, 115) if is_primary else (180, 180, 180)
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)

    label = f"Person #{pose.person_index + 1} ({pose.confidence * 100:.0f}%)"
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.5
    thickness = 1
    (lw, lh), baseline = cv2.getTextSize(label, font, font_scale, thickness)

    label_y1 = max(0, y1 - lh - baseline - 4)
    cv2.rectangle(
        frame,
        (x1, label_y1),
        (x1 + lw + 8, label_y1 + lh + baseline + 4),
        (30, 30, 30),
        -1,
    )
    cv2.putText(
        frame,
        label,
        (x1 + 4, label_y1 + lh + 2),
        font,
        font_scale,
        color,
        thickness,
        cv2.LINE_AA,
    )


def draw_hud_overlay(
    frame: np.ndarray,
    det_result: DetectionResult,
    fps: float,
    device_label: str,
    latency_mode: str = "Low-Latency Direct",
    skipped_stale: int = 0,
) -> None:
    """Render a semi-transparent HUD showing person detection status, FPS, and timing."""
    hud_w, hud_h = 380, 145
    overlay = frame.copy()
    cv2.rectangle(overlay, (12, 12), (12 + hud_w, 12 + hud_h), (20, 20, 24), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (12, 12), (12 + hud_w, 12 + hud_h), (70, 70, 80), 1)

    # Person detection status
    if det_result.persons_detected > 0:
        status_text = f"PERSON DETECTED ({det_result.persons_detected})"
        status_color = (0, 255, 100)  # Bright green
    else:
        status_text = "NO PERSON DETECTED"
        status_color = (60, 70, 240)  # Red / Coral

    cv2.putText(
        frame,
        status_text,
        (24, 36),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.62,
        status_color,
        2,
        cv2.LINE_AA,
    )

    # FPS display
    cv2.putText(
        frame,
        f"FPS: {fps:4.1f} | Mode: {latency_mode}",
        (24, 62),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )

    # Inference timing display
    inf_ms = det_result.inference_time_ms
    cv2.putText(
        frame,
        f"Inference: {inf_ms:.1f} ms [{device_label}] | Skipped Stale: {skipped_stale}",
        (24, 88),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.50,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )

    # Controls hint
    cv2.putText(
        frame,
        "Press 'Q' or ESC to exit",
        (24, 114),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (160, 160, 160),
        1,
        cv2.LINE_AA,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Low-latency live DroidCam FFmpeg pipe with YOLO11s-Pose inference."
    )
    parser.add_argument(
        "--device",
        default="auto",
        help="Inference device for PoseDetector ('auto', 'cuda', or 'cpu', default: auto).",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.25,
        help="Detection confidence threshold (default: 0.25).",
    )
    parser.add_argument(
        "--model",
        default="yolo11s-pose.pt",
        help="Path to YOLO pose weights (default: yolo11s-pose.pt).",
    )
    args = parser.parse_args()

    print("=" * 65)
    print("AI Fight Analyzer - Low-Latency DroidCam YOLO11s-Pose Diagnostic")
    print(f"Target Device        : {DEVICE_NAME}")
    print(f"Target Input         : {WIDTH}x{HEIGHT} @ {FPS_TARGET} FPS")
    print(f"Low-Latency Flags    : -fflags nobuffer -flags low_delay -rtbufsize 100M")
    print(f"Requested Inference  : {args.device}")
    print(f"Model Path           : {args.model}")
    print(f"Confidence Threshold : {args.conf}")
    print("=" * 65)

    # Initialize PoseDetector
    print("[INFO] Initializing PoseDetector...")
    detector = PoseDetector(
        model_path=args.model,
        device=args.device,
        conf_threshold=args.conf,
    )
    actual_device = detector.device.upper()
    print(f"[INFO] PoseDetector ready on device: {actual_device}")

    print("[INFO] Launching low-latency FFmpeg subprocess...")
    proc: subprocess.Popen | None = None
    grabber: LatestFrameGrabber | None = None
    window_name = "DroidCam FFmpeg - Low-Latency YOLO11s Pose"

    try:
        proc = subprocess.Popen(
            FFMPEG_CMD,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=10**7,
        )
    except FileNotFoundError:
        print("[ERROR] FFmpeg executable not found in PATH.")
        sys.exit(1)
    except Exception as exc:
        print(f"[ERROR] Failed to start FFmpeg subprocess: {exc}")
        sys.exit(1)

    assert proc.stdout is not None, "Failed to capture FFmpeg stdout pipe."

    # Start latest frame grabber
    grabber = LatestFrameGrabber(proc, FRAME_SIZE, WIDTH, HEIGHT, CHANNELS)

    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 1280, 720)

    processed_frames = 0
    t_prev = time.perf_counter()
    fps_estimate = 0.0
    total_inference_ms = 0.0

    print("[INFO] Background frame reader active. Press 'Q' or ESC in preview window to exit.")
    print("-" * 65)

    try:
        while True:
            frame, stream_ended = grabber.get_latest_frame(timeout=1.0)
            if frame is None:
                if stream_ended:
                    exit_code = proc.poll()
                    print(f"\n[INFO] Pipe stream ended (FFmpeg exit code: {exit_code}).")
                    break
                continue

            processed_frames += 1

            # Run YOLO11s-Pose inference
            det_result = detector.detect(frame)
            total_inference_ms += det_result.inference_time_ms

            # Calculate smoothed FPS
            t_now = time.perf_counter()
            dt = t_now - t_prev
            t_prev = t_now
            instant_fps = 1.0 / dt if dt > 0 else 0.0
            fps_estimate = 0.85 * fps_estimate + 0.15 * instant_fps if fps_estimate > 0 else instant_fps

            skipped_stale = max(0, grabber.total_received - processed_frames)

            # Log periodically to console
            if processed_frames % 30 == 0:
                print(
                    f"[Frame {processed_frames:5d}] "
                    f"Inference: {det_result.inference_time_ms:5.1f} ms | "
                    f"FPS: {fps_estimate:4.1f} | "
                    f"Persons: {det_result.persons_detected} | "
                    f"Skipped Stale: {skipped_stale}"
                )

            # Draw 17-keypoint skeleton and boxes for detected persons
            for person in det_result.all_persons:
                is_primary = (
                    det_result.primary is not None
                    and person.person_index == det_result.primary.person_index
                )
                draw_bounding_box(frame, person, is_primary=is_primary)
                draw_skeleton(frame, person, conf_thresh=args.conf)

            # Render HUD overlay
            draw_hud_overlay(
                frame,
                det_result,
                fps_estimate,
                actual_device,
                latency_mode="Realtime Newest",
                skipped_stale=skipped_stale,
            )

            # Display frame
            cv2.imshow(window_name, frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\n[INFO] Exit key pressed (Q/ESC). Stopping...")
                break

    except KeyboardInterrupt:
        print("\n[INFO] Interrupted by user (Ctrl+C). Stopping...")
    finally:
        terminate_process(proc, grabber)
        cv2.destroyAllWindows()
        print("-" * 65)
        avg_inf = (total_inference_ms / processed_frames) if processed_frames > 0 else 0.0
        print(f"[INFO] Processed frames      : {processed_frames}")
        total_rec = grabber.total_received if grabber else processed_frames
        print(f"[INFO] Total received frames : {total_rec}")
        print(f"[INFO] Skipped stale frames  : {max(0, total_rec - processed_frames)}")
        print(f"[INFO] Average inference time: {avg_inf:.2f} ms")
        print("[INFO] Subprocess and OpenCV windows cleaned up cleanly.")
        print("=" * 65)


if __name__ == "__main__":
    main()
