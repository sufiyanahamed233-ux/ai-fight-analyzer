import React, { useEffect } from 'react';
import type { FightObservationResult } from '../types/analysis.ts';

interface ProcessingScreenProps {
  result: FightObservationResult | null;
  error: string | null;
  onComplete: () => void;
  onReset: () => void;
}

/**
 * ProcessingScreen: Stage 06 // Telemetry Processing
 *
 * Displays cinematic dual-camera telemetry extraction state while
 * YOLO pose and movement features are evaluated. Automatically calls
 * onComplete() when analysis result is present.
 */
export const ProcessingScreen: React.FC<ProcessingScreenProps> = ({
  result,
  error,
  onComplete,
  onReset,
}) => {
  useEffect(() => {
    if (result && !error) {
      // Brief aesthetic pause to allow user to see completion
      const timer = setTimeout(() => {
        onComplete();
      }, 900);
      return () => clearTimeout(timer);
    }
  }, [result, error, onComplete]);

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-8 select-none">
      <div className="max-w-3xl mx-auto flex flex-col items-center space-y-10">
        {/* Stage Status Badge */}
        <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-neutral-900/90 border border-neutral-800 text-xs sm:text-sm font-mono uppercase tracking-[0.3em] text-neutral-400">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              error
                ? 'bg-red-500'
                : result
                  ? 'bg-emerald-500'
                  : 'bg-amber-500 animate-pulse'
            }`}
          />
          <span>Stage 06 // Telemetry Processing</span>
        </div>

        {/* Primary Title */}
        <div className="space-y-3">
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
                ANALYZING <span className="text-red-600">FIGHT</span>
              </>
            )}
          </h1>
          <p className="text-base sm:text-lg text-neutral-400 font-mono tracking-wide max-w-xl mx-auto">
            {error
              ? 'A camera recording or processing issue occurred.'
              : result
                ? 'Kinematic movement features evaluated. Loading review…'
                : 'Extracting dual-camera pose sequence and evaluating movement metrics…'}
          </p>
        </div>

        {/* Central Visual Card */}
        <div className="w-full max-w-md p-8 rounded-2xl bg-neutral-950/80 border border-neutral-800/90 shadow-2xl flex flex-col items-center space-y-6">
          {error ? (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 rounded-full bg-red-950/60 border border-red-700/80 flex items-center justify-center mx-auto text-red-400 text-3xl font-bold">
                ✕
              </div>
              <p className="text-sm font-mono text-red-300 bg-red-950/40 p-3 rounded-lg border border-red-900/60">
                {error}
              </p>
              <button
                type="button"
                onClick={onReset}
                className="px-6 py-2.5 rounded-lg text-xs font-mono font-semibold tracking-wider bg-red-950/60 hover:bg-red-900 border border-red-700/60 text-red-300 transition-colors cursor-pointer"
              >
                Return to Start ↺
              </button>
            </div>
          ) : (
            <>
              {/* Radar / Spinner */}
              <div className="relative flex items-center justify-center w-24 h-24">
                <div
                  className={`absolute inset-0 rounded-full border-2 ${
                    result
                      ? 'border-emerald-500/30'
                      : 'border-red-500/30 animate-ping'
                  }`}
                />
                <div
                  className={`w-16 h-16 rounded-full border-2 border-dashed ${
                    result
                      ? 'border-emerald-400'
                      : 'border-red-500/80 animate-spin'
                  }`}
                />
                <div
                  className={`w-4 h-4 rounded-full ${
                    result ? 'bg-emerald-500' : 'bg-red-600'
                  }`}
                />
              </div>

              {/* Progress Steps */}
              <div className="w-full space-y-2 text-left text-xs font-mono">
                <div className="flex items-center justify-between text-neutral-300 pb-1 border-b border-neutral-800">
                  <span>1. Dual-Camera Sync</span>
                  <span className="text-emerald-400">OK</span>
                </div>
                <div className="flex items-center justify-between text-neutral-300 pb-1 border-b border-neutral-800">
                  <span>2. YOLO Keypoint Tracking</span>
                  <span className="text-emerald-400">
                    {result ? 'OK' : 'Processing…'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-neutral-300 pb-1 border-b border-neutral-800">
                  <span>3. Kinematic Feature Analysis</span>
                  <span className={result ? 'text-emerald-400' : 'text-neutral-500'}>
                    {result ? 'OK' : 'Pending'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-neutral-300">
                  <span>4. Heuristic Observation Scoring</span>
                  <span className={result ? 'text-emerald-400' : 'text-neutral-500'}>
                    {result ? 'OK' : 'Pending'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
