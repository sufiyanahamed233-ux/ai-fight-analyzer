import React, { useEffect, useRef, useState } from 'react';
import { useARGloveOverlay } from '../ar/useARGloveOverlay';
import { apiService } from '../services/api';
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
  const videoRef          = useRef<HTMLVideoElement>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const viewportRef       = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    let cancelled = false;
    let animId: number;
    const videoEl = videoRef.current;

    async function startCamera() {
      try {
        // 1. Check if backend stream is available
        const { FRONT_STREAM_URL, checkPhone1StreamAvailable } = await import('../services/camera');
        const isAvailable = await checkPhone1StreamAvailable();

        if (cancelled) return;

        if (!isAvailable) {
          setCameraState('unavailable');
          return;
        }

        // 2. Consume MJPEG stream into a hidden Image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load backend MJPEG stream'));
          // Append a timestamp to avoid aggressive caching
          img.src = `${FRONT_STREAM_URL}?t=${Date.now()}`;
        });

        if (cancelled) return;

        // 3. Draw Image to a hidden Canvas and capture it as a MediaStream
        // This bridges the MJPEG endpoint to the <video> element expected by useARGloveOverlay
        const hiddenCanvas = document.createElement('canvas');
        hiddenCanvas.width = img.naturalWidth || 1280;
        hiddenCanvas.height = img.naturalHeight || 720;
        const ctx = hiddenCanvas.getContext('2d');

        if (!ctx) {
          throw new Error('Failed to get 2d context for hidden stream canvas');
        }

        const renderLoop = () => {
          if (cancelled) return;
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
          }
          animId = requestAnimationFrame(renderLoop);
        };
        renderLoop();

        // 4. Feed the captured stream to the video element
        const stream = hiddenCanvas.captureStream(30);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Must play the video explicitly when piping a captured stream
          await videoRef.current.play().catch(() => {});
        }

        setCameraState('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        setCameraState('unavailable');
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      if (animId) cancelAnimationFrame(animId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoEl) {
        videoEl.srcObject = null;
      }
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
  // AR Glove canvas overlay (Three.js WebGL with 2D PNG fallback)
  // -------------------------------------------------------------------------
  useARGloveOverlay(
    canvasRef,
    viewportRef,
    videoRef,
    cameraState === 'ready' && !isFightEnded,
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

      // 1. Immediately stop camera tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

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
  // Render helpers
  // -------------------------------------------------------------------------

  const progressPct = cameraState === 'ready'
    ? ((durationSecs - timeLeft) / durationSecs) * 100
    : 0;

  const timerDone = isFightEnded || timeLeft <= 0;

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

        {/* Live video feed – CSS-mirrored so the participant sees themselves correctly */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ transform: 'scaleX(-1)' }}
          className={`w-full h-full object-cover transition-opacity duration-500 ${
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
          style={{ pointerEvents: 'none' }}
          className={`absolute inset-0 w-full h-full transition-opacity duration-500 ${
            cameraState === 'ready' ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden="true"
        />

        {/* Live HUD telemetry badges (ready only) */}
        {cameraState === 'ready' && !isFightEnded && (
          <>
            <div className="absolute top-4 left-6 pointer-events-none flex items-center gap-2 px-3 py-1 rounded bg-black/60 border border-neutral-800 text-[10px] font-mono uppercase tracking-widest text-neutral-300 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>ROUND ACTIVE // POSE CV LOCK</span>
            </div>
            {/* Mobile title fallback floating */}
            <div className="absolute top-16 left-6 pointer-events-none sm:hidden">
              <h1 className="text-2xl font-black uppercase tracking-tight leading-none">
                <span className="text-white drop-shadow-[0_4px_15px_rgba(255,255,255,0.2)]">FIGHT</span> <span className="text-[#E10600] drop-shadow-[0_0_15px_rgba(225,6,0,0.8)]">ACTIVE</span>
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
            Fight Over
          </p>
        )}
      </div>
    </div>
  );
};
