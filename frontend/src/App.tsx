import { useState, useCallback } from 'react';
import { ExhibitionShell } from './components/ExhibitionShell.tsx';
import { WelcomeScreen } from './screens/WelcomeScreen.tsx';
import { CalibrationScreen } from './screens/CalibrationScreen.tsx';
import { InstructionsScreen } from './screens/InstructionsScreen.tsx';
import {
  ExhibitionState,
  EXHIBITION_FLOW_SEQUENCE,
} from './types/exhibition.ts';

export default function App() {
  const [currentState, setCurrentState] = useState<ExhibitionState>(
    ExhibitionState.WELCOME
  );

  const goToState = useCallback((state: ExhibitionState) => {
    setCurrentState(state);
  }, []);

  const resetToWelcome = useCallback(() => {
    setCurrentState(ExhibitionState.WELCOME);
  }, []);

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

      {currentState !== ExhibitionState.WELCOME &&
        currentState !== ExhibitionState.CALIBRATION &&
        currentState !== ExhibitionState.INSTRUCTIONS && (
          /* Holding container for subsequent states (COUNTDOWN, FIGHT, etc.) */
          <div className="flex flex-col items-center justify-center text-center space-y-6 max-w-2xl px-4 py-8">
            <div className="px-4 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-xs font-mono uppercase tracking-[0.2em] text-neutral-400">
              Current Stage
            </div>

            <h2 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-white">
              {currentState}
            </h2>

            <p className="text-neutral-400 text-sm sm:text-base font-mono">
              Screen implementation pending next phase.
            </p>

            <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={resetToWelcome}
                className="px-6 py-2.5 rounded-lg text-xs font-mono font-semibold tracking-wider bg-red-950/60 hover:bg-red-950/90 border border-red-700/60 text-red-300 transition-colors cursor-pointer"
              >
                Reset to WELCOME ↺
              </button>
            </div>

            {/* Minimal Dev Stepper (To preview all states) */}
            <div className="pt-6 border-t border-neutral-900 w-full flex flex-wrap items-center justify-center gap-1.5">
              {EXHIBITION_FLOW_SEQUENCE.map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => goToState(state)}
                  className={`px-2.5 py-1 rounded text-[10px] font-mono tracking-wider cursor-pointer transition-all ${
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
        )}
    </ExhibitionShell>
  );
}
