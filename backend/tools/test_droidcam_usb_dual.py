"""Dual DroidCam USB/MJPEG Stream Diagnostic Tool.

Captures and displays live video streams from two DroidCam MJPEG endpoints:
- Camera 1: http://127.0.0.1:4747/video
- Camera 2: http://127.0.0.1:4748/video

Features:
- Dedicated background reader threads for each camera stream (no cross-blocking).
- Real-time FPS and resolution HUD overlays on each window.
- Handles disconnected, empty, or lagging frames gracefully.
- Displays feeds in separate OpenCV windows.
- Prints connection status and frame counts to console.
- Clean exit with 'Q' or ESC.

Standalone diagnostic only. Does NOT use YOLO, OBS, DirectShow, or camera indexes.
"""

from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path
from typing import Optional, Tuple

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Suppress noisy OpenCV logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np

CAM1_URL = "http://127.0.0.1:4747/video"
CAM2_URL = "http://127.0.0.1:4748/video"


class CameraStreamReader:
    """Asynchronous reader for an MJPEG HTTP camera stream using OpenCV."""

    def __init__(self, name: str, url: str) -> None:
        self.name = name
        self.url = url

        self._lock = threading.Lock()
        self._stop_event = threading.Event()

        self._cap: Optional[cv2.VideoCapture] = None
        self._latest_frame: Optional[np.ndarray] = None
        self.is_connected = False
        self.frame_count = 0
        self.failed_reads = 0
        self.fps = 0.0
        self.resolution: Tuple[int, int] = (0, 0)
        self.error_message: Optional[str] = None

        self._thread = threading.Thread(
            target=self._read_loop,
            daemon=True,
            name=f"Reader-{self.name}",
        )

    def start(self) -> None:
        """Start background reading thread."""
        self._thread.start()

    def _open_stream(self) -> bool:
        """Attempt to connect to the MJPEG URL."""
        if self._cap is not None:
            self._cap.release()

        self._cap = cv2.VideoCapture(self.url)
        if not self._cap.isOpened():
            with self._lock:
                self.is_connected = False
                self.error_message = "Failed to open stream URL"
            return False

        with self._lock:
            self.is_connected = True
            self.error_message = None
        return True

    def _read_loop(self) -> None:
        """Continuously grab frames from the stream."""
        if not self._open_stream():
            print(f"[{self.name}] Initial connection failed for {self.url}. Retrying...")

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
                    self.failed_reads += 1
                    self.error_message = "Empty/failed frame received"
                # Brief sleep to avoid busy-spin on broken connection
                time.sleep(0.05)
                continue

            h, w = frame.shape[:2]
            instant_fps = 1.0 / dt if dt > 0 else 0.0

            with self._lock:
                self.is_connected = True
                self.error_message = None
                self._latest_frame = frame
                self.frame_count += 1
                self.resolution = (w, h)
                # Smoothed FPS
                self.fps = 0.85 * self.fps + 0.15 * instant_fps if self.fps > 0 else instant_fps

    def get_frame_and_stats(self) -> Tuple[Optional[np.ndarray], bool, int, float, Tuple[int, int], Optional[str]]:
        """Retrieve the latest frame copy and current stream statistics."""
        with self._lock:
            frame_copy = self._latest_frame.copy() if self._latest_frame is not None else None
            return (
                frame_copy,
                self.is_connected,
                self.frame_count,
                self.fps,
                self.resolution,
                self.error_message,
            )

    def stop(self) -> None:
        """Stop background reader and release VideoCapture."""
        self._stop_event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=1.0)
        if self._cap is not None:
            self._cap.release()
            self._cap = None


def render_hud(
    frame: np.ndarray,
    cam_name: str,
    url: str,
    connected: bool,
    frame_count: int,
    fps: float,
    resolution: Tuple[int, int],
) -> np.ndarray:
    """Draw a clean diagnostic HUD overlay on the camera frame."""
    w, h = resolution
    hud_w, hud_h = 360, 105

    # Semi-transparent dark background card
    overlay = frame.copy()
    cv2.rectangle(overlay, (12, 12), (12 + hud_w, 12 + hud_h), (20, 20, 24), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (12, 12), (12 + hud_w, 12 + hud_h), (70, 70, 80), 1)

    status_str = "CONNECTED" if connected else "DISCONNECTED"
    status_col = (0, 255, 100) if connected else (60, 70, 240)

    # Line 1: Camera title and connection status
    cv2.putText(
        frame,
        f"{cam_name}: {status_str}",
        (24, 36),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.62,
        status_col,
        2,
        cv2.LINE_AA,
    )

    # Line 2: Resolution & FPS
    cv2.putText(
        frame,
        f"Resolution: {w}x{h} | FPS: {fps:4.1f}",
        (24, 64),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )

    # Line 3: Frame counter & URL
    cv2.putText(
        frame,
        f"Frames: {frame_count:6d} | {url}",
        (24, 92),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.44,
        (200, 200, 200),
        1,
        cv2.LINE_AA,
    )

    return frame


def create_placeholder_frame(
    cam_name: str,
    url: str,
    error_msg: Optional[str] = None,
) -> np.ndarray:
    """Generate a clean placeholder screen when a camera is offline or waiting."""
    placeholder = np.zeros((720, 1280, 3), dtype=np.uint8)
    # Slate background
    placeholder[:] = (35, 30, 30)

    title = f"{cam_name} — WAITING FOR STREAM"
    cv2.putText(
        placeholder,
        title,
        (60, 320),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.1,
        (0, 180, 255),
        2,
        cv2.LINE_AA,
    )

    url_text = f"Target URL: {url}"
    cv2.putText(
        placeholder,
        url_text,
        (60, 370),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (200, 200, 200),
        1,
        cv2.LINE_AA,
    )

    if error_msg:
        err_text = f"Status: {error_msg}"
        cv2.putText(
            placeholder,
            err_text,
            (60, 420),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (80, 80, 240),
            1,
            cv2.LINE_AA,
        )

    hint = "Ensure DroidCam client or USB port forwarding is running."
    cv2.putText(
        placeholder,
        hint,
        (60, 470),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (140, 140, 140),
        1,
        cv2.LINE_AA,
    )

    return placeholder


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="AI Fight Analyzer - Dual DroidCam USB Diagnostic")
    parser.add_argument("--adb", action="store_true", help="Automatically configure ADB USB port forwarding before starting")
    args, _ = parser.parse_known_args()

    print("=" * 68)
    print("AI Fight Analyzer - Dual DroidCam USB MJPEG Diagnostic")
    print(f"  Camera 1 URL : {CAM1_URL}")
    print(f"  Camera 2 URL : {CAM2_URL}")
    print("=" * 68)

    if args.adb:
        from app.camera.adb_forwarder import setup_dual_droidcam_usb
        print("[INFO] Automatically configuring USB ADB port forwards...")
        try:
            setup_dual_droidcam_usb(verify_streams=False)
            print("[INFO] ADB port forwards configured successfully.")
        except Exception as exc:
            print(f"[WARN] ADB forward auto-configuration failed: {exc}")

    print("[INFO] Initializing stream readers...")

    cam1 = CameraStreamReader("Camera 1", CAM1_URL)
    cam2 = CameraStreamReader("Camera 2", CAM2_URL)

    cam1.start()
    cam2.start()

    win1 = "Camera 1: http://127.0.0.1:4747/video"
    win2 = "Camera 2: http://127.0.0.1:4748/video"

    cv2.namedWindow(win1, cv2.WINDOW_NORMAL)
    cv2.namedWindow(win2, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win1, 960, 540)
    cv2.resizeWindow(win2, 960, 540)

    print("[INFO] Streams started. Press 'Q' or ESC in either window to exit.")
    print("-" * 68)

    last_console_log = time.time()

    try:
        while True:
            # Camera 1 frame retrieval & rendering
            f1, conn1, count1, fps1, res1, err1 = cam1.get_frame_and_stats()
            if f1 is not None and f1.size > 0:
                display_f1 = render_hud(f1, "Camera 1", CAM1_URL, conn1, count1, fps1, res1)
            else:
                display_f1 = create_placeholder_frame("Camera 1", CAM1_URL, err1)
            cv2.imshow(win1, display_f1)

            # Camera 2 frame retrieval & rendering
            f2, conn2, count2, fps2, res2, err2 = cam2.get_frame_and_stats()
            if f2 is not None and f2.size > 0:
                display_f2 = render_hud(f2, "Camera 2", CAM2_URL, conn2, count2, fps2, res2)
            else:
                display_f2 = create_placeholder_frame("Camera 2", CAM2_URL, err2)
            cv2.imshow(win2, display_f2)

            # Periodic console telemetry
            now = time.time()
            if now - last_console_log >= 1.0:
                s1 = f"{res1[0]}x{res1[1]} @ {fps1:4.1f} FPS, {count1:5d} frames" if conn1 else "DISCONNECTED"
                s2 = f"{res2[0]}x{res2[1]} @ {fps2:4.1f} FPS, {count2:5d} frames" if conn2 else "DISCONNECTED"
                print(f"[STATUS] Cam 1: {s1:<32} | Cam 2: {s2}")
                last_console_log = now

            # Check exit keys
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\n[INFO] Exit key pressed (Q/ESC). Stopping...")
                break

    except KeyboardInterrupt:
        print("\n[INFO] Interrupted by user (Ctrl+C). Stopping...")
    finally:
        print("-" * 68)
        print("[INFO] Shutting down stream readers...")
        cam1.stop()
        cam2.stop()
        cv2.destroyAllWindows()

        _, _, total1, avg_fps1, res1, _ = cam1.get_frame_and_stats()
        _, _, total2, avg_fps2, res2, _ = cam2.get_frame_and_stats()

        print(f"Camera 1: Total {total1} frames captured | Last resolution: {res1[0]}x{res1[1]} | FPS: {avg_fps1:.1f}")
        print(f"Camera 2: Total {total2} frames captured | Last resolution: {res2[0]}x{res2[1]} | FPS: {avg_fps2:.1f}")
        print("[INFO] Both camera captures released and OpenCV windows closed.")
        print("=" * 68)


if __name__ == "__main__":
    main()
