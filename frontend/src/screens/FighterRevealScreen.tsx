import React, { useState, useEffect, useMemo } from 'react';
import type { FightObservationResult } from '../types/analysis.ts';
import {
  getFighterForScore,
  getCandidateImagePaths,
} from '../services/fighterMapping.ts';
import { CinematicArenaBackground } from '../components/CinematicArenaBackground';
import { ArenaHeader, ArenaCornerBrackets } from '../components/ArenaHUD';

interface FighterRevealScreenProps {
  result: FightObservationResult | null;
  onReset: () => void;
}

/**
 * Converts a fighter ID into a descriptive fight-style subtitle.
 */
function getFighterTypeSubtitle(fighterId: string): string {
  switch (fighterId) {
    case 'hasbulla':
      return 'WILD CARD';
    case 'carlos_prates':
      return 'POWER STRIKER';
    case 'jean_silva':
      return 'EXPLOSIVE STRIKER';
    case 'farid_basharat':
      return 'TECHNICAL FIGHTER';
    case 'max_holloway':
      return 'VOLUME STRIKER';
    case 'alexander_volkanovski':
      return 'ELITE ALL-ROUNDER';
    case 'justin_gaethje':
      return 'PRESSURE FIGHTER';
    case 'khabib_nurmagomedov':
      return 'CONTROL SPECIALIST';
    case 'islam_makhachev':
      return 'SUBMISSION SPECIALIST';
    case 'jon_jones':
      return 'COMPLETE FIGHTER';
    default:
      return 'PRO FIGHTER';
  }
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

    // Fade "YOUR TYPE" out around 1.5 seconds
    const fadeTimer = setTimeout(() => {
      setTitleFading(true);
    }, 1500);

    // Transition to reveal phase at 1.8 seconds
    const revealTimer = setTimeout(() => {
      setPhase('reveal');
    }, 1800);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(revealTimer);
    };
  }, [fighter]);

  // Fallback for null overall_score
  if (!fighter) {
    return (
      <CinematicArenaBackground variant="reveal" bgImageSrc="/assets/fighter-reveal-bg.jpg">
        <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-6 select-none">
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
      </CinematicArenaBackground>
    );
  }

  return (
    <CinematicArenaBackground variant="reveal" bgImageSrc="/assets/fighter-reveal-bg.jpg">
      {/* ── Phase 1: TITLE SCREEN ("YOUR TYPE") ── */}
      {phase === 'title' && (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center">
          <div
            className={`transition-all duration-500 ease-in-out transform ${
              titleFading
                ? 'opacity-0 scale-95'
                : 'opacity-100 scale-100'
            }`}
          >
            <h1 className="text-6xl sm:text-8xl md:text-9xl font-black uppercase tracking-tight leading-none text-center">
              <span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">YOUR</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">FIGHTER TYPE</span>
            </h1>
          </div>
        </div>
      )}

      {/* ── Phase 2: REVEAL SCREEN ── */}
      {phase === 'reveal' && (
        <div className="relative z-10 w-full flex-1 flex flex-col items-center justify-between py-6 px-6">

          {/* Top Label */}
          <ArenaHeader stageNumber="08" stageTitle="AI FIGHTER REVEAL MATCH" />

          {/* Main 2-Column Reveal Grid (Left: Fighter Image | Right: Fighter Name & Telemetry) */}
          <div className="w-full max-w-7xl mx-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center my-auto">
            
            {/* Left Column: Fighter Image standing inside Octagon (7 cols) */}
            <div className="lg:col-span-7 relative flex items-center justify-center h-full max-h-[60vh]">
              {!allImagesFailed ? (
                <div className="relative flex items-center justify-center h-full">
                  {/* Spotlight & Rim Light Glow */}
                  <div className="absolute inset-0 rounded-full bg-red-600/25 blur-[90px] animate-pulse pointer-events-none" />

                  {/* Floor Contact Shadow */}
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-64 sm:w-80 h-8 bg-black/90 blur-md rounded-full pointer-events-none" />

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
                    className={`max-w-full max-h-full w-auto h-auto object-contain drop-shadow-[0_0_60px_rgba(220,38,38,0.45)] transition-all duration-700 ease-out transform relative z-10 ${
                      imageLoaded
                        ? 'opacity-100 scale-100 translate-y-0'
                        : 'opacity-0 scale-95 translate-y-4'
                    }`}
                  />
                </div>
              ) : (
                /* Asset Fallback */
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
                </div>
              )}
            </div>

            {/* Right Column: Fighter Metadata Card & Action (5 cols) */}
            <div
              className={`lg:col-span-5 w-full min-w-0 flex flex-col items-start text-left space-y-6 transition-all duration-700 delay-150 transform ${
                imageLoaded ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6'
              }`}
            >
              {/* Sub-label */}
              <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-[0.25em] text-neutral-400 font-bold">
                <span className="w-2 h-2 rounded-full bg-[#E10600]" />
                <span>YOUR FIGHTER TYPE</span>
              </div>

              {/* Fighter Name */}
              <h1
                className={`font-black uppercase tracking-tight text-white drop-shadow-[0_4px_30px_rgba(220,38,38,0.5)] leading-[0.95] break-words w-full ${
                  fighter.name.length > 12
                    ? 'text-5xl sm:text-6xl xl:text-7xl' // Slightly smaller for long names (e.g. Alexander Volkanovski)
                    : 'text-5xl sm:text-7xl lg:text-8xl' // Original size for short names (e.g. Jon Jones)
                }`}
              >
                {fighter.name}
              </h1>

              {/* Fighter Subtitle / Category Badge */}
              <div className="space-y-2">
                <div className="inline-block px-4 py-1.5 rounded-lg bg-red-950/90 border border-red-600/70 text-sm sm:text-base font-mono font-bold uppercase tracking-widest text-red-300 shadow-[0_0_20px_rgba(220,38,38,0.4)]">
                  {getFighterTypeSubtitle(fighter.id)}
                </div>
                <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
                  AI-COMPUTED FIGHTER TYPE
                </p>
              </div>

              {/* Overall Score Card */}
              <div className="w-full p-5 rounded-2xl bg-neutral-950/90 border border-neutral-800 backdrop-blur-md relative overflow-hidden flex items-center justify-between">
                <ArenaCornerBrackets />
                <div>
                  <p className="text-xs font-mono uppercase tracking-widest text-neutral-500">
                    OVERALL SCORE
                  </p>
                  <p className="text-sm font-sans text-neutral-200 font-medium">
                    Kinematic Compatibility Index
                  </p>
                </div>
                <div className="text-3xl sm:text-4xl font-black font-mono text-red-500 tabular-nums">
                  {overall != null ? overall.toFixed(1) : 'N/A'} <span className="text-xs text-neutral-600 font-normal">/ 10</span>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onReset}
                  className="px-8 py-3.5 rounded-xl text-xs sm:text-sm font-mono font-bold tracking-widest uppercase bg-[#E10600] hover:bg-red-700 text-white shadow-[0_0_30px_rgba(225,6,0,0.6)] transition-all cursor-pointer"
                >
                  PLAY AGAIN ↺
                </button>
              </div>

            </div>

          </div>

        </div>
      )}
    </CinematicArenaBackground>
  );
};
