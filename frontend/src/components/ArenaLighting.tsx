import React from 'react';

interface ArenaLightingProps {
  variant?: 'welcome' | 'calibration' | 'instructions' | 'countdown' | 'fight' | 'analysis' | 'review' | 'reveal';
  pulseRed?: boolean;
}

/**
 * ArenaLighting Component
 * Renders atmospheric volumetric spotlights, red/blue LED light strips,
 * overhead truss lighting, and fog layers.
 */
export const ArenaLighting: React.FC<ArenaLightingProps> = ({
  variant = 'welcome',
  pulseRed = false,
}) => {
  const isCountdown = variant === 'countdown';
  const isReveal = variant === 'reveal';
  const isAnalysis = variant === 'analysis';

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      {/* Overhead Truss Rig Shadow */}
      <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-black via-black/80 to-transparent z-10" />

      {/* Red LED Accent Strip Left */}
      <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-red-600 via-red-500 to-transparent opacity-80 shadow-[0_0_15px_rgba(220,38,38,0.8)]" />

      {/* Blue LED Accent Strip Right */}
      <div className="absolute top-0 bottom-0 right-0 w-1 bg-gradient-to-b from-blue-600 via-blue-500 to-transparent opacity-80 shadow-[0_0_15px_rgba(37,99,235,0.8)]" />

      {/* Top Left White/Red Spotlight Beam */}
      <div
        className="absolute -top-32 -left-32 w-[700px] h-[700px] opacity-35 transition-all duration-1000"
        style={{
          background: 'radial-gradient(circle at top left, rgba(239, 68, 68, 0.5), rgba(37, 99, 235, 0.1) 40%, transparent 70%)',
          filter: 'blur(30px)',
        }}
      />

      {/* Top Right White/Blue Spotlight Beam */}
      <div
        className="absolute -top-32 -right-32 w-[700px] h-[700px] opacity-35 transition-all duration-1000"
        style={{
          background: 'radial-gradient(circle at top right, rgba(59, 130, 246, 0.5), rgba(220, 38, 38, 0.1) 40%, transparent 70%)',
          filter: 'blur(30px)',
        }}
      />

      {/* Center Octagon Aura Glow */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[140px] transition-all duration-1000 ${
          pulseRed || isCountdown || isReveal
            ? 'w-[900px] h-[900px] bg-red-600/30 animate-pulse'
            : isAnalysis
            ? 'w-[800px] h-[800px] bg-blue-600/20 animate-pulse'
            : 'w-[700px] h-[700px] bg-red-600/18 animate-pulse'
        }`}
      />

      {/* Volumetric Fog & Atmospheric Particles */}
      <div
        className="absolute inset-0 opacity-20 mix-blend-screen pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.15) 0%, transparent 60%)',
        }}
      />
    </div>
  );
};
