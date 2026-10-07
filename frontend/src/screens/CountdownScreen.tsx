import React, { useEffect, useRef, useState } from 'react';

/**
 * Countdown sequence labels.
 * 'FIGHT!' is the final frame shown briefly before onComplete fires.
 */
type CountdownLabel = '3' | '2' | '1' | 'FIGHT!';

const SEQUENCE: CountdownLabel[] = ['3', '2', '1', 'FIGHT!'];

/** How long each numeric digit is shown (ms). */
const DIGIT_DURATION_MS = 1000;

/** How long "FIGHT!" stays on screen before onComplete fires (ms). */
const FIGHT_DURATION_MS = 800;

interface CountdownScreenProps {
  /**
   * Called once the full 3-2-1-FIGHT! sequence completes.
   * Intentionally kept argument-free so camera / recording sync
   * can be wired in here later without changing the signature contract.
   */
  onComplete: () => void;
}

/**
 * CountdownScreen – Phase 6
 *
 * Displays a cinematic 3 -> 2 -> 1 -> FIGHT! countdown sequence.
 * Each digit shows for ~1 s; "FIGHT!" shows briefly, then onComplete fires.
 * All timers are cleaned up on unmount.
 */
export const CountdownScreen: React.FC<CountdownScreenProps> = ({
  onComplete,
}) => {
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [visible, setVisible] = useState<boolean>(true);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    let elapsed = 0;

    SEQUENCE.forEach((_, index) => {
      const isFight = index === SEQUENCE.length - 1;
      const showDuration = isFight ? FIGHT_DURATION_MS : DIGIT_DURATION_MS;
      const fadeOutOffset = showDuration - 150; // start fade before next tick

      // Advance to this step
      timers.push(
        setTimeout(() => {
          setStepIndex(index);
          setVisible(true);
        }, elapsed)
      );

      // Fade out just before the next step (skip on FIGHT! since we complete immediately)
      if (!isFight) {
        timers.push(
          setTimeout(() => {
            setVisible(false);
          }, elapsed + fadeOutOffset)
        );
      }

      elapsed += showDuration;
    });

    // Fire onComplete after the full sequence
    timers.push(
      setTimeout(() => {
        onCompleteRef.current();
      }, elapsed)
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, []); // intentionally run once on mount

  const label = SEQUENCE[stepIndex];
  const isFight = label === 'FIGHT!';

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-8 select-none">
      <div className="max-w-5xl mx-auto flex flex-col items-center space-y-10 sm:space-y-12">
        {/* Stage Status Badge */}
        <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-neutral-900/90 border border-neutral-800 text-xs sm:text-sm font-mono uppercase tracking-[0.3em] text-neutral-400">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
          <span>Stage 04 // Countdown</span>
        </div>

        {/* Main Countdown Display */}
        <div
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'scale(1)' : 'scale(0.85)',
            transition: 'opacity 150ms ease-in-out, transform 150ms ease-in-out',
          }}
        >
          {isFight ? (
            <h1
              className="font-black uppercase tracking-tight leading-none drop-shadow-[0_10px_50px_rgba(220,38,38,0.85)]"
              style={{ fontSize: 'clamp(4rem, 18vw, 12rem)' }}
            >
              <span className="text-red-600">FIGHT</span>
              <span className="text-white">!</span>
            </h1>
          ) : (
            <h1
              className="font-black leading-none text-white drop-shadow-[0_10px_50px_rgba(0,0,0,0.9)]"
              style={{ fontSize: 'clamp(8rem, 30vw, 22rem)' }}
            >
              {label}
            </h1>
          )}
        </div>

        {/* Pacing Indicator */}
        <div className="pt-2">
          <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase">
            {isFight ? 'Starting fight\u2026' : 'Get into position'}
          </span>
        </div>
      </div>
    </div>
  );
};
