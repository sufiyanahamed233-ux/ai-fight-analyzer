import React from 'react';
import type { ExhibitionState } from '../types/exhibition.ts';

interface ExhibitionShellProps {
  children: React.ReactNode;
  currentState?: ExhibitionState;
}

/**
 * ExhibitionShell provides the full-screen cinematic stage container for the
 * AI Fight Analyzer kiosk/display experience.
 *
 * It guarantees:
 * - Fixed full-screen dimensions (w-screen h-screen)
 * - Scroll prevention and text-selection prevention
 * - Deep cinematic combat-sports background grading (vignette & radial glow)
 * - Uniform structural padding and layout safe areas for future screens
 */
export const ExhibitionShell: React.FC<ExhibitionShellProps> = ({
  children,
  currentState,
}) => {
  return (
    <div className="fixed inset-0 w-screen h-screen overflow-hidden select-none bg-black text-neutral-100 flex flex-col justify-between font-sans antialiased">
      {/* Cinematic ambient background glow and vignette */}
      <div 
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_40%,rgba(180,20,20,0.12),transparent_70%)]" 
        aria-hidden="true" 
      />
      <div 
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.03),transparent_60%)]" 
        aria-hidden="true" 
      />

      {/* Subtle corner arena markers */}
      <div className="pointer-events-none absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-neutral-700/60 z-10" aria-hidden="true" />
      <div className="pointer-events-none absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-neutral-700/60 z-10" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-neutral-700/60 z-10" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-neutral-700/60 z-10" aria-hidden="true" />

      {/* Minimal Exhibition HUD Header Bar */}
      <header className="relative z-10 w-full px-10 pt-8 flex items-center justify-between border-b border-neutral-800/40 pb-4">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600 animate-pulse" />
          <span className="text-xs uppercase tracking-[0.3em] font-mono text-neutral-400 font-bold">
            Octagon Optical Vision // Active
          </span>
        </div>

        {currentState && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-mono tracking-widest text-neutral-500">
              STATE:
            </span>
            <span className="px-2.5 py-0.5 rounded text-[11px] font-mono font-semibold tracking-wider bg-neutral-900 border border-neutral-700/80 text-neutral-200">
              {currentState}
            </span>
          </div>
        )}
      </header>

      {/* Central Screen Stage Container */}
      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-10 py-6 flex flex-col items-center justify-center">
        {children}
      </main>

      {/* Minimal Exhibition Footer Safe Area */}
      <footer className="relative z-10 w-full px-10 pb-6 flex items-center justify-between text-[11px] font-mono text-neutral-500 tracking-wider">
        <span>EXHIBITION SYSTEM // 2-DAY PROTOTYPE</span>
        <span>TWO-CAMERA MOVEMENT TELEMETRY</span>
      </footer>
    </div>
  );
};
