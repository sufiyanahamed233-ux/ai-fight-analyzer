import React from 'react';

interface WelcomeScreenProps {
  onStart: () => void;
}

/**
 * WelcomeScreen: Phase 3 Exhibition Entrance Screen
 *
 * Provides a high-contrast, cinematic entry point tailored for
 * large exhibition kiosk displays.
 * Strictly presents:
 * - Title: AI FIGHT ANALYZER
 * - Instruction: Step into the fight zone
 * - Primary Action: GET STARTED
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart }) => {
  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-8 select-none">
      <div className="max-w-5xl mx-auto flex flex-col items-center space-y-10 sm:space-y-12">
        {/* Visual Combat Badge */}
        <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-neutral-900/90 border border-neutral-700/70 text-xs sm:text-sm font-mono uppercase tracking-[0.3em] text-neutral-300 shadow-inner">
          <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
          <span>Interactive Computer Vision System</span>
        </div>

        {/* Primary Title */}
        <h1 className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black uppercase tracking-tight text-white drop-shadow-[0_10px_35px_rgba(0,0,0,0.9)] leading-none">
          AI FIGHT <span className="text-red-600">ANALYZER</span>
        </h1>

        {/* Primary Instruction */}
        <p className="text-2xl sm:text-3xl md:text-4xl font-light text-neutral-200 tracking-wide max-w-2xl">
          Step into the fight zone
        </p>

        {/* Primary Action Button */}
        <div className="pt-4 sm:pt-6">
          <button
            type="button"
            onClick={onStart}
            autoFocus
            className="group relative inline-flex items-center justify-center px-12 py-5 sm:px-16 sm:py-6 text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-[0.2em] text-white bg-red-600 hover:bg-red-500 active:scale-95 rounded-xl cursor-pointer transition-all duration-200 shadow-[0_0_50px_rgba(220,38,38,0.55)] hover:shadow-[0_0_70px_rgba(239,68,68,0.75)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-400 focus-visible:ring-offset-4 focus-visible:ring-offset-black"
          >
            <span>GET STARTED</span>
            <span className="ml-4 transition-transform duration-200 group-hover:translate-x-2">
              →
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
