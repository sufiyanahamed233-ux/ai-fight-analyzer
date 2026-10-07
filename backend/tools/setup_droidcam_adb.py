"""
setup_droidcam_adb.py
---------------------
CLI utility to automatically configure USB ADB port forwarding for dual DroidCam devices.

Usage:
    python tools/setup_droidcam_adb.py
    python tools/setup_droidcam_adb.py --front <serial> --side <serial>
    python tools/setup_droidcam_adb.py --teardown
    python tools/setup_droidcam_adb.py --no-verify
"""

import argparse
import sys
from pathlib import Path

# Ensure backend directory is in sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.camera.adb_forwarder import (
    AdbDeviceNotFoundError,
    AdbError,
    AdbForwardError,
    AdbNotFoundError,
    find_adb_executable,
    list_devices,
    list_forwards,
    setup_dual_droidcam_usb,
    teardown_dual_droidcam_usb,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Configure USB ADB port forwarding for dual DroidCam.")
    parser.add_argument("--front", help="Serial of the FRONT camera phone")
    parser.add_argument("--side", help="Serial of the SIDE camera phone")
    parser.add_argument("--front-port", type=int, default=4747, help="Local host port for FRONT (default: 4747)")
    parser.add_argument("--side-port", type=int, default=4748, help="Local host port for SIDE (default: 4748)")
    parser.add_argument("--teardown", action="store_true", help="Remove forwards on front and side ports")
    parser.add_argument("--no-verify", action="store_true", help="Skip /video endpoint frame verification")
    parser.add_argument("--list", action="store_true", help="List connected ADB devices and current forwards")

    args = parser.parse_args()

    print("=" * 65)
    print("AI Fight Analyzer - DroidCam USB ADB Setup Utility")
    print("=" * 65)

    try:
        adb_path = find_adb_executable()
        print(f"[ADB] Found ADB executable: {adb_path}")
    except AdbNotFoundError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    if args.list:
        print("\nConnected ADB devices:")
        devices = list_devices(adb_path)
        if not devices:
            print("  (no devices detected)")
        for d in devices:
            print(f"  - {d.serial} ({d.state})")

        print("\nCurrent ADB port forwards:")
        forwards = list_forwards(adb_path)
        if not forwards:
            print("  (no active forwards)")
        for f in forwards:
            print(f"  - {f['serial']}: {f['local']} -> {f['remote']}")
        return 0

    if args.teardown:
        print(f"[INFO] Tearing down ADB forwards for ports {args.front_port} and {args.side_port}...")
        teardown_dual_droidcam_usb(front_local_port=args.front_port, side_local_port=args.side_port)
        print("[SUCCESS] Port forwards removed.")
        return 0

    print("[INFO] Detecting connected devices and configuring ADB forwards...")
    try:
        result = setup_dual_droidcam_usb(
            front_serial=args.front,
            side_serial=args.side,
            front_local_port=args.front_port,
            side_local_port=args.side_port,
            verify_streams=not args.no_verify,
            adb_path=adb_path,
        )
        print("\n" + "-" * 65)
        print("[SUCCESS] USB ADB port forwarding active:")
        print(f"  FRONT Camera: {result.front_serial} -> {result.front_url}")
        if result.front_info and result.front_info.available:
            print(f"         Status: Verified ({result.front_info.width}x{result.front_info.height})")
        print(f"  SIDE  Camera: {result.side_serial} -> {result.side_url}")
        if result.side_info and result.side_info.available:
            print(f"         Status: Verified ({result.side_info.width}x{result.side_info.height})")
        print("-" * 65)
        print("Ready for dual-camera recording or diagnostics.")
        return 0
    except (AdbDeviceNotFoundError, AdbForwardError, AdbError) as exc:
        print(f"\n[ERROR] Setup failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
