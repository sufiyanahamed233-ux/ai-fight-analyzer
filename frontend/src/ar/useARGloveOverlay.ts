/**
 * useARGloveOverlay.ts
 *
 * React hook that manages the full AR glove pipeline:
 *
 *  1. Initialises MediaPipe HandLandmarker (local WASM → CDN fallback).
 *  2. Runs the landmark detection loop on every video frame.
 *  3. Converts landmarks to 3D hand poses via handPoseEstimator.
 *  4. Drives the Three.js ARGloveRenderer with the smoothed poses.
 *  5. Falls back to 2D PNG overlay if Three.js/WebGL is unavailable.
 *  6. Disposes all resources cleanly on unmount or when active becomes false.
 *
 * FALLBACK BEHAVIOR
 * -----------------
 * If WebGL is not available in the browser, or if ARGloveRenderer throws
 * during construction, the hook automatically falls back to the legacy
 * 2D canvas PNG renderer.  Both renderers share the same canvas element.
 *
 * CLEANUP GUARANTEES
 * ------------------
 * - requestAnimationFrame loop is always cancelled.
 * - MediaPipe HandLandmarker is always closed.
 * - ResizeObserver is always disconnected.
 * - ARGloveRenderer.dispose() is always called (or the 2D canvas is cleared).
 * - No duplicate loops are created.
 */

import { useEffect } from 'react';
import type React from 'react';
import { createHandLandmarker, normToCanvas, extractWristCoordinates } from '../services/handTracker';
import { extractHandPoses } from './handPoseEstimator';
import { ARGloveRenderer } from './ARGloveRenderer';
import type { HandLandmarker } from '@mediapipe/tasks-vision';

// ────────────────────────────────────────────────────────────────────────────
// 2-D fallback assets (same PNGs as before)
// ────────────────────────────────────────────────────────────────────────────

const leftGloveFallback  = new Image();
leftGloveFallback.src    = '/assets/gloves/boxing-glove-left.png';
const rightGloveFallback = new Image();
rightGloveFallback.src   = '/assets/gloves/boxing-glove-right.png';

// ────────────────────────────────────────────────────────────────────────────
// WebGL availability check
// ────────────────────────────────────────────────────────────────────────────

function isWebGLAvailable(): boolean {
  try {
    const testCanvas = document.createElement('canvas');
    return !!(
      testCanvas.getContext('webgl2') ||
      testCanvas.getContext('webgl')
    );
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

export function useARGloveOverlay(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    // Clear canvas when inactive
    if (!active) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const canvas    = canvasRef.current;
    const container = containerRef.current;
    const video     = videoRef.current;
    if (!canvas || !container || !video) return;

    let animId: number;
    let isCancelled = false;
    let landmarker: HandLandmarker | null = null;
    let lastVideoTime = -1;
    let lastLandmarkerTimestamp = 0;

    // Try to set up the 3D AR renderer
    let arRenderer: ARGloveRenderer | null = null;
    let using3D = false;

    if (isWebGLAvailable()) {
      try {
        arRenderer = new ARGloveRenderer(canvas);
        using3D    = true;
        console.info('[ARGlove] Using Three.js 3D renderer.');
      } catch (e) {
        console.warn('[ARGlove] Three.js renderer init failed, falling back to 2D PNG:', e);
        arRenderer = null;
        using3D    = false;
      }
    } else {
      console.warn('[ARGlove] WebGL unavailable – using 2D PNG fallback.');
    }

    // ── Canvas size sync ───────────────────────────────────────────────────

    const syncCanvasSize = () => {
      const { width, height } = container.getBoundingClientRect();
      const w = Math.round(width);
      const h = Math.round(height);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
        if (arRenderer) arRenderer.resize(w, h);
      }
    };

    syncCanvasSize();
    const resizeObserver = new ResizeObserver(syncCanvasSize);
    resizeObserver.observe(container);

    // ── 2-D fallback state (used when using3D is false) ───────────────────

    // Smooth state for the 2D fallback path
    const fallback2DState = {
      left: {
        x: 0.30, y: 0.55, angle: 0, scale: 160,
        targetX: 0.30, targetY: 0.55, targetAngle: 0, targetScale: 160,
        visible: false, lastSeen: 0,
      },
      right: {
        x: 0.70, y: 0.55, angle: 0, scale: 160,
        targetX: 0.70, targetY: 0.55, targetAngle: 0, targetScale: 160,
        visible: false, lastSeen: 0,
      },
    };

    // ── MediaPipe init ────────────────────────────────────────────────────

    createHandLandmarker()
      .then((tracker) => {
        if (isCancelled) { tracker.close(); return; }
        landmarker = tracker;
        console.info('[ARGlove] MediaPipe HandLandmarker ready.');
      })
      .catch((err) => {
        console.error('[ARGlove] Failed to initialise HandLandmarker:', err);
      });

    // ── Frame loop ─────────────────────────────────────────────────────────

    const loop = () => {
      if (isCancelled) return;

      const now = performance.now();

      // Run MediaPipe detection on new video frames
      if (
        landmarker &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        !video.paused &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        try {
          const ts = Math.max(now, lastLandmarkerTimestamp + 1);
          lastLandmarkerTimestamp = ts;

          const results = landmarker.detectForVideo(video, ts);

          if (using3D && arRenderer) {
            // ── 3D path ──────────────────────────────────────────────────
            const poses = extractHandPoses(results);
            arRenderer.update(poses.left, poses.right, now);
          } else {
            // ── 2D fallback path ─────────────────────────────────────────
            // Reuse the existing extractWristCoordinates from handTracker
            const tracked = extractWristCoordinates(
              results,
              canvas.width, canvas.height,
              video.videoWidth, video.videoHeight,
            );

            const apply2D = (s: typeof fallback2DState.left, d: typeof tracked.left) => {
              if (!d) return;
              if (!s.visible) {
                s.x = d.norm.x; s.y = d.norm.y;
                s.angle = d.angleDeg; s.scale = d.handSpanPx * 2.85;
                s.visible = true;
              }
              s.targetX = d.norm.x; s.targetY = d.norm.y;
              s.targetAngle = d.angleDeg; s.targetScale = d.handSpanPx * 2.85;
              s.lastSeen = now;
            };
            apply2D(fallback2DState.left,  tracked.left);
            apply2D(fallback2DState.right, tracked.right);
          }
        } catch (err) {
          console.warn('[ARGlove] Detection error:', err);
        }
      }

      if (using3D && arRenderer) {
        // ── 3D render ─────────────────────────────────────────────────────
        arRenderer.render();
      } else {
        // ── 2D fallback render ────────────────────────────────────────────
        const ctx = canvas.getContext('2d');
        if (ctx && canvas.width > 0 && canvas.height > 0) {
          const { width, height } = canvas;
          ctx.clearRect(0, 0, width, height);

          const vW = video.videoWidth  || width;
          const vH = video.videoHeight || height;
          const minH = Math.min(width, height) * 0.16;
          const maxH = Math.min(width, height) * 0.65;

          const smooth2D = (s: typeof fallback2DState.left) => {
            if (!s.visible) return;
            const dx   = s.targetX - s.x;
            const dy   = s.targetY - s.y;
            const dist = Math.hypot(dx, dy);
            const a    = Math.min(0.88, Math.max(0.42, 0.42 + dist * 2.6));
            s.x += dx * a;
            s.y += dy * a;

            let diff = s.targetAngle - s.angle;
            while (diff >  180) diff -= 360;
            while (diff < -180) diff += 360;
            s.angle += diff * Math.min(0.75, Math.max(0.35, 0.35 + dist * 2.0));
            s.scale += (s.targetScale - s.scale) * 0.35;
          };

          smooth2D(fallback2DState.left);
          smooth2D(fallback2DState.right);

          const draw2D = (
            s:     typeof fallback2DState.left,
            asset: HTMLImageElement,
          ) => {
            if (!s.visible || now - s.lastSeen > 400) return;
            if (!asset.complete || asset.naturalWidth === 0) return;

            const coords = normToCanvas(
              { x: s.x, y: s.y }, width, height, vW, vH,
            );
            const gloveH = Math.min(maxH, Math.max(minH, s.scale));
            const aspect = asset.naturalWidth / asset.naturalHeight;
            const gloveW = gloveH * aspect;

            ctx.save();
            ctx.translate(coords.cx, coords.cy);
            ctx.rotate((s.angle * Math.PI) / 180);
            ctx.shadowColor = 'rgba(0,0,0,0.38)';
            ctx.shadowBlur  = Math.round(gloveH * 0.08);
            ctx.shadowOffsetY = Math.round(gloveH * 0.04);
            ctx.drawImage(asset, -gloveW / 2, -gloveH * 0.52, gloveW, gloveH);
            ctx.restore();
          };

          draw2D(fallback2DState.left,  leftGloveFallback);
          draw2D(fallback2DState.right, rightGloveFallback);
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);

    // ── Cleanup ───────────────────────────────────────────────────────────

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();

      if (landmarker) {
        try { landmarker.close(); } catch { /* ignore */ }
        landmarker = null;
      }

      if (arRenderer) {
        arRenderer.dispose();
        arRenderer = null;
      }

      // Clear 2D canvas if we were using fallback
      if (!using3D) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [active, canvasRef, containerRef, videoRef]);
}
