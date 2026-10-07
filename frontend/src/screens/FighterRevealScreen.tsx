import React from 'react';
import type { FightObservationResult } from '../types/analysis.ts';

interface FighterRevealScreenProps {
  result: FightObservationResult | null;
  onReset: () => void;
}

interface Archetype {
  name: string;
  tagline: string;
  description: string;
  badge: string;
}

function deriveArchetype(result: FightObservationResult | null): Archetype {
  if (!result) {
    return {
      name: 'THE OCTAGON CONTENDER',
      tagline: 'Versatile Combatant',
      description:
        'A balanced fighter capable of adapting to high-paced ring exchanges.',
      badge: '⚔️ ADAPTIVE',
    };
  }

  const scores = [
    { cat: 'striking', val: result.striking.score ?? 0 },
    { cat: 'guard', val: result.guard.score ?? 0 },
    { cat: 'movement', val: result.movement.score ?? 0 },
    { cat: 'balance', val: result.balance.score ?? 0 },
    { cat: 'stance', val: result.stance.score ?? 0 },
    { cat: 'coordination', val: result.coordination.score ?? 0 },
  ];

  scores.sort((a, b) => b.val - a.val);
  const top = scores[0];

  if (top.cat === 'striking') {
    return {
      name: 'THE APEX STRIKER',
      tagline: 'Precision & Kinetic Velocity',
      description:
        'Characterized by rapid hand speed, assertive arm extension, and snappy punch retraction.',
      badge: '🥊 HIGH VELOCITY',
    };
  }
  if (top.cat === 'guard' || top.cat === 'balance') {
    return {
      name: 'THE IRON FORTRESS',
      tagline: 'Defensive Discipline & Centerline Control',
      description:
        'Excels at maintaining high-guard posture and anchored hip stability throughout exchanges.',
      badge: '🛡️ DEFENSIVE BULWARK',
    };
  }
  if (top.cat === 'movement') {
    return {
      name: 'THE PHANTOM OUT-FIGHTER',
      tagline: 'Lateral Pacing & Ring Geometry',
      description:
        'Employs active displacement and agile evasive movement to control the fight perimeter.',
      badge: '💨 ELUSIVE FOOTWORK',
    };
  }
  return {
    name: 'THE ALL-ROUND COMBATANT',
    tagline: 'Kinetic Flow & Adaptability',
    description:
      'Harmonious coordination between stance width, hip pivot, and punch extension.',
    badge: '🥋 HARMONIC FLOW',
  };
}

export const FighterRevealScreen: React.FC<FighterRevealScreenProps> = ({
  result,
  onReset,
}) => {
  const archetype = deriveArchetype(result);
  const overall = result?.overall_score ?? null;

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-6 max-w-4xl mx-auto select-none">
      {/* Stage Badge */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] sm:text-xs font-mono uppercase tracking-[0.25em] text-neutral-400 mb-6">
        <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
        <span>Stage 08 // Fighter Reveal</span>
      </div>

      {/* Entertainment Only Warning Callout */}
      <div className="inline-block px-4 py-1 rounded bg-amber-950/40 border border-amber-600/50 text-amber-300 text-[11px] font-mono uppercase tracking-wider mb-8">
        ✨ Entertainment Feature Only — Does Not Claim Fighter Matching
      </div>

      {/* Main Archetype Card */}
      <div className="w-full max-w-xl p-8 rounded-3xl bg-neutral-950/90 border border-neutral-800 shadow-[0_0_60px_rgba(220,38,38,0.15)] flex flex-col items-center space-y-6">
        <div className="px-3.5 py-1 rounded-full bg-neutral-900 border border-neutral-700 text-xs font-mono font-bold text-neutral-300">
          {archetype.badge}
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-white leading-tight">
            {archetype.name}
          </h1>
          <p className="text-base sm:text-lg text-red-400 font-mono tracking-wide">
            {archetype.tagline}
          </p>
        </div>

        <p className="text-sm text-neutral-400 leading-relaxed max-w-md font-sans">
          {archetype.description}
        </p>

        {overall !== null && (
          <div className="pt-4 border-t border-neutral-900 w-full flex items-center justify-center gap-4">
            <span className="text-xs font-mono uppercase tracking-wider text-neutral-500">
              Telemetry Rating:
            </span>
            <span className="text-2xl font-black font-mono text-white">
              {overall.toFixed(1)} / 10
            </span>
          </div>
        )}
      </div>

      {/* Reset CTA */}
      <div className="pt-8">
        <button
          type="button"
          onClick={onReset}
          className="px-8 py-3.5 rounded-xl text-xs sm:text-sm font-mono font-bold tracking-widest uppercase bg-red-600 hover:bg-red-500 text-white transition-all shadow-[0_0_25px_rgba(220,38,38,0.5)] cursor-pointer"
        >
          New Exhibition Run ↺
        </button>
      </div>
    </div>
  );
};
