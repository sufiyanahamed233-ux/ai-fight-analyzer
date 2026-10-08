import React, { useState } from 'react';

export interface CinematicBackgroundProps {
  variant?: 'default' | 'countdown' | 'analysis' | 'review' | 'reveal';
  videoSrc?: string;
  showArena?: boolean;
  showParticles?: boolean;
  showScanlines?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Reusable Cinematic Background Component
 *
 * Combines:
 *  1. Looped HTML5 video background (with automatic fallback to CSS arena graphics if missing/failed)
 *  2. Rich sports-arena radial gradients and pulsing lighting
 *  3. Top-corner arena spotlights
 *  4. 3D perspective octagon floor grid
 *  5. Subtle ring-rope / cage geometry
 *  6. Subtle scanlines & vignette
 */
export const CinematicBackground: React.FC<CinematicBackgroundProps> = ({
  variant = 'default',
  videoSrc = '/assets/cinematic-loop.mp4',
  showArena = true,
  showScanlines = true,
  className = '',
  children,
}) => {
  const [videoFailed, setVideoFailed] = useState(false);

  const isCountdown = variant === 'countdown';
  const isAnalysis = variant === 'analysis';
  const isReveal = variant === 'reveal';

  return (
    <div
      className={`relative w-full flex-1 flex flex-col min-h-full overflow-hidden bg-neutral-950 text-white select-none ${className}`}
    >
      {/* ── Background Layer Group ── */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        {/* 1. Looped Video Background */}
        {!videoFailed && videoSrc && (
          <video
            src={videoSrc}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-screen"
          />
        )}

        {/* 2. Base Dark Gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-950 via-neutral-950/90 to-neutral-950" />

        {/* 3. Pulsing Center Arena Glow */}
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[130px] transition-all duration-1000 ${
            isCountdown
              ? 'w-[750px] h-[750px] bg-red-600/25 animate-pulse'
              : isAnalysis
              ? 'w-[700px] h-[700px] bg-red-600/20 animate-pulse'
              : isReveal
              ? 'w-[850px] h-[850px] bg-red-600/25 animate-pulse'
              : 'w-[600px] h-[600px] bg-red-600/15 animate-pulse'
          }`}
        />

        {/* 4. Top Arena Corner Spotlights */}
        <div
          className="absolute -top-40 -left-40 w-[650px] h-[650px] opacity-25"
          style={{
            background: 'radial-gradient(circle at top left, rgba(220, 38, 38, 0.45), transparent 70%)',
          }}
        />
        <div
          className="absolute -top-40 -right-40 w-[650px] h-[650px] opacity-25"
          style={{
            background: 'radial-gradient(circle at top right, rgba(220, 38, 38, 0.45), transparent 70%)',
          }}
        />

        {/* 5. Octagon 3D Perspective Grid Floor */}
        {showArena && (
          <div className="absolute inset-x-0 bottom-0 h-[42%] opacity-20" style={{ perspective: '800px' }}>
            <div
              className="absolute inset-0 origin-bottom"
              style={{
                transform: 'rotateX(75deg)',
                backgroundImage: `
                  linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)
                `,
                backgroundSize: '40px 40px',
              }}
            />
            {/* Octagon Boundary Ring */}
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[650px] h-[320px] rounded-full border border-red-500/30"
              style={{
                transform: 'rotateX(75deg)',
                boxShadow: '0 0 100px rgba(220, 38, 38, 0.3)',
              }}
            />
          </div>
        )}

        {/* 6. Subtle Ring Rope / Cage Lines */}
        <div className="absolute inset-0 flex flex-col justify-evenly opacity-10">
          <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-red-500 to-transparent" />
          <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-neutral-500 to-transparent" />
          <div className="w-full h-[1px] bg-gradient-to-r from-transparent via-red-500 to-transparent" />
        </div>

        {/* 7. Scanline Lines Overlay */}
        {showScanlines && (
          <div
            className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
            style={{
              backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)',
              backgroundSize: '100% 4px',
            }}
          />
        )}

        {/* 8. Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.88)_100%)]" />
      </div>

      {/* ── Content Layer ── */}
      <div className="relative z-10 w-full flex-1 flex flex-col">{children}</div>
    </div>
  );
};
