import React from 'react';
import { ArenaLighting } from './ArenaLighting';

export interface CinematicArenaBackgroundProps {
  variant?: 'welcome' | 'calibration' | 'instructions' | 'countdown' | 'fight' | 'analysis' | 'review' | 'reveal';
  videoSrc?: string;
  bgImageSrc?: string;
  showArenaFloor?: boolean;
  showCageMesh?: boolean;
  pulseRed?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * CinematicArenaBackground
 *
 * Renders the professional MMA Octagon Arena environment:
 *  - Real-looking octagonal cage mesh & illuminated corner posts
 *  - Tilted reflective fight floor with center octagon ring markings
 *  - Stadium audience depth silhouettes
 *  - Red/Blue LED accent lighting & white overhead spotlights
 *  - Volumetric smoke/fog & deep vignette
 *  - Supports optional video background with seamless CSS fallback
 */
export const CinematicArenaBackground: React.FC<CinematicArenaBackgroundProps> = ({
  variant = 'welcome',
  videoSrc,
  bgImageSrc,
  showArenaFloor = true,
  showCageMesh = true,
  pulseRed = false,
  className = '',
  children,
}) => {
  return (
    <div className={`relative w-full flex-1 flex flex-col min-h-full overflow-hidden bg-transparent text-white select-none ${className}`}>
      {/* ── Arena Environment Layers (Lighting Only) ── */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        {/* Arena Lighting (Spotlights & Red/Blue LED Strips) */}
        <ArenaLighting variant={variant} pulseRed={pulseRed} />

        {/* 4. Stadium Audience Silhouette Background */}
        <div
          className="absolute inset-x-0 top-1/4 h-1/2 opacity-15 mix-blend-overlay"
          style={{
            backgroundImage: `radial-gradient(ellipse at center, rgba(255,255,255,0.12) 0%, transparent 70%)`,
          }}
        />

        {/* 5. Octagon Cage Wire Mesh & Posts */}
        {showCageMesh && (
          <div className="absolute inset-0 opacity-15">
            {/* Cage Wire Mesh Diagonal Lattice */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `
                  linear-gradient(45deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px),
                  linear-gradient(-45deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px)
                `,
                backgroundSize: '24px 24px',
              }}
            />
            {/* Octagon Corner Posts */}
            <div className="absolute top-0 bottom-0 left-1/4 w-[2px] bg-neutral-700/60 shadow-[0_0_10px_rgba(220,38,38,0.5)]" />
            <div className="absolute top-0 bottom-0 right-1/4 w-[2px] bg-neutral-700/60 shadow-[0_0_10px_rgba(37,99,235,0.5)]" />
          </div>
        )}

        {/* 6. Reflective Octagon Fight Floor */}
        {showArenaFloor && (
          <div className="absolute inset-x-0 bottom-0 h-[48%] opacity-25" style={{ perspective: '900px' }}>
            {/* Floor Plane Tilted in Perspective */}
            <div
              className="absolute inset-0 origin-bottom"
              style={{
                transform: 'rotateX(72deg)',
                backgroundImage: `
                  linear-gradient(to right, rgba(255,255,255,0.09) 1px, transparent 1px),
                  linear-gradient(to bottom, rgba(255,255,255,0.09) 1px, transparent 1px)
                `,
                backgroundSize: '48px 48px',
              }}
            />

            {/* Center Octagon Ring Logo / Canvas Seam */}
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[700px] h-[340px] rounded-full border-2 border-red-600/40"
              style={{
                transform: 'rotateX(72deg)',
                boxShadow: '0 0 120px rgba(220, 38, 38, 0.35), inset 0 0 80px rgba(220, 38, 38, 0.2)',
              }}
            >
              {/* Inner Ring */}
              <div className="absolute inset-6 rounded-full border border-blue-500/30" />
            </div>
          </div>
        )}

        {/* 7. Subtle Scanline Texture */}
        <div
          className="absolute inset-0 opacity-[0.025] pointer-events-none mix-blend-overlay"
          style={{
            backgroundImage: 'linear-gradient(to bottom, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '100% 4px',
          }}
        />

        {/* 8. Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.92)_100%)]" />
      </div>

      {/* ── Content Layer ── */}
      <div className="relative z-10 w-full flex-1 flex flex-col">{children}</div>
    </div>
  );
};
