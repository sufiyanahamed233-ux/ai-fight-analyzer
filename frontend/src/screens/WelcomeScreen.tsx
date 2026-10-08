import React from 'react';
import { CinematicArenaBackground } from '../components/CinematicArenaBackground';
import { ArenaHeader } from '../components/ArenaHUD';

interface WelcomeScreenProps {
  onStart: () => void;
}

/**
 * WelcomeScreen: Phase 3 Exhibition Entrance Screen
 *
 * Visual layout matching the reference design:
 * - Left side: Title "AI FIGHT ANALYZER", sub-headline, and red pill button "START EXPERIENCE →"
 * - Right side: Muscular back-facing fighter silhouette in gloves looking at the illuminated octagon arena
 */
export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onStart }) => {
  return (
    <CinematicArenaBackground variant="welcome">
      <ArenaHeader stageNumber="01" stageTitle="FIGHT SYSTEM ENTRANCE" />

      <div className="w-full flex-1 flex flex-col justify-between px-6 sm:px-12 py-6 select-none relative overflow-hidden">
        
        {/* Main Content Grid (Left Title & Actions | Right Fighter Silhouette) */}
        <div className="w-full max-w-7xl mx-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center my-auto">
          
          {/* Left Column: Title Block & Call to Action (7 cols) */}
          <div className="lg:col-span-7 flex flex-col items-start text-left space-y-6 sm:space-y-8 z-10">
            
            {/* Broadcast Sub-Badge */}
            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-neutral-900/90 border border-red-700/60 text-xs sm:text-sm font-mono uppercase tracking-[0.25em] text-red-400 shadow-[0_0_20px_rgba(220,38,38,0.3)] backdrop-blur-md">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping" />
              <span>INTERACTIVE COMPUTER VISION EXHIBITION</span>
            </div>

            {/* Primary Title */}
            <h1 className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-black uppercase tracking-tight leading-[0.95] animate-in fade-in zoom-in-95 duration-700">
              <span className="text-white drop-shadow-[0_10px_45px_rgba(255,255,255,0.2)]">AI FIGHT</span> <br />
              <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">
                ANALYZER
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-2xl md:text-3xl font-light text-neutral-200 tracking-wide max-w-xl font-sans leading-relaxed">
              STEP INTO THE <span className="text-[#E10600] font-semibold">FIGHT ZONE</span>
            </p>

            {/* Action Button */}
            <div className="pt-2 sm:pt-4">
              <button
                type="button"
                onClick={onStart}
                autoFocus
                className="group relative inline-flex items-center justify-center px-10 py-4 sm:px-14 sm:py-5 text-lg sm:text-2xl font-black uppercase tracking-[0.2em] text-white bg-[#E10600] hover:bg-red-700 active:scale-95 rounded-2xl cursor-pointer transition-all duration-200 shadow-[0_0_50px_rgba(225,6,0,0.6)] hover:shadow-[0_0_75px_rgba(225,6,0,0.85)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-400"
              >
                <span>GET STARTED</span>
                <span className="ml-3 transition-transform duration-200 group-hover:translate-x-2">
                  →
                </span>
              </button>
            </div>

          </div>

          {/* Right Column: Fighter Cinematic Image (5 cols) */}
          <div className="lg:col-span-5 relative flex items-center justify-center h-full min-h-[380px] lg:min-h-[500px]">
            {/* Red Spotlight Halo behind Silhouette */}
            <div className="absolute inset-0 rounded-full bg-[#E10600]/20 blur-[90px] animate-pulse pointer-events-none" />
            <img 
              src="/assets/person-gloves.jpg" 
              alt="Fighter" 
              className="w-full h-full object-cover object-right max-h-[600px] z-10 rounded-2xl shadow-[0_0_50px_rgba(225,6,0,0.4)] opacity-90 mix-blend-lighten"
              style={{ maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%)', WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%)' }}
            />
          </div>

        </div>

      </div>
    </CinematicArenaBackground>
  );
};
