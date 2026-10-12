import React, { useEffect, useRef, useState } from 'react';
import { CinematicArenaBackground } from '../components/CinematicArenaBackground';
import { ArenaHeader } from '../components/ArenaHUD';
import { FireEmberSparks } from '../components/FighterSilhouettes';

type CountdownLabel = '3' | '2' | '1' | 'FIGHT!';

const SEQUENCE: CountdownLabel[] = ['3', '2', '1', 'FIGHT!'];
const DIGIT_DURATION_MS = 1500;
const FIGHT_DURATION_MS = 1500;

interface CountdownScreenProps {
  onComplete: () => void;
}

/**
 * CountdownScreen – Phase 6
 *
 * FIERY / RED ENERGY theme matching reference:
 * - Fiery smoke, burning red ember sparks, red glowing cage, intense spotlights
 * - Giant textured crimson number (3 -> 2 -> 1 -> FIGHT!)
 * - Light pulses & camera shake
 */
export const CountdownScreen: React.FC<CountdownScreenProps> = ({
  onComplete,
}) => {
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [visible, setVisible] = useState<boolean>(true);
  const [flash, setFlash] = useState<boolean>(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const audio = new Audio('/assets/audio/321fight.mp3');
    audio.play().catch((err) => console.warn('Audio playback failed:', err));
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;

    SEQUENCE.forEach((_, index) => {
      const isFight = index === SEQUENCE.length - 1;
      const showDuration = isFight ? FIGHT_DURATION_MS : DIGIT_DURATION_MS;
      const fadeOutOffset = showDuration - 150;

      timers.push(
        setTimeout(() => {
          setStepIndex(index);
          setVisible(true);
          setFlash(true);
          setTimeout(() => setFlash(false), 200);
        }, elapsed)
      );

      if (!isFight) {
        timers.push(
          setTimeout(() => {
            setVisible(false);
          }, elapsed + fadeOutOffset)
        );
      }

      elapsed += showDuration;
    });

    timers.push(
      setTimeout(() => {
        onCompleteRef.current();
      }, elapsed)
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  const label = SEQUENCE[stepIndex];
  const isFight = label === 'FIGHT!';

  return (
    <CinematicArenaBackground variant="countdown" pulseRed={flash}>
      <ArenaHeader stageNumber="04" stageTitle="FIGHT SYSTEM ARMED" />

      {/* Fiery Ember Sparks & Energy Layer */}
      <FireEmberSparks />

      {/* Arena flash overlay on number tick */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 bg-red-600/40 transition-opacity duration-200 ${
          flash ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-8 select-none relative z-20">
        <div className="max-w-5xl mx-auto flex flex-col items-center space-y-6 sm:space-y-8">

          {/* Background Cinematic Arena Walk-In */}
          <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
            <img 
              src="/assets/countdown-bg.jpg" 
              alt="Fighter entering arena" 
              className="w-full h-full object-cover object-top opacity-35"
            />
            {/* Bottom fade to keep countdown legible */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30" />
          </div>

          {/* Subtitle Header */}
          <div className="space-y-1 relative z-10">
            <h2 className="text-4xl sm:text-6xl font-black uppercase tracking-tight leading-none">
              {isFight ? (
                <><span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">ENGAGING</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">CV TARGETING</span></>
              ) : (
                <><span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">GET</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">READY</span></>
              )}
            </h2>
            <p className="text-xs sm:text-base font-mono uppercase tracking-[0.3em] text-[#E10600] font-bold">
              {isFight ? 'ROUND IN PROGRESS' : 'FIGHT STARTS IN'}
            </p>
          </div>

          {/* Giant Numeric Countdown Display */}
          <div
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'scale(1)' : 'scale(0.80)',
              transition: 'opacity 150ms ease-in-out, transform 150ms ease-in-out',
            }}
            className="flex items-center justify-center my-2 relative z-10"
          >
            <span
              className={`font-black font-mono leading-none tracking-tighter tabular-nums select-none ${
                isFight
                  ? 'text-7xl sm:text-9xl md:text-[14rem] text-red-500 drop-shadow-[0_0_120px_rgba(220,38,38,1)] animate-pulse'
                  : 'text-9xl sm:text-[14rem] md:text-[18rem] text-white drop-shadow-[0_0_90px_rgba(220,38,38,0.85)]'
              }`}
            >
              {label}
            </span>
          </div>

          {/* Subline */}
          <div className="pt-2 relative z-10">
            <p className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-300 font-bold">
              {isFight ? 'KEEP ARMS ELEVATED IN FIGHTING STANCE' : 'PREPARE COMBAT STANCE IN THE OCTAGON'}
            </p>
          </div>

        </div>
      </div>
    </CinematicArenaBackground>
  );
};
