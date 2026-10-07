"""
test_adb_forwarder.py
---------------------
Unit tests for the automatic DroidCam USB ADB port-forwarding layer.

All subprocess and socket/OpenCV calls are mocked so no physical phones or
real ADB daemon executions are required. Tests verify:
  - Locating the ADB executable (custom, env, bundled search, PATH fallback)
  - Parsing device lists and filtering active/ready devices
  - Handling conflicting port forwards safely
  - Configurable FRONT and SIDE device serials (via args and environment)
  - Auto-assignment when two phones are connected
  - Failure reporting when required phones are missing or unauthorized
  - Endpoint verification (TCP socket + OpenCV probe)
  - Teardown of forwards
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

from app.camera.adb_forwarder import (
    AdbDevice,
    AdbDeviceNotFoundError,
    AdbError,
    AdbForwardError,
    AdbNotFoundError,
    DualAdbSetupResult,
    find_adb_executable,
    get_active_serials,
    list_devices,
    list_forwards,
    remove_forward,
    run_adb_command,
    setup_dual_droidcam_usb,
    setup_forward,
    teardown_dual_droidcam_usb,
    verify_endpoint,
)
from app.camera.camera_manager import CameraInfo


# ---------------------------------------------------------------------------
# Locating ADB Executable
# ---------------------------------------------------------------------------


class TestFindAdbExecutable:
    def test_explicit_custom_path_valid(self, tmp_path):
        dummy_adb = tmp_path / "adb.exe"
        dummy_adb.touch()
        found = find_adb_executable(dummy_adb)
        assert found == dummy_adb.resolve()

    def test_explicit_custom_path_missing_raises(self, tmp_path):
        missing = tmp_path / "missing_adb.exe"
        with pytest.raises(AdbNotFoundError, match="Custom ADB executable not found"):
            find_adb_executable(missing)

    def test_env_var_path_valid(self, tmp_path, monkeypatch):
        dummy_adb = tmp_path / "env_adb.exe"
        dummy_adb.touch()
        monkeypatch.setenv("DROIDCAM_ADB_PATH", str(dummy_adb))
        found = find_adb_executable()
        assert found == dummy_adb.resolve()

    def test_env_var_path_invalid_raises(self, monkeypatch):
        monkeypatch.setenv("DROIDCAM_ADB_PATH", r"C:\fake\non_existent\adb.exe")
        with pytest.raises(AdbNotFoundError, match="specifies non-existent path"):
            find_adb_executable()

    def test_config_settings_adb_path(self, tmp_path, monkeypatch):
        monkeypatch.delenv("DROIDCAM_ADB_PATH", raising=False)
        dummy_adb = tmp_path / "settings_adb.exe"
        dummy_adb.touch()
        with patch("app.camera.adb_forwarder.settings") as mock_settings:
            mock_settings.droidcam_adb_path = str(dummy_adb)
            found = find_adb_executable()
            assert found == dummy_adb.resolve()

    def test_bundled_search_paths_found(self, monkeypatch, tmp_path):
        monkeypatch.delenv("DROIDCAM_ADB_PATH", raising=False)
        dummy_bundled = tmp_path / "bundled_adb.exe"
        dummy_bundled.touch()

        with patch("app.camera.adb_forwarder.DEFAULT_ADB_SEARCH_PATHS", (dummy_bundled,)):
            found = find_adb_executable()
            assert found == dummy_bundled.resolve()

    def test_system_path_fallback(self, monkeypatch):
        monkeypatch.delenv("DROIDCAM_ADB_PATH", raising=False)
        with (
            patch("app.camera.adb_forwarder.DEFAULT_ADB_SEARCH_PATHS", ()),
            patch("shutil.which", return_value=r"C:\System\adb.exe"),
            patch.object(Path, "resolve", return_value=Path(r"C:\System\adb.exe")),
        ):
            found = find_adb_executable()
            assert str(found) == r"C:\System\adb.exe"

    def test_no_adb_found_raises(self, monkeypatch):
        monkeypatch.delenv("DROIDCAM_ADB_PATH", raising=False)
        with (
            patch("app.camera.adb_forwarder.DEFAULT_ADB_SEARCH_PATHS", ()),
            patch("shutil.which", return_value=None),
        ):
            with pytest.raises(AdbNotFoundError, match="Could not find ADB executable"):
                find_adb_executable()


# ---------------------------------------------------------------------------
# Device Listing & Parsing
# ---------------------------------------------------------------------------


class TestDeviceListing:
    MOCK_DEVICES_OUTPUT = (
        "List of devices attached\n"
        "SERIAL_A\tdevice\n"
        "SERIAL_B\tdevice\n"
        "SERIAL_C\tunauthorized\n"
        "SERIAL_D\toffline\n"
        "\n"
    )

    def test_list_devices_parses_correctly(self):
        with patch("app.camera.adb_forwarder.run_adb_command", return_value=self.MOCK_DEVICES_OUTPUT):
            devices = list_devices()

        assert len(devices) == 4
        assert devices[0] == AdbDevice(serial="SERIAL_A", state="device")
        assert devices[1] == AdbDevice(serial="SERIAL_B", state="device")
        assert devices[2] == AdbDevice(serial="SERIAL_C", state="unauthorized")
        assert devices[3] == AdbDevice(serial="SERIAL_D", state="offline")

    def test_get_active_serials_filters_only_ready(self):
        with patch("app.camera.adb_forwarder.run_adb_command", return_value=self.MOCK_DEVICES_OUTPUT):
            ready_serials = get_active_serials()

        assert ready_serials == ["SERIAL_A", "SERIAL_B"]


# ---------------------------------------------------------------------------
# Port Forwarding Management
# ---------------------------------------------------------------------------


class TestForwarding:
    MOCK_FORWARD_LIST = (
        "SERIAL_OLD tcp:4747 tcp:4747\n"
        "SERIAL_OTHER tcp:4748 tcp:4747\n"
    )

    def test_list_forwards_parses_correctly(self):
        with patch("app.camera.adb_forwarder.run_adb_command", return_value=self.MOCK_FORWARD_LIST):
            forwards = list_forwards()

        assert len(forwards) == 2
        assert forwards[0] == {"serial": "SERIAL_OLD", "local": "tcp:4747", "remote": "tcp:4747"}
        assert forwards[1] == {"serial": "SERIAL_OTHER", "local": "tcp:4748", "remote": "tcp:4747"}

    def test_setup_forward_removes_conflicting_forward(self):
        with (
            patch("app.camera.adb_forwarder.list_forwards", return_value=[
                {"serial": "DIFFERENT_DEV", "local": "tcp:4747", "remote": "tcp:4747"}
            ]),
            patch("app.camera.adb_forwarder.run_adb_command") as mock_run,
        ):
            setup_forward("NEW_DEV", 4747, 4747)

            # Expect remove conflicting followed by setup forward
            calls = mock_run.call_args_list
            assert calls[0] == call(["forward", "--remove", "tcp:4747"], adb_path=None)
            assert calls[1] == call(["-s", "NEW_DEV", "forward", "tcp:4747", "tcp:4747"], adb_path=None)

    def test_setup_forward_skips_when_already_matching(self):
        with (
            patch("app.camera.adb_forwarder.list_forwards", return_value=[
                {"serial": "TARGET_DEV", "local": "tcp:4747", "remote": "tcp:4747"}
            ]),
            patch("app.camera.adb_forwarder.run_adb_command") as mock_run,
        ):
            setup_forward("TARGET_DEV", 4747, 4747)
            # Should not call run_adb_command since forward already matches
            mock_run.assert_not_called()

    def test_remove_forward_safe_on_error(self):
        with patch("app.camera.adb_forwarder.run_adb_command", side_effect=AdbError("No forward found")):
            # Must not raise
            remove_forward(4747)

    def test_setup_forward_failure_raises_adb_forward_error(self):
        with (
            patch("app.camera.adb_forwarder.list_forwards", return_value=[]),
            patch("app.camera.adb_forwarder.run_adb_command", side_effect=AdbError("cannot bind listener")),
        ):
            with pytest.raises(AdbForwardError, match="Failed to configure ADB forward"):
                setup_forward("DEV_1", 4747, 4747)


class TestRunAdbCommand:
    def test_run_adb_command_timeout(self):
        import subprocess
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="adb", timeout=5.0)),
        ):
            with pytest.raises(AdbError, match="timed out"):
                run_adb_command(["devices"], timeout=5.0)

    def test_run_adb_command_nonzero_exit(self):
        mock_res = MagicMock()
        mock_res.returncode = 1
        mock_res.stderr = "error: device offline"
        mock_res.stdout = ""
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("subprocess.run", return_value=mock_res),
        ):
            with pytest.raises(AdbError, match="error: device offline"):
                run_adb_command(["devices"])


# ---------------------------------------------------------------------------
# Endpoint Verification
# ---------------------------------------------------------------------------


class TestVerifyEndpoint:
    def test_verify_endpoint_success(self):
        mock_info = CameraInfo(index=-1, available=True, frame_read=True)
        with (
            patch("app.camera.adb_forwarder.check_droidcam_port", return_value=True),
            patch("app.camera.adb_forwarder.probe_stream", return_value=mock_info),
        ):
            info = verify_endpoint("http://127.0.0.1:4747/video", 4747, verify_stream=True)
            assert info.available is True
            assert info.frame_read is True

    def test_verify_endpoint_port_closed_raises(self):
        with patch("app.camera.adb_forwarder.check_droidcam_port", return_value=False):
            with pytest.raises(AdbForwardError, match="TCP connection refused on 127.0.0.1:4747"):
                verify_endpoint("http://127.0.0.1:4747/video", 4747)

    def test_verify_endpoint_stream_no_frame_raises(self):
        mock_info = CameraInfo(index=-1, available=True, frame_read=False, error="No frame data")
        with (
            patch("app.camera.adb_forwarder.check_droidcam_port", return_value=True),
            patch("app.camera.adb_forwarder.probe_stream", return_value=mock_info),
        ):
            with pytest.raises(AdbForwardError, match="failed validation"):
                verify_endpoint("http://127.0.0.1:4747/video", 4747, verify_stream=True)


# ---------------------------------------------------------------------------
# High-Level setup_dual_droidcam_usb
# ---------------------------------------------------------------------------


class TestSetupDualDroidcamUsb:
    def test_auto_assign_two_devices(self):
        mock_info = CameraInfo(index=-1, available=True, frame_read=True)
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_FRONT", "DEV_SIDE"]),
            patch("app.camera.adb_forwarder.setup_forward") as mock_setup,
            patch("app.camera.adb_forwarder.verify_endpoint", return_value=mock_info),
        ):
            res = setup_dual_droidcam_usb(verify_streams=True)

            assert isinstance(res, DualAdbSetupResult)
            assert res.front_serial == "DEV_FRONT"
            assert res.side_serial == "DEV_SIDE"
            assert res.front_url == "http://127.0.0.1:4747/video"
            assert res.side_url == "http://127.0.0.1:4748/video"

            assert mock_setup.call_args_list == [
                call("DEV_FRONT", 4747, 4747, Path("mock_adb.exe")),
                call("DEV_SIDE", 4748, 4747, Path("mock_adb.exe")),
            ]

    def test_explicit_serials_args(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["PHONE_A", "PHONE_B", "PHONE_C"]),
            patch("app.camera.adb_forwarder.setup_forward"),
            patch("app.camera.adb_forwarder.verify_endpoint"),
        ):
            res = setup_dual_droidcam_usb(front_serial="PHONE_C", side_serial="PHONE_A", verify_streams=False)
            assert res.front_serial == "PHONE_C"
            assert res.side_serial == "PHONE_A"

    def test_env_serials(self, monkeypatch):
        monkeypatch.setenv("DROIDCAM_FRONT_SERIAL", "ENV_PHONE_1")
        monkeypatch.setenv("DROIDCAM_SIDE_SERIAL", "ENV_PHONE_2")

        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["ENV_PHONE_1", "ENV_PHONE_2"]),
            patch("app.camera.adb_forwarder.setup_forward"),
            patch("app.camera.adb_forwarder.verify_endpoint"),
        ):
            res = setup_dual_droidcam_usb(verify_streams=False)
            assert res.front_serial == "ENV_PHONE_1"
            assert res.side_serial == "ENV_PHONE_2"

    def test_insufficient_devices_raises(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["SINGLE_DEV"]),
        ):
            with pytest.raises(AdbDeviceNotFoundError, match="requires 2 connected Android devices"):
                setup_dual_droidcam_usb()

    def test_missing_configured_front_device_raises(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_A"]),
            patch("app.camera.adb_forwarder.list_devices", return_value=[
                AdbDevice(serial="DEV_A", state="device"),
                AdbDevice(serial="DEV_UNAUTH", state="unauthorized"),
            ]),
        ):
            with pytest.raises(AdbDeviceNotFoundError, match="Configured FRONT device 'DEV_UNAUTH' is unauthorized"):
                setup_dual_droidcam_usb(front_serial="DEV_UNAUTH", side_serial="DEV_A")

    def test_missing_configured_side_device_raises(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_A"]),
            patch("app.camera.adb_forwarder.list_devices", return_value=[
                AdbDevice(serial="DEV_A", state="device"),
                AdbDevice(serial="DEV_OFFLINE", state="offline"),
            ]),
        ):
            with pytest.raises(AdbDeviceNotFoundError, match="Configured SIDE device 'DEV_OFFLINE' is offline"):
                setup_dual_droidcam_usb(front_serial="DEV_A", side_serial="DEV_OFFLINE")

    def test_config_settings_serials(self, monkeypatch):
        monkeypatch.delenv("DROIDCAM_FRONT_SERIAL", raising=False)
        monkeypatch.delenv("DROIDCAM_SIDE_SERIAL", raising=False)

        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["CONF_FRONT", "CONF_SIDE"]),
            patch("app.camera.adb_forwarder.settings") as mock_settings,
            patch("app.camera.adb_forwarder.setup_forward") as mock_setup,
            patch("app.camera.adb_forwarder.verify_endpoint"),
        ):
            mock_settings.droidcam_front_serial = "CONF_FRONT"
            mock_settings.droidcam_side_serial = "CONF_SIDE"
            mock_settings.droidcam_front_port = 4747
            mock_settings.droidcam_side_port = 4748

            res = setup_dual_droidcam_usb(verify_streams=False)
            assert res.front_serial == "CONF_FRONT"
            assert res.side_serial == "CONF_SIDE"

    def test_config_settings_custom_ports(self, monkeypatch):
        monkeypatch.delenv("DROIDCAM_FRONT_SERIAL", raising=False)
        monkeypatch.delenv("DROIDCAM_SIDE_SERIAL", raising=False)

        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_1", "DEV_2"]),
            patch("app.camera.adb_forwarder.settings") as mock_settings,
            patch("app.camera.adb_forwarder.setup_forward") as mock_setup,
            patch("app.camera.adb_forwarder.verify_endpoint"),
        ):
            mock_settings.droidcam_front_serial = "DEV_1"
            mock_settings.droidcam_side_serial = "DEV_2"
            mock_settings.droidcam_front_port = 4755
            mock_settings.droidcam_side_port = 4756

            res = setup_dual_droidcam_usb(verify_streams=False)
            assert res.front_url == "http://127.0.0.1:4755/video"
            assert res.side_url == "http://127.0.0.1:4756/video"
            assert mock_setup.call_args_list == [
                call("DEV_1", 4755, 4747, Path("mock_adb.exe")),
                call("DEV_2", 4756, 4747, Path("mock_adb.exe")),
            ]

    def test_auto_assign_when_only_front_specified(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_A", "DEV_B"]),
            patch("app.camera.adb_forwarder.setup_forward"),
            patch("app.camera.adb_forwarder.verify_endpoint"),
        ):
            res = setup_dual_droidcam_usb(front_serial="DEV_A", verify_streams=False)
            assert res.front_serial == "DEV_A"
            assert res.side_serial == "DEV_B"

    def test_auto_assign_when_only_side_specified(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_A", "DEV_B"]),
            patch("app.camera.adb_forwarder.setup_forward"),
            patch("app.camera.adb_forwarder.verify_endpoint"),
        ):
            res = setup_dual_droidcam_usb(side_serial="DEV_B", verify_streams=False)
            assert res.front_serial == "DEV_A"
            assert res.side_serial == "DEV_B"

    def test_only_front_specified_no_other_device_raises(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_A"]),
        ):
            with pytest.raises(AdbDeviceNotFoundError, match="SIDE device serial not specified and no other ready device available"):
                setup_dual_droidcam_usb(front_serial="DEV_A", verify_streams=False)

    def test_only_side_specified_no_other_device_raises(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_B"]),
        ):
            with pytest.raises(AdbDeviceNotFoundError, match="FRONT device serial not specified and no other ready device available"):
                setup_dual_droidcam_usb(side_serial="DEV_B", verify_streams=False)

    def test_same_front_and_side_serial_raises(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.get_active_serials", return_value=["DEV_A", "DEV_B"]),
        ):
            with pytest.raises(AdbError, match="cannot use the same device serial"):
                setup_dual_droidcam_usb(front_serial="DEV_A", side_serial="DEV_A")

    def test_teardown_dual_droidcam_usb(self):
        with (
            patch("app.camera.adb_forwarder.find_adb_executable", return_value=Path("mock_adb.exe")),
            patch("app.camera.adb_forwarder.remove_forward") as mock_remove,
        ):
            teardown_dual_droidcam_usb(4747, 4748)
            assert mock_remove.call_args_list == [
                call(4747, Path("mock_adb.exe")),
                call(4748, Path("mock_adb.exe")),
            ]
