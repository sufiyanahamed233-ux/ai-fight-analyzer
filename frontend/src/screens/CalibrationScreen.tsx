import React, { useEffect, useState, useRef } from 'react';
import { apiService } from '../services/api.ts';
import {
  CalibrationStatus,
  type CalibrationResponse,
} from '../types/calibration.ts';
import { CinematicArenaBackground } from '../components/CinematicArenaBackground';
import { ArenaHeader, ArenaCornerBrackets } from '../components/ArenaHUD';
import { CinematicPanel } from '../components/CinematicPanel';

interface CalibrationScreenProps {
  onComplete: () => void;
}

/**
 * CalibrationScreen: Phase 4 Participant Positioning & CV Calibration
 *
 * Communicates positioning feedback to the participant inside a cinematic broadcast frame:
 * - Left HUD: CAMERA 1 ACTIVE, POSE DETECTION, BODY TRACKING, CALIBRATION STATUS
 * - Right HUD: PERSON DETECTED (HEAD, SHOULDERS, ARMS, POSITION locks)
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
    const audio = new Audio('/assets/audio/position-yourself.mp3');
    audio.play().catch((err) => console.warn('Audio playback failed:', err));
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  useEffect(() => {
    let hasCompleted = false;
    const timer = setTimeout(() => {
      if (!hasCompleted) {
        hasCompleted = true;
        onCompleteRef.current();
      }
    }, 2000);

    const unsubscribe = apiService.subscribeCalibration((update) => {
      setData(update);
    });

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const isReady = data.status === CalibrationStatus.READY;
  const personDetected = data.person_detected || isReady;

  return (
    <CinematicArenaBackground variant="calibration">
      <ArenaHeader stageNumber="02" stageTitle="CALIBRATION & CV TARGETING" />

      <div className="w-full flex-1 flex flex-col items-center justify-between px-4 py-6 select-none">

        {/* Title */}
        <div className="text-center space-y-1 my-2">
          <h1 className="text-4xl sm:text-6xl font-black uppercase tracking-tight leading-none">
            <span className="text-white drop-shadow-[0_10px_35px_rgba(255,255,255,0.2)]">POSITION</span> <span className="text-[#E10600] drop-shadow-[0_0_35px_rgba(225,6,0,0.8)]">YOURSELF</span>
          </h1>
          <p className="text-sm sm:text-base font-mono uppercase tracking-widest text-neutral-300">
            Position yourself inside the fighting zone
          </p>
        </div>

        {/* Main 3-Column Broadcast Frame (Left HUD | Central Target Kiosk | Right HUD) */}
        <div className="w-full max-w-5xl my-auto grid grid-cols-1 lg:grid-cols-4 gap-6 items-center">

          {/* Left Telemetry Panel */}
          <CinematicPanel glowColor={isReady ? 'emerald' : 'red'} className="hidden lg:flex flex-col space-y-4 text-left">
            <p className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 pb-2 border-b border-neutral-800">
              System Telemetry
            </p>
            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center text-neutral-300">
                <span>CAMERA 1</span>
                <span className="text-emerald-400 font-bold">ACTIVE</span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>POSE DETECTION</span>
                <span className={personDetected ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                  {personDetected ? '✓' : 'SEARCHING'}
                </span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>BODY TRACKING</span>
                <span className={personDetected ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                  {personDetected ? '✓' : 'WAITING'}
                </span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>CALIBRATION</span>
                <span className={isReady ? 'text-emerald-400 font-bold' : 'text-amber-400 animate-pulse'}>
                  {isReady ? 'READY' : 'CALIBRATING'}
                </span>
              </div>
            </div>
          </CinematicPanel>

          {/* Center Target Indicator Card */}
          <div className="lg:col-span-2 flex flex-col items-center">
            <div
              className={`w-full p-8 sm:p-10 rounded-2xl border transition-all duration-500 flex flex-col items-center justify-center space-y-6 relative overflow-hidden backdrop-blur-md ${
                isReady
                  ? 'bg-emerald-950/45 border-emerald-500/70 shadow-[0_0_60px_rgba(16,185,129,0.3)]'
                  : 'bg-neutral-950/85 border-neutral-800/90 shadow-2xl'
              }`}
            >
              <ArenaCornerBrackets />

              {/* Background Cinematic Person Element */}
              <div className="absolute inset-0 z-0 opacity-15 mix-blend-screen pointer-events-none">
                <img 
                  src="/assets/person-gloves.jpg" 
                  alt="Background" 
                  className="w-full h-full object-cover object-left-top filter grayscale contrast-125"
                />
              </div>

              {/* Moving scanline inside target card */}
              {!isReady && (
                <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-red-500/80 to-transparent animate-pulse top-0" />
              )}

              {/* Visual Target Radar Circle */}
              <div className="relative flex items-center justify-center w-24 h-24 sm:w-28 sm:h-28">
                {isReady ? (
                  <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 text-5xl font-bold animate-in fade-in zoom-in duration-300">
                    ✓
                  </div>
                ) : (
                  <>
                    <div className="absolute inset-0 rounded-full border-2 border-red-500/30 animate-ping" />
                    <div className="w-20 h-20 rounded-full border-2 border-dashed border-red-500/80 animate-spin" />
                    <div className="w-5 h-5 rounded-full bg-red-600 shadow-[0_0_15px_rgba(220,38,38,1)]" />
                  </>
                )}
              </div>

              {/* Status Message */}
              <div className="space-y-1 text-center">
                <p
                  className={`text-2xl sm:text-3xl font-mono font-bold uppercase tracking-wider ${
                    isReady ? 'text-emerald-400' : 'text-amber-400 animate-pulse'
                  }`}
                >
                  {isReady ? "YOU'RE READY" : 'DETECTING...'}
                </p>
                <p className="text-xs sm:text-sm font-mono uppercase tracking-widest text-neutral-400">
                  {isReady
                    ? 'CV Alignment Established — Advancing'
                    : personDetected
                    ? 'Person Detected — Acquiring Lock'
                    : 'Position yourself inside the fight zone'}
                </p>
              </div>
            </div>
          </div>

          {/* Right Lock Status Panel */}
          <CinematicPanel glowColor={personDetected ? 'emerald' : 'red'} className="hidden lg:flex flex-col space-y-4 text-left">
            <p className="text-xs font-mono font-bold uppercase tracking-widest text-neutral-400 pb-2 border-b border-neutral-800">
              Person Detection
            </p>
            <div className="space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center text-neutral-300">
                <span>HEAD</span>
                <span className={personDetected ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                  {personDetected ? '✓ LOCK' : 'PENDING'}
                </span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>SHOULDERS</span>
                <span className={personDetected ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                  {personDetected ? '✓ LOCK' : 'PENDING'}
                </span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>ARMS</span>
                <span className={personDetected ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                  {personDetected ? '✓ LOCK' : 'PENDING'}
                </span>
              </div>
              <div className="flex justify-between items-center text-neutral-300">
                <span>POSITION</span>
                <span className={isReady ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                  {isReady ? '✓ CENTERED' : 'ADJUSTING'}
                </span>
              </div>
            </div>
          </CinematicPanel>

        </div>

      </div>
    </CinematicArenaBackground>
  );
};
