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
    // Adding a cache-buster query parameter to force loading the updated "seven seconds" recording
    const audio = new Audio('/assets/audio/get-ready-instructions.mp3?v=20261009-v2');
    let hasCompleted = false;
    let timerFired = false;
    let audioEnded = false;

    const tryComplete = () => {
      if (timerFired && audioEnded && !hasCompleted) {
        hasCompleted = true;
        onCompleteRef.current();
      }
    };

    audio.onended = () => {
      audioEnded = true;
      tryComplete();
    };

    audio.play().catch((err) => {
      console.warn('Audio playback failed or blocked:', err);
      // Fallback if audio fails
      audioEnded = true;
      tryComplete();
    });

    const timer = setTimeout(() => {
      timerFired = true;
      // If audio is stuck playing or couldn't play, we fallback
      if (audio.paused && audio.currentTime === 0) {
        audioEnded = true;
      }
      tryComplete();
    }, 7000);

    return () => {
      audio.pause();
      audio.src = '';
      clearTimeout(timer);
    };
  }, []);

  const instructions = [
    {
      num: '01',
      text: 'Stay inside the marked square.',
    },
    {
      num: '02',
      text: 'Perform your fighting movements naturally.',
    },
    {
      num: '03',
      text: 'You have 7 seconds.',
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
            <div className="space-y-1 mb-4">
              <h1 className="text-5xl sm:text-7xl font-black uppercase tracking-tight leading-none">
                <span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">GET</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">READY</span>
              </h1>
            </div>

            {/* Instruction Cards Stack */}
            <div className="w-full max-w-3xl flex flex-col space-y-3">
              {instructions.map((item, idx) => (
                <div
                  key={item.num}
                  className="animate-in fade-in slide-in-from-bottom-4 duration-500"
                  style={{ animationDelay: `${idx * 120}ms` }}
                >
                  <CinematicPanel glowColor="red" className="flex items-center gap-6 hover:border-red-600/70 p-5 sm:px-8 sm:py-6">
                    <span className="text-lg sm:text-xl font-mono font-black text-[#E10600] tracking-wider shrink-0">
                      {item.num}
                    </span>
                    <p className="text-base sm:text-lg text-white font-sans font-medium leading-snug">
                      {item.text}
                    </p>
                  </CinematicPanel>
                </div>
              ))}
            </div>

            {/* Status Indicator */}
            <div className="pt-8 w-full max-w-3xl flex justify-center">
              <span className="text-[10px] font-mono tracking-[0.2em] text-neutral-500 uppercase">
                ADVANCING TO COUNTDOWN...
              </span>
            </div>

          </div>

        </div>
      </div>
    </CinematicArenaBackground>
  );
};
