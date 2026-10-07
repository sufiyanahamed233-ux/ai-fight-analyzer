"""
tools/test_dual_capture.py
--------------------------
Diagnostic script — run from the repo root:

    python backend/tools/test_dual_capture.py
    python backend/tools/test_dual_capture.py --front 0 --side 1

Records a short test session from both FRONT and SIDE cameras (defaulting to
USB DroidCam MJPEG endpoints http://127.0.0.1:4747/video and http://127.0.0.1:4748/video),
saves rotated 1280x720 video files (AVI/XVID) and timestamps, then prints a full summary report.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# Allow running from repo root: python backend/tools/test_dual_capture.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Silence OpenCV's internal DSHOW probe noise
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
import cv2  # noqa: E402
cv2.setLogLevel(0)

from app.camera.recorder import (  # noqa: E402
    DEFAULT_FRONT_URL,
    DEFAULT_ROTATION,
    DEFAULT_SIDE_URL,
    DualCameraRecorder,
)

logging.basicConfig(level=logging.WARNING)

TEST_DURATION = 5.0   # seconds
OUTPUT_DIR = Path(__file__).parent.parent / "recordings"


def _fmt_path(p) -> str:
    return str(p) if p else "N/A (no frames captured)"


def _file_size(p) -> str:
    if p and Path(p).exists():
        kb = Path(p).stat().st_size / 1024
        return f"{kb:.1f} KB"
    return "—"


def main() -> None:
    parser = argparse.ArgumentParser(description="Dual camera diagnostic recording tool.")
    parser.add_argument(
        "--front",
        default=DEFAULT_FRONT_URL,
        help=f"Front camera URL or index (default: {DEFAULT_FRONT_URL}).",
    )
    parser.add_argument(
        "--side",
        default=DEFAULT_SIDE_URL,
        help=f"Side camera URL or index (default: {DEFAULT_SIDE_URL}).",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=TEST_DURATION,
        help=f"Recording duration in seconds (default: {TEST_DURATION}).",
    )
    parser.add_argument(
        "--rotation",
        type=int,
        default=DEFAULT_ROTATION,
        help=f"Clockwise rotation in degrees (0, 90, 180, 270; default: {DEFAULT_ROTATION}).",
    )
    args = parser.parse_args()

    # Cast to integer if numeric index
    front_source = int(args.front) if args.front.isdigit() else args.front
    side_source = int(args.side) if args.side.isdigit() else args.side

    print("AI Fight Analyzer - Dual Camera Diagnostic")
    print("=" * 60)
    print(f"  Duration : {args.duration}s")
    print(f"  Front    : {front_source}")
    print(f"  Side     : {side_source}")
    print(f"  Rotation : {args.rotation}°")
    print(f"  Output   : {OUTPUT_DIR}")
    print()
    print("Recording… ", end="", flush=True)

    recorder = DualCameraRecorder(
        front_source=front_source,
        side_source=side_source,
        duration=args.duration,
        output_dir=OUTPUT_DIR,
        front_rotation=args.rotation,
        side_rotation=args.rotation,
    )
    session = recorder.record()

    print("done.")
    print()
    print("-" * 60)
    print(f"Session ID      : {session.session_id}")
    print(f"Started at      : {session.started_at}")
    print(f"Elapsed         : {session.elapsed_seconds:.2f}s")
    print()

    for cam_result in (session.front, session.side):
        label = f"Camera ({cam_result.role.value.upper()}) -> {cam_result.source}"
        if cam_result.success:
            fps_actual = (
                cam_result.frame_count / session.elapsed_seconds
                if session.elapsed_seconds > 0
                else 0
            )
            print(f"[OK]  {label}")
            print(f"      Frames    : {cam_result.frame_count}")
            print(f"      FPS       : {fps_actual:.1f} (effective)")
            print(f"      Res       : {cam_result.actual_width}x{cam_result.actual_height} (rotation={cam_result.rotation}°)")
            print(f"      Video     : {_fmt_path(cam_result.video_path)}")
            print(f"      Size      : {_file_size(cam_result.video_path)}")
            print(f"      Timestamps: {_fmt_path(cam_result.timestamps_path)}")
        else:
            print(f"[ERR] {label}")
            print(f"      Error     : {cam_result.error}")
        print()

    print("-" * 60)
    if session.success:
        print("Result: SUCCESS - both cameras recorded successfully.")
    else:
        print(f"Result: PARTIAL/FAILURE — {session.error}")
    print("=" * 60)


if __name__ == "__main__":
    main()
