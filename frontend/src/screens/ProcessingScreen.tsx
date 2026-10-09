import React, { useEffect, useRef } from 'react';
import type { FightObservationResult } from '../types/analysis.ts';
import { CinematicArenaBackground } from '../components/CinematicArenaBackground';
import { ArenaHeader, ArenaCornerBrackets } from '../components/ArenaHUD';

interface ProcessingScreenProps {
  result: FightObservationResult | null;
  error: string | null;
  onComplete: () => void;
  onReset: () => void;
}

const MIN_TOTAL_DISPLAY_MS = 2000;
const MIN_RESULT_DISPLAY_MS = 1000;

/**
 * ProcessingScreen: Stage 06 // Telemetry Processing
 *
 * Visual layout matching the reference design:
 *  - Left: Title "ANALYZING FIGHT" & telemetry status checklist
 *  - Center: Dual 3D Vector Skeletons (BLUE vs RED fighters) with joint points, skeleton tracking lines, and circular floor target rings
 *  - Right: AI telemetry HUD graphs & diagrams
 */
export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({
  result,
  error,
  onComplete,
  onReset,
}) => {
  const mountTimeRef = useRef<number>(Date.now());
  const completedRef = useRef<boolean>(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    const audio = new Audio('/assets/audio/analyzing-fight.mp3');
    audio.play().catch((err) => console.warn('Audio playback failed:', err));
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!result || error) return;
    if (completedRef.current) return;

    const elapsed = Date.now() - mountTimeRef.current;
    const remainingDelay = Math.max(
      MIN_RESULT_DISPLAY_MS,
      MIN_TOTAL_DISPLAY_MS - elapsed
    );

    const timer = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current();
      }
    }, remainingDelay);

    return () => clearTimeout(timer);
  }, [result, error]);

  return (
    <CinematicArenaBackground variant="analysis">
      <ArenaHeader stageNumber="06" stageTitle="TELEMETRY ANALYSIS LAB" />

      <div className="w-full flex-1 flex flex-col items-center justify-between px-6 py-6 select-none overflow-y-auto">
        <div className="w-full max-w-7xl mx-auto flex flex-col items-center space-y-6 my-auto">

          {/* Screen Header */}
          <div className="text-center space-y-1">
            <h1 className="text-4xl sm:text-6xl md:text-7xl font-black uppercase tracking-tight text-white leading-none">
              {error ? (
                <>
                  ANALYSIS <span className="text-red-600">FAILED</span>
                </>
              ) : result ? (
                <>
                  TELEMETRY <span className="text-emerald-500">READY</span>
                </>
              ) : (
                <>
                  <span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">ANALYZING</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">FIGHT</span>
                </>
              )}
            </h1>
            <p className="text-xs sm:text-sm text-neutral-300 font-mono tracking-wide">
              {error
                ? 'A camera recording or processing issue occurred.'
                : result
                  ? 'Kinematic movement features evaluated. Loading review…'
                  : 'Extracting dual-camera pose sequence and evaluating movement metrics…'}
            </p>
          </div>

          {/* Main 3-Column AI Computer Vision Visualization Layout */}
          <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">

            {/* Left Column: Status Checklist (4 cols) */}
            <div className="lg:col-span-4 p-6 rounded-2xl bg-neutral-950/85 border border-neutral-800/90 shadow-2xl backdrop-blur-md relative overflow-hidden text-left space-y-5">
              <ArenaCornerBrackets />

              <p className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 pb-2 border-b border-neutral-800">
                Kinematic Pipeline Status
              </p>

              {error ? (
                <div className="space-y-4 text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-red-950/60 border border-red-700/80 flex items-center justify-center mx-auto text-red-400 text-2xl font-bold">
                    ✕
                  </div>
                  <p className="text-xs font-mono text-red-300 bg-red-950/40 p-3 rounded-lg border border-red-900/60">
                    {error}
                  </p>
                  <button
                    type="button"
                    onClick={onReset}
                    className="px-5 py-2 rounded-lg text-xs font-mono font-semibold tracking-wider bg-red-950/60 hover:bg-red-900 border border-red-700/60 text-red-300 transition-colors cursor-pointer"
                  >
                    Return to Start ↺
                  </button>
                </div>
              ) : (
                <div className="space-y-3 text-xs font-mono">
                  <div className="flex items-center justify-between text-neutral-200 pb-1.5 border-b border-neutral-800/80">
                    <span>DUAL CAMERA SYNC</span>
                    <span className="text-emerald-400 font-bold">✓ OK</span>
                  </div>
                  <div className="flex items-center justify-between text-neutral-200 pb-1.5 border-b border-neutral-800/80">
                    <span>POSE TRACKING</span>
                    <span className={result ? 'text-emerald-400 font-bold' : 'text-amber-400 animate-pulse'}>
                      {result ? '✓ OK' : 'PROCESSING...'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-neutral-200 pb-1.5 border-b border-neutral-800/80">
                    <span>MOVEMENT ANALYSIS</span>
                    <span className={result ? 'text-emerald-400 font-bold' : 'text-amber-400 animate-pulse'}>
                      {result ? '✓ OK' : 'PROCESSING...'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-neutral-200 pb-1.5 border-b border-neutral-800/80">
                    <span>STRIKE PATTERNS</span>
                    <span className={result ? 'text-emerald-400 font-bold' : 'text-amber-400 animate-pulse'}>
                      {result ? '✓ OK' : 'PENDING...'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-neutral-200">
                    <span>AI MATCHING</span>
                    <span className={result ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                      {result ? '✓ OK' : 'PENDING...'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Center Column: Cinematic Analyzing Image (5 cols) */}
            <div className="lg:col-span-5 rounded-2xl border border-[#E10600]/40 shadow-2xl relative overflow-hidden min-h-[340px] flex flex-col items-center justify-center">
              <ArenaCornerBrackets />
              {/* Analyzing fighter image */}
              <img
                src="/assets/analyzing-bg.jpg"
                alt="Fighter Analyzing"
                className="absolute inset-0 w-full h-full object-cover object-center opacity-85"
              />
              {/* Overlay to keep HUD elements visible */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />
              {/* Animated scan line */}
              <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-[#E10600]/80 to-transparent animate-pulse z-10" style={{ top: '40%' }} />
              {/* Center label */}
              <div className="relative z-10 mt-auto mb-4 px-4 py-2 rounded-lg bg-black/70 border border-[#E10600]/40 backdrop-blur-sm">
                <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#E10600] font-bold text-center animate-pulse">
                  {result ? 'ANALYSIS COMPLETE' : 'PROCESSING KINEMATIC DATA…'}
                </p>
              </div>
            </div>

            {/* Right Column: Mini HUD Graphs & Telemetry Diagram (3 cols) */}
            <div className="lg:col-span-3 p-5 rounded-2xl bg-neutral-950/85 border border-neutral-800/90 shadow-2xl backdrop-blur-md relative overflow-hidden text-left space-y-4">
              <ArenaCornerBrackets />

              <p className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 pb-2 border-b border-neutral-800">
                Live Data Feeds
              </p>

              {/* Simulated Waveform & Line Chart */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-neutral-400">
                    <span>KINEMATIC VELOCITY</span>
                    <span className="text-red-400 font-bold">2.8 m/s</span>
                  </div>
                  <div className="w-full h-8 bg-neutral-900 rounded flex items-end justify-between px-1 py-1">
                    {[40, 65, 30, 85, 95, 60, 75, 50, 90, 70, 85].map((h, i) => (
                      <div
                        key={i}
                        className="w-1 bg-red-600 rounded-t transition-all duration-300"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-neutral-400">
                    <span>GUARD STABILITY INDEX</span>
                    <span className="text-blue-400 font-bold">94%</span>
                  </div>
                  <div className="w-full h-8 bg-neutral-900 rounded flex items-end justify-between px-1 py-1">
                    {[70, 80, 85, 75, 90, 95, 88, 92, 94, 96].map((h, i) => (
                      <div
                        key={i}
                        className="w-1 bg-blue-500 rounded-t transition-all duration-300"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
              </div>

            </div>

          </div>

        </div>
      </div>
    </CinematicArenaBackground>
  );
};
