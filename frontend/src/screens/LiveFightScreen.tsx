import React, { useEffect, useRef, useState } from 'react';
import { useARGloveOverlay } from '../ar/useARGloveOverlay';
import { apiService } from '../services/api';
import { FRONT_STREAM_URL, checkPhone1StreamAvailable } from '../services/camera';
import type { FightObservationResult } from '../types/analysis';
import { CornerBrackets } from '../components/TelemetryOverlay';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CameraState =
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'unavailable';

interface LiveFightScreenProps {
  /** Total fight duration in seconds. */
  durationSecs?: number;
  /**
   * Called exactly once when the 10-second fight timer reaches zero.
   * App.tsx uses this to transition FIGHT -> PROCESSING.
   */
  onFightComplete?: () => void;
  /** Integration callbacks */
  onComplete?: (result: FightObservationResult) => void;
  onError?: (error: string) => void;
  onProcessing?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_SECS = 7;

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
 * LiveFightScreen
 *
 * - Acquires Camera 1 via getUserMedia on mount.
 * - Runs MediaPipe HandLandmarker and overlays photorealistic combat-sports gloves.
 * - Runs the 10-second fight timer; upon completion immediately terminates camera,
 *   cleans up MediaPipe resources, and calls onFightComplete() / onComplete() / onProcessing().
 */
export const LiveFightScreen: React.FC<LiveFightScreenProps> = ({
  durationSecs = DEFAULT_DURATION_SECS,
  onFightComplete,
  onComplete,
  onError,
  onProcessing,
}) => {
  const imageRef          = useRef<HTMLImageElement | null>(null);
  const videoRef          = useRef<HTMLVideoElement | null>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const viewportRef       = useRef<HTMLDivElement>(null);
  const animFrameIdRef    = useRef<number | null>(null);
  const isStartingCameraRef = useRef<boolean>(false);
  const isStreamActiveRef   = useRef<boolean>(false);

  // Guard refs to prevent duplicate callbacks & duplicate API triggers
  const completedRef          = useRef<boolean>(false);
  const hasTriggeredApiRef    = useRef<boolean>(false);
  const timerReachedZeroRef   = useRef<boolean>(false);
  const analysisResultRef     = useRef<FightObservationResult | null>(null);

  // Callback refs to prevent stale closure issues inside async / interval handlers
  const onFightCompleteRef = useRef(onFightComplete);
  const onCompleteRef      = useRef(onComplete);
  const onErrorRef         = useRef(onError);
  const onProcessingRef    = useRef(onProcessing);

  useEffect(() => {
    onFightCompleteRef.current = onFightComplete;
    onCompleteRef.current      = onComplete;
    onErrorRef.current         = onError;
    onProcessingRef.current    = onProcessing;
  }, [onFightComplete, onComplete, onError, onProcessing]);

  const [cameraState, setCameraState] = useState<CameraState>('requesting');
  const [timeLeft,    setTimeLeft]    = useState<number>(durationSecs);
  const [isFightEnded, setIsFightEnded] = useState<boolean>(false);

  const cleanupStream = () => {
    isStartingCameraRef.current = false;
    isStreamActiveRef.current = false;

    if (animFrameIdRef.current !== null) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }

    const imgEl = imageRef.current;
    if (imgEl) {
      imgEl.onload = null;
      imgEl.onerror = null;
      imgEl.src = '';
      imgEl.removeAttribute('src');
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      // Prevent duplicate initialization if startCamera is called more than once
      if (isStartingCameraRef.current || isStreamActiveRef.current) {
        return;
      }
      isStartingCameraRef.current = true;

      try {
        // 1. Resilient readiness check (retry up to 4 times with backoff)
        let isAvailable = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          if (cancelled) return;
          isAvailable = await checkPhone1StreamAvailable();
          if (isAvailable) break;
          await new Promise((r) => setTimeout(r, 600));
        }

        if (cancelled) return;

        if (!isAvailable) {
          setCameraState('unavailable');
          isStartingCameraRef.current = false;
          return;
        }

        const imgEl = imageRef.current;
        if (!imgEl) {
          isStartingCameraRef.current = false;
          return;
        }

        // 2. Direct MJPEG stream into tracked <img> element
        await new Promise<void>((resolve, reject) => {
          let settled = false;

          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              if (imgEl.naturalWidth > 0 || isAvailable) {
                resolve();
              } else {
                reject(new Error('Timed out waiting for MJPEG stream frame'));
              }
            }
          }, 3500);

          imgEl.onload = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          };

          imgEl.onerror = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              if (isAvailable) {
                resolve();
              } else {
                reject(new Error('Failed to load backend MJPEG stream'));
              }
            }
          };

          imgEl.src = `${FRONT_STREAM_URL}?t=${Date.now()}`;
        });

        if (cancelled) {
          cleanupStream();
          return;
        }

        // Remove the one-off onload handler now that stream is established
        if (imgEl) {
          imgEl.onload = null;
          imgEl.onerror = () => {
            if (!cancelled) {
              console.warn('[LiveFightScreen] MJPEG stream disconnected.');
            }
          };
        }

        isStreamActiveRef.current = true;
        isStartingCameraRef.current = false;
        setCameraState('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('[LiveFightScreen] Camera acquisition error:', err);
        setCameraState('unavailable');
        isStartingCameraRef.current = false;
        isStreamActiveRef.current = false;
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      cleanupStream();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Trigger Backend Analysis ONCE when camera is ready
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (cameraState !== 'ready') return;
    if (hasTriggeredApiRef.current) return;
    hasTriggeredApiRef.current = true;

    apiService
      .analyzeFight({ duration_seconds: durationSecs })
      .then((result) => {
        analysisResultRef.current = result;

        // If the 10-second fight timer has already expired while the API call was running:
        if (timerReachedZeroRef.current && !completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current?.(result);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        onErrorRef.current?.(message);
      });
  }, [cameraState, durationSecs]);

  // -------------------------------------------------------------------------
  // Render helpers & Timeline Logic
  // -------------------------------------------------------------------------

  const elapsedSecs = durationSecs - timeLeft;
  const isPrepPhase = elapsedSecs < 2;
  const timerDone = isFightEnded || timeLeft <= 0;
  
  // Progress bar represents the continuous 15s duration (0s to 15s)
  const fightProgressPct = cameraState === 'ready'
    ? ((durationSecs - timeLeft) / durationSecs) * 100
    : 0;

  // -------------------------------------------------------------------------
  // AR Glove canvas overlay (Three.js WebGL with 2D PNG fallback)
  // -------------------------------------------------------------------------
  useARGloveOverlay(
    canvasRef,
    viewportRef,
    videoRef,
    false,
  );

  // -------------------------------------------------------------------------
  // Exact 10-Second Fight Timer + Single-Fire Completion Lifecycle
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (cameraState !== 'ready') return;

    let timerId: ReturnType<typeof setInterval> | null = null;
    const fightStart = Date.now();
    const durationMs = durationSecs * 1000;

    const stopFight = () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      timerReachedZeroRef.current = true;
      setIsFightEnded(true);

      // 1. Immediately close camera preview and release stream
      cleanupStream();

      // 2. Trigger legacy parent transition callback
      onFightCompleteRef.current?.();

      // 3. Handle integration flow:
      // If analysis result has already arrived, call onComplete immediately.
      // Otherwise, call onProcessing to signal the parent component.
      if (analysisResultRef.current) {
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current?.(analysisResultRef.current);
        }
      } else {
        onProcessingRef.current?.();
      }
    };

    const tick = () => {
      const elapsed = Date.now() - fightStart;
      const remainingSecs = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      setTimeLeft(remainingSecs);

      if (elapsed >= durationMs || remainingSecs <= 0) {
        stopFight();
      }
    };

    timerId = setInterval(tick, 100);

    return () => {
      if (timerId !== null) {
        clearInterval(timerId);
      }
    };
  }, [cameraState, durationSecs]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="w-full flex-1 flex flex-col items-stretch select-none overflow-hidden">

      {/* ── Top HUD ── */}
      <div className="flex items-center justify-between px-5 py-3 bg-neutral-950/90 border-b border-neutral-800/70">
        {/* Stage badge */}
        <div className="flex items-center gap-4">
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-neutral-400">
            <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
            <span>Stage 05 // Fight</span>
          </div>
          
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight leading-none hidden sm:block">
            <span className="text-white drop-shadow-[0_4px_15px_rgba(255,255,255,0.2)]">FIGHT</span> <span className="text-[#E10600] drop-shadow-[0_0_15px_rgba(225,6,0,0.8)]">ACTIVE</span>
          </h1>
        </div>

        {/* Camera 1 live label */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-red-950/60 border border-red-700/50 text-[10px] sm:text-xs font-mono uppercase tracking-widest text-red-400">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
          CAMERA&nbsp;1&nbsp;•&nbsp;LIVE
        </div>
      </div>

      {/* ── Camera Viewport ── */}
      {/*
        ref={viewportRef} is used by useARGloveOverlay's ResizeObserver to
        keep the canvas bitmap dimensions in sync with layout.
      */}
      <div
        ref={viewportRef}
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden border-y border-red-900/40 shadow-[inset_0_0_80px_rgba(220,38,38,0.2)]"
      >
        <CornerBrackets />

        {/* Live MJPEG stream feed – CSS-mirrored so the participant sees themselves correctly */}
        <img
          ref={imageRef}
          alt="Live fight camera feed"
          style={{ transform: 'scaleX(-1)' }}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${
            cameraState === 'ready' ? 'opacity-100' : 'opacity-0'
          }`}
          aria-label="Live fight camera feed"
        />

        {/*
          ── Canvas Glove Overlay ──
          - absolute + inset-0 → same bounds as the video.
          - pointer-events: none → never blocks interaction.
          - The bitmap size is kept in sync via useARGloveOverlay / ResizeObserver.
          - Only visible when camera is ready.
        */}
        <canvas
          ref={canvasRef}
          style={{
            pointerEvents: 'none',
            display: 'none',
          }}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 opacity-0 pointer-events-none`}
          aria-hidden="true"
        />

        {/* Live HUD telemetry badges (ready only) */}
        {cameraState === 'ready' && !isFightEnded && (
          <>
            <div className="absolute top-4 left-6 pointer-events-none flex flex-col gap-2">
              <div className="flex items-center gap-2 px-3 py-1 rounded bg-black/60 border border-neutral-800 text-[10px] font-mono uppercase tracking-widest text-neutral-300 backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{isPrepPhase ? 'PREPARATION // POSE CV LOCK' : 'ROUND ACTIVE // RECORDING'}</span>
              </div>
            </div>

            {/* Removed GUARD UP Overlay (0-2s) as requested */}

            {/* Mobile title fallback floating */}
            <div className="absolute top-16 left-6 pointer-events-none sm:hidden">
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none">
                <span className="text-white drop-shadow-[0_4px_15px_rgba(255,255,255,0.2)]">FIGHT</span> <span className="text-[#E10600] drop-shadow-[0_0_15px_rgba(225,6,0,0.8)]">{isPrepPhase ? 'PREP' : 'ACTIVE'}</span>
              </h1>
            </div>
          </>
        )}

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
            {isPrepPhase ? 'GUARD PHASE' : 'FIGHT TIME'}
          </span>
          <span
            className={`text-4xl sm:text-5xl font-black font-mono tabular-nums leading-none transition-colors duration-300 ${
              timerDone
                ? 'text-red-500'
                : isPrepPhase
                  ? 'text-emerald-400'
                  : timeLeft <= 3
                    ? 'text-amber-400'
                    : 'text-white'
            }`}
          >
            {formatTime(timeLeft)}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-lg h-1 rounded-full bg-neutral-800 overflow-hidden relative">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-linear ${
              isPrepPhase ? 'bg-emerald-500' : 'bg-red-600'
            }`}
            style={{ width: `${fightProgressPct}%` }}
          />
        </div>

        {timerDone && (
          <p className="text-xs font-mono uppercase tracking-widest text-red-400 animate-pulse">
            Fight Over
          </p>
        )}
      </div>
    </div>
  );
};
