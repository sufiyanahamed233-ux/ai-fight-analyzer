"""Diagnostic tool for temporal pose sequence processing on video files.

Usage:
    python backend/tools/test_pose_sequence.py [path_to_video]

Outputs:
    - Video resolution
    - Source FPS
    - Total frames
    - Duration
    - Number of frames processed
    - Number of frames with a detected person
    - Number of frames without a detected person
    - Average pose inference time per frame
    - Overall processing FPS
"""

import argparse
import glob
import os
import sys
import time
from pathlib import Path

# Suppress noisy OpenCV logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")

import cv2

# Ensure backend package is in python path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.analysis.pose_sequence import PoseSequenceAnalyzer
from app.pose.pose_detector import PoseDetector


def find_or_create_sample_video() -> str:
    """Find a recorded sample video or generate one from real-person sample image."""
    # Check existing camera recordings first
    recordings_dir = backend_dir / "recordings"
    if recordings_dir.exists():
        avi_files = sorted(
            glob.glob(str(recordings_dir / "**" / "*.avi"), recursive=True),
            key=os.path.getsize,
            reverse=True,
        )
        for avi in avi_files:
            if os.path.getsize(avi) > 50000:  # Real recorded video with data
                return avi

    # Fallback: create a 2-second (60 frames) test video from sample_person.jpg
    samples_dir = backend_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)
    sample_video_path = samples_dir / "sample_person_video.avi"

    if sample_video_path.exists() and os.path.getsize(sample_video_path) > 10000:
        return str(sample_video_path)

    sample_img_path = samples_dir / "sample_person.jpg"
    if not sample_img_path.exists():
        # Try copying from ultralytics assets
        import ultralytics
        cand = Path(ultralytics.__file__).resolve().parent / "assets" / "zidane.jpg"
        if cand.exists():
            import shutil
            shutil.copy2(cand, sample_img_path)

    frame = cv2.imread(str(sample_img_path))
    if frame is None:
        raise FileNotFoundError("Could not find or create a sample video/image.")

    h, w = frame.shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*"XVID")
    writer = cv2.VideoWriter(str(sample_video_path), fourcc, 30.0, (w, h))
    for _ in range(60):
        writer.write(frame)
    writer.release()

    return str(sample_video_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Test temporal pose sequence analysis on video.")
    parser.add_argument("video_path", nargs="?", help="Path to local video file.")
    parser.add_argument("--max-frames", type=int, default=None, help="Max frames to process.")
    args = parser.parse_args()

    video_path = args.video_path
    if not video_path:
        video_path = find_or_create_sample_video()

    print("=" * 60)
    print("AI Fight Analyzer - Temporal Pose Sequence Diagnostic")
    print("=" * 60)
    print(f"Video File: {video_path}")

    # Initialize existing PoseDetector (loads model once)
    detector = PoseDetector()
    print(f"Pose Detector loaded on device: {detector.model.device}")

    # Inspect source video metadata
    cap = cv2.VideoCapture(video_path)
    total_frames_in_file = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    source_fps = float(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    print(f"Video Resolution: {width}x{height}")
    print(f"Source FPS: {source_fps:.2f}")
    print(f"Total Video Frames: {total_frames_in_file}")
    calc_duration = (total_frames_in_file / source_fps) if source_fps > 0 else 0.0
    print(f"Source Duration: {calc_duration:.2f} seconds")

    print("-" * 60)
    print("Processing video frames sequentially...")

    analyzer = PoseSequenceAnalyzer(detector=detector)

    start_time = time.perf_counter()
    sequence = analyzer.process_video(video_path, max_frames=args.max_frames)
    total_processing_time = time.perf_counter() - start_time

    processed_count = sequence.frame_count
    detected_count = sequence.detected_frames_count
    undetected_count = sequence.undetected_frames_count

    avg_ms_per_frame = (total_processing_time / processed_count * 1000.0) if processed_count > 0 else 0.0
    processing_fps = (processed_count / total_processing_time) if total_processing_time > 0 else 0.0

    print("=" * 60)
    print("SEQUENCE PROCESSING RESULTS")
    print("=" * 60)
    print(f"Frames processed: {processed_count}")
    print(f"Frames with detected person: {detected_count} ({detected_count / max(1, processed_count) * 100:.1f}%)")
    print(f"Frames without detected person: {undetected_count} ({undetected_count / max(1, processed_count) * 100:.1f}%)")
    print(f"Sequence duration: {sequence.duration:.2f} seconds")
    print(f"Timestamp source: {sequence.timestamp_source}")
    print(f"Total processing wall time: {total_processing_time:.3f} seconds")
    print(f"Average processing time per frame: {avg_ms_per_frame:.2f} ms")
    print(f"Processing FPS: {processing_fps:.1f} FPS")

    # Sample keypoint inspection from first detected frame
    first_detected = next((f for f in sequence.frames if f.detection_present), None)
    if first_detected:
        print("-" * 60)
        print(f"Sample Frame Observation (Frame Index {first_detected.frame_index}, t={first_detected.timestamp:.3f}s):")
        print(f"Person confidence: {first_detected.person_confidence:.4f}")
        print(f"Keypoint count: {len(first_detected.keypoints)}")
        nose = first_detected.get_keypoint("nose")
        if nose:
            print(f"Nose: px=({nose.x_px:.1f}, {nose.y_px:.1f}), norm=({nose.x_norm:.3f}, {nose.y_norm:.3f}), conf={nose.confidence:.4f}")
        lw = first_detected.get_keypoint("left_wrist")
        rw = first_detected.get_keypoint("right_wrist")
        if lw:
            print(f"Left Wrist: px=({lw.x_px:.1f}, {lw.y_px:.1f}), norm=({lw.x_norm:.3f}, {lw.y_norm:.3f}), conf={lw.confidence:.4f}")
        if rw:
            print(f"Right Wrist: px=({rw.x_px:.1f}, {rw.y_px:.1f}), norm=({rw.x_norm:.3f}, {rw.y_norm:.3f}), conf={rw.confidence:.4f}")

    print("=" * 60)
    print("Sequence processing diagnostic completed successfully.")


if __name__ == "__main__":
    main()
