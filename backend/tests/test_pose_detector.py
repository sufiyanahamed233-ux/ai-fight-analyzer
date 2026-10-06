"""Unit tests for the PoseDetector module.

These tests mock Ultralytics YOLO to ensure no GPU, downloaded weights,
or physical camera / person is required.
"""

from unittest.mock import MagicMock, patch
import numpy as np
import pytest

from app.pose.pose_detector import (
    COCO_KEYPOINT_NAMES,
    DetectionResult,
    Keypoint,
    PoseDetector,
    PoseResult,
)


class MockTensor:
    """Mock tensor supporting .cpu().numpy()."""

    def __init__(self, array: np.ndarray):
        self._array = array

    def cpu(self):
        return self

    def numpy(self):
        return self._array


def create_mock_yolo_result(num_persons: int = 1, confidences: list[float] | None = None):
    """Generate a mock Ultralytics Results object."""
    if num_persons == 0:
        mock_res = MagicMock()
        mock_res.boxes = MagicMock()
        mock_res.boxes.__len__.return_value = 0
        mock_res.boxes.xyxy = MockTensor(np.empty((0, 4), dtype=np.float32))
        mock_res.boxes.conf = MockTensor(np.empty((0,), dtype=np.float32))
        mock_res.keypoints = None
        return mock_res

    if confidences is None:
        confidences = [0.9] * num_persons

    # boxes: xyxy, conf
    boxes_xyxy = np.zeros((num_persons, 4), dtype=np.float32)
    boxes_conf = np.array(confidences, dtype=np.float32)

    # keypoints: shape (num_persons, 17, 2)
    kp_xy = np.zeros((num_persons, 17, 2), dtype=np.float32)
    kp_xyn = np.zeros((num_persons, 17, 2), dtype=np.float32)
    kp_conf = np.zeros((num_persons, 17), dtype=np.float32)

    for p in range(num_persons):
        boxes_xyxy[p] = [50.0 + p * 10, 50.0 + p * 10, 200.0 + p * 10, 400.0 + p * 10]
        for k in range(17):
            kp_xy[p, k] = [100.0 + k * 2, 150.0 + k * 5]
            kp_xyn[p, k] = [(100.0 + k * 2) / 640.0, (150.0 + k * 5) / 480.0]
            kp_conf[p, k] = 0.85 + (k % 5) * 0.02

    mock_res = MagicMock()
    mock_res.boxes = MagicMock()
    mock_res.boxes.__len__.return_value = num_persons
    mock_res.boxes.xyxy = MockTensor(boxes_xyxy)
    mock_res.boxes.conf = MockTensor(boxes_conf)

    mock_res.keypoints = MagicMock()
    mock_res.keypoints.xy = MockTensor(kp_xy)
    mock_res.keypoints.xyn = MockTensor(kp_xyn)
    mock_res.keypoints.conf = MockTensor(kp_conf)

    return mock_res


@pytest.fixture
def mock_yolo():
    """Fixture that mocks the YOLO constructor."""
    with patch("app.pose.pose_detector.YOLO") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance
        yield mock_cls, mock_instance


def test_pose_detector_init(mock_yolo):
    """Test model is initialized once on detector instantiation."""
    mock_cls, mock_instance = mock_yolo
    detector = PoseDetector(model_path="dummy_pose.pt", device="cpu", conf_threshold=0.3)

    mock_cls.assert_called_once()
    assert detector.model_loaded is True
    assert detector.device == "cpu"
    assert detector.conf_threshold == 0.3


def test_detect_single_person(mock_yolo):
    """Test detection with a single person returning 17 keypoints."""
    _, mock_instance = mock_yolo
    mock_instance.return_value = [create_mock_yolo_result(num_persons=1, confidences=[0.92])]

    detector = PoseDetector()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    result = detector.detect(frame)

    assert result.persons_detected == 1
    assert result.primary is not None
    assert result.image_width == 640
    assert result.image_height == 480
    assert result.inference_time_ms >= 0.0

    primary = result.primary
    assert primary.confidence == pytest.approx(0.92, rel=1e-3)
    assert len(primary.keypoints) == 17

    # Check keypoint ordering and names match COCO standard
    for i, name in enumerate(COCO_KEYPOINT_NAMES):
        kp = primary.keypoints[i]
        assert kp.name == name
        assert kp.index == i
        assert kp.x_px == pytest.approx(100.0 + i * 2, rel=1e-3)
        assert kp.y_px == pytest.approx(150.0 + i * 5, rel=1e-3)
        assert 0.0 <= kp.x_norm <= 1.0
        assert 0.0 <= kp.y_norm <= 1.0
        assert kp.confidence > 0.0


def test_detect_no_person(mock_yolo):
    """Test detection when no person is detected."""
    _, mock_instance = mock_yolo
    mock_instance.return_value = [create_mock_yolo_result(num_persons=0)]

    detector = PoseDetector()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    result = detector.detect(frame)

    assert result.persons_detected == 0
    assert result.primary is None
    assert len(result.all_persons) == 0
    assert result.image_width == 640
    assert result.image_height == 480


def test_detect_empty_or_none_frame(mock_yolo):
    """Test detection on invalid, empty, or None frame."""
    detector = PoseDetector()

    res_none = detector.detect(None)  # type: ignore
    assert res_none.persons_detected == 0
    assert res_none.primary is None

    res_empty = detector.detect(np.empty((0, 0, 3), dtype=np.uint8))
    assert res_empty.persons_detected == 0
    assert res_empty.primary is None


def test_primary_person_selection_highest_confidence(mock_yolo):
    """Test that when multiple people are detected, the one with highest confidence is selected as primary."""
    _, mock_instance = mock_yolo
    # Person 0 has confidence 0.65, Person 1 has confidence 0.95
    mock_instance.return_value = [create_mock_yolo_result(num_persons=2, confidences=[0.65, 0.95])]

    detector = PoseDetector()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    result = detector.detect(frame)

    assert result.persons_detected == 2
    assert len(result.all_persons) == 2
    assert result.primary is not None
    assert result.primary.person_index == 1
    assert result.primary.confidence == pytest.approx(0.95, rel=1e-3)


def test_get_keypoint_helper(mock_yolo):
    """Test PoseResult.get_keypoint helper method."""
    _, mock_instance = mock_yolo
    mock_instance.return_value = [create_mock_yolo_result(num_persons=1)]

    detector = PoseDetector()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    result = detector.detect(frame)

    assert result.primary is not None
    nose = result.primary.get_keypoint("nose")
    assert nose is not None
    assert nose.name == "nose"
    assert nose.index == 0

    left_wrist = result.primary.get_keypoint("left_wrist")
    assert left_wrist is not None
    assert left_wrist.name == "left_wrist"
    assert left_wrist.index == 9

    non_existent = result.primary.get_keypoint("non_existent_joint")
    assert non_existent is None


def test_model_not_reloaded_per_frame(mock_yolo):
    """Test that multiple detect() calls do not reload the YOLO model."""
    mock_cls, mock_instance = mock_yolo
    mock_instance.return_value = [create_mock_yolo_result(num_persons=1)]

    detector = PoseDetector()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)

    detector.detect(frame)
    detector.detect(frame)
    detector.detect(frame)

    # YOLO constructor should only be called once during init
    assert mock_cls.call_count == 1
    # model inference should be called 3 times
    assert mock_instance.call_count == 3
