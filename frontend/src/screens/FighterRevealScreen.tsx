import React, { useState, useEffect, useMemo } from 'react';
import type { FightObservationResult } from '../types/analysis.ts';
import {
  getFighterForScore,
  getCandidateImagePaths,
} from '../services/fighterMapping.ts';

interface FighterRevealScreenProps {
  result: FightObservationResult | null;
  onReset: () => void;
}

export const FighterRevealScreen: React.FC<FighterRevealScreenProps> = ({
  result,
  onReset,
}) => {
  const overall = result?.overall_score ?? null;
  const fighter = useMemo(() => getFighterForScore(overall), [overall]);

  const [phase, setPhase] = useState<'title' | 'reveal'>('title');
  const [titleFading, setTitleFading] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [allImagesFailed, setAllImagesFailed] = useState(false);

  const candidatePaths = useMemo(
    () => (fighter ? getCandidateImagePaths(fighter) : []),
    [fighter]
  );

  useEffect(() => {
    // If no valid score or fighter, do not execute the reveal sequence
    if (!fighter) return;

    // Fade "YOUR TYPE" out around 1.4-1.5 seconds
    const fadeTimer = setTimeout(() => {
      setTitleFading(true);
    }, 1500);

    // Transition to reveal phase at 1.8 seconds (within 1.5–2 seconds)
    const revealTimer = setTimeout(() => {
      setPhase('reveal');
    }, 1800);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(revealTimer);
    };
  }, [fighter]);

  // If overall_score is null/N/A, preserve existing N/A/insufficient-tracking behavior (do not invent a fighter)
  if (!fighter) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-center px-6 select-none">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-400 mb-6">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span>Telemetry Status // Inconclusive</span>
        </div>
        <h2 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-white mb-4">
          INSUFFICIENT TRACKING
        </h2>
        <p className="text-sm font-mono text-neutral-400 max-w-md leading-relaxed mb-8">
          Unable to establish fighter profile match. Neither camera recorded sufficient valid person tracking during the exhibition round.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="px-8 py-3.5 rounded-xl text-xs sm:text-sm font-mono font-bold tracking-widest uppercase bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-white transition-all cursor-pointer"
        >
          New Exhibition Run ↺
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center overflow-hidden select-none">
      {/* Background cinematic radial grading */}
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_50%,rgba(220,38,38,0.12),transparent_70%)]"
        aria-hidden="true"
      />

      {/* Step 1: YOUR TYPE centered in very large bold typography */}
      {phase === 'title' && (
        <div
          className={`relative z-10 flex flex-col items-center justify-center transition-all duration-500 ease-in-out transform ${
            titleFading
              ? 'opacity-0 scale-95'
              : 'opacity-100 scale-100'
          }`}
        >
          <h1 className="text-6xl sm:text-8xl md:text-9xl font-black uppercase tracking-tight text-white drop-shadow-[0_0_50px_rgba(255,255,255,0.25)] text-center">
            YOUR TYPE
          </h1>
        </div>
      )}

      {/* Step 2: Full-screen fighter image reveal */}
      {phase === 'reveal' && (
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center p-2 sm:p-6">
          {!allImagesFailed ? (
            <img
              src={candidatePaths[candidateIdx]}
              alt={fighter.name}
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                if (candidateIdx + 1 < candidatePaths.length) {
                  setCandidateIdx((prev) => prev + 1);
                } else {
                  setAllImagesFailed(true);
                }
              }}
              className={`max-w-full max-h-[92vh] w-auto h-auto object-contain drop-shadow-[0_0_60px_rgba(220,38,38,0.25)] transition-all duration-700 ease-out transform ${
                imageLoaded
                  ? 'opacity-100 scale-100'
                  : 'opacity-0 scale-95'
              }`}
            />
          ) : (
            /* Fallback only if the image file has not been copied to public/fighters/ yet */
            <div className="flex flex-col items-center justify-center space-y-4 max-w-lg p-8 rounded-3xl bg-neutral-950/90 border border-neutral-800 text-center">
              <span className="text-xs font-mono uppercase tracking-[0.2em] text-red-500 font-bold">
                Fighter Match
              </span>
              <h2 className="text-4xl sm:text-6xl font-black uppercase text-white tracking-tight">
                {fighter.name}
              </h2>
              <p className="text-xs font-mono text-neutral-500">
                Overall Score: {overall?.toFixed(1)} / 10.0
              </p>
              <p className="text-[11px] font-mono text-neutral-600">
                Awaiting asset at <code className="text-neutral-400">public/fighters/{fighter.imageFileName}.png</code>
              </p>
            </div>
          )}

          {/* Minimal reset control */}
          <button
            type="button"
            onClick={onReset}
            className="absolute bottom-6 right-8 text-neutral-500 hover:text-white font-mono text-xs uppercase tracking-widest px-4 py-2 rounded-lg bg-neutral-950/80 border border-neutral-800/80 hover:border-neutral-700 transition-colors cursor-pointer"
          >
            Reset ↺
          </button>
        </div>
      )}
    </div>
  );
};
