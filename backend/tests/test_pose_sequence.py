"""Unit tests for PoseSequenceAnalyzer and temporal pose sequences.

Mocks PoseDetector and OpenCV VideoCapture so tests execute fast, deterministically,
and without any physical camera, video file, or GPU requirements.

Manifest timestamp tests are in the ``TestManifestTimestamps`` class and cover:
- valid manifest (timestamps normalised, source=="manifest", duration from manifest)
- missing manifest (FPS fallback, source=="video_fps_fallback")
- malformed manifest – bad JSON (FPS fallback)
- malformed manifest – missing key (FPS fallback)
- malformed manifest – non-numeric entries (FPS fallback)
- mismatched manifest – fewer timestamps than frames (FPS fallback for overflow frames)
"""

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from app.analysis.models import PoseFrame, PoseSequence
from app.analysis.pose_sequence import (
    TS_SOURCE_FPS,
    TS_SOURCE_MANIFEST,
    PoseSequenceAnalyzer,
    _load_timestamps,
)
from app.pose.pose_detector import (
    COCO_KEYPOINT_NAMES,
    DetectionResult,
    Keypoint,
    PoseDetector,
    PoseResult,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Original integration tests (unchanged behaviour)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# _load_timestamps unit tests (no video needed)
# ---------------------------------------------------------------------------


class TestLoadTimestamps:
    """Unit tests for the _load_timestamps() helper."""

    def test_no_manifest_returns_none_fps_source(self, tmp_path):
        """When no manifest file exists the helper returns (None, 'video_fps_fallback')."""
        video = tmp_path / "clip.avi"
        video.touch()
        ts, source = _load_timestamps(str(video))
        assert ts is None
        assert source == TS_SOURCE_FPS

    def test_valid_manifest_returns_timestamps_manifest_source(self, tmp_path):
        """A well-formed manifest is loaded and source is 'manifest'."""
        video = tmp_path / "clip.avi"
        video.touch()
        manifest = tmp_path / "clip_timestamps.json"
        manifest.write_text(
            json.dumps({"timestamps_s": [1.0, 1.033, 1.066]}),
            encoding="utf-8",
        )
        ts, source = _load_timestamps(str(video))
        assert ts == pytest.approx([1.0, 1.033, 1.066])
        assert source == TS_SOURCE_MANIFEST

    def test_bad_json_returns_none_fps_source(self, tmp_path):
        """A manifest with invalid JSON triggers FPS fallback."""
        video = tmp_path / "clip.avi"
        video.touch()
        manifest = tmp_path / "clip_timestamps.json"
        manifest.write_text("{ not valid json !!!}", encoding="utf-8")
        ts, source = _load_timestamps(str(video))
        assert ts is None
        assert source == TS_SOURCE_FPS

    def test_missing_key_returns_none_fps_source(self, tmp_path):
        """A manifest missing 'timestamps_s' triggers FPS fallback."""
        video = tmp_path / "clip.avi"
        video.touch()
        manifest = tmp_path / "clip_timestamps.json"
        manifest.write_text(json.dumps({"role": "front"}), encoding="utf-8")
        ts, source = _load_timestamps(str(video))
        assert ts is None
        assert source == TS_SOURCE_FPS

    def test_empty_timestamps_list_returns_none_fps_source(self, tmp_path):
        """An empty 'timestamps_s' list triggers FPS fallback."""
        video = tmp_path / "clip.avi"
        video.touch()
        manifest = tmp_path / "clip_timestamps.json"
        manifest.write_text(json.dumps({"timestamps_s": []}), encoding="utf-8")
        ts, source = _load_timestamps(str(video))
        assert ts is None
        assert source == TS_SOURCE_FPS

    def test_non_numeric_entries_returns_none_fps_source(self, tmp_path):
        """Non-numeric entries in 'timestamps_s' trigger FPS fallback."""
        video = tmp_path / "clip.avi"
        video.touch()
        manifest = tmp_path / "clip_timestamps.json"
        manifest.write_text(
            json.dumps({"timestamps_s": [0.0, "bad", 0.066]}),
            encoding="utf-8",
        )
        ts, source = _load_timestamps(str(video))
        assert ts is None
        assert source == TS_SOURCE_FPS


# ---------------------------------------------------------------------------
# Manifest timestamp integration tests (process_video)
# ---------------------------------------------------------------------------


class TestManifestTimestamps:
    """Integration tests for timestamp resolution inside process_video()."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _make_detector(n: int = 3) -> MagicMock:
        d = MagicMock(spec=PoseDetector)
        d.detect.side_effect = [
            create_mock_detection_result(detected=True) for _ in range(n)
        ]
        return d

    # ------------------------------------------------------------------
    # Valid manifest
    # ------------------------------------------------------------------

    def test_valid_manifest_timestamps_normalised_to_zero(self, tmp_path):
        """Frames use manifest timestamps normalised so first == 0.0."""
        video = tmp_path / "front_20261006T182132.avi"
        video.touch()

        # Simulate real monotonic timestamps (non-zero first value)
        raw = [10.0, 10.033, 10.066]
        manifest = tmp_path / "front_20261006T182132_timestamps.json"
        manifest.write_text(json.dumps({"timestamps_s": raw}), encoding="utf-8")

        mock_cap = MockVideoCapture(num_frames=3, fps=30.0)
        detector = self._make_detector(3)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            analyzer = PoseSequenceAnalyzer(detector=detector)
            seq = analyzer.process_video(str(video))

        assert seq.timestamp_source == TS_SOURCE_MANIFEST
        assert seq.frames[0].timestamp == pytest.approx(0.0)
        assert seq.frames[1].timestamp == pytest.approx(0.033, abs=1e-6)
        assert seq.frames[2].timestamp == pytest.approx(0.066, abs=1e-6)

    def test_valid_manifest_duration_from_manifest(self, tmp_path):
        """Sequence duration is derived from the manifest span, not FPS."""
        video = tmp_path / "front_20261006T182132.avi"
        video.touch()

        raw = [5.0, 5.050, 5.110]  # 0.110-second span
        manifest = tmp_path / "front_20261006T182132_timestamps.json"
        manifest.write_text(json.dumps({"timestamps_s": raw}), encoding="utf-8")

        mock_cap = MockVideoCapture(num_frames=3, fps=30.0)
        detector = self._make_detector(3)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            seq = PoseSequenceAnalyzer(detector=detector).process_video(str(video))

        expected_duration = raw[-1] - raw[0]
        assert seq.duration == pytest.approx(expected_duration, abs=1e-9)
        assert seq.timestamp_source == TS_SOURCE_MANIFEST

    def test_valid_manifest_source_reported(self, tmp_path):
        """timestamp_source is 'manifest' when manifest is successfully used."""
        video = tmp_path / "clip.avi"
        video.touch()
        manifest = tmp_path / "clip_timestamps.json"
        manifest.write_text(json.dumps({"timestamps_s": [0.0, 0.033, 0.066]}), encoding="utf-8")

        mock_cap = MockVideoCapture(num_frames=3, fps=30.0)
        detector = self._make_detector(3)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            seq = PoseSequenceAnalyzer(detector=detector).process_video(str(video))

        assert seq.timestamp_source == TS_SOURCE_MANIFEST

    # ------------------------------------------------------------------
    # Missing manifest → FPS fallback
    # ------------------------------------------------------------------

    def test_missing_manifest_uses_fps_fallback(self, tmp_path):
        """When no manifest exists, timestamps fall back to frame_index/fps."""
        video = tmp_path / "clip.avi"
        video.touch()
        # Deliberately do NOT create a manifest file.

        fps = 25.0
        mock_cap = MockVideoCapture(num_frames=3, fps=fps)
        detector = self._make_detector(3)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            seq = PoseSequenceAnalyzer(detector=detector).process_video(str(video))

        assert seq.timestamp_source == TS_SOURCE_FPS
        for i, frame in enumerate(seq.frames):
            assert frame.timestamp == pytest.approx(i / fps, rel=1e-6)

    # ------------------------------------------------------------------
    # Malformed manifests → FPS fallback
    # ------------------------------------------------------------------

    def test_malformed_bad_json_uses_fps_fallback(self, tmp_path):
        """Bad JSON in manifest → FPS fallback."""
        video = tmp_path / "clip.avi"
        video.touch()
        (tmp_path / "clip_timestamps.json").write_text("not json", encoding="utf-8")

        fps = 30.0
        mock_cap = MockVideoCapture(num_frames=2, fps=fps)
        detector = self._make_detector(2)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            seq = PoseSequenceAnalyzer(detector=detector).process_video(str(video))

        assert seq.timestamp_source == TS_SOURCE_FPS
        assert seq.frames[0].timestamp == pytest.approx(0.0)
        assert seq.frames[1].timestamp == pytest.approx(1 / fps, rel=1e-6)

    def test_malformed_missing_key_uses_fps_fallback(self, tmp_path):
        """Manifest without 'timestamps_s' key → FPS fallback."""
        video = tmp_path / "clip.avi"
        video.touch()
        (tmp_path / "clip_timestamps.json").write_text(
            json.dumps({"role": "front", "frame_count": 3}),
            encoding="utf-8",
        )

        fps = 30.0
        mock_cap = MockVideoCapture(num_frames=2, fps=fps)
        detector = self._make_detector(2)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            seq = PoseSequenceAnalyzer(detector=detector).process_video(str(video))

        assert seq.timestamp_source == TS_SOURCE_FPS

    def test_malformed_non_numeric_entries_uses_fps_fallback(self, tmp_path):
        """Non-numeric timestamps_s entries → FPS fallback."""
        video = tmp_path / "clip.avi"
        video.touch()
        (tmp_path / "clip_timestamps.json").write_text(
            json.dumps({"timestamps_s": [0.0, "oops", 0.066]}),
            encoding="utf-8",
        )

        fps = 30.0
        mock_cap = MockVideoCapture(num_frames=2, fps=fps)
        detector = self._make_detector(2)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            seq = PoseSequenceAnalyzer(detector=detector).process_video(str(video))

        assert seq.timestamp_source == TS_SOURCE_FPS

    # ------------------------------------------------------------------
    # Mismatched manifest (fewer timestamps than frames)
    # ------------------------------------------------------------------

    def test_mismatched_manifest_overflow_frames_use_fps(self, tmp_path):
        """Frames beyond manifest length fall back to FPS timestamps while
        frames within the manifest use normalised manifest timestamps."""
        video = tmp_path / "clip.avi"
        video.touch()

        # Manifest only covers 2 of the 4 frames
        raw = [5.0, 5.040]
        (tmp_path / "clip_timestamps.json").write_text(
            json.dumps({"timestamps_s": raw}),
            encoding="utf-8",
        )

        fps = 30.0
        mock_cap = MockVideoCapture(num_frames=4, fps=fps)
        detector = self._make_detector(4)

        with patch("cv2.VideoCapture", return_value=mock_cap):
            seq = PoseSequenceAnalyzer(detector=detector).process_video(str(video))

        # Manifest was loaded → source is "manifest"
        assert seq.timestamp_source == TS_SOURCE_MANIFEST

        # Frames 0-1: use normalised manifest timestamps
        assert seq.frames[0].timestamp == pytest.approx(0.0)
        assert seq.frames[1].timestamp == pytest.approx(0.040, abs=1e-9)

        # Frames 2-3: beyond manifest length → fps fallback
        assert seq.frames[2].timestamp == pytest.approx(2 / fps, rel=1e-6)
        assert seq.frames[3].timestamp == pytest.approx(3 / fps, rel=1e-6)
