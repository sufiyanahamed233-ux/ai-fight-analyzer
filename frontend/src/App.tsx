import { useState, useCallback } from 'react';
import { DasaraIntroScreen } from './components/DasaraIntroScreen.tsx';
import { ExhibitionShell } from './components/ExhibitionShell.tsx';
import { WelcomeScreen } from './screens/WelcomeScreen.tsx';
import { CalibrationScreen } from './screens/CalibrationScreen.tsx';
import { InstructionsScreen } from './screens/InstructionsScreen.tsx';
import { CountdownScreen } from './screens/CountdownScreen.tsx';
import { LiveFightScreen } from './screens/LiveFightScreen.tsx';
import { ProcessingScreen } from './screens/ProcessingScreen.tsx';
import { ReviewScreen } from './screens/ReviewScreen.tsx';
import { FighterRevealScreen } from './screens/FighterRevealScreen.tsx';
import {
  ExhibitionState,
  EXHIBITION_FLOW_SEQUENCE,
} from './types/exhibition.ts';
import type { FightObservationResult } from './types/analysis.ts';

// Internal-only state for the Dasara intro (not part of the public ExhibitionState enum)
type AppPhase = 'DASARA_INTRO' | ExhibitionState;

export default function App() {
  // Start with Dasara intro; it fires onComplete → WELCOME
  const [phase, setPhase] = useState<AppPhase>('DASARA_INTRO');
  const [analysisResult, setAnalysisResult] =
    useState<FightObservationResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const currentState = phase as ExhibitionState; // safe after intro

  const goToState = useCallback((state: ExhibitionState) => {
    setPhase(state);
  }, []);

  const resetToWelcome = useCallback(() => {
    setAnalysisResult(null);
    setAnalysisError(null);
    setPhase(ExhibitionState.WELCOME);
  }, []);

  const handleFightComplete = useCallback(
    (result: FightObservationResult) => {
      setAnalysisResult(result);
      goToState(ExhibitionState.PROCESSING);
    },
    [goToState]
  );

  const handleFightProcessing = useCallback(() => {
    goToState(ExhibitionState.PROCESSING);
  }, [goToState]);

  const handleFightError = useCallback((error: string) => {
    setAnalysisError(error);
  }, []);

  // ── Dasara intro is rendered outside ExhibitionShell (full-viewport takeover) ──
  if (phase === 'DASARA_INTRO') {
    return (
      <DasaraIntroScreen
        onComplete={() => setPhase(ExhibitionState.WELCOME)}
      />
    );
  }

  return (
    <ExhibitionShell currentState={currentState}>
      {currentState === ExhibitionState.WELCOME && (
        <WelcomeScreen onStart={() => goToState(ExhibitionState.CALIBRATION)} />
      )}

      {currentState === ExhibitionState.CALIBRATION && (
        <CalibrationScreen
          onComplete={() => goToState(ExhibitionState.INSTRUCTIONS)}
        />
      )}

      {currentState === ExhibitionState.INSTRUCTIONS && (
        <InstructionsScreen
          onComplete={() => goToState(ExhibitionState.COUNTDOWN)}
        />
      )}

      {currentState === ExhibitionState.COUNTDOWN && (
        <CountdownScreen
          onComplete={() => goToState(ExhibitionState.FIGHT)}
        />
      )}

      {currentState === ExhibitionState.FIGHT && (
        <LiveFightScreen
          durationSecs={10}
          onProcessing={handleFightProcessing}
          onComplete={handleFightComplete}
          onError={handleFightError}
        />
      )}

      {currentState === ExhibitionState.PROCESSING && (
        <ProcessingScreen
          result={analysisResult}
          error={analysisError}
          onComplete={() => goToState(ExhibitionState.REVIEW)}
          onReset={resetToWelcome}
        />
      )}

      {currentState === ExhibitionState.REVIEW && (
        <ReviewScreen
          result={analysisResult}
          onNext={() => goToState(ExhibitionState.FIGHTER_REVEAL)}
          onReset={resetToWelcome}
        />
      )}

      {currentState === ExhibitionState.FIGHTER_REVEAL && (
        <FighterRevealScreen
          result={analysisResult}
          onReset={resetToWelcome}
        />
      )}

      {/* Dev Navigation Footer Stepper */}
      <div className="fixed bottom-12 inset-x-0 z-30 pointer-events-none flex justify-center opacity-20 hover:opacity-100 transition-opacity">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-950/90 border border-neutral-800">
          {EXHIBITION_FLOW_SEQUENCE.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => goToState(state)}
              className={`px-2 py-0.5 rounded text-[9px] font-mono tracking-wider cursor-pointer transition-all ${
                currentState === state
                  ? 'bg-red-600 text-white font-bold'
                  : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
              }`}
            >
              {state}
            </button>
          ))}
        </div>
      </div>
    </ExhibitionShell>
  );
}
