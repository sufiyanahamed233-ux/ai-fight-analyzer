"""Dual DroidCam USB/MJPEG Live Stream with YOLO11s-Pose Estimation.

Connects to two DroidCam MJPEG endpoints:
- Camera 1: http://127.0.0.1:4747/video
- Camera 2: http://127.0.0.1:4748/video

Runs the existing YOLO11s-Pose detector (with CUDA if available) on BOTH camera feeds.
Renders the 17-keypoint skeleton overlay, bounding boxes, person count, and dual FPS metrics
(actual processing FPS vs. stream ingestion FPS).

Displays feeds in separate OpenCV windows and logs periodic telemetry to the terminal.
Exits cleanly on 'Q' or ESC.

Standalone diagnostic only. Does NOT modify existing project files.
Does NOT use OBS, DirectShow, camera indexes, or Wi-Fi.
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple

# Suppress noisy OpenCV logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np

# Ensure backend directory is in sys.path to import existing project modules
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.pose.pose_detector import DetectionResult, PoseDetector, PoseResult

DEFAULT_CAM1_URL = "http://127.0.0.1:4747/video"
DEFAULT_CAM2_URL = "http://127.0.0.1:4748/video"

# 16 standard COCO skeleton edges connecting the 17 keypoints
SKELETON_EDGES: List[Tuple[int, int]] = [
    # Face
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
    # Arms / Shoulders
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    # Torso
    (5, 11),
    (6, 12),
    (11, 12),
    # Legs
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
    # Torso (yellow)
    (5, 6): (0, 255, 255),
    (5, 11): (0, 255, 255),
    (6, 12): (0, 255, 255),
    (11, 12): (0, 255, 255),
    # Left limbs (cyan)
    (5, 7): (255, 215, 0),
    (7, 9): (255, 215, 0),
    (11, 13): (255, 215, 0),
    (13, 15): (255, 215, 0),
    # Right limbs (orange)
    (6, 8): (0, 140, 255),
    (8, 10): (0, 140, 255),
    (12, 14): (0, 140, 255),
    (14, 16): (0, 140, 255),
}


class CameraStreamReader:
    """Asynchronous frame grabber for an MJPEG stream to avoid network I/O stalls."""

    def __init__(self, name: str, url: str) -> None:
        self.name = name
        self.url = url

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._new_frame_event = threading.Event()

        self._cap: Optional[cv2.VideoCapture] = None
        self._latest_frame: Optional[np.ndarray] = None
        self.is_connected = False
        self.stream_frame_count = 0
        self.stream_fps = 0.0
        self.resolution: Tuple[int, int] = (0, 0)
        self.error_message: Optional[str] = None

        self._thread = threading.Thread(
            target=self._read_loop,
            daemon=True,
            name=f"Reader-{self.name}",
        )

    def start(self) -> None:
        """Start the background reading thread."""
        self._thread.start()

    def _open_stream(self) -> bool:
        """Open or reopen the VideoCapture connection."""
        if self._cap is not None:
            self._cap.release()

        self._cap = cv2.VideoCapture(self.url)
        if not self._cap.isOpened():
            with self._lock:
                self.is_connected = False
                self.error_message = "Connection refused / stream unavailable"
            return False

        with self._lock:
            self.is_connected = True
            self.error_message = None
        return True

    def _read_loop(self) -> None:
        """Continuously drain frames from the MJPEG stream."""
        if not self._open_stream():
            print(f"[{self.name}] Initial connection failed to {self.url}. Retrying...")

        t_prev = time.perf_counter()

        while not self._stop_event.is_set():
            if self._cap is None or not self._cap.isOpened():
                if not self._open_stream():
                    time.sleep(1.0)
                    continue

            ret, frame = self._cap.read()
            t_now = time.perf_counter()
            dt = t_now - t_prev
            t_prev = t_now

            if not ret or frame is None or frame.size == 0:
                with self._lock:
                    self.is_connected = False
                    self.error_message = "Received empty or corrupted frame"
                time.sleep(0.05)
                continue

            h, w = frame.shape[:2]
            instant_fps = 1.0 / dt if dt > 0 else 0.0

            with self._lock:
                self.is_connected = True
                self.error_message = None
                self._latest_frame = frame
                self.stream_frame_count += 1
                self.resolution = (w, h)
                self.stream_fps = (
                    0.85 * self.stream_fps + 0.15 * instant_fps
                    if self.stream_fps > 0
                    else instant_fps
                )

            self._new_frame_event.set()

    def get_latest_frame(self) -> Tuple[Optional[np.ndarray], bool, int, float, Tuple[int, int], Optional[str]]:
        """Retrieve the freshest frame copy along with stream metrics."""
        with self._lock:
            frame_copy = self._latest_frame.copy() if self._latest_frame is not None else None
            return (
                frame_copy,
                self.is_connected,
                self.stream_frame_count,
                self.stream_fps,
                self.resolution,
                self.error_message,
            )

    def stop(self) -> None:
        """Terminate the background reading thread and release VideoCapture."""
        self._stop_event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1.0)
        if self._cap is not None:
            self._cap.release()
            self._cap = None


def draw_skeleton(
    frame: np.ndarray,
    pose: PoseResult,
    conf_thresh: float = 0.25,
) -> None:
    """Draw 17-keypoint skeleton limbs and joints on the frame."""
    keypoints = pose.keypoints

    # 1. Limbs
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

    # 2. Joint dots
    for kp in keypoints:
        if kp.confidence >= conf_thresh and (kp.x_px > 0 or kp.y_px > 0):
            pt = (int(round(kp.x_px)), int(round(kp.y_px)))
            cv2.circle(frame, pt, 5, (20, 20, 20), -1, cv2.LINE_AA)
            cv2.circle(frame, pt, 3, (0, 255, 128), -1, cv2.LINE_AA)


def draw_bounding_box(
    frame: np.ndarray,
    pose: PoseResult,
    is_primary: bool = True,
) -> None:
    """Draw bounding box and confidence score for a detected person."""
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


def draw_hud(
    frame: np.ndarray,
    cam_name: str,
    url: str,
    connected: bool,
    resolution: Tuple[int, int],
    proc_fps: float,
    stream_fps: float,
    processed_count: int,
    persons_detected: int,
    inf_ms: float,
    device_name: str,
) -> np.ndarray:
    """Render a semi-transparent HUD overlay with metrics."""
    w, h = resolution
    hud_w, hud_h = 390, 135

    overlay = frame.copy()
    cv2.rectangle(overlay, (12, 12), (12 + hud_w, 12 + hud_h), (20, 20, 24), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (12, 12), (12 + hud_w, 12 + hud_h), (70, 70, 80), 1)

    # Status & persons
    if connected:
        if persons_detected > 0:
            status_text = f"{cam_name}: PERSON DETECTED ({persons_detected})"
            status_col = (0, 255, 100)
        else:
            status_text = f"{cam_name}: CONNECTED (0 Persons)"
            status_col = (0, 210, 255)
    else:
        status_text = f"{cam_name}: DISCONNECTED"
        status_col = (60, 70, 240)

    cv2.putText(
        frame,
        status_text,
        (24, 36),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        status_col,
        2,
        cv2.LINE_AA,
    )

    # Line 2: FPS Metrics (Processing vs Stream)
    cv2.putText(
        frame,
        f"Proc FPS: {proc_fps:4.1f} | Stream FPS: {stream_fps:4.1f}",
        (24, 62),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.50,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )

    # Line 3: Inference Latency and Hardware
    cv2.putText(
        frame,
        f"YOLO11s-Pose: {inf_ms:4.1f} ms [{device_name}] | Res: {w}x{h}",
        (24, 88),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )

    # Line 4: Frame counts & Exit hint
    cv2.putText(
        frame,
        f"Frames: {processed_count:5d} | {url}",
        (24, 114),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.42,
        (180, 180, 180),
        1,
        cv2.LINE_AA,
    )

    return frame


def create_placeholder_frame(
    cam_name: str,
    url: str,
    error_msg: Optional[str] = None,
) -> np.ndarray:
    """Create a placeholder frame when a camera feed is unavailable."""
    placeholder = np.zeros((720, 1280, 3), dtype=np.uint8)
    placeholder[:] = (35, 30, 30)

    cv2.putText(
        placeholder,
        f"{cam_name} — WAITING FOR STREAM",
        (60, 310),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (0, 180, 255),
        2,
        cv2.LINE_AA,
    )

    cv2.putText(
        placeholder,
        f"Target URL: {url}",
        (60, 360),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.70,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )

    if error_msg:
        cv2.putText(
            placeholder,
            f"Status: {error_msg}",
            (60, 410),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.60,
            (80, 80, 240),
            1,
            cv2.LINE_AA,
        )

    cv2.putText(
        placeholder,
        "Verify DroidCam server or port forwarding (e.g. adb forward tcp:4747...)",
        (60, 460),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (140, 140, 140),
        1,
        cv2.LINE_AA,
    )

    return placeholder


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dual DroidCam MJPEG live stream with YOLO11s-Pose estimation."
    )
    parser.add_argument(
        "--url1",
        default=DEFAULT_CAM1_URL,
        help=f"URL for Camera 1 (default: {DEFAULT_CAM1_URL}).",
    )
    parser.add_argument(
        "--url2",
        default=DEFAULT_CAM2_URL,
        help=f"URL for Camera 2 (default: {DEFAULT_CAM2_URL}).",
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

    print("=" * 70)
    print("AI Fight Analyzer - Dual DroidCam USB YOLO11s-Pose Diagnostic")
    print(f"  Camera 1 URL         : {args.url1}")
    print(f"  Camera 2 URL         : {args.url2}")
    print(f"  Requested Device     : {args.device}")
    print(f"  Model Path           : {args.model}")
    print(f"  Confidence Threshold : {args.conf}")
    print("=" * 70)

    # Initialize YOLO11s-Pose detector
    print("[INFO] Initializing PoseDetector...")
    detector = PoseDetector(
        model_path=args.model,
        device=args.device,
        conf_threshold=args.conf,
    )
    actual_device = detector.device.upper()
    print(f"[INFO] PoseDetector ready on device: {actual_device}")

    # Start background stream grabbers
    print("[INFO] Initializing asynchronous MJPEG stream readers...")
    cam1 = CameraStreamReader("Camera 1", args.url1)
    cam2 = CameraStreamReader("Camera 2", args.url2)

    cam1.start()
    cam2.start()

    win1 = f"Camera 1: {args.url1}"
    win2 = f"Camera 2: {args.url2}"

    cv2.namedWindow(win1, cv2.WINDOW_NORMAL)
    cv2.namedWindow(win2, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win1, 960, 540)
    cv2.resizeWindow(win2, 960, 540)

    # Processing telemetry tracking
    proc_count_1 = 0
    proc_count_2 = 0
    t_prev_1 = time.perf_counter()
    t_prev_2 = time.perf_counter()
    proc_fps_1 = 0.0
    proc_fps_2 = 0.0
    inf_ms_1 = 0.0
    inf_ms_2 = 0.0
    persons_1 = 0
    persons_2 = 0

    total_inf_time_1 = 0.0
    total_inf_time_2 = 0.0

    last_console_log = time.time()

    print("[INFO] Streams started. Press 'Q' or ESC in preview window to exit.")
    print("-" * 70)

    try:
        while True:
            # --- CAMERA 1 PROCESSING ---
            f1, conn1, stream_cnt1, s_fps1, res1, err1 = cam1.get_latest_frame()
            if f1 is not None and f1.size > 0:
                det1 = detector.detect(f1)
                inf_ms_1 = det1.inference_time_ms
                total_inf_time_1 += inf_ms_1
                persons_1 = det1.persons_detected
                proc_count_1 += 1

                t_now = time.perf_counter()
                dt1 = t_now - t_prev_1
                t_prev_1 = t_now
                inst_fps_1 = 1.0 / dt1 if dt1 > 0 else 0.0
                proc_fps_1 = 0.85 * proc_fps_1 + 0.15 * inst_fps_1 if proc_fps_1 > 0 else inst_fps_1

                # Draw skeleton and boxes
                for person in det1.all_persons:
                    is_prim = (
                        det1.primary is not None
                        and person.person_index == det1.primary.person_index
                    )
                    draw_bounding_box(f1, person, is_primary=is_prim)
                    draw_skeleton(f1, person, conf_thresh=args.conf)

                display_f1 = draw_hud(
                    f1, "Camera 1", args.url1, conn1, res1,
                    proc_fps_1, s_fps1, proc_count_1, persons_1,
                    inf_ms_1, actual_device,
                )
            else:
                display_f1 = create_placeholder_frame("Camera 1", args.url1, err1)
            cv2.imshow(win1, display_f1)

            # --- CAMERA 2 PROCESSING ---
            f2, conn2, stream_cnt2, s_fps2, res2, err2 = cam2.get_latest_frame()
            if f2 is not None and f2.size > 0:
                det2 = detector.detect(f2)
                inf_ms_2 = det2.inference_time_ms
                total_inf_time_2 += inf_ms_2
                persons_2 = det2.persons_detected
                proc_count_2 += 1

                t_now = time.perf_counter()
                dt2 = t_now - t_prev_2
                t_prev_2 = t_now
                inst_fps_2 = 1.0 / dt2 if dt2 > 0 else 0.0
                proc_fps_2 = 0.85 * proc_fps_2 + 0.15 * inst_fps_2 if proc_fps_2 > 0 else inst_fps_2

                # Draw skeleton and boxes
                for person in det2.all_persons:
                    is_prim = (
                        det2.primary is not None
                        and person.person_index == det2.primary.person_index
                    )
                    draw_bounding_box(f2, person, is_primary=is_prim)
                    draw_skeleton(f2, person, conf_thresh=args.conf)

                display_f2 = draw_hud(
                    f2, "Camera 2", args.url2, conn2, res2,
                    proc_fps_2, s_fps2, proc_count_2, persons_2,
                    inf_ms_2, actual_device,
                )
            else:
                display_f2 = create_placeholder_frame("Camera 2", args.url2, err2)
            cv2.imshow(win2, display_f2)

            # --- PERIODIC CONSOLE TELEMETRY ---
            now = time.time()
            if now - last_console_log >= 1.0:
                log_c1 = (
                    f"Proc: {proc_fps_1:4.1f} FPS ({inf_ms_1:4.1f}ms) | Stream: {s_fps1:4.1f} FPS | Persons: {persons_1} | Frames: {proc_count_1}"
                    if conn1 else "DISCONNECTED"
                )
                log_c2 = (
                    f"Proc: {proc_fps_2:4.1f} FPS ({inf_ms_2:4.1f}ms) | Stream: {s_fps2:4.1f} FPS | Persons: {persons_2} | Frames: {proc_count_2}"
                    if conn2 else "DISCONNECTED"
                )
                print(f"[STATUS] Cam 1: {log_c1}")
                print(f"         Cam 2: {log_c2}")
                last_console_log = now

            # Exit key handling
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\n[INFO] Exit key pressed (Q/ESC). Stopping...")
                break

    except KeyboardInterrupt:
        print("\n[INFO] Interrupted by user (Ctrl+C). Stopping...")
    finally:
        print("-" * 70)
        print("[INFO] Shutting down streams and cleaning up...")
        cam1.stop()
        cam2.stop()
        cv2.destroyAllWindows()

        avg_inf_1 = (total_inf_time_1 / proc_count_1) if proc_count_1 > 0 else 0.0
        avg_inf_2 = (total_inf_time_2 / proc_count_2) if proc_count_2 > 0 else 0.0

        print("=" * 70)
        print("SUMMARY REPORT:")
        print(f"  Inference Device    : {actual_device}")
        print(f"  Camera 1 Processed  : {proc_count_1} frames | Avg Inference: {avg_inf_1:4.2f} ms")
        print(f"  Camera 2 Processed  : {proc_count_2} frames | Avg Inference: {avg_inf_2:4.2f} ms")
        print("[INFO] All captures released and OpenCV windows closed.")
        print("=" * 70)


if __name__ == "__main__":
    main()
