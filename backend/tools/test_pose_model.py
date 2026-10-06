"""
tools/test_pose_model.py
------------------------
CV environment verification script for AI Fight Analyzer.

Run from the repo root:

    python backend/tools/test_pose_model.py

Verifies:
  - Python version
  - PyTorch version + CUDA availability + GPU name
  - Ultralytics version
  - yolo11s-pose.pt loads correctly
  - One inference pass on a synthetic image completes without error

No camera, no recording, no fight analysis — environment check only.
"""

from __future__ import annotations

import os
import sys

# Allow running from repo root: python backend/tools/test_pose_model.py
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Silence OpenCV and Ultralytics verbose output during the probe
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")

import cv2                          # noqa: E402
import numpy as np                  # noqa: E402
import torch                        # noqa: E402
import ultralytics                  # noqa: E402
from ultralytics import YOLO        # noqa: E402

cv2.setLogLevel(0)

# ---------------------------------------------------------------------------
# Model path: search venv root, CWD, and script dir
# ---------------------------------------------------------------------------
_SEARCH_DIRS = [
    os.path.join(os.path.dirname(__file__), ".."),   # backend/
    os.path.dirname(__file__),                        # backend/tools/
    os.getcwd(),                                      # wherever you launched from
]
_MODEL_NAME = "yolo11s-pose.pt"


def _find_model() -> str:
    for d in _SEARCH_DIRS:
        candidate = os.path.join(d, _MODEL_NAME)
        if os.path.isfile(candidate):
            return candidate
    # Fall back to letting Ultralytics auto-download it
    return _MODEL_NAME


def _section(title: str) -> None:
    print(f"\n{'=' * 46}")
    print(f"  {title}")
    print(f"{'=' * 46}")


def main() -> None:
    print("AI Fight Analyzer - CV Environment Check")
    print("=" * 46)

    # ------------------------------------------------------------------
    # 1. Python
    # ------------------------------------------------------------------
    _section("Python")
    print(f"  Version : {sys.version.split()[0]}")
    print(f"  Exec    : {sys.executable}")

    # ------------------------------------------------------------------
    # 2. PyTorch + CUDA
    # ------------------------------------------------------------------
    _section("PyTorch")
    print(f"  Version       : {torch.__version__}")
    cuda_ok = torch.cuda.is_available()
    print(f"  CUDA available: {cuda_ok}")
    if cuda_ok:
        gpu_name = torch.cuda.get_device_name(0)
        cuda_ver = torch.version.cuda
        vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
        print(f"  GPU           : {gpu_name}")
        print(f"  CUDA version  : {cuda_ver}")
        print(f"  VRAM          : {vram_gb:.1f} GB")
    else:
        print("  GPU           : NONE (CPU-only mode)")

    # ------------------------------------------------------------------
    # 3. OpenCV
    # ------------------------------------------------------------------
    _section("OpenCV")
    print(f"  Version : {cv2.__version__}")

    # ------------------------------------------------------------------
    # 4. Ultralytics
    # ------------------------------------------------------------------
    _section("Ultralytics")
    print(f"  Version : {ultralytics.__version__}")

    # ------------------------------------------------------------------
    # 5. Load YOLO pose model
    # ------------------------------------------------------------------
    _section("YOLO Pose Model")
    model_path = _find_model()
    print(f"  Loading : {model_path}")
    try:
        model = YOLO(model_path)
        print(f"  Task    : {model.task}")
        print(f"  Type    : {type(model.model).__name__}")
        print("  Status  : LOADED OK")
    except Exception as exc:
        print(f"  ERROR   : {exc}")
        sys.exit(1)

    # ------------------------------------------------------------------
    # 6. Inference on a synthetic image
    # ------------------------------------------------------------------
    _section("Inference Check")
    # 640x480 RGB image filled with a mid-grey gradient — valid input for pose
    synthetic = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.rectangle(synthetic, (100, 50), (540, 430), (180, 180, 180), -1)   # body-ish rect
    cv2.circle(synthetic, (320, 90), 60, (200, 200, 200), -1)              # head-ish circle

    print("  Image   : 640x480 synthetic (no real person — detections may be empty)")
    print("  Running inference…")
    try:
        results = model(synthetic, verbose=False)
        n_det = len(results[0].boxes) if results[0].boxes is not None else 0
        print(f"  Done    : {len(results)} result(s), {n_det} detection(s)")
        print("  Status  : INFERENCE OK")
    except Exception as exc:
        print(f"  ERROR   : {exc}")
        sys.exit(1)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    _section("Summary")
    device = f"CUDA ({torch.cuda.get_device_name(0)})" if cuda_ok else "CPU"
    print(f"  Python      : {sys.version.split()[0]}")
    print(f"  PyTorch     : {torch.__version__}")
    print(f"  Device      : {device}")
    print(f"  OpenCV      : {cv2.__version__}")
    print(f"  Ultralytics : {ultralytics.__version__}")
    print(f"  Model       : {_MODEL_NAME}  [task={model.task}]")
    print()
    print("  All checks passed. CV environment is ready.")
    print()


if __name__ == "__main__":
    main()
