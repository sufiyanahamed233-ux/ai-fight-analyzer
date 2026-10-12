import React from 'react';

/**
 * BackFighterSilhouette: Rendered on the Welcome screen.
 * Displays a muscular fighter seen from behind standing inside the octagon ring with gloves on,
 * looking out at the illuminated arena crowd and red/white spotlights.
 */
export const BackFighterSilhouette: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`relative pointer-events-none select-none ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 400 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full object-contain filter drop-shadow-[0_0_35px_rgba(220,38,38,0.5)]"
      >
        <defs>
          <linearGradient id="bodyGradBack" x1="200" y1="0" x2="200" y2="600" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1e1e24" />
            <stop offset="50%" stopColor="#0d0d12" />
            <stop offset="100%" stopColor="#050508" />
          </linearGradient>
          <linearGradient id="redRimBack" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.9" />
            <stop offset="25%" stopColor="#dc2626" stopOpacity="0.4" />
            <stop offset="80%" stopColor="#1d4ed8" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
          </linearGradient>
        </defs>

        {/* Outer Red/Blue Rim Light Glow */}
        <g stroke="url(#redRimBack)" strokeWidth="4" fill="none">
          {/* Head & Neck */}
          <path d="M175 110 C175 80 225 80 225 110 C225 130 175 130 175 110 Z" />
          {/* Broad Traps & Shoulders */}
          <path d="M150 145 Q200 135 250 145 L290 185 L280 280 L240 310 L240 420 L270 560 L130 560 L160 420 L160 310 L120 280 L110 185 Z" />
          {/* Raised Guard Arms / Gloves */}
          <path d="M110 185 Q90 230 100 270 Q115 310 130 280" />
          <path d="M290 185 Q310 230 300 270 Q285 310 270 280" />
        </g>

        {/* Solid Muscular Body Silhouette */}
        <g fill="url(#bodyGradBack)">
          {/* Head */}
          <ellipse cx="200" cy="105" rx="28" ry="34" />
          {/* Traps */}
          <path d="M172 135 Q200 125 228 135 L260 160 L140 160 Z" />
          {/* Shoulders & Back (Lats) */}
          <path d="M140 160 Q200 150 260 160 L285 240 Q200 260 115 240 Z" />
          {/* Waist & Shorts */}
          <path d="M150 240 L250 240 L240 360 L160 360 Z" fill="#09090b" stroke="#dc2626" strokeWidth="2" />
          {/* Left Leg */}
          <path d="M160 360 L200 360 L185 550 L145 550 Z" />
          {/* Right Leg */}
          <path d="M200 360 L240 360 L255 550 L215 550 Z" />
          {/* Left Arm & Glove */}
          <path d="M140 160 Q105 210 115 260 L140 250 Z" />
          <circle cx="115" cy="270" r="22" fill="#dc2626" />
          {/* Right Arm & Glove */}
          <path d="M260 160 Q295 210 285 260 L260 250 Z" />
          <circle cx="285" cy="270" r="22" fill="#dc2626" />
        </g>
      </svg>
    </div>
  );
};

/**
 * BoxerGuardSilhouette: Rendered on Instructions and Review screens.
 * Side profile of a boxer in guard stance with dramatic red rim lighting and red gloves.
 */
export const BoxerGuardSilhouette: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`relative pointer-events-none select-none ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 450 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full object-contain filter drop-shadow-[0_0_40px_rgba(220,38,38,0.6)]"
      >
        <defs>
          <linearGradient id="boxerGrad" x1="0" y1="0" x2="450" y2="600" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#26262e" />
            <stop offset="60%" stopColor="#0f0f14" />
            <stop offset="100%" stopColor="#050508" />
          </linearGradient>
          <filter id="redGlow">
            <feGaussianBlur stdDeviation="8" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Fiery Red Ambient Aura behind Boxer */}
        <circle cx="220" cy="240" r="160" fill="#dc2626" opacity="0.25" className="animate-pulse" filter="url(#redGlow)" />

        {/* Red Rim Highlight */}
        <path
          d="M190 80 Q250 85 260 140 Q280 200 240 280 Q290 320 270 420 L230 580 M270 200 L320 230"
          stroke="#ef4444"
          strokeWidth="6"
          strokeLinecap="round"
          filter="url(#redGlow)"
        />

        {/* Boxer Body Profile */}
        <g fill="url(#boxerGrad)">
          {/* Head in stance */}
          <path d="M170 120 Q190 70 240 90 Q260 130 230 160 Q190 165 170 120 Z" />
          {/* Neck & Back */}
          <path d="M210 150 Q280 180 260 280 L230 400 L170 390 Q170 260 210 150 Z" />
          {/* Front Glove in Guard */}
          <ellipse cx="320" cy="210" rx="30" ry="26" fill="#dc2626" stroke="#f87171" strokeWidth="3" />
          <path d="M250 170 L300 200 L270 230 Z" fill="#18181b" />
          {/* Rear Glove guarding chin */}
          <ellipse cx="260" cy="180" rx="26" ry="22" fill="#b91c1c" stroke="#ef4444" strokeWidth="2" />
          {/* Shorts */}
          <path d="M170 390 L240 400 L250 480 L160 470 Z" fill="#09090b" stroke="#dc2626" strokeWidth="2" />
          {/* Legs in Stance */}
          <path d="M170 470 L210 475 L190 580 L150 580 Z" />
          <path d="M210 475 L250 480 L270 580 L230 580 Z" />
        </g>
      </svg>
    </div>
  );
};

/**
 * DualVectorSkeletons: Rendered on Analyzing screen.
 * Displays two 3D vector combat skeletons (BLUE vs RED) facing off with joint nodes, motion lines, and circular floor target rings.
 */
export const DualVectorSkeletons: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`relative pointer-events-none select-none w-full h-full flex items-center justify-center ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 800 450"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full object-contain filter drop-shadow-[0_0_30px_rgba(0,0,0,0.8)]"
      >
        <defs>
          <filter id="blueGlow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="redGlow2">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 1. Reflective Floor Rings */}
        <ellipse cx="400" cy="380" rx="320" ry="50" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeDasharray="8 8" />
        <ellipse cx="250" cy="380" rx="140" ry="30" stroke="#3b82f6" strokeWidth="3" opacity="0.6" filter="url(#blueGlow)" />
        <ellipse cx="550" cy="380" rx="140" ry="30" stroke="#ef4444" strokeWidth="3" opacity="0.6" filter="url(#redGlow2)" />

        {/* 2. BLUE FIGHTER SKELETON (Left) */}
        <g stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" filter="url(#blueGlow)">
          {/* Head */}
          <circle cx="230" cy="140" r="22" fill="rgba(59,130,246,0.2)" />
          {/* Spine & Neck */}
          <line x1="230" y1="162" x2="240" y2="250" />
          {/* Shoulders */}
          <line x1="200" y1="180" x2="280" y2="175" />
          {/* Lead Left Punch Arm (Extended outward) */}
          <line x1="280" y1="175" x2="340" y2="185" />
          <line x1="340" y1="185" x2="390" y2="190" stroke="#60a5fa" strokeWidth="5" />
          {/* Rear Guard Arm */}
          <line x1="200" y1="180" x2="180" y2="210" />
          <line x1="180" y1="210" x2="220" y2="200" />
          {/* Pelvis */}
          <line x1="215" y1="250" x2="265" y2="250" />
          {/* Lead Leg */}
          <line x1="265" y1="250" x2="290" y2="310" />
          <line x1="290" y1="310" x2="310" y2="375" />
          {/* Rear Leg */}
          <line x1="215" y1="250" x2="195" y2="310" />
          <line x1="195" y1="310" x2="180" y2="375" />

          {/* Joint Nodes */}
          <circle cx="230" cy="140" r="5" fill="#93c5fd" />
          <circle cx="200" cy="180" r="5" fill="#93c5fd" />
          <circle cx="280" cy="175" r="5" fill="#93c5fd" />
          <circle cx="340" cy="185" r="5" fill="#93c5fd" />
          <circle cx="390" cy="190" r="8" fill="#60a5fa" className="animate-ping" />
          <circle cx="215" cy="250" r="5" fill="#93c5fd" />
          <circle cx="265" cy="250" r="5" fill="#93c5fd" />
          <circle cx="290" cy="310" r="5" fill="#93c5fd" />
          <circle cx="310" cy="375" r="5" fill="#93c5fd" />
        </g>

        {/* 3. RED FIGHTER SKELETON (Right) */}
        <g stroke="#ef4444" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" filter="url(#redGlow2)">
          {/* Head */}
          <circle cx="570" cy="145" r="22" fill="rgba(239,68,68,0.2)" />
          {/* Spine & Neck */}
          <line x1="570" y1="167" x2="560" y2="255" />
          {/* Shoulders */}
          <line x1="520" y1="185" x2="600" y2="180" />
          {/* Guard Arms */}
          <line x1="520" y1="185" x2="470" y2="195" />
          <line x1="470" y1="195" x2="430" y2="190" stroke="#f87171" strokeWidth="5" />
          <line x1="600" y1="180" x2="580" y2="215" />
          <line x1="580" y1="215" x2="540" y2="205" />
          {/* Pelvis */}
          <line x1="535" y1="255" x2="585" y2="255" />
          {/* Lead Leg */}
          <line x1="535" y1="255" x2="505" y2="315" />
          <line x1="505" y1="315" x2="485" y2="375" />
          {/* Rear Leg */}
          <line x1="585" y1="255" x2="610" y2="315" />
          <line x1="610" y1="315" x2="630" y2="375" />

          {/* Joint Nodes */}
          <circle cx="570" cy="145" r="5" fill="#fca5a5" />
          <circle cx="520" cy="185" r="5" fill="#fca5a5" />
          <circle cx="600" cy="180" r="5" fill="#fca5a5" />
          <circle cx="470" cy="195" r="5" fill="#fca5a5" />
          <circle cx="430" cy="190" r="8" fill="#f87171" className="animate-ping" />
          <circle cx="535" cy="255" r="5" fill="#fca5a5" />
          <circle cx="585" cy="255" r="5" fill="#fca5a5" />
          <circle cx="505" cy="315" r="5" fill="#fca5a5" />
          <circle cx="485" cy="375" r="5" fill="#fca5a5" />
        </g>

        {/* Motion Energy Impact Spark between fists */}
        <circle cx="410" cy="190" r="18" fill="#ffffff" filter="url(#redGlow2)" opacity="0.8" className="animate-pulse" />
      </svg>
    </div>
  );
};

/**
 * FireEmberSparks: Rendered on the Countdown screen.
 * Displays rising fire ember particles and fiery red energy aura.
 */
export const FireEmberSparks: React.FC = () => {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-10 select-none" aria-hidden="true">
      {/* 1. Bottom Fiery Glow Base */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-red-600/40 via-red-950/20 to-transparent mix-blend-screen animate-pulse" />

      {/* 2. Floating Fire Embers / Spark Particles */}
      <div className="absolute inset-0">
        {[...Array(16)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-gradient-to-t from-red-500 to-amber-300 animate-bounce"
            style={{
              width: `${Math.random() * 6 + 3}px`,
              height: `${Math.random() * 6 + 3}px`,
              left: `${Math.random() * 100}%`,
              bottom: `${Math.random() * 80}%`,
              opacity: Math.random() * 0.8 + 0.2,
              animationDuration: `${Math.random() * 3 + 2}s`,
              boxShadow: '0 0 10px rgba(239, 68, 68, 0.9)',
            }}
          />
        ))}
      </div>
    </div>
  );
};
