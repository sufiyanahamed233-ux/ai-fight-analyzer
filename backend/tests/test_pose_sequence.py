"""Unit tests for PoseSequenceAnalyzer and temporal pose sequences.

Mocks PoseDetector and OpenCV VideoCapture so tests execute fast, deterministically,
and without any physical camera, video file, or GPU requirements.
"""

from unittest.mock import MagicMock, patch
import numpy as np
import pytest

from app.analysis.models import PoseFrame, PoseSequence
from app.analysis.pose_sequence import PoseSequenceAnalyzer
from app.pose.pose_detector import (
    COCO_KEYPOINT_NAMES,
    DetectionResult,
    Keypoint,
    PoseDetector,
    PoseResult,
)


def create_dummy_keypoints(offset: float = 0.0) -> list[Keypoint]:
    """Helper to generate 17 test keypoints."""
    return [
        Keypoint(
            name=name,
            index=i,
            x_px=100.0 + i * 5 + offset,
            y_px=150.0 + i * 5 + offset,
            x_norm=(100.0 + i * 5 + offset) / 640.0,
            y_norm=(150.0 + i * 5 + offset) / 480.0,
            confidence=0.90 + (i % 3) * 0.03,
        )
        for i, name in enumerate(COCO_KEYPOINT_NAMES)
    ]


def create_mock_detection_result(detected: bool = True, frame_offset: float = 0.0) -> DetectionResult:
    """Helper to create DetectionResult."""
    if not detected:
        return DetectionResult(
            persons_detected=0,
            primary=None,
            all_persons=[],
            inference_time_ms=12.5,
            image_width=640,
            image_height=480,
        )

    kps = create_dummy_keypoints(offset=frame_offset)
    primary = PoseResult(
        person_index=0,
        bbox_xyxy=(50.0, 50.0, 200.0, 400.0),
        confidence=0.95,
        keypoints=kps,
        image_width=640,
        image_height=480,
    )
    return DetectionResult(
        persons_detected=1,
        primary=primary,
        all_persons=[primary],
        inference_time_ms=12.5,
        image_width=640,
        image_height=480,
    )


class MockVideoCapture:
    """Mock for cv2.VideoCapture producing N synthetic frames."""

    def __init__(self, num_frames: int = 5, width: int = 640, height: int = 480, fps: float = 30.0):
        self.num_frames = num_frames
        self.width = width
        self.height = height
        self.fps = fps
        self.current_frame = 0
        self.released = False

    def isOpened(self) -> bool:
        return not self.released

    def get(self, prop_id: int):
        import cv2

        if prop_id == cv2.CAP_PROP_FRAME_WIDTH:
            return float(self.width)
        elif prop_id == cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self.height)
        elif prop_id == cv2.CAP_PROP_FPS:
            return float(self.fps)
        elif prop_id == cv2.CAP_PROP_FRAME_COUNT:
            return float(self.num_frames)
        return 0.0

    def read(self):
        if self.current_frame >= self.num_frames:
            return False, None
        frame = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        self.current_frame += 1
        return True, frame

    def release(self):
        self.released = True


def test_process_video_successful_sequence():
    """Test full video processing with all frames detected."""
    mock_detector = MagicMock(spec=PoseDetector)
    mock_detector.detect.side_effect = [
        create_mock_detection_result(detected=True, frame_offset=0.0),
        create_mock_detection_result(detected=True, frame_offset=1.0),
        create_mock_detection_result(detected=True, frame_offset=2.0),
    ]

    mock_cap = MockVideoCapture(num_frames=3, width=640, height=480, fps=30.0)

    with patch("os.path.exists", return_value=True), patch("cv2.VideoCapture", return_value=mock_cap):
        analyzer = PoseSequenceAnalyzer(detector=mock_detector)
        sequence = analyzer.process_video("mock_video.avi")

    assert sequence.video_path == "mock_video.avi"
    assert sequence.width == 640
    assert sequence.height == 480
    assert sequence.source_fps == 30.0
    assert sequence.frame_count == 3
    assert sequence.duration == pytest.approx(0.1, rel=1e-3)
    assert len(sequence.frames) == 3
    assert sequence.detected_frames_count == 3
    assert sequence.undetected_frames_count == 0

    # Verify timestamps are sequential
    for i, frame in enumerate(sequence.frames):
        assert frame.frame_index == i
        assert frame.timestamp == pytest.approx(i / 30.0, rel=1e-3)
        assert frame.detection_present is True
        assert len(frame.keypoints) == 17
        assert frame.person_confidence == pytest.approx(0.95, rel=1e-3)

        # Check keypoint access helper
        nose = frame.get_keypoint("nose")
        assert nose is not None
        assert nose.name == "nose"
        assert nose.index == 0

    assert mock_cap.released is True


def test_process_video_intermittent_detections():
    """Test handling frames where person is missing/undetected."""
    mock_detector = MagicMock(spec=PoseDetector)
    # Frame 0: detected, Frame 1: missed, Frame 2: detected
    mock_detector.detect.side_effect = [
        create_mock_detection_result(detected=True),
        create_mock_detection_result(detected=False),
        create_mock_detection_result(detected=True),
    ]

    mock_cap = MockVideoCapture(num_frames=3, width=640, height=480, fps=25.0)

    with patch("os.path.exists", return_value=True), patch("cv2.VideoCapture", return_value=mock_cap):
        analyzer = PoseSequenceAnalyzer(detector=mock_detector)
        sequence = analyzer.process_video("intermittent.mp4")

    assert sequence.frame_count == 3
    assert sequence.detected_frames_count == 2
    assert sequence.undetected_frames_count == 1

    # Frame 0: Present
    assert sequence.frames[0].detection_present is True
    assert len(sequence.frames[0].keypoints) == 17

    # Frame 1: Not present
    assert sequence.frames[1].detection_present is False
    assert len(sequence.frames[1].keypoints) == 0
    assert sequence.frames[1].person_confidence == 0.0
    assert sequence.frames[1].bbox_xyxy is None

    # Frame 2: Present
    assert sequence.frames[2].detection_present is True
    assert len(sequence.frames[2].keypoints) == 17


def test_process_video_max_frames():
    """Test capping processing with max_frames parameter."""
    mock_detector = MagicMock(spec=PoseDetector)
    mock_detector.detect.return_value = create_mock_detection_result(detected=True)

    mock_cap = MockVideoCapture(num_frames=10, width=640, height=480, fps=30.0)

    with patch("os.path.exists", return_value=True), patch("cv2.VideoCapture", return_value=mock_cap):
        analyzer = PoseSequenceAnalyzer(detector=mock_detector)
        sequence = analyzer.process_video("ten_frames.mp4", max_frames=4)

    assert sequence.frame_count == 4
    assert len(sequence.frames) == 4
    assert mock_detector.detect.call_count == 4


def test_process_video_file_not_found():
    """Test that FileNotFoundError is raised when file does not exist."""
    analyzer = PoseSequenceAnalyzer(detector=MagicMock(spec=PoseDetector))
    with pytest.raises(FileNotFoundError):
        analyzer.process_video("non_existent_file.mp4")


def test_process_video_cannot_open():
    """Test that ValueError is raised when OpenCV cannot open video."""
    mock_cap = MagicMock()
    mock_cap.isOpened.return_value = False

    with patch("os.path.exists", return_value=True), patch("cv2.VideoCapture", return_value=mock_cap):
        analyzer = PoseSequenceAnalyzer(detector=MagicMock(spec=PoseDetector))
        with pytest.raises(ValueError):
            analyzer.process_video("corrupted_video.mp4")


def test_keypoint_coordinates_preserved():
    """Verify that normalized and pixel coordinates and confidences are accurately preserved."""
    mock_detector = MagicMock(spec=PoseDetector)
    det_res = create_mock_detection_result(detected=True, frame_offset=5.0)
    mock_detector.detect.return_value = det_res

    mock_cap = MockVideoCapture(num_frames=1, width=640, height=480, fps=30.0)

    with patch("os.path.exists", return_value=True), patch("cv2.VideoCapture", return_value=mock_cap):
        analyzer = PoseSequenceAnalyzer(detector=mock_detector)
        sequence = analyzer.process_video("test.avi")

    kp = sequence.frames[0].keypoints[0]
    expected_kp = det_res.primary.keypoints[0]
    assert kp.x_px == pytest.approx(expected_kp.x_px)
    assert kp.y_px == pytest.approx(expected_kp.y_px)
    assert kp.x_norm == pytest.approx(expected_kp.x_norm)
    assert kp.y_norm == pytest.approx(expected_kp.y_norm)
    assert kp.confidence == pytest.approx(expected_kp.confidence)
