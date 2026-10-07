import type {
  FightAnalysisRequest,
  FightObservationResult,
} from './analysis.ts';

export const CalibrationStatus = {
  DETECTING: 'detecting',
  READY: 'ready',
} as const;

export type CalibrationStatus =
  (typeof CalibrationStatus)[keyof typeof CalibrationStatus];

export interface CalibrationResponse {
  status: CalibrationStatus;
  person_detected: boolean;
  error?: string;
  device_label?: string;
}

export interface IApiService {
  /**
   * Subscribes to live or simulated participant calibration events.
   * Returns an unsubscription callback to cleanly stop listening/timers.
   */
  subscribeCalibration(
    onUpdate: (data: CalibrationResponse) => void
  ): () => void;

  /**
   * One-time check for calibration status
   */
  getCalibrationStatus(): Promise<CalibrationResponse>;

  /**
   * Trigger dual-camera recording and deterministic CV fight analysis.
   */
  analyzeFight(
    request?: FightAnalysisRequest
  ): Promise<FightObservationResult>;
}

