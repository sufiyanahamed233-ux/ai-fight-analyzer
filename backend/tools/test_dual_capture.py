"""
tools/test_dual_capture.py
--------------------------
Diagnostic script — run from the repo root:

    python backend/tools/test_dual_capture.py

Opens Camera 0 (front) and Camera 1 (side), records a short 5-second test
session, saves output files, then prints a full summary report.

Safe to run with missing cameras — it will report the error cleanly.
"""

from __future__ import annotations

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

from app.camera.recorder import DualCameraRecorder  # noqa: E402

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
    print("AI Fight Analyzer - Dual Camera Diagnostic")
    print("=" * 46)
    print(f"  Duration : {TEST_DURATION}s")
    print(f"  Front    : Camera 0")
    print(f"  Side     : Camera 1")
    print(f"  Output   : {OUTPUT_DIR}")
    print()
    print("Recording… ", end="", flush=True)

    recorder = DualCameraRecorder(
        front_index=0,
        side_index=1,
        duration=TEST_DURATION,
        output_dir=OUTPUT_DIR,
    )
    session = recorder.record()

    print("done.")
    print()
    print("-" * 46)
    print(f"Session ID      : {session.session_id}")
    print(f"Started at      : {session.started_at}")
    print(f"Elapsed         : {session.elapsed_seconds:.2f}s")
    print()

    for cam_result in (session.front, session.side):
        label = f"Camera {cam_result.index} ({cam_result.role.value.upper()})"
        if cam_result.success:
            fps_actual = (
                cam_result.frame_count / session.elapsed_seconds
                if session.elapsed_seconds > 0
                else 0
            )
            print(f"[OK]  {label}")
            print(f"      Frames    : {cam_result.frame_count}")
            print(f"      FPS       : {fps_actual:.1f} (effective)")
            print(f"      Res       : {cam_result.actual_width}x{cam_result.actual_height}")
            print(f"      Video     : {_fmt_path(cam_result.video_path)}")
            print(f"      Size      : {_file_size(cam_result.video_path)}")
            print(f"      Timestamps: {_fmt_path(cam_result.timestamps_path)}")
        else:
            print(f"[ERR] {label}")
            print(f"      Error     : {cam_result.error}")
        print()

    print("-" * 46)
    if session.success:
        print("Result: SUCCESS - both cameras recorded successfully.")
    else:
        print(f"Result: PARTIAL/FAILURE — {session.error}")
    print()


if __name__ == "__main__":
    main()
