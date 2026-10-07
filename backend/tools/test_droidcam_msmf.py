"""Standalone MSMF Camera Diagnostic for Camera Index 1.

Tests camera index 1 using cv2.CAP_MSMF across resolutions (1280x720, 640x480)
and pixel formats (MJPG, YUY2).
Reports opened status, actual resolution, frame validity, and BGR mean/std.
Displays the successful live feed in an OpenCV window until Q/ESC is pressed.
"""

from __future__ import annotations

import os
import sys
import time
from typing import Optional, Tuple
import cv2

# Suppress noisy OpenCV backend logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")


def test_configuration(
    cam_index: int,
    target_w: int,
    target_h: int,
    fourcc_str: str,
) -> Tuple[bool, int, int, bool, Optional[Tuple[float, float, float]], Optional[Tuple[float, float, float]]]:
    """Test a specific resolution and codec configuration on the camera index."""
    cap = cv2.VideoCapture(cam_index, cv2.CAP_MSMF)
    opened = cap.isOpened()
    if not opened:
        cap.release()
        return False, 0, 0, False, None, None

    # Set codec and resolution
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc_str))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, target_w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, target_h)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Read frames with warmup
    valid_frame = False
    captured_frame = None
    for _ in range(10):
        ret, frame = cap.read()
        if ret and frame is not None and frame.size > 0:
            valid_frame = True
            captured_frame = frame
            break
        time.sleep(0.05)

    bgr_mean = None
    bgr_std = None
    if valid_frame and captured_frame is not None:
        mean_vals = captured_frame.mean(axis=(0, 1))
        std_vals = captured_frame.std(axis=(0, 1))
        bgr_mean = (float(mean_vals[0]), float(mean_vals[1]), float(mean_vals[2]))
        bgr_std = (float(std_vals[0]), float(std_vals[1]), float(std_vals[2]))

    cap.release()
    return opened, actual_w, actual_h, valid_frame, bgr_mean, bgr_std


def main() -> None:
    cam_index = 1
    print("=" * 70)
    print("MSMF Diagnostic Tool - Camera Index 1 (cv2.CAP_MSMF)")
    print("=" * 70)

    # Test combinations: 1280x720 and 640x480 with MJPG, then YUY2
    configurations = [
        (1280, 720, "MJPG"),
        (640, 480, "MJPG"),
        (1280, 720, "YUY2"),
        (640, 480, "YUY2"),
    ]

    successful_config = None

    for target_w, target_h, fourcc_str in configurations:
        print(f"\n--- Testing: {target_w}x{target_h} [{fourcc_str}] ---")
        opened, actual_w, actual_h, valid, mean, std = test_configuration(
            cam_index=cam_index,
            target_w=target_w,
            target_h=target_h,
            fourcc_str=fourcc_str,
        )

        print(f"  - Opened               : {opened}")
        print(f"  - Actual Resolution    : {actual_w}x{actual_h}")
        print(f"  - Valid Frame Received : {valid}")
        if valid and mean is not None and std is not None:
            print(
                f"  - BGR Mean             : B={mean[0]:.2f}, G={mean[1]:.2f}, R={mean[2]:.2f}"
            )
            print(
                f"  - BGR Std              : B={std[0]:.2f}, G={std[1]:.2f}, R={std[2]:.2f}"
            )
            if successful_config is None:
                successful_config = (target_w, target_h, fourcc_str)
        else:
            print("  - BGR Mean/Std         : N/A (no valid frames)")

    print("\n" + "=" * 70)
    if successful_config is None:
        print("[ERROR] None of the configurations produced valid frames with cv2.CAP_MSMF.")
        sys.exit(1)

    disp_w, disp_h, disp_fourcc = successful_config
    print(f"[SUCCESS] Starting live feed with: {disp_w}x{disp_h} [{disp_fourcc}]")
    print("Press 'Q' or ESC in the video window to quit.")
    print("=" * 70)

    # Reopen camera with the successful configuration for live streaming
    cap = cv2.VideoCapture(cam_index, cv2.CAP_MSMF)
    if not cap.isOpened():
        print(f"[ERROR] Could not reopen Camera {cam_index} for live display.")
        sys.exit(1)

    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*disp_fourcc))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, disp_w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, disp_h)

    window_name = f"Camera {cam_index} (MSMF - {disp_fourcc} {disp_w}x{disp_h})"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    try:
        while True:
            ret, frame = cap.read()
            if ret and frame is not None:
                cv2.imshow(window_name, frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\n[INFO] Exit requested by user (Q/ESC).")
                break
    except KeyboardInterrupt:
        print("\n[INFO] Interrupted by user (Ctrl+C).")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("[INFO] Camera released and window closed cleanly.")


if __name__ == "__main__":
    main()
