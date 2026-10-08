import React, { useEffect, useState } from 'react';
import type {
  CategoryObservation,
  FightObservationResult,
} from '../types/analysis.ts';
import { CinematicArenaBackground } from '../components/CinematicArenaBackground';
import { ArenaHeader, ArenaCornerBrackets } from '../components/ArenaHUD';
import { CinematicPanel } from '../components/CinematicPanel';

interface ReviewScreenProps {
  result: FightObservationResult | null;
  onNext: () => void;
  onReset: () => void;
}

interface CategoryCardProps {
  label: string;
  icon: string;
  observation: CategoryObservation;
  animated: boolean;
}

const CategoryCard: React.FC<CategoryCardProps> = ({
  label,
  icon,
  observation,
  animated,
}) => {
  const hasScore = observation.score !== null && !isNaN(observation.score);
  const scoreVal = hasScore ? observation.score! : null;

  const scoreColor =
    scoreVal === null
      ? 'text-neutral-500'
      : scoreVal >= 7.5
        ? 'text-emerald-400'
        : scoreVal >= 5.0
          ? 'text-amber-400'
          : 'text-red-400';

  const barColor =
    scoreVal === null
      ? 'bg-neutral-800'
      : scoreVal >= 7.5
        ? 'bg-emerald-500'
        : scoreVal >= 5.0
          ? 'bg-amber-500'
          : 'bg-red-500';

  return (
    <CinematicPanel glowColor="red" className="h-full flex flex-col justify-between hover:border-red-600/70 p-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base sm:text-lg">{icon}</span>
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-200 font-bold">
              {label}
            </span>
          </div>

          <div className="flex items-baseline gap-1">
            <span className={`text-xl sm:text-2xl font-black font-mono tabular-nums ${scoreColor}`}>
              {hasScore ? scoreVal!.toFixed(1) : '—'}
            </span>
            <span className="text-[10px] font-mono text-neutral-600">/10</span>
          </div>
        </div>

        {/* Progress bar with animated width transition */}
        <div className="w-full h-1.5 bg-neutral-900 rounded-full overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out ${barColor}`}
            style={{
              width: animated && hasScore ? `${Math.min(100, Math.max(0, scoreVal! * 10))}%` : '0%',
            }}
          />
        </div>

        {/* Observation text */}
        <p className="text-xs text-neutral-300 leading-relaxed font-sans line-clamp-2">
          {observation.observation || 'No observations recorded for this category.'}
        </p>
      </div>
    </CinematicPanel>
  );
};

export const ReviewScreen: React.FC<ReviewScreenProps> = ({
  result,
  onNext,
  onReset,
}) => {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const hasOverall =
    result?.overall_score !== null &&
    result?.overall_score !== undefined &&
    !isNaN(result.overall_score);
  const overallVal = hasOverall ? result!.overall_score! : null;

  // Automatically transition to Fighter Reveal after ~5.5 seconds if a valid overall score exists
  useEffect(() => {
    if (!hasOverall) return;
    const timer = setTimeout(() => {
      onNext();
    }, 5500);
    return () => clearTimeout(timer);
  }, [hasOverall, onNext]);

  const categories = [
    {
      label: 'SPEED & OUTPUT',
      icon: '⚡',
      data: result?.striking ?? { category: 'Striking', score: null, observation: '' },
    },
    {
      label: 'POWER & FORCE',
      icon: '💥',
      data: result?.movement ?? { category: 'Movement', score: null, observation: '' },
    },
    {
      label: 'ACCURACY',
      icon: '🎯',
      data: result?.guard ?? { category: 'Guard', score: null, observation: '' },
    },
    {
      label: 'DEFENSE',
      icon: '🛡️',
      data: result?.balance ?? { category: 'Balance', score: null, observation: '' },
    },
    {
      label: 'FOOTWORK',
      icon: '👟',
      data: result?.stance ?? { category: 'Stance', score: null, observation: '' },
    },
    {
      label: 'COMBOS',
      icon: '🥊',
      data: result?.coordination ?? { category: 'Coordination', score: null, observation: '' },
    },
  ];

  return (
    <CinematicArenaBackground variant="review">
      <ArenaHeader stageNumber="07" stageTitle="MOVEMENT TELEMETRY BROADCAST" />

      <div className="w-full flex-1 flex flex-col items-center justify-between px-6 py-6 select-none overflow-y-auto">
        <div className="w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center my-auto">

          {/* Left Column: Fighter Image (4 cols) */}
          <div className="hidden lg:flex lg:col-span-4 relative items-center justify-center h-full min-h-[420px] overflow-hidden rounded-2xl">
            <div className="absolute inset-0 ring-1 ring-[#E10600]/40 rounded-2xl pointer-events-none z-10" />
            <img
              src="/assets/review-fighter-bg.jpg"
              alt="Fighter"
              className="absolute inset-0 w-full h-full object-cover object-center opacity-90"
            />
            {/* Right-edge fade to blend into the panel grid */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-black/70 pointer-events-none z-10" />
          </div>

          {/* Right Column: Telemetry Cards & Overall Ring (8 cols) */}
          <div className="lg:col-span-8 flex flex-col space-y-6 text-left">

            {/* Header */}
            <div className="space-y-1">
              <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tight leading-none">
                <span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">MOVEMENT</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">TELEMETRY</span>
              </h1>
              <p className="text-xs sm:text-sm font-mono uppercase tracking-widest text-neutral-400">
                ANALYSIS RESULTS // KINEMATIC AGGREGATE
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              {/* 6 Category Cards Grid (8 cols) */}
              <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {categories.map((cat, idx) => (
                  <div
                    key={cat.label}
                    className="transition-all duration-500 transform animate-in fade-in slide-in-from-bottom-3"
                    style={{ animationDelay: `${idx * 80}ms` }}
                  >
                    <CategoryCard
                      label={cat.label}
                      icon={cat.icon}
                      observation={cat.data}
                      animated={animated}
                    />
                  </div>
                ))}
              </div>

              {/* Large Circular Overall Score Ring (4 cols) */}
              {hasOverall && (
                <div className="md:col-span-4 h-full p-6 rounded-2xl bg-neutral-950/90 border border-red-700/60 shadow-[0_0_50px_rgba(220,38,38,0.3)] backdrop-blur-md flex flex-col items-center justify-center text-center relative overflow-hidden">
                  <ArenaCornerBrackets />

                  <div className="relative flex items-center justify-center w-28 h-28 sm:w-32 sm:h-32 mb-3">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        className="text-neutral-900 stroke-current"
                        strokeWidth="8"
                        fill="transparent"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        className="text-red-600 stroke-current transition-all duration-1000 ease-out"
                        strokeWidth="8"
                        strokeDasharray={251.2}
                        strokeDashoffset={animated ? 251.2 - (251.2 * (overallVal! / 10)) : 251.2}
                        strokeLinecap="round"
                        fill="transparent"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <span className="text-3xl sm:text-4xl font-black font-mono text-white leading-none">
                        {overallVal!.toFixed(1)}
                      </span>
                      <span className="text-xs font-mono text-neutral-500">/ 10</span>
                    </div>
                  </div>

                  <p className="text-xs font-mono uppercase tracking-widest text-red-400 font-bold">
                    OVERALL SCORE
                  </p>
                  <p className="text-[11px] font-mono text-neutral-400 mt-1">
                    UFC Fighter Compatibility Index
                  </p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="w-full flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onReset}
                className="px-5 py-2.5 rounded-lg text-xs font-mono font-semibold tracking-wider bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                Reset ↺
              </button>

              <button
                type="button"
                onClick={onNext}
                className="px-7 py-3 rounded-xl text-xs sm:text-sm font-mono font-bold tracking-widest uppercase bg-[#E10600] hover:bg-red-700 text-white shadow-[0_0_30px_rgba(225,6,0,0.6)] transition-all cursor-pointer"
              >
                Reveal Fighter Match →
              </button>
            </div>

          </div>

        </div>
      </div>
    </CinematicArenaBackground>
  );
};
