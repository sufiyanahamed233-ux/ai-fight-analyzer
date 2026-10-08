import React, { useEffect, useRef } from 'react';
import { CinematicArenaBackground } from '../components/CinematicArenaBackground';
import { ArenaHeader } from '../components/ArenaHUD';
import { CinematicPanel } from '../components/CinematicPanel';

interface InstructionsScreenProps {
  onComplete: () => void;
  /** Duration in milliseconds before auto-advancing (defaults to 4500ms) */
  durationMs?: number;
}

/**
 * InstructionsScreen: Phase 5 Participant Pre-Fight Directives
 *
 * Visual layout matching the reference design:
 * - Left side: Boxer silhouette in guard stance with red rim lighting and red gloves
 * - Right side: Title "FIGHT INSTRUCTIONS", 4 numbered broadcast cards, and red "READY →" button
 */
export const InstructionsScreen: React.FC<InstructionsScreenProps> = ({
  onComplete,
  durationMs = 4500,
}) => {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timer = setTimeout(() => {
      onCompleteRef.current();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [durationMs]);

  const instructions = [
    {
      num: '1',
      title: 'STAND IN THE BOX',
      desc: 'Position yourself inside the marked octagon fight square.',
      icon: '📐',
    },
    {
      num: '2',
      title: 'THROW NATURAL PUNCHES',
      desc: 'Perform jabs, hooks, and combinations naturally toward the camera.',
      icon: '🥊',
    },
    {
      num: '3',
      title: 'FIGHT FOR 10 SECONDS',
      desc: 'Demonstrate your fighting style while the AR round timer is active.',
      icon: '⏱️',
    },
    {
      num: '4',
      title: 'GET YOUR AI FIGHTER TYPE',
      desc: 'Receive AI kinematic analysis and discover your UFC fighter match.',
      icon: '🧠',
    },
  ];

  return (
    <CinematicArenaBackground variant="instructions">
      <ArenaHeader stageNumber="03" stageTitle="EXHIBITION DIRECTIVES" />

      <div className="w-full flex-1 flex flex-col items-center justify-between px-6 py-6 select-none overflow-y-auto">
        <div className="w-full max-w-5xl mx-auto flex flex-col items-start my-auto">

          {/* Instruction Panels & Action */}
          <div className="w-full flex flex-col items-start space-y-6 text-left">
            
            {/* Title */}
            <div className="space-y-1">
              <h1 className="text-4xl sm:text-6xl font-black uppercase tracking-tight leading-none">
                <span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">GET</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">READY</span>
              </h1>
              <p className="text-xs sm:text-sm font-mono uppercase tracking-widest text-neutral-400">
                Follow directives before entering the exhibition round
              </p>
            </div>

            {/* 4 Instruction Cards Grid */}
            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
              {instructions.map((item, idx) => (
                <div
                  key={item.num}
                  className="animate-in fade-in slide-in-from-bottom-4 duration-500"
                  style={{ animationDelay: `${idx * 120}ms` }}
                >
                  <CinematicPanel glowColor="red" className="h-full flex flex-col justify-between hover:border-red-600/70 p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xl sm:text-2xl font-mono font-black text-red-500 tracking-wider">
                        {item.num}
                      </span>
                      <span className="text-2xl">{item.icon}</span>
                    </div>

                    <div className="space-y-1">
                      <h2 className="text-base sm:text-lg font-black uppercase tracking-wide text-white">
                        {item.title}
                      </h2>
                      <p className="text-xs text-neutral-300 font-sans leading-relaxed">
                        {item.desc}
                      </p>
                    </div>
                  </CinematicPanel>
                </div>
              ))}
            </div>

            {/* Ready Action Button */}
            <div className="pt-2 w-full flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono tracking-widest text-neutral-400 uppercase">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span>Round Armed • Ready</span>
              </div>

              <button
                type="button"
                onClick={onComplete}
                className="px-8 py-3.5 rounded-xl text-sm font-mono font-bold tracking-widest uppercase bg-[#E10600] hover:bg-red-700 text-white shadow-[0_0_30px_rgba(225,6,0,0.6)] transition-all cursor-pointer"
              >
                READY →
              </button>
            </div>

          </div>

        </div>
      </div>
    </CinematicArenaBackground>
  );
};
