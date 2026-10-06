"""
tools/test_cameras.py
---------------------
Diagnostic script — run from the project root:

    python backend/tools/test_cameras.py

Prints which camera indexes OpenCV can open on this machine.
No arguments required. Safe to run with no cameras attached
(all cameras will report "unavailable").
"""

from __future__ import annotations

import os
import sys

# Allow running from repo root: python backend/tools/test_cameras.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Suppress OpenCV's verbose DSHOW/obsensor stderr warnings that appear when
# probing unavailable camera indexes — purely cosmetic noise.
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")

import cv2  # noqa: E402 — must come after env var

cv2.setLogLevel(0)  # 0 = silent

from app.camera.camera_manager import discover_cameras  # noqa: E402


def main() -> None:
    print("AI Fight Analyzer - Camera Discovery")
    print("=" * 38)

    result = discover_cameras()

    if not result.probed:
        print("No cameras probed.")
        return

    for cam in result.probed:
        if cam.available:
            res = ""
            if cam.width and cam.height:
                res = f"  [{int(cam.width)}x{int(cam.height)}]"
            frame_note = "  (frame OK)" if cam.frame_read else "  (frame FAILED)"
            backend = f"  backend={cam.backend}" if cam.backend else ""
            print(f"Camera {cam.index}: available{res}{frame_note}{backend}")
        else:
            print(f"Camera {cam.index}: unavailable")

    print()
    print(f"Summary: {len(result.available)} available, {len(result.unavailable)} unavailable")


if __name__ == "__main__":
    main()
