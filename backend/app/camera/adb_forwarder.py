"""
adb_forwarder.py
----------------
Automatic USB ADB port-forwarding manager for dual DroidCam devices.

Responsibilities:
  - Locate the bundled or system ADB executable (e.g., from DroidCam Client installation)
  - Detect connected and authorized Android devices via `adb devices`
  - Map configurable FRONT and SIDE device serials to local ports:
      FRONT -> localhost:4747 -> remote 4747
      SIDE  -> localhost:4748 -> remote 4747
  - Safely inspect, remove, and recreate conflicting forwards
  - Verify forwarded DroidCam endpoints respond (using camera_manager probe functions)
  - Provide clean error reporting when devices are offline, unauthorized, or missing

Kept strictly decoupled from DualCameraRecorder to preserve modularity and fallback options.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple, Union

from app.camera.camera_manager import CameraInfo, check_droidcam_port, probe_stream
try:
    from app.core.config import settings
except ImportError:  # pragma: no cover
    settings = None

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants & Defaults
# ---------------------------------------------------------------------------

ENV_ADB_PATH = "DROIDCAM_ADB_PATH"
ENV_FRONT_SERIAL = "DROIDCAM_FRONT_SERIAL"
ENV_SIDE_SERIAL = "DROIDCAM_SIDE_SERIAL"

DEFAULT_FRONT_PORT = 4747
DEFAULT_SIDE_PORT = 4748
DEFAULT_REMOTE_PORT = 4747

DEFAULT_ADB_SEARCH_PATHS: Tuple[Path, ...] = (
    Path(r"C:\Program Files\DroidCam\Client\data\obs-plugins\droidcam-obs\adb\adb.exe"),
    Path(r"C:\Program Files\DroidCam\Client\adb.exe"),
    Path(r"C:\Program Files\DroidCam\adb.exe"),
    Path(r"C:\Program Files (x86)\DroidCam\Client\data\obs-plugins\droidcam-obs\adb\adb.exe"),
    Path(r"C:\Program Files (x86)\DroidCam\Client\adb.exe"),
    Path(r"C:\Program Files (x86)\DroidCam\adb.exe"),
    Path(os.path.expandvars(r"%LOCALAPPDATA%\Programs\DroidCam\Client\adb.exe")),
    Path(os.path.expandvars(r"%LOCALAPPDATA%\Programs\DroidCam\adb.exe")),
    Path(os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe")),
    Path(os.path.expandvars(r"%USERPROFILE%\AppData\Local\Android\Sdk\platform-tools\adb.exe")),
)


# ---------------------------------------------------------------------------
# Custom Exceptions
# ---------------------------------------------------------------------------


class AdbError(Exception):
    """Base exception for ADB operations."""


class AdbNotFoundError(AdbError):
    """Raised when ADB executable cannot be found."""


class AdbDeviceNotFoundError(AdbError):
    """Raised when a required Android device is missing or unauthorized."""


class AdbForwardError(AdbError):
    """Raised when ADB forwarding or stream verification fails."""


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------


@dataclass
class AdbDevice:
    """Represents a connected Android device."""

    serial: str
    state: str  # 'device', 'unauthorized', 'offline', etc.

    @property
    def is_ready(self) -> bool:
        return self.state == "device"


@dataclass
class DualAdbSetupResult:
    """Result of setting up dual DroidCam ADB forwards."""

    front_serial: str
    side_serial: str
    front_url: str
    side_url: str
    front_info: Optional[CameraInfo] = None
    side_info: Optional[CameraInfo] = None


# ---------------------------------------------------------------------------
# Core ADB Helpers
# ---------------------------------------------------------------------------


def find_adb_executable(custom_path: Optional[Union[str, Path]] = None) -> Path:
    """
    Locate the ADB executable.

    Checks:
    1. Explicit custom_path
    2. DROIDCAM_ADB_PATH environment variable
    3. Bundled DroidCam ADB search locations
    4. System PATH via shutil.which('adb')
    """
    if custom_path:
        p = Path(custom_path)
        if p.is_file():
            return p.resolve()
        raise AdbNotFoundError(f"Custom ADB executable not found at: {custom_path}")

    env_path = os.getenv(ENV_ADB_PATH) or (
        getattr(settings, "droidcam_adb_path", None) if settings else None
    )
    if env_path:
        p = Path(env_path)
        if p.is_file():
            return p.resolve()
        raise AdbNotFoundError(f"Environment {ENV_ADB_PATH} specifies non-existent path: {env_path}")

    for candidate in DEFAULT_ADB_SEARCH_PATHS:
        if candidate.is_file():
            logger.debug("Found bundled DroidCam ADB: %s", candidate)
            return candidate.resolve()

    system_adb = shutil.which("adb")
    if system_adb:
        return Path(system_adb).resolve()

    raise AdbNotFoundError(
        "Could not find ADB executable. Ensure DroidCam is installed or set "
        f"the {ENV_ADB_PATH} environment variable."
    )


def run_adb_command(
    args: List[str],
    adb_path: Optional[Union[str, Path]] = None,
    timeout: float = 10.0,
) -> str:
    """Execute an ADB command and return stdout. Raises AdbError on failure."""
    resolved_adb = find_adb_executable(adb_path)
    cmd = [str(resolved_adb)] + args

    try:
        res = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AdbError(f"ADB command timed out after {timeout}s: {' '.join(cmd)}") from exc
    except Exception as exc:
        raise AdbError(f"Failed to execute ADB command ({' '.join(cmd)}): {exc}") from exc

    if res.returncode != 0:
        err_msg = res.stderr.strip() or res.stdout.strip()
        raise AdbError(f"ADB command failed ({' '.join(args)}): {err_msg}")

    return res.stdout


def list_devices(adb_path: Optional[Union[str, Path]] = None) -> List[AdbDevice]:
    """Parse output of `adb devices` into AdbDevice instances."""
    output = run_adb_command(["devices"], adb_path=adb_path)
    devices: List[AdbDevice] = []

    for line in output.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices attached") or line.startswith("* daemon"):
            continue

        parts = line.split()
        if len(parts) >= 2:
            devices.append(AdbDevice(serial=parts[0], state=parts[1]))

    return devices


def get_active_serials(adb_path: Optional[Union[str, Path]] = None) -> List[str]:
    """Return serials of all devices in 'device' (authorized/ready) state."""
    return [d.serial for d in list_devices(adb_path) if d.is_ready]


def list_forwards(adb_path: Optional[Union[str, Path]] = None) -> List[dict]:
    """
    Parse output of `adb forward --list`.

    Returns:
        List of dicts: [{'serial': str, 'local': str, 'remote': str}]
    """
    output = run_adb_command(["forward", "--list"], adb_path=adb_path)
    forwards: List[dict] = []

    for line in output.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) >= 3:
            forwards.append(
                {
                    "serial": parts[0],
                    "local": parts[1],
                    "remote": parts[2],
                }
            )

    return forwards


def remove_forward(local_port: int, adb_path: Optional[Union[str, Path]] = None) -> None:
    """Remove forward on tcp:<local_port> safely (ignores if not present)."""
    try:
        run_adb_command(["forward", "--remove", f"tcp:{local_port}"], adb_path=adb_path)
        logger.debug("Removed existing forward on local port %d", local_port)
    except AdbError as exc:
        logger.debug("Forward remove for port %d returned: %s", local_port, exc)


def setup_forward(
    serial: str,
    local_port: int,
    remote_port: int = DEFAULT_REMOTE_PORT,
    adb_path: Optional[Union[str, Path]] = None,
) -> None:
    """
    Forward local_port to remote_port on specific device serial.
    Removes any conflicting forward on local_port first.
    """
    expected_local = f"tcp:{local_port}"
    expected_remote = f"tcp:{remote_port}"

    current = list_forwards(adb_path=adb_path)
    for f in current:
        if f["local"] == expected_local:
            if f["serial"] == serial and f["remote"] == expected_remote:
                logger.debug("Forward already matches: %s -> %s for %s", expected_local, expected_remote, serial)
                return
            # Conflicting forward on local_port -> remove it
            logger.info(
                "Removing conflicting forward on %s (was %s -> %s, target %s -> %s)",
                expected_local,
                f["serial"],
                f["remote"],
                serial,
                expected_remote,
            )
            remove_forward(local_port, adb_path=adb_path)
            break

    try:
        run_adb_command(["-s", serial, "forward", expected_local, expected_remote], adb_path=adb_path)
        logger.info("Configured ADB forward: %s -> localhost:%d -> remote:%d", serial, local_port, remote_port)
    except AdbError as exc:
        raise AdbForwardError(
            f"Failed to configure ADB forward on {expected_local} -> {expected_remote} for device '{serial}': {exc}"
        ) from exc


def verify_endpoint(
    url: str,
    port: int,
    verify_stream: bool = True,
) -> CameraInfo:
    """
    Verify that the forwarded DroidCam stream responds.

    Checks:
    1. TCP socket connection on localhost:port
    2. Optional frame read via camera_manager.probe_stream(url)
    """
    if not check_droidcam_port("127.0.0.1", port):
        raise AdbForwardError(
            f"TCP connection refused on 127.0.0.1:{port}. Ensure DroidCam is running on the device."
        )

    if verify_stream:
        info = probe_stream(url)
        if not info.available or not info.frame_read:
            raise AdbForwardError(
                f"DroidCam stream endpoint {url} failed validation: {info.error or 'no frame data'}"
            )
        return info

    return CameraInfo(index=-1, available=True, source=url)


# ---------------------------------------------------------------------------
# High-level Orchestrator
# ---------------------------------------------------------------------------


def setup_dual_droidcam_usb(
    front_serial: Optional[str] = None,
    side_serial: Optional[str] = None,
    front_local_port: int = DEFAULT_FRONT_PORT,
    side_local_port: int = DEFAULT_SIDE_PORT,
    remote_port: int = DEFAULT_REMOTE_PORT,
    verify_streams: bool = True,
    adb_path: Optional[Union[str, Path]] = None,
) -> DualAdbSetupResult:
    """
    Automate USB ADB port forwarding for dual DroidCam devices.

    Workflow:
    1. Detects connected Android devices.
    2. Resolves and validates FRONT and SIDE device serials.
    3. Replaces/configures local port forwards:
         FRONT -> localhost:front_local_port (default 4747) -> remote 4747
         SIDE  -> localhost:side_local_port  (default 4748) -> remote 4747
    4. Verifies both endpoints respond before returning.

    Raises:
        AdbNotFoundError: If ADB binary cannot be found.
        AdbDeviceNotFoundError: If a required phone is missing or unauthorized.
        AdbForwardError: If port forwarding or stream verification fails.
    """
    resolved_adb = find_adb_executable(adb_path)
    active_serials = get_active_serials(resolved_adb)

    # 1. Resolve configured or requested serials (args > config > env)
    target_front = (
        front_serial
        or (getattr(settings, "droidcam_front_serial", None) if settings else None)
        or os.getenv(ENV_FRONT_SERIAL)
    )
    target_side = (
        side_serial
        or (getattr(settings, "droidcam_side_serial", None) if settings else None)
        or os.getenv(ENV_SIDE_SERIAL)
    )

    actual_front_port = front_local_port if front_local_port != DEFAULT_FRONT_PORT else (
        getattr(settings, "droidcam_front_port", DEFAULT_FRONT_PORT) if settings else DEFAULT_FRONT_PORT
    )
    actual_side_port = side_local_port if side_local_port != DEFAULT_SIDE_PORT else (
        getattr(settings, "droidcam_side_port", DEFAULT_SIDE_PORT) if settings else DEFAULT_SIDE_PORT
    )

    # If serials are not explicitly specified, auto-assign from connected devices
    if not target_front and not target_side:
        if len(active_serials) < 2:
            raise AdbDeviceNotFoundError(
                f"Dual DroidCam requires 2 connected Android devices, but found {len(active_serials)}: "
                f"{active_serials}. Please connect both phones via USB with USB debugging enabled."
            )
        target_front = active_serials[0]
        target_side = active_serials[1]
    elif not target_front:
        remaining = [s for s in active_serials if s != target_side]
        if not remaining:
            raise AdbDeviceNotFoundError(
                f"FRONT device serial not specified and no other ready device available besides SIDE ({target_side})."
            )
        target_front = remaining[0]
    elif not target_side:
        remaining = [s for s in active_serials if s != target_front]
        if not remaining:
            raise AdbDeviceNotFoundError(
                f"SIDE device serial not specified and no other ready device available besides FRONT ({target_front})."
            )
        target_side = remaining[0]

    # Validate that both devices are distinct
    if target_front == target_side:
        raise AdbError(f"FRONT and SIDE cameras cannot use the same device serial ('{target_front}').")

    # Validate both devices are attached and ready (only query list_devices if missing)
    if target_front not in active_serials:
        all_devs = list_devices(resolved_adb)
        states = {d.serial: d.state for d in all_devs}
        state_msg = states.get(target_front, "not connected")
        raise AdbDeviceNotFoundError(
            f"Configured FRONT device '{target_front}' is {state_msg}. Ready devices: {active_serials}"
        )

    if target_side not in active_serials:
        all_devs = list_devices(resolved_adb)
        states = {d.serial: d.state for d in all_devs}
        state_msg = states.get(target_side, "not connected")
        raise AdbDeviceNotFoundError(
            f"Configured SIDE device '{target_side}' is {state_msg}. Ready devices: {active_serials}"
        )

    # 3. Create forwards
    setup_forward(target_front, actual_front_port, remote_port, resolved_adb)
    setup_forward(target_side, actual_side_port, remote_port, resolved_adb)

    front_url = f"http://127.0.0.1:{actual_front_port}/video"
    side_url = f"http://127.0.0.1:{actual_side_port}/video"

    # 4. Verify endpoints
    front_info: Optional[CameraInfo] = None
    side_info: Optional[CameraInfo] = None

    if verify_streams:
        logger.info("Verifying FRONT endpoint at %s...", front_url)
        front_info = verify_endpoint(front_url, actual_front_port, verify_stream=True)
        logger.info("Verifying SIDE endpoint at %s...", side_url)
        side_info = verify_endpoint(side_url, actual_side_port, verify_stream=True)

    logger.info(
        "Successfully configured dual DroidCam ADB forwards: FRONT=%s (%s), SIDE=%s (%s)",
        target_front,
        front_url,
        target_side,
        side_url,
    )

    return DualAdbSetupResult(
        front_serial=target_front,
        side_serial=target_side,
        front_url=front_url,
        side_url=side_url,
        front_info=front_info,
        side_info=side_info,
    )


def teardown_dual_droidcam_usb(
    front_local_port: int = DEFAULT_FRONT_PORT,
    side_local_port: int = DEFAULT_SIDE_PORT,
    adb_path: Optional[Union[str, Path]] = None,
) -> None:
    """Safely tear down local ADB forwards on the FRONT and SIDE ports."""
    resolved_adb = find_adb_executable(adb_path)
    actual_front_port = front_local_port if front_local_port != DEFAULT_FRONT_PORT else (
        getattr(settings, "droidcam_front_port", DEFAULT_FRONT_PORT) if settings else DEFAULT_FRONT_PORT
    )
    actual_side_port = side_local_port if side_local_port != DEFAULT_SIDE_PORT else (
        getattr(settings, "droidcam_side_port", DEFAULT_SIDE_PORT) if settings else DEFAULT_SIDE_PORT
    )
    remove_forward(actual_front_port, resolved_adb)
    remove_forward(actual_side_port, resolved_adb)
    logger.info("Removed DroidCam ADB forwards for ports %d and %d", actual_front_port, actual_side_port)
