"""Simultaneous raw camera diagnostic tool for AI Fight Analyzer.

Opens camera indexes 0, 1, and 2 simultaneously using OpenCV.
Displays each raw feed in its own OpenCV window ("Camera 0", "Camera 1", "Camera 2").
Prints backend, resolution, and FPS for each camera.
No YOLO or project modules are used.

Usage:
    python backend/tools/test_raw_cameras.py
"""

from __future__ import annotations

import os
import sys
import time
from typing import Dict, Optional

# Suppress noisy OpenCV DSHOW/backend probe logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")

import cv2

cv2.setLogLevel(0)


def open_camera(index: int) -> Optional[cv2.VideoCapture]:
    """Open camera index using DirectShow on Windows, falling back to default backend."""
    # Try CAP_DSHOW first (standard on Windows for webcams)
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if cap.isOpened():
        ret, frame = cap.read()
        if ret and frame is not None and frame.size > 0:
            return cap
        cap.release()

    # Fallback to default backend (e.g., MSMF)
    cap = cv2.VideoCapture(index)
    if cap.isOpened():
        ret, frame = cap.read()
        if ret and frame is not None and frame.size > 0:
            return cap
        cap.release()

    return None


def main() -> None:
    target_indexes = [0, 1, 2]
    caps: Dict[int, cv2.VideoCapture] = {}
    frame_counts: Dict[int, int] = {idx: 0 for idx in target_indexes}
    fps_start_times: Dict[int, float] = {}

    print("=" * 65)
    print("AI Fight Analyzer - Simultaneous Raw Camera Diagnostic")
    print("=" * 65)
    print(f"Opening camera indexes: {target_indexes} simultaneously...\n")

    # 1. Open all cameras
    for idx in target_indexes:
        cap = open_camera(idx)
        if cap is not None and cap.isOpened():
            caps[idx] = cap
            backend = cap.getBackendName()
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            reported_fps = cap.get(cv2.CAP_PROP_FPS)

            print(
                f"[OK]  Camera {idx} opened successfully:\n"
                f"      Backend    : {backend}\n"
                f"      Resolution : {w}x{h}\n"
                f"      Reported FPS: {reported_fps:.1f}\n"
            )
        else:
            print(f"[FAIL] Camera {idx} could not be opened.\n")

    if not caps:
        print("[ERROR] None of the requested cameras (0, 1, 2) could be opened.")
        sys.exit(1)

    # 2. Setup separate OpenCV windows for each open camera
    for idx in caps:
        window_name = f"Camera {idx}"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        fps_start_times[idx] = time.perf_counter()

    print("-" * 65)
    print("Streaming live feeds in separate windows:")
    for idx in caps:
        print(f"  - Window: 'Camera {idx}'")
    print("\nPress 'Q' (or ESC) in any window to exit.")
    print("-" * 65)

    last_log_time = time.perf_counter()
    loop_start_time = time.perf_counter()

    try:
        while True:
            # Read and display a frame from each camera
            for idx, cap in list(caps.items()):
                ret, frame = cap.read()
                if ret and frame is not None:
                    frame_counts[idx] += 1
                    cv2.imshow(f"Camera {idx}", frame)

            # Check keypress for clean exit
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\n[INFO] 'Q' pressed. Exiting...")
                break

            # Periodically print real-time measured FPS every 2 seconds
            now = time.perf_counter()
            if now - last_log_time >= 2.0:
                elapsed = now - loop_start_time
                fps_strings = []
                for idx in caps:
                    measured_fps = frame_counts[idx] / elapsed if elapsed > 0 else 0.0
                    fps_strings.append(f"Camera {idx}: {measured_fps:4.1f} FPS")
                print(f"[Live FPS] {' | '.join(fps_strings)}")
                last_log_time = now

    except KeyboardInterrupt:
        print("\n[INFO] Interrupted by user (Ctrl+C). Exiting...")
    finally:
        total_elapsed = time.perf_counter() - loop_start_time
        print("-" * 65)
        print("SUMMARY:")
        for idx in target_indexes:
            if idx in caps:
                cap = caps[idx]
                backend = cap.getBackendName()
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                count = frame_counts[idx]
                effective_fps = count / total_elapsed if total_elapsed > 0 else 0.0
                print(
                    f"Camera {idx}: Backend={backend}, Resolution={w}x{h}, "
                    f"Frames={count}, Effective FPS={effective_fps:.1f}"
                )
                cap.release()
            else:
                print(f"Camera {idx}: Not available")

        cv2.destroyAllWindows()
        print("\n[INFO] All camera handles released and OpenCV windows closed cleanly.")
        print("=" * 65)


if __name__ == "__main__":
    main()
