"""YOLO11s-Pose detector for AI Fight Analyzer.

Loads the YOLO pose model once and performs per-frame pose estimation,
returning structured 17 COCO keypoints in both pixel and normalized coordinates.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from ultralytics import YOLO

logger = logging.getLogger(__name__)

# Standard COCO 17-keypoint order used by YOLO Pose models
COCO_KEYPOINT_NAMES: Tuple[str, ...] = (
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
)


@dataclass
class Keypoint:
    """Single body keypoint with pixel and normalized coordinates."""

    name: str
    index: int
    x_px: float
    y_px: float
    x_norm: float
    y_norm: float
    confidence: float


@dataclass
class PoseResult:
    """Detected person's pose and bounding box."""

    person_index: int
    bbox_xyxy: Tuple[float, float, float, float]
    confidence: float
    keypoints: List[Keypoint]
    image_width: int
    image_height: int

    def get_keypoint(self, name: str) -> Optional[Keypoint]:
        """Look up keypoint by standard COCO name."""
        for kp in self.keypoints:
            if kp.name == name:
                return kp
        return None


@dataclass
class DetectionResult:
    """Result of pose detection on a single frame."""

    persons_detected: int
    primary: Optional[PoseResult] = None
    all_persons: List[PoseResult] = field(default_factory=list)
    inference_time_ms: float = 0.0
    image_width: int = 0
    image_height: int = 0


def _resolve_model_path(model_path: str = "yolo11s-pose.pt") -> str:
    """Resolve model path by checking repo root and backend directory."""
    if os.path.isabs(model_path) and os.path.exists(model_path):
        return model_path

    # Candidate locations
    here = Path(__file__).resolve()
    repo_root = here.parents[3]  # backend/app/pose -> repo_root
    backend_dir = here.parents[2]

    candidates = [
        Path(model_path),
        repo_root / model_path,
        backend_dir / model_path,
    ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate.resolve())

    # Fallback to model name string (Ultralytics handles downloads if needed)
    return model_path


class PoseDetector:
    """Detector wrapper around Ultralytics YOLO11s-Pose."""

    def __init__(
        self,
        model_path: str = "yolo11s-pose.pt",
        device: str = "auto",
        conf_threshold: float = 0.25,
    ):
        """Initialize the detector and load the model into memory once.

        Args:
            model_path: Path or name of the YOLO pose weights file.
            device: 'auto' (detects cuda/cpu), 'cuda', or 'cpu'.
            conf_threshold: Minimum detection confidence threshold.
        """
        self.resolved_model_path = _resolve_model_path(model_path)
        self.conf_threshold = conf_threshold

        if device == "auto" or device is None:
            try:
                import torch
                self.device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                self.device = "cpu"
        else:
            self.device = device

        logger.info(f"Loading YOLO pose model from {self.resolved_model_path} on {self.device}...")
        self.model = YOLO(self.resolved_model_path)
        if self.device != "cpu":
            try:
                self.model.to(self.device)
            except Exception as e:
                logger.warning(f"Failed to move model to {self.device}: {e}")
        self.model_loaded = True

    def detect(self, frame: np.ndarray) -> DetectionResult:
        """Run pose detection on an input image frame.

        Args:
            frame: BGR numpy image from OpenCV.

        Returns:
            DetectionResult containing primary person and all detected poses.
        """
        if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
            return DetectionResult(persons_detected=0)

        h, w = frame.shape[:2]
        if h == 0 or w == 0:
            return DetectionResult(persons_detected=0, image_width=w, image_height=h)

        start_time = time.perf_counter()

        predict_kwargs = {
            "conf": self.conf_threshold,
            "verbose": False,
        }
        if self.device is not None:
            predict_kwargs["device"] = self.device

        results = self.model(frame, **predict_kwargs)
        inference_time_ms = (time.perf_counter() - start_time) * 1000.0

        if not results:
            return DetectionResult(
                persons_detected=0,
                inference_time_ms=inference_time_ms,
                image_width=w,
                image_height=h,
            )

        res = results[0]
        if res.boxes is None or len(res.boxes) == 0 or res.keypoints is None:
            return DetectionResult(
                persons_detected=0,
                inference_time_ms=inference_time_ms,
                image_width=w,
                image_height=h,
            )

        num_persons = len(res.boxes)
        boxes_xyxy = res.boxes.xyxy.cpu().numpy()
        boxes_conf = res.boxes.conf.cpu().numpy()

        # Keypoints: xy (pixels), xyn (normalized), conf
        kp_xy = res.keypoints.xy.cpu().numpy() if res.keypoints.xy is not None else None
        kp_xyn = res.keypoints.xyn.cpu().numpy() if res.keypoints.xyn is not None else None
        kp_conf = (
            res.keypoints.conf.cpu().numpy()
            if getattr(res.keypoints, "conf", None) is not None
            else None
        )

        all_persons: List[PoseResult] = []

        for p_idx in range(num_persons):
            box = tuple(float(c) for c in boxes_xyxy[p_idx])
            p_conf = float(boxes_conf[p_idx])

            keypoints: List[Keypoint] = []
            for kp_idx, name in enumerate(COCO_KEYPOINT_NAMES):
                if kp_xy is not None and kp_idx < kp_xy.shape[1]:
                    x_px = float(kp_xy[p_idx, kp_idx, 0])
                    y_px = float(kp_xy[p_idx, kp_idx, 1])
                else:
                    x_px, y_px = 0.0, 0.0

                if kp_xyn is not None and kp_idx < kp_xyn.shape[1]:
                    x_norm = float(kp_xyn[p_idx, kp_idx, 0])
                    y_norm = float(kp_xyn[p_idx, kp_idx, 1])
                else:
                    x_norm = max(0.0, min(1.0, x_px / w)) if w > 0 else 0.0
                    y_norm = max(0.0, min(1.0, y_px / h)) if h > 0 else 0.0

                if kp_conf is not None and kp_idx < kp_conf.shape[1]:
                    conf = float(kp_conf[p_idx, kp_idx])
                else:
                    conf = 1.0 if (x_px > 0 or y_px > 0) else 0.0

                keypoints.append(
                    Keypoint(
                        name=name,
                        index=kp_idx,
                        x_px=x_px,
                        y_px=y_px,
                        x_norm=x_norm,
                        y_norm=y_norm,
                        confidence=conf,
                    )
                )

            all_persons.append(
                PoseResult(
                    person_index=p_idx,
                    bbox_xyxy=box,  # type: ignore
                    confidence=p_conf,
                    keypoints=keypoints,
                    image_width=w,
                    image_height=h,
                )
            )

        # Primary person selection: highest bounding box confidence
        primary = max(all_persons, key=lambda p: p.confidence) if all_persons else None

        return DetectionResult(
            persons_detected=len(all_persons),
            primary=primary,
            all_persons=all_persons,
            inference_time_ms=inference_time_ms,
            image_width=w,
            image_height=h,
        )
