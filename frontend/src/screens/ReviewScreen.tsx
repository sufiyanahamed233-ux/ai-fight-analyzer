import React from 'react';
import type {
  CategoryObservation,
  FightObservationResult,
} from '../types/analysis.ts';

interface ReviewScreenProps {
  result: FightObservationResult | null;
  onNext: () => void;
  onReset: () => void;
}

interface CategoryCardProps {
  label: string;
  icon: string;
  observation: CategoryObservation;
}

const CategoryCard: React.FC<CategoryCardProps> = ({
  label,
  icon,
  observation,
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
    <div className="flex flex-col justify-between p-4 sm:p-5 rounded-xl bg-neutral-950/80 border border-neutral-800 hover:border-neutral-700 transition-all text-left">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base sm:text-lg">{icon}</span>
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold">
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

        {/* Progress bar */}
        <div className="w-full h-1 bg-neutral-900 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: hasScore ? `${Math.min(100, Math.max(0, scoreVal! * 10))}%` : '0%' }}
          />
        </div>

        {/* Observation text */}
        <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed font-sans">
          {observation.observation || 'No observations recorded for this category.'}
        </p>
      </div>
    </div>
  );
};

export const ReviewScreen: React.FC<ReviewScreenProps> = ({
  result,
  onNext,
  onReset,
}) => {
  if (!result) {
    return (
      <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-8">
        <h2 className="text-3xl font-black uppercase text-white mb-4">
          No Results Available
        </h2>
        <button
          type="button"
          onClick={onReset}
          className="px-6 py-2.5 rounded-lg text-xs font-mono font-semibold bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-white cursor-pointer"
        >
          Return to Start ↺
        </button>
      </div>
    );
  }

  const hasOverall =
    result.overall_score !== null && !isNaN(result.overall_score);
  const overallVal = hasOverall ? result.overall_score! : null;

  return (
    <div className="w-full flex-1 flex flex-col items-stretch justify-between px-2 sm:px-6 py-3 max-w-6xl mx-auto overflow-y-auto select-none">
      {/* Top Header & Overall Score */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4 border-b border-neutral-800/80">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-400 mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Stage 07 // Performance Review</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tight text-white leading-none">
            MOVEMENT <span className="text-red-600">TELEMETRY</span>
          </h1>
        </div>

        {/* Overall Score Badge */}
        <div className="flex items-center gap-4 bg-neutral-950/90 border border-neutral-800 px-5 py-2.5 rounded-2xl">
          <div className="text-right">
            <span className="block text-[10px] font-mono uppercase tracking-widest text-neutral-500">
              Overall Score
            </span>
            <span className="text-xs font-mono text-neutral-400">
              Deterministic 6-Category Mean
            </span>
          </div>
          <div className="flex items-baseline gap-1 pl-4 border-l border-neutral-800">
            <span
              className={`text-4xl sm:text-5xl font-black font-mono leading-none ${
                overallVal === null
                  ? 'text-neutral-500'
                  : overallVal >= 7.5
                    ? 'text-emerald-400'
                    : overallVal >= 5.0
                      ? 'text-amber-400'
                      : 'text-red-400'
              }`}
            >
              {hasOverall ? overallVal!.toFixed(1) : 'N/A'}
            </span>
            <span className="text-xs font-mono text-neutral-600">/10</span>
          </div>
        </div>
      </div>

      {/* 6 Category Breakdown Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 my-4 flex-1">
        <CategoryCard
          label="Stance & Base"
          icon="🥋"
          observation={result.stance}
        />
        <CategoryCard
          label="Balance & Stability"
          icon="⚖️"
          observation={result.balance}
        />
        <CategoryCard
          label="Guard & Defense"
          icon="🛡️"
          observation={result.guard}
        />
        <CategoryCard
          label="Striking & Extension"
          icon="🥊"
          observation={result.striking}
        />
        <CategoryCard
          label="Kinetic Coordination"
          icon="⚡"
          observation={result.coordination}
        />
        <CategoryCard
          label="Ring Movement"
          icon="💨"
          observation={result.movement}
        />
      </div>

      {/* Heuristic Disclaimer and Actions */}
      <div className="pt-3 border-t border-neutral-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-[11px] text-neutral-500 font-mono max-w-2xl text-left leading-relaxed">
          ⚠️ <span className="text-neutral-400 font-semibold">Disclaimer:</span>{' '}
          {result.disclaimer}
        </p>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onReset}
            className="px-4 py-2.5 rounded-lg text-xs font-mono font-semibold tracking-wider bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            Reset ↺
          </button>
          <button
            type="button"
            onClick={onNext}
            className="px-6 py-2.5 rounded-lg text-xs font-mono font-bold tracking-wider bg-red-600 hover:bg-red-500 text-white transition-all shadow-[0_0_20px_rgba(220,38,38,0.4)] cursor-pointer"
          >
            Fighter Reveal →
          </button>
        </div>
      </div>
    </div>
  );
};
