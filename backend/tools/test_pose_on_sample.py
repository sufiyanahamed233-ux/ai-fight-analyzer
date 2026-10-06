"""Diagnostic script to verify real-person pose inference using YOLO11s-Pose.

Usage:
    python backend/tools/test_pose_on_sample.py [path_to_image_or_video]

Outputs:
    - Model load confirmation
    - Number of persons detected
    - Keypoint count and standard COCO names/indexes
    - Confidence values and coordinates (pixel and normalized)
    - Image/video resolution
    - Inference time per frame (ms)
    - Approximate FPS for inference
"""

import argparse
import os
import shutil
import sys
import time
from pathlib import Path

# Suppress noisy OpenCV logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")

import cv2
import numpy as np

# Ensure backend package is in python path
backend_dir = Path(__file__).resolve().parents[1]
repo_root = backend_dir.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.pose.pose_detector import COCO_KEYPOINT_NAMES, DetectionResult, PoseDetector


def find_or_create_sample_image() -> str:
    """Find an available real-person sample image or copy one from bundled assets."""
    samples_dir = backend_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)
    sample_person_path = samples_dir / "sample_person.jpg"

    if sample_person_path.exists():
        return str(sample_person_path)

    # Check ultralytics bundled assets
    try:
        import ultralytics
        ultralytics_assets = Path(ultralytics.__file__).resolve().parent / "assets"
        for candidate in ["zidane.jpg", "bus.jpg"]:
            cand_path = ultralytics_assets / candidate
            if cand_path.exists():
                shutil.copy2(cand_path, sample_person_path)
                return str(sample_person_path)
    except Exception:
        pass

    raise FileNotFoundError("No sample real-person image found or could be copied.")


def run_image_diagnostic(detector: PoseDetector, image_path: str) -> None:
    """Run pose detector on a single image and print detailed diagnostics."""
    frame = cv2.imread(image_path)
    if frame is None:
        print(f"[ERROR] Could not load image from: {image_path}")
        sys.exit(1)

    h, w = frame.shape[:2]
    print(f"Image Path: {image_path}")
    print(f"Image Resolution: {w}x{h} (width x height)")

    # Warmup inference to initialize CUDA kernels
    _ = detector.detect(frame)

    # Benchmark run (average over 5 iterations for stable timing)
    iterations = 5
    times = []
    det_result: DetectionResult = None  # type: ignore
    for _ in range(iterations):
        t0 = time.perf_counter()
        det_result = detector.detect(frame)
        times.append((time.perf_counter() - t0) * 1000.0)

    avg_inference_ms = float(np.mean(times))
    fps = 1000.0 / avg_inference_ms if avg_inference_ms > 0 else 0.0

    print("=" * 60)
    print("DETECTION SUMMARY")
    print("=" * 60)
    print(f"Persons detected: {det_result.persons_detected}")
    print(f"Inference time per frame: {avg_inference_ms:.2f} ms (averaged over {iterations} runs)")
    print(f"Approximate inference FPS: {fps:.1f} FPS")

    if det_result.persons_detected == 0 or det_result.primary is None:
        print("[WARNING] No person detected in the sample image.")
        return

    primary = det_result.primary
    print("-" * 60)
    print(f"Primary Person Details (index: {primary.person_index}):")
    print(f"Detection confidence: {primary.confidence:.4f}")
    bx1, by1, bx2, by2 = primary.bbox_xyxy
    print(f"Bounding box (xyxy): [{bx1:.1f}, {by1:.1f}, {bx2:.1f}, {by2:.1f}]")
    print(f"Keypoint count: {len(primary.keypoints)}")
    print("-" * 60)
    print(f"{'Idx':<4} {'Keypoint Name':<16} {'Conf':<8} {'Pixel (X, Y)':<20} {'Norm (X, Y)':<18}")
    print("-" * 60)

    for kp in primary.keypoints:
        px_str = f"({kp.x_px:.1f}, {kp.y_px:.1f})"
        norm_str = f"({kp.x_norm:.3f}, {kp.y_norm:.3f})"
        print(f"{kp.index:<4} {kp.name:<16} {kp.confidence:<8.4f} {px_str:<20} {norm_str:<18}")

    print("-" * 60)


def run_video_diagnostic(detector: PoseDetector, video_path: str) -> None:
    """Run pose detector on a video and print diagnostics."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[ERROR] Could not open video from: {video_path}")
        sys.exit(1)

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Video Path: {video_path}")
    print(f"Video Resolution: {w}x{h}, Total Frames: {total_frames}")

    frame_count = 0
    inference_times = []
    detected_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1
        t0 = time.perf_counter()
        result = detector.detect(frame)
        inference_times.append((time.perf_counter() - t0) * 1000.0)

        if result.persons_detected > 0:
            detected_count += 1

    cap.release()

    avg_ms = float(np.mean(inference_times)) if inference_times else 0.0
    fps = 1000.0 / avg_ms if avg_ms > 0 else 0.0

    print("=" * 60)
    print("VIDEO DETECTION SUMMARY")
    print("=" * 60)
    print(f"Processed frames: {frame_count}")
    print(f"Frames with person detected: {detected_count} ({detected_count / max(1, frame_count) * 100:.1f}%)")
    print(f"Average inference time per frame: {avg_ms:.2f} ms")
    print(f"Approximate inference FPS: {fps:.1f} FPS")


def main() -> None:
    parser = argparse.ArgumentParser(description="Test YOLO11s-Pose on sample image or video.")
    parser.add_argument("source", nargs="?", help="Path to sample image or video file.")
    args = parser.parse_args()

    sample_path = args.source
    if not sample_path:
        sample_path = find_or_create_sample_image()

    print("=" * 60)
    print("AI Fight Analyzer - Real-Person Pose Inference Diagnostic")
    print("=" * 60)

    # Initialize PoseDetector
    detector = PoseDetector()
    print(f"Model loaded: {detector.resolved_model_path}")
    print(f"Using device: {detector.model.device}")

    # Check if image or video
    ext = Path(sample_path).suffix.lower()
    if ext in [".avi", ".mp4", ".mov", ".mkv"]:
        run_video_diagnostic(detector, sample_path)
    else:
        run_image_diagnostic(detector, sample_path)

    print("=" * 60)
    print("Diagnostic completed successfully.")


if __name__ == "__main__":
    main()
