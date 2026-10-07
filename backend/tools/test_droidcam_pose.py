"""Live camera pose estimation tool for AI Fight Analyzer.

Captures live video from an OpenCV camera (e.g., DroidCam or webcam),
runs YOLO11s-Pose on every frame using CUDA via PoseDetector,
draws the 17-keypoint skeleton overlay, displays person detection status and FPS,
and logs inference timing.

Usage:
    python backend/tools/test_droidcam_pose.py [camera_index]
    python backend/tools/test_droidcam_pose.py --camera 0
    python backend/tools/test_droidcam_pose.py --camera 1 --device cuda
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Tuple, Union

# Suppress noisy OpenCV logs
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")

import cv2
import numpy as np

# Ensure backend package is in python path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.pose.pose_detector import DetectionResult, PoseDetector, PoseResult

# 16 COCO skeleton edges connecting the 17 standard keypoints:
#  0: nose, 1: left_eye, 2: right_eye, 3: left_ear, 4: right_ear,
#  5: left_shoulder, 6: right_shoulder, 7: left_elbow, 8: right_elbow,
#  9: left_wrist, 10: right_wrist, 11: left_hip, 12: right_hip,
# 13: left_knee, 14: right_knee, 15: left_ankle, 16: right_ankle
SKELETON_EDGES: list[Tuple[int, int]] = [
    # Facial connections
    (0, 1),
    (0, 2),
    (1, 3),
    (2, 4),
    # Upper body / Arms
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    # Torso
    (5, 11),
    (6, 12),
    (11, 12),
    # Lower body / Legs
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
]

# Color mapping for limbs (BGR format)
EDGE_COLORS: dict[Tuple[int, int], Tuple[int, int, int]] = {
    # Face (lavender / light blue)
    (0, 1): (255, 180, 100),
    (0, 2): (255, 180, 100),
    (1, 3): (255, 180, 100),
    (2, 4): (255, 180, 100),
    # Shoulders / Torso (bright yellow)
    (5, 6): (0, 255, 255),
    (5, 11): (0, 255, 255),
    (6, 12): (0, 255, 255),
    (11, 12): (0, 255, 255),
    # Left limbs (vibrant cyan)
    (5, 7): (255, 215, 0),
    (7, 9): (255, 215, 0),
    (11, 13): (255, 215, 0),
    (13, 15): (255, 215, 0),
    # Right limbs (vibrant orange)
    (6, 8): (0, 140, 255),
    (8, 10): (0, 140, 255),
    (12, 14): (0, 140, 255),
    (14, 16): (0, 140, 255),
}


def open_camera(source: Union[int, str]) -> cv2.VideoCapture:
    """Open OpenCV VideoCapture with DirectShow fallback for Windows webcams."""
    if isinstance(source, int) or (isinstance(source, str) and source.isdigit()):
        idx = int(source)
        # Windows DirectShow provides fast camera binding
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(idx)
        return cap
    else:
        # String stream URL (e.g. RTSP or DroidCam HTTP MJPEG)
        return cv2.VideoCapture(source)


def draw_skeleton(
    frame: np.ndarray,
    pose: PoseResult,
    conf_thresh: float = 0.25,
) -> None:
    """Draw 17-keypoint skeleton lines and joint dots on the frame."""
    keypoints = pose.keypoints

    # 1. Draw skeleton limb edges
    for edge in SKELETON_EDGES:
        idx1, idx2 = edge
        if idx1 < len(keypoints) and idx2 < len(keypoints):
            kp1 = keypoints[idx1]
            kp2 = keypoints[idx2]

            if (
                kp1.confidence >= conf_thresh
                and kp2.confidence >= conf_thresh
                and (kp1.x_px > 0 or kp1.y_px > 0)
                and (kp2.x_px > 0 or kp2.y_px > 0)
            ):
                pt1 = (int(round(kp1.x_px)), int(round(kp1.y_px)))
                pt2 = (int(round(kp2.x_px)), int(round(kp2.y_px)))
                color = EDGE_COLORS.get(edge, (0, 255, 0))
                cv2.line(frame, pt1, pt2, color, 3, cv2.LINE_AA)

    # 2. Draw keypoint joint circles
    for kp in keypoints:
        if kp.confidence >= conf_thresh and (kp.x_px > 0 or kp.y_px > 0):
            pt = (int(round(kp.x_px)), int(round(kp.y_px)))
            # Outer dark ring for contrast
            cv2.circle(frame, pt, 5, (20, 20, 20), -1, cv2.LINE_AA)
            # Inner bright joint dot
            cv2.circle(frame, pt, 3, (0, 255, 128), -1, cv2.LINE_AA)


def draw_bounding_box(
    frame: np.ndarray,
    pose: PoseResult,
    is_primary: bool = True,
) -> None:
    """Draw a bounding box and label around the detected person."""
    x1, y1, x2, y2 = [int(round(v)) for v in pose.bbox_xyxy]
    color = (0, 230, 115) if is_primary else (180, 180, 180)
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)

    label = f"Person #{pose.person_index + 1} ({pose.confidence * 100:.0f}%)"
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.5
    thickness = 1
    (lw, lh), baseline = cv2.getTextSize(label, font, font_scale, thickness)

    label_y1 = max(0, y1 - lh - baseline - 4)
    cv2.rectangle(
        frame,
        (x1, label_y1),
        (x1 + lw + 8, label_y1 + lh + baseline + 4),
        (30, 30, 30),
        -1,
    )
    cv2.putText(
        frame,
        label,
        (x1 + 4, label_y1 + lh + 2),
        font,
        font_scale,
        color,
        thickness,
        cv2.LINE_AA,
    )


def draw_hud_overlay(
    frame: np.ndarray,
    det_result: DetectionResult,
    fps: float,
    device_label: str,
) -> None:
    """Render a semi-transparent HUD showing person detection status, FPS, and timing."""
    hud_w, hud_h = 360, 132
    overlay = frame.copy()
    cv2.rectangle(overlay, (12, 12), (12 + hud_w, 12 + hud_h), (20, 20, 24), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)
    cv2.rectangle(frame, (12, 12), (12 + hud_w, 12 + hud_h), (70, 70, 80), 1)

    # Person detection status
    if det_result.persons_detected > 0:
        status_text = f"PERSON DETECTED ({det_result.persons_detected})"
        status_color = (0, 255, 100)  # Bright green
    else:
        status_text = "NO PERSON DETECTED"
        status_color = (60, 70, 240)  # Red / Coral

    cv2.putText(
        frame,
        status_text,
        (26, 38),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        status_color,
        2,
        cv2.LINE_AA,
    )

    # FPS display
    cv2.putText(
        frame,
        f"FPS: {fps:.1f}",
        (26, 64),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (255, 255, 255),
        1,
        cv2.LINE_AA,
    )

    # Inference timing display
    inf_ms = det_result.inference_time_ms
    cv2.putText(
        frame,
        f"Inference: {inf_ms:.1f} ms [{device_label}]",
        (26, 90),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (220, 220, 220),
        1,
        cv2.LINE_AA,
    )

    # Controls hint
    cv2.putText(
        frame,
        "Press 'Q' to exit",
        (26, 116),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (160, 160, 160),
        1,
        cv2.LINE_AA,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Live DroidCam/Webcam YOLO11s-Pose inference using CUDA."
    )
    parser.add_argument(
        "camera_index",
        nargs="?",
        default=None,
        help="Optional positional camera index (e.g., 0, 1) or stream URL.",
    )
    parser.add_argument(
        "-c",
        "--camera",
        default="0",
        help="Camera index or URL (default: 0).",
    )
    parser.add_argument(
        "--device",
        default="cuda",
        help="Inference device for PoseDetector (default: cuda).",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.25,
        help="Detection confidence threshold (default: 0.25).",
    )
    args = parser.parse_args()

    # Resolve camera source: positional argument takes precedence if supplied
    raw_source = args.camera_index if args.camera_index is not None else args.camera
    cam_source: Union[int, str]
    if str(raw_source).isdigit():
        cam_source = int(raw_source)
    else:
        cam_source = raw_source

    print("=" * 60)
    print("AI Fight Analyzer - Live Pose Detection Test")
    print("=" * 60)
    print(f"Target Camera Source : {cam_source}")
    print(f"Requested Device     : {args.device}")
    print(f"Confidence Threshold : {args.conf}")
    print("-" * 60)

    # Initialize PoseDetector (loads YOLO11s-Pose on CUDA)
    print("[INFO] Initializing PoseDetector...")
    detector = PoseDetector(device=args.device, conf_threshold=args.conf)
    actual_device = detector.device.upper()
    print(f"[INFO] PoseDetector ready on device: {actual_device}")

    # Open camera stream
    print(f"[INFO] Opening camera {cam_source}...")
    cap = open_camera(cam_source)

    if not cap.isOpened():
        print(f"[ERROR] Could not open camera {cam_source}.")
        print("[HINT] Make sure your webcam or DroidCam client is connected and active.")
        print("[HINT] Run `python backend/tools/test_cameras.py` to view available camera indexes.")
        sys.exit(1)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cam_fps = cap.get(cv2.CAP_PROP_FPS)
    print(f"[INFO] Camera stream active: {width}x{height} @ {cam_fps:.1f} reported FPS")
    print("[INFO] Live feed started. Press 'Q' in the video window to quit.")
    print("-" * 60)

    window_title = f"AI Fight Analyzer - Pose Stream (Camera {cam_source})"
    cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)

    frame_count = 0
    t_prev = time.perf_counter()
    fps_estimate = 0.0
    total_inference_ms = 0.0

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                print("\n[WARNING] Failed to grab frame from camera. Exiting...")
                break

            frame_count += 1

            # Run YOLO11s-Pose inference on the frame
            det_result = detector.detect(frame)
            total_inference_ms += det_result.inference_time_ms

            # Calculate instantaneous and smoothed FPS
            t_now = time.perf_counter()
            dt = t_now - t_prev
            t_prev = t_now
            instant_fps = 1.0 / dt if dt > 0 else 0.0
            fps_estimate = 0.85 * fps_estimate + 0.15 * instant_fps if fps_estimate > 0 else instant_fps

            # Print inference timing to console
            print(
                f"[Frame {frame_count:05d}] "
                f"Inference: {det_result.inference_time_ms:5.1f} ms | "
                f"FPS: {fps_estimate:4.1f} | "
                f"Persons: {det_result.persons_detected}"
            )

            # Draw 17-keypoint skeleton and boxes for detected persons
            for person in det_result.all_persons:
                is_primary = (
                    det_result.primary is not None
                    and person.person_index == det_result.primary.person_index
                )
                draw_bounding_box(frame, person, is_primary=is_primary)
                draw_skeleton(frame, person, conf_thresh=args.conf)

            # Display HUD overlay
            draw_hud_overlay(frame, det_result, fps_estimate, actual_device)

            # Show live camera feed
            cv2.imshow(window_title, frame)

            # Check for 'q' or 'Q' or ESC to exit
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\n[INFO] 'Q' pressed. Exiting...")
                break

    except KeyboardInterrupt:
        print("\n[INFO] Interrupted by user (Ctrl+C). Exiting...")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("-" * 60)
        avg_inf = (total_inference_ms / frame_count) if frame_count > 0 else 0.0
        print(f"[INFO] Total frames processed : {frame_count}")
        print(f"[INFO] Average inference time: {avg_inf:.2f} ms")
        print("[INFO] Camera released and OpenCV windows closed cleanly.")
        print("=" * 60)


if __name__ == "__main__":
    main()
