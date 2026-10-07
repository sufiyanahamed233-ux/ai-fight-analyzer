import React, { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CameraState =
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'unavailable';

interface LiveFightScreenProps {
  /** Total fight duration in seconds (presentation-only timer). */
  durationSecs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_SECS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Derive a human-readable message for each camera state.
 * Raw browser error text is intentionally never shown to the participant.
 */
function cameraErrorMessage(state: CameraState): string {
  switch (state) {
    case 'denied':
      return 'Camera access was denied. Please allow camera permissions and try again.';
    case 'unavailable':
      return 'Camera is unavailable on this device. Please check your hardware and try again.';
    default:
      return 'An unexpected error occurred with the camera.';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * LiveFightScreen – Phase 7
 *
 * Displays a live browser camera feed (Camera 1 / facingMode: "user") during
 * the FIGHT state. Includes a presentation-only countdown timer.
 *
 * Camera lifecycle:
 *  - Requests getUserMedia on mount.
 *  - Attaches the MediaStream to the <video> ref.
 *  - Stops every track in the cleanup function to release the device.
 *
 * Timer lifecycle:
 *  - Starts only once the camera is "ready".
 *  - UI-only: does not gate any backend recording.
 *
 * Error handling:
 *  - NotAllowedError / PermissionDeniedError  -> 'denied'
 *  - Everything else                           -> 'unavailable'
 */
export const LiveFightScreen: React.FC<LiveFightScreenProps> = ({
  durationSecs = DEFAULT_DURATION_SECS,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraState, setCameraState] = useState<CameraState>('requesting');
  const [timeLeft, setTimeLeft] = useState<number>(durationSecs);
  const [timerDone, setTimerDone] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Camera acquisition + cleanup
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });

        if (cancelled) {
          // Component unmounted while awaiting – release immediately
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        setCameraState('ready');
      } catch (err: unknown) {
        if (cancelled) return;

        const name =
          err instanceof DOMException ? err.name : '';

        if (
          name === 'NotAllowedError' ||
          name === 'PermissionDeniedError'
        ) {
          setCameraState('denied');
        } else {
          setCameraState('unavailable');
        }
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Presentation-only fight timer – starts after camera is ready
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (cameraState !== 'ready') return;

    setTimeLeft(durationSecs);
    setTimerDone(false);

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setTimerDone(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [cameraState, durationSecs]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const progressPct = cameraState === 'ready'
    ? ((durationSecs - timeLeft) / durationSecs) * 100
    : 0;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="w-full flex-1 flex flex-col items-stretch select-none overflow-hidden">

      {/* ── Top HUD ── */}
      <div className="flex items-center justify-between px-5 py-3 bg-neutral-950/90 border-b border-neutral-800/70">
        {/* Stage badge */}
        <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-neutral-400">
          <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
          <span>Stage 05 // Fight</span>
        </div>

        {/* Camera 1 live label */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-red-950/60 border border-red-700/50 text-[10px] sm:text-xs font-mono uppercase tracking-widest text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
          CAMERA&nbsp;1&nbsp;•&nbsp;LIVE
        </div>
      </div>

      {/* ── Camera Viewport ── */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">

        {/* Live video feed */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover transition-opacity duration-500 ${
            cameraState === 'ready' ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Live fight camera feed"
        />

        {/* ── Requesting overlay ── */}
        {cameraState === 'requesting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-neutral-950">
            <div className="relative flex items-center justify-center w-20 h-20">
              <div className="absolute inset-0 rounded-full border-2 border-red-500/30 animate-ping" />
              <div className="w-14 h-14 rounded-full border-2 border-dashed border-red-500/70 animate-spin" />
              <div className="absolute w-4 h-4 rounded-full bg-red-600" />
            </div>
            <p className="text-neutral-400 font-mono text-sm uppercase tracking-widest">
              Requesting camera…
            </p>
          </div>
        )}

        {/* ── Error overlay ── */}
        {(cameraState === 'denied' || cameraState === 'unavailable') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-neutral-950 px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-red-950/50 border border-red-700/60 flex items-center justify-center text-red-400 text-3xl">
              ✕
            </div>
            <div className="space-y-3 max-w-sm">
              <p className="text-white font-black uppercase tracking-wide text-xl">
                Camera Unavailable
              </p>
              <p className="text-neutral-400 font-mono text-sm leading-relaxed">
                {cameraErrorMessage(cameraState)}
              </p>
            </div>
          </div>
        )}

        {/* ── Corner scanline decoration (ready only) ── */}
        {cameraState === 'ready' && (
          <>
            {/* top-left */}
            <span className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-red-600/70 pointer-events-none" />
            {/* top-right */}
            <span className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-red-600/70 pointer-events-none" />
            {/* bottom-left */}
            <span className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-red-600/70 pointer-events-none" />
            {/* bottom-right */}
            <span className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-red-600/70 pointer-events-none" />
          </>
        )}
      </div>

      {/* ── Bottom HUD – Fight Timer ── */}
      <div className="flex flex-col items-center gap-3 px-5 py-4 bg-neutral-950/90 border-t border-neutral-800/70">

        {/* Timer display */}
        <div className="flex items-baseline gap-3">
          <span className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">
            Fight Time
          </span>
          <span
            className={`text-4xl sm:text-5xl font-black font-mono tabular-nums leading-none transition-colors duration-300 ${
              timerDone
                ? 'text-red-500'
                : timeLeft <= 3
                  ? 'text-amber-400'
                  : 'text-white'
            }`}
          >
            {formatTime(timeLeft)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-lg h-1 rounded-full bg-neutral-800 overflow-hidden">
          <div
            className="h-full bg-red-600 rounded-full transition-all duration-1000 ease-linear"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {timerDone && (
          <p className="text-xs font-mono uppercase tracking-widest text-red-400 animate-pulse">
            Time&rsquo;s up
          </p>
        )}
      </div>
    </div>
  );
};
