import React, { useEffect, useRef, useState } from 'react';
import {
  createHandLandmarker,
  extractWristCoordinates,
  normToCanvas,
} from '../services/handTracker.ts';
import type { GloveData } from '../services/handTracker.ts';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

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
// Realistic Glove Assets
// ---------------------------------------------------------------------------

// Preload high-resolution photorealistic boxing glove image assets once
const leftGloveAsset = new Image();
leftGloveAsset.src = '/assets/gloves/boxing-glove-left.png';

const rightGloveAsset = new Image();
rightGloveAsset.src = '/assets/gloves/boxing-glove-right.png';

// ---------------------------------------------------------------------------
// Glove overlay hook with Real-Time MediaPipe Hand Tracking
// ---------------------------------------------------------------------------

/**
 * Manages the real-time hand-tracking loop and canvas overlay.
 *
 * - Tracks left and right hands via MediaPipe HandLandmarker.
 * - Smooth position + orientation angle + scale using velocity-adaptive exponential smoothing.
 * - Renders photorealistic combat-sports boxing glove graphic assets over actual fists.
 * - Cleans up on unmount or completion: cancels rAF, closes MediaPipe, disconnects ResizeObserver.
 */
function useGloveOverlay(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const video = videoRef.current;
    if (!canvas || !container || !video) return;

    let animId: number;
    let isCancelled = false;
    let landmarker: HandLandmarker | null = null;
    let lastVideoTime = -1;
    let lastLandmarkerTimestamp = 0;

    // Smoothed state: position + angle + scale for each glove.
    const state = {
      left: {
        current: { x: 0.65, y: 0.55 },
        target:  { x: 0.65, y: 0.55 },
        angleCurrent: 0,
        angleTarget:  0,
        scaleCurrent: 160,
        scaleTarget:  160,
        lastSeen: 0,
        hasEverBeenSeen: false,
      },
      right: {
        current: { x: 0.35, y: 0.55 },
        target:  { x: 0.35, y: 0.55 },
        angleCurrent: 0,
        angleTarget:  0,
        scaleCurrent: 160,
        scaleTarget:  160,
        lastSeen: 0,
        hasEverBeenSeen: false,
      },
    };

    const syncCanvasSize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
        canvas.width  = Math.round(width);
        canvas.height = Math.round(height);
      }
    };

    syncCanvasSize();
    const observer = new ResizeObserver(syncCanvasSize);
    observer.observe(container);

    // Asynchronously instantiate MediaPipe HandLandmarker
    createHandLandmarker()
      .then((tracker) => {
        if (isCancelled) {
          tracker.close();
          return;
        }
        landmarker = tracker;
      })
      .catch((err) => {
        console.error('Failed to initialize MediaPipe HandLandmarker:', err);
      });

    const loop = () => {
      if (isCancelled) return;

      const now = performance.now();

      // Run inference whenever the video has fresh frame data
      if (
        landmarker &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.paused &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        if (video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          try {
            const timestamp = Math.max(now, lastLandmarkerTimestamp + 1);
            lastLandmarkerTimestamp = timestamp;

            const results = landmarker.detectForVideo(video, timestamp);
            const tracked = extractWristCoordinates(
              results,
              canvas.width,
              canvas.height,
              video.videoWidth,
              video.videoHeight,
            );

            const applyGloveData = (g: typeof state.left, data: GloveData) => {
              if (!g.hasEverBeenSeen) {
                g.current = { ...data.norm };
                g.angleCurrent = data.angleDeg;
                g.scaleCurrent = data.handSpanPx * 2.85;
                g.hasEverBeenSeen = true;
              }
              g.target = { ...data.norm };
              g.angleTarget = data.angleDeg;
              g.scaleTarget = data.handSpanPx * 2.85;
              g.lastSeen = now;
            };

            if (tracked.left)  applyGloveData(state.left,  tracked.left);
            if (tracked.right) applyGloveData(state.right, tracked.right);

          } catch (detectionErr) {
            console.warn('MediaPipe detection frame error:', detectionErr);
          }
        }
      }

      // Shortest-path angle lerp (avoids spinning through 360)
      const lerpAngle = (cur: number, tgt: number, alpha: number) => {
        let diff = tgt - cur;
        while (diff >  180) diff -= 360;
        while (diff < -180) diff += 360;
        return cur + diff * alpha;
      };

      // Velocity-adaptive exponential smoothing for position + angle + scale
      const smoothGlove = (g: typeof state.left) => {
        if (!g.hasEverBeenSeen) return;
        const dx = g.target.x - g.current.x;
        const dy = g.target.y - g.current.y;
        const dist = Math.hypot(dx, dy);

        // Velocity-adaptive smoothing for position (responsive yet jitter-free)
        const alpha = Math.min(0.88, Math.max(0.42, 0.42 + dist * 2.6));
        g.current.x += dx * alpha;
        g.current.y += dy * alpha;

        // Smooth angle
        const alphaA = Math.min(0.75, Math.max(0.35, 0.35 + dist * 2.0));
        g.angleCurrent = lerpAngle(g.angleCurrent, g.angleTarget, alphaA);

        // Smooth scale to eliminate depth flicker
        const alphaS = 0.35;
        g.scaleCurrent += (g.scaleTarget - g.scaleCurrent) * alphaS;
      };

      smoothGlove(state.left);
      smoothGlove(state.right);

      // Render realistic glove graphic overlay on canvas
      const ctx = canvas.getContext('2d');
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        const vW = video.videoWidth || width;
        const vH = video.videoHeight || height;

        const minGloveH = Math.min(width, height) * 0.16;
        const maxGloveH = Math.min(width, height) * 0.65;

        const renderRealisticGlove = (
          g: typeof state.left,
          asset: HTMLImageElement,
        ) => {
          if (!g.hasEverBeenSeen || now - g.lastSeen > 400) return;
          if (!asset.complete || asset.naturalWidth === 0) return;

          const coords = normToCanvas(g.current, width, height, vW, vH);
          const gloveH = Math.min(maxGloveH, Math.max(minGloveH, g.scaleCurrent));
          const aspect = asset.naturalWidth / asset.naturalHeight;
          const gloveW = gloveH * aspect;

          ctx.save();
          ctx.translate(coords.cx, coords.cy);
          ctx.rotate((g.angleCurrent * Math.PI) / 180);

          // Subtle realistic contact drop shadow
          ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
          ctx.shadowBlur = Math.round(gloveH * 0.08);
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = Math.round(gloveH * 0.04);

          // Draw the realistic combat-sports glove asset.
          // Knuckles sit over the fist (top of asset), cuff visually connects to wrist.
          ctx.drawImage(
            asset,
            -gloveW / 2,
            -gloveH * 0.52,
            gloveW,
            gloveH,
          );

          ctx.restore();
        };

        renderRealisticGlove(state.left, leftGloveAsset);
        renderRealisticGlove(state.right, rightGloveAsset);
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animId);
      observer.disconnect();
      if (landmarker) {
        try {
          landmarker.close();
        } catch {
          // ignore close errors on unmount
        }
        landmarker = null;
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [active, canvasRef, containerRef, videoRef]);
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
 *   cleans up MediaPipe resources, and calls onFightComplete() once.
 */
export const LiveFightScreen: React.FC<LiveFightScreenProps> = ({
  durationSecs = DEFAULT_DURATION_SECS,
  onFightComplete,
}) => {
  const videoRef          = useRef<HTMLVideoElement>(null);
  const streamRef         = useRef<MediaStream | null>(null);
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const viewportRef       = useRef<HTMLDivElement>(null);

  // Guard: onFightComplete fires at most once per mount
  const completedRef      = useRef<boolean>(false);
  const onFightCompleteRef = useRef(onFightComplete);
  useEffect(() => {
    onFightCompleteRef.current = onFightComplete;
  }, [onFightComplete]);

  const [cameraState, setCameraState] = useState<CameraState>('requesting');
  const [timeLeft,    setTimeLeft]    = useState<number>(durationSecs);
  const [isFightEnded, setIsFightEnded] = useState<boolean>(false);

  // -------------------------------------------------------------------------
  // Camera acquisition + cleanup
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const videoEl = videoRef.current;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });

        if (cancelled) {
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

        const name = err instanceof DOMException ? err.name : '';

        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
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
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Glove canvas overlay (active only when camera is ready and fight has not ended)
  // -------------------------------------------------------------------------
  useGloveOverlay(
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
      if (completedRef.current) return;
      completedRef.current = true;
      setIsFightEnded(true);

      // 1. Immediately stop camera tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      // 2. Trigger parent transition (App.tsx leaves LIVE FIGHT -> PROCESSING)
      onFightCompleteRef.current?.();
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
      {/*
        ref={viewportRef} is used by useGloveOverlay's ResizeObserver to
        keep the canvas bitmap dimensions in sync with layout.
      */}
      <div
        ref={viewportRef}
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden"
      >

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
          - The bitmap size is kept in sync via useGloveOverlay / ResizeObserver.
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
