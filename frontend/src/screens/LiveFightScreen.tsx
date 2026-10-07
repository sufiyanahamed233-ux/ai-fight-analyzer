import React, { useEffect, useRef, useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CameraState =
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'unavailable';

/**
 * Normalised wrist coordinates in the range [0, 1].
 *
 * x = 0 is the LEFT edge of the camera frame (before mirroring).
 * y = 0 is the TOP edge.
 *
 * The canvas draw function mirrors x so gloves align with the CSS-mirrored
 * video:  canvasX = (1 - norm.x) * canvasWidth
 *
 * When the real CV backend is wired in, replace MOCK_WRISTS with live values
 * (e.g. from a WebSocket message) using the same WristCoords shape.
 */
interface WristCoords {
  /** Normalised [0..1] horizontal position in the un-mirrored camera frame. */
  x: number;
  /** Normalised [0..1] vertical position. */
  y: number;
}

interface LiveFightScreenProps {
  /** Total fight duration in seconds (presentation-only timer). */
  durationSecs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_SECS = 10;

/**
 * MOCK wrist positions – temporary placeholder for Phase 8.
 * Replace with real CV-backend data in a later phase.
 * Coordinates are normalised (0→1) in the un-mirrored camera frame.
 */
const MOCK_WRISTS: { left: WristCoords; right: WristCoords } = {
  left:  { x: 0.40, y: 0.55 },
  right: { x: 0.60, y: 0.55 },
};

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
// Canvas glove drawing
// ---------------------------------------------------------------------------

/**
 * Convert a normalised wrist coordinate to canvas pixel coordinates.
 *
 * The video element is CSS-mirrored (scaleX(-1)) so the participant sees their
 * hands on the "correct" side of the screen.  We apply the same horizontal
 * mirror here so the canvas gloves stay aligned:
 *
 *   canvasX = (1 - norm.x) * canvasWidth
 *   canvasY =       norm.y  * canvasHeight
 *
 * This mapping is the single authoritative place to update when real backend
 * wrist coordinates arrive.
 */
function normToCanvas(
  norm: WristCoords,
  canvasWidth: number,
  canvasHeight: number,
): { cx: number; cy: number } {
  return {
    cx: (1 - norm.x) * canvasWidth,   // mirror x to match CSS scaleX(-1)
    cy:       norm.y  * canvasHeight,
  };
}

/**
 * Draw a stylised boxing glove centred at (cx, cy) on the given context.
 *
 * Geometry (no external images / assets):
 *  - Main body  : large rounded rectangle (the glove bulk)
 *  - Thumb bump : smaller ellipse on the inner side
 *  - Wrist cuff : flat rectangle below the main body
 *  - Highlight  : small semi-transparent arc for a 3-D sheen
 *
 * @param ctx        2-D rendering context
 * @param cx         centre-x of the glove on the canvas
 * @param cy         centre-y of the glove on the canvas
 * @param size       overall radius / scale unit (default ≈ 36)
 * @param isLeft     true → thumb on the right side, false → thumb on the left
 * @param fillColor  main glove colour
 */
function drawGlove(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  isLeft: boolean,
  fillColor: string,
): void {
  const thumbSide = isLeft ? 1 : -1; // +1 = right, -1 = left

  ctx.save();
  ctx.translate(cx, cy);

  // ----- Wrist cuff -----
  const cuffW = size * 1.1;
  const cuffH = size * 0.55;
  const cuffY = size * 0.55;
  ctx.beginPath();
  ctx.roundRect(-cuffW / 2, cuffY, cuffW, cuffH, size * 0.15);
  ctx.fillStyle = darken(fillColor, 0.25);
  ctx.fill();

  // Cuff horizontal seam line
  ctx.beginPath();
  ctx.moveTo(-cuffW / 2 + size * 0.1, cuffY + cuffH * 0.45);
  ctx.lineTo( cuffW / 2 - size * 0.1, cuffY + cuffH * 0.45);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = size * 0.06;
  ctx.stroke();

  // ----- Main glove body -----
  const bodyW = size * 1.25;
  const bodyH = size * 1.1;
  ctx.beginPath();
  ctx.roundRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, size * 0.38);
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Body outline
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = size * 0.07;
  ctx.stroke();

  // ----- Thumb bump (ellipse on the inner/upper side) -----
  const thumbX = thumbSide * (bodyW / 2 - size * 0.08);
  const thumbY = -bodyH * 0.18;
  ctx.beginPath();
  ctx.ellipse(thumbX, thumbY, size * 0.28, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = darken(fillColor, 0.12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = size * 0.06;
  ctx.stroke();

  // ----- Knuckle seam lines (horizontal across upper body) -----
  const seamsY = [-bodyH * 0.18, bodyH * 0.05, bodyH * 0.26];
  seamsY.forEach((sy) => {
    ctx.beginPath();
    ctx.moveTo(-bodyW * 0.36, sy);
    ctx.lineTo( bodyW * 0.36, sy);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = size * 0.045;
    ctx.stroke();
  });

  // ----- Highlight sheen (top-left arc) -----
  ctx.beginPath();
  ctx.arc(-bodyW * 0.18, -bodyH * 0.28, size * 0.32, Math.PI * 1.1, Math.PI * 1.7);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = size * 0.13;
  ctx.stroke();

  ctx.restore();
}

/** Darken a hex/rgb colour string by a fractional amount (0 = no change, 1 = black). */
function darken(color: string, amount: number): string {
  // Parse as hex shorthand or 6-digit
  const hex = color.replace('#', '');
  const full = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex;
  const r = Math.round(parseInt(full.slice(0, 2), 16) * (1 - amount));
  const g = Math.round(parseInt(full.slice(2, 4), 16) * (1 - amount));
  const b = Math.round(parseInt(full.slice(4, 6), 16) * (1 - amount));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Glove overlay hook
// ---------------------------------------------------------------------------

/**
 * Manages the canvas overlay that renders virtual boxing gloves.
 *
 * - Uses a ResizeObserver to keep the canvas bitmap dimensions in sync with
 *   the container element's layout size.
 * - Re-draws whenever the canvas size changes.
 * - Entirely independent of the camera lifecycle; operates only on the canvas ref.
 */
function useGloveOverlay(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  active: boolean,
): void {
  const drawGloves = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Glove size scales with the smaller canvas dimension
    const size = Math.min(width, height) * 0.065;

    // Left glove (participant's left → right side of mirrored frame)
    const left = normToCanvas(MOCK_WRISTS.left, width, height);
    drawGlove(ctx, left.cx, left.cy, size, true, '#cc1a1a');

    // Right glove (participant's right → left side of mirrored frame)
    const right = normToCanvas(MOCK_WRISTS.right, width, height);
    drawGlove(ctx, right.cx, right.cy, size, false, '#cc1a1a');
  }, []);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const syncAndDraw = () => {
      const { width, height } = container.getBoundingClientRect();
      // Only update bitmap size when dimensions actually change (avoids flicker)
      if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
        canvas.width  = Math.round(width);
        canvas.height = Math.round(height);
      }
      drawGloves(canvas);
    };

    // Initial draw
    syncAndDraw();

    const observer = new ResizeObserver(syncAndDraw);
    observer.observe(container);

    return () => observer.disconnect();
  }, [active, canvasRef, containerRef, drawGloves]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * LiveFightScreen – Phase 7 + Phase 8
 *
 * Phase 7: live camera feed via getUserMedia.
 * Phase 8: canvas overlay with mock virtual boxing gloves.
 *
 * Camera lifecycle:
 *  - Requests getUserMedia on mount.
 *  - Attaches the MediaStream to the <video> ref.
 *  - Stops every track in the cleanup function to release the device.
 *
 * Canvas overlay:
 *  - Positioned absolute, same bounds as the video.
 *  - pointer-events: none so it never blocks camera interaction.
 *  - ResizeObserver keeps canvas bitmap in sync with container layout.
 *  - Draws gloves only when cameraState === 'ready'.
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
  const videoRef     = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const viewportRef  = useRef<HTMLDivElement>(null);

  const [cameraState, setCameraState] = useState<CameraState>('requesting');
  const [timeLeft,    setTimeLeft]    = useState<number>(durationSecs);
  const [timerDone,   setTimerDone]   = useState<boolean>(false);

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
    };
  }, []);

  // -------------------------------------------------------------------------
  // Glove canvas overlay (active only when camera is ready)
  // -------------------------------------------------------------------------
  useGloveOverlay(canvasRef, viewportRef, cameraState === 'ready');

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
            Time&rsquo;s up
          </p>
        )}
      </div>
    </div>
  );
};
