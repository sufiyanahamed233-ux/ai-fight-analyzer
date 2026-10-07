import React, { useEffect, useState, useRef } from 'react';
import { apiService } from '../services/api.ts';
import {
  CalibrationStatus,
  type CalibrationResponse,
} from '../types/calibration.ts';

interface CalibrationScreenProps {
  onComplete: () => void;
}

/**
 * CalibrationScreen: Phase 4 Participant Positioning & CV Calibration
 *
 * Communicates positioning feedback to the participant:
 * - Title: POSITION YOURSELF
 * - Instruction: Position yourself inside the fighting zone
 * - Status: "Detecting..." until the service confirms ready ("You're Ready")
 * - Automatically invokes onComplete() after confirming ready
 */
export const CalibrationScreen: React.FC<CalibrationScreenProps> = ({
  onComplete,
}) => {
  const [data, setData] = useState<CalibrationResponse>({
    status: CalibrationStatus.DETECTING,
    person_detected: false,
  });

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let transitionTimer: ReturnType<typeof setTimeout> | null = null;

    // Subscribe to centralized service (mock or real CV backend)
    const unsubscribe = apiService.subscribeCalibration((update) => {
      setData(update);

      if (update.status === CalibrationStatus.READY) {
        // Allow participant to absorb the "You're Ready" confirmation before transitioning
        transitionTimer = setTimeout(() => {
          onCompleteRef.current();
        }, 1200);
      }
    });

    return () => {
      unsubscribe();
      if (transitionTimer) clearTimeout(transitionTimer);
    };
  }, []);

  const isReady = data.status === CalibrationStatus.READY;

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center text-center px-4 py-8 select-none">
      <div className="max-w-4xl mx-auto flex flex-col items-center space-y-10 sm:space-y-12">
        {/* Stage Status Badge */}
        <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-neutral-900/90 border border-neutral-800 text-xs sm:text-sm font-mono uppercase tracking-[0.3em] text-neutral-400">
          <span
            className={`w-2.5 h-2.5 rounded-full transition-colors duration-300 ${
              isReady ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.9)]' : 'bg-amber-500 animate-pulse'
            }`}
          />
          <span>Stage 02 // Calibration</span>
        </div>

        {/* Primary Title */}
        <h1 className="text-5xl sm:text-7xl md:text-8xl font-black uppercase tracking-tight text-white drop-shadow-[0_10px_35px_rgba(0,0,0,0.9)] leading-none">
          POSITION <span className="text-red-600">YOURSELF</span>
        </h1>

        {/* Primary Instruction */}
        <p className="text-xl sm:text-2xl md:text-3xl font-light text-neutral-300 tracking-wide max-w-2xl">
          Position yourself inside the fighting zone
        </p>

        {/* Status Indicator Card */}
        <div className="pt-2 sm:pt-4 w-full max-w-md">
          <div
            className={`p-6 sm:p-8 rounded-2xl border transition-all duration-500 flex flex-col items-center justify-center space-y-4 ${
              isReady
                ? 'bg-emerald-950/40 border-emerald-500/60 shadow-[0_0_50px_rgba(16,185,129,0.25)]'
                : 'bg-neutral-950/80 border-neutral-800/90 shadow-2xl'
            }`}
          >
            {/* Visual Pulse / Radar Indicator */}
            <div className="relative flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20">
              {isReady ? (
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 text-3xl font-bold animate-in fade-in zoom-in duration-300">
                  ✓
                </div>
              ) : (
                <>
                  <div className="absolute inset-0 rounded-full border-2 border-red-500/30 animate-ping" />
                  <div className="w-12 h-12 rounded-full border-2 border-dashed border-red-500/80 animate-spin" />
                  <div className="w-4 h-4 rounded-full bg-red-600" />
                </>
              )}
            </div>

            {/* Status Text Display */}
            <div className="space-y-1">
              <div
                className={`text-2xl sm:text-3xl font-black uppercase tracking-widest transition-colors duration-300 ${
                  isReady ? 'text-emerald-400' : 'text-neutral-200'
                }`}
              >
                {isReady ? "You're Ready" : 'Detecting...'}
              </div>
              <p className="text-xs font-mono tracking-wider text-neutral-400">
                {isReady
                  ? 'Locked on. Preparing instructions...'
                  : data.person_detected
                    ? 'Subject located. Aligning sensors...'
                    : 'Awaiting subject in fighting zone...'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
