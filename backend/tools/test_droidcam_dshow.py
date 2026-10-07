"""DirectShow camera diagnostic tool.

Tests camera indexes 0 through 5 using cv2.CAP_DSHOW only.
Displays valid camera feeds in separate windows.
Press 'Q' or ESC to exit.
"""

from __future__ import annotations

import os
import sys
import cv2

# Suppress noisy OpenCV backend probe logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")


def main() -> None:
    print("=" * 65)
    print("DirectShow Camera Diagnostic (cv2.CAP_DSHOW only)")
    print("Testing camera indexes 0 through 5...")
    print("=" * 65)

    target_indexes = list(range(6))
    valid_caps: dict[int, cv2.VideoCapture] = {}

    for idx in target_indexes:
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if not cap.isOpened():
            print(f"Camera {idx}: Failed to open (cv2.CAP_DSHOW)")
            cap.release()
            continue

        ret, frame = cap.read()
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        valid_frame = bool(ret and frame is not None and frame.size > 0)

        print(
            f"Camera {idx}: Open=True | Resolution={width}x{height} | "
            f"Valid Frame Received={valid_frame}"
        )

        if valid_frame:
            valid_caps[idx] = cap
        else:
            cap.release()

    print("-" * 65)
    if not valid_caps:
        print("No valid camera feeds found using cv2.CAP_DSHOW on indexes 0-5.")
        return

    print(f"Active feeds found ({len(valid_caps)}): {list(valid_caps.keys())}")
    print("Displaying feeds in separate windows. Press 'Q' or ESC to exit.")
    print("-" * 65)

    for idx in valid_caps:
        cv2.namedWindow(f"Camera {idx}", cv2.WINDOW_NORMAL)

    try:
        while True:
            for idx, cap in valid_caps.items():
                ret, frame = cap.read()
                if ret and frame is not None:
                    cv2.imshow(f"Camera {idx}", frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\nExit key pressed (Q/ESC). Exiting...")
                break
    except KeyboardInterrupt:
        print("\nInterrupted by user (Ctrl+C). Exiting...")
    finally:
        for idx, cap in valid_caps.items():
            cap.release()
        cv2.destroyAllWindows()
        print("All camera captures released and OpenCV windows closed.")


if __name__ == "__main__":
    main()
