"""DroidCam FFmpeg DirectShow Diagnostic Tool.

Captures raw video frames from DroidCam via an FFmpeg DirectShow pipe:
  ffmpeg -f dshow -i "video=DroidCam Video" -f rawvideo -pix_fmt bgr24 -video_size 1280x720 -r 30 pipe:1

Displays the live stream, prints received FPS and frame shape, and cleanly
terminates the FFmpeg subprocess when exiting (Q/ESC or Ctrl+C).
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import cv2
import numpy as np

# Suppress unnecessary OpenCV warnings
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

WIDTH = 1280
HEIGHT = 720
CHANNELS = 3
FRAME_SIZE = WIDTH * HEIGHT * CHANNELS
DEVICE_NAME = "video=DroidCam Video"
FPS_TARGET = 30

FFMPEG_CMD = [
    "ffmpeg",
    "-f", "dshow",
    "-i", DEVICE_NAME,
    "-f", "rawvideo",
    "-pix_fmt", "bgr24",
    "-video_size", f"{WIDTH}x{HEIGHT}",
    "-r", str(FPS_TARGET),
    "pipe:1",
]


def read_exact(stream, n_bytes: int) -> bytes | None:
    """Read exactly n_bytes from a binary stream or return None on EOF."""
    buffer = bytearray(n_bytes)
    view = memoryview(buffer)
    bytes_read = 0
    while bytes_read < n_bytes:
        chunk_size = stream.readinto(view[bytes_read:])
        if not chunk_size:
            return None
        bytes_read += chunk_size
    return bytes(buffer)


def terminate_process(proc: subprocess.Popen | None) -> None:
    """Cleanly terminate the FFmpeg subprocess."""
    if proc is None:
        return

    print("Cleaning up FFmpeg subprocess...")
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=2.0)
            print("FFmpeg process terminated gracefully.")
        except subprocess.TimeoutExpired:
            print("FFmpeg process timed out on terminate. Killing...")
            proc.kill()
            proc.wait(timeout=1.0)
            print("FFmpeg process killed.")

    if proc.stdout:
        try:
            proc.stdout.close()
        except Exception:
            pass


def main() -> None:
    print("=" * 65)
    print("DroidCam FFmpeg DirectShow Diagnostic")
    print(f"Target Device: {DEVICE_NAME}")
    print(f"Target Stream: {WIDTH}x{HEIGHT} @ {FPS_TARGET} FPS (bgr24)")
    print(f"Command: {' '.join(FFMPEG_CMD)}")
    print("=" * 65)
    print("Starting FFmpeg subprocess...")

    proc: subprocess.Popen | None = None
    window_name = "DroidCam FFmpeg Feed"

    try:
        proc = subprocess.Popen(
            FFMPEG_CMD,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=10**7,
        )
    except FileNotFoundError:
        print("ERROR: FFmpeg executable not found in PATH.")
        sys.exit(1)
    except Exception as exc:
        print(f"ERROR: Failed to start FFmpeg subprocess: {exc}")
        sys.exit(1)

    assert proc.stdout is not None, "Failed to capture FFmpeg stdout pipe."

    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(window_name, 960, 540)

    total_frames = 0
    interval_frames = 0
    last_fps_time = time.time()
    current_fps = 0.0

    print("Reading frames from pipe... Press 'Q' or ESC to exit.")
    print("-" * 65)

    try:
        while True:
            raw_bytes = read_exact(proc.stdout, FRAME_SIZE)
            if raw_bytes is None:
                # Check if process exited unexpectedly
                exit_code = proc.poll()
                print(f"\nPipe stream ended (FFmpeg exit code: {exit_code}).")
                break

            total_frames += 1
            interval_frames += 1

            # Reconstruct frame from buffer and ensure it is writable
            frame = np.frombuffer(raw_bytes, dtype=np.uint8).reshape((HEIGHT, WIDTH, CHANNELS)).copy()

            now = time.time()
            elapsed = now - last_fps_time
            if elapsed >= 1.0:
                current_fps = interval_frames / elapsed
                print(
                    f"[DroidCam Feed] Frame: {total_frames:5d} | "
                    f"Shape: {frame.shape} | "
                    f"Received FPS: {current_fps:5.1f}"
                )
                interval_frames = 0
                last_fps_time = now

            # Overlay diagnostic info on the live frame
            overlay_text = f"Shape: {frame.shape[1]}x{frame.shape[0]} | FPS: {current_fps:.1f} | Frame: {total_frames}"
            cv2.putText(
                frame,
                overlay_text,
                (20, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 255, 0),
                2,
                cv2.LINE_AA,
            )

            cv2.imshow(window_name, frame)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("\nExit key pressed (Q/ESC). Stopping...")
                break

    except KeyboardInterrupt:
        print("\nInterrupted by user (Ctrl+C). Stopping...")
    finally:
        terminate_process(proc)
        cv2.destroyAllWindows()
        print("OpenCV windows closed. Diagnostic completed.")


if __name__ == "__main__":
    main()
