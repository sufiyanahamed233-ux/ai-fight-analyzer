import React, { useEffect, useRef } from 'react';

interface InstructionsScreenProps {
  onComplete: () => void;
  /** Duration in milliseconds before auto-advancing (defaults to 4500ms) */
  durationMs?: number;
}

/**
 * InstructionsScreen: Phase 5 Participant Pre-Fight Directives
 *
 * Displays exactly:
 * - Title: GET READY
 * - Instruction 1: Stay inside the marked square.
 * - Instruction 2: Perform your fighting movements naturally.
 * - Instruction 3: You have 10 seconds.
 *
 * Automatically triggers onComplete() after a reasonable presentation window.
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
      num: '01',
      text: 'Stay inside the marked square.',
    },
    {
      num: '02',
      text: 'Perform your fighting movements naturally.',
    },
    {
      num: '03',
      text: 'You have 10 seconds.',
    },
  ];

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-8 select-none">
      <div className="max-w-4xl mx-auto flex flex-col items-center space-y-10 sm:space-y-12">
        {/* Stage Status Badge */}
        <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-neutral-900/90 border border-neutral-800 text-xs sm:text-sm font-mono uppercase tracking-[0.3em] text-neutral-400">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
          <span>Stage 03 // Instructions</span>
        </div>

        {/* Primary Title */}
        <h1 className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-black uppercase tracking-tight text-white drop-shadow-[0_10px_35px_rgba(0,0,0,0.9)] leading-none">
          GET <span className="text-red-600">READY</span>
        </h1>

        {/* Instructions Stack */}
        <div className="w-full max-w-2xl space-y-4 text-left">
          {instructions.map((item) => (
            <div
              key={item.num}
              className="flex items-center gap-6 px-6 sm:px-8 py-5 sm:py-6 rounded-xl bg-neutral-950/80 border border-neutral-800/90 border-l-4 border-l-red-600 shadow-xl"
            >
              <span className="text-xl sm:text-2xl font-mono font-black text-red-500 tracking-wider">
                {item.num}
              </span>
              <p className="text-xl sm:text-2xl md:text-3xl font-medium text-neutral-100 tracking-wide">
                {item.text}
              </p>
            </div>
          ))}
        </div>

        {/* Pacing Indicator */}
        <div className="pt-2">
          <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase">
            Advancing to countdown...
          </span>
        </div>
      </div>
    </div>
  );
};
