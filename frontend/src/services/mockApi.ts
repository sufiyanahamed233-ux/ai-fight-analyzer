import {
  CalibrationStatus,
  type CalibrationResponse,
  type IApiService,
} from '../types/calibration.ts';
import type {
  FightAnalysisRequest,
  FightObservationResult,
} from '../types/analysis.ts';

/**
 * MockApiService simulates the computer-vision / backend responses
 * during local frontend exhibition testing.
 */
export const mockApiService: IApiService = {
  subscribeCalibration(
    onUpdate: (data: CalibrationResponse) => void
  ): () => void {
    // 1. Immediately emit initial detecting state
    onUpdate({
      status: CalibrationStatus.DETECTING,
      person_detected: false,
    });

    // 2. Simulate person stepping into zone after 1s
    const personTimer = setTimeout(() => {
      onUpdate({
        status: CalibrationStatus.DETECTING,
        person_detected: true,
      });
    }, 1000);

    // 3. Simulate CV locking on and confirming ready after 2.4s
    const readyTimer = setTimeout(() => {
      onUpdate({
        status: CalibrationStatus.READY,
        person_detected: true,
      });
    }, 2400);

    // Cleanup timer subscriptions on unmount / transition
    return () => {
      clearTimeout(personTimer);
      clearTimeout(readyTimer);
    };
  },

  async getCalibrationStatus(): Promise<CalibrationResponse> {
    return {
      status: CalibrationStatus.READY,
      person_detected: true,
    };
  },

  async analyzeFight(
    _request?: FightAnalysisRequest
  ): Promise<FightObservationResult> {
    // Simulate telemetry processing duration
    await new Promise((resolve) => setTimeout(resolve, 1200));

    return {
      session_id: `mock-session-${Date.now()}`,
      overall_score: 7.8,
      stance: {
        category: 'stance',
        score: 8.2,
        observation:
          'Consistent athletic base maintained throughout combinations with stable shoulder-width spacing.',
        metrics_summary: { normalized_width: 1.45, stance_consistency: 0.88 },
      },
      balance: {
        category: 'balance',
        score: 7.5,
        observation:
          'Strong hip centering during directional changes; slight forward lean during flurry.',
        metrics_summary: { torso_hip_stability: 0.82, pose_stability: 0.79 },
      },
      guard: {
        category: 'guard',
        score: 7.9,
        observation:
          'Disciplined high-guard recovery after punching sequences, protecting chin level.',
        metrics_summary: { guard_ratio: 0.76, chin_protection_ratio: 0.82 },
      },
      striking: {
        category: 'striking',
        score: 8.4,
        observation:
          'Crisp hand velocity on straight punches with full extension and rapid retraction.',
        metrics_summary: { max_wrist_speed: 4.8, avg_extension_deg: 162 },
      },
      coordination: {
        category: 'coordination',
        score: 7.3,
        observation:
          'Smooth kinetic chain transfer from hip rotation into arm extension.',
        metrics_summary: { hip_shoulder_sync: 0.77 },
      },
      movement: {
        category: 'movement',
        score: 7.5,
        observation:
          'Active ring pacing with effective lateral displacement and upright posture.',
        metrics_summary: { total_displacement: 3.2, speed_mps: 0.65 },
      },
      disclaimer:
        'Heuristic movement observations for athletic training and fitness feedback only. ' +
        'Does not constitute professional judging, officiating, or combat readiness evaluation.',
    };
  },
};

