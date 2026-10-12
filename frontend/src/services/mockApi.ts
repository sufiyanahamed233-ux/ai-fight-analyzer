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
    await new Promise((resolve) => setTimeout(resolve, 2200));

    // Generate genuinely random scores so different sessions reveal different fighters
    const rnd = (lo: number, hi: number) =>
      parseFloat((lo + Math.random() * (hi - lo)).toFixed(2));

    const stance = rnd(3.5, 9.8);
    const balance = rnd(3.5, 9.8);
    const guard = rnd(3.0, 9.5);
    const striking = rnd(3.5, 9.9);
    const coordination = rnd(3.0, 9.5);
    const movement = rnd(3.0, 9.5);

    const overall = parseFloat(
      (
        stance * 0.15 +
        balance * 0.20 +
        guard * 0.15 +
        striking * 0.25 +
        coordination * 0.15 +
        movement * 0.10
      ).toFixed(2)
    );

    const obsStance = (s: number) =>
      s >= 8
        ? 'Athletic, wide base maintained with consistent shoulder-width spacing.'
        : s >= 6
          ? 'Solid stance width with moderate consistency across the session.'
          : 'Narrow or inconsistent foot placement — widen and stabilise your base.';

    const obsBalance = (s: number) =>
      s >= 8
        ? 'Strong hip centering with minimal lateral lean during directional changes.'
        : s >= 6
          ? 'Generally balanced with occasional forward lean during combinations.'
          : 'Notable lateral drift — core stability and balance need improvement.';

    const obsGuard = (s: number) =>
      s >= 8
        ? 'Disciplined high-guard recovery after every punching sequence.'
        : s >= 6
          ? 'Guard returns to chin-level between most exchanges.'
          : 'Hands dropping after punches — guard discipline needs consistent work.';

    const obsStriking = (s: number) =>
      s >= 8
        ? 'Crisp hand velocity on straight punches with full extension and rapid retraction.'
        : s >= 6
          ? 'Decent punch speed with reasonable extension on combinations.'
          : 'Slow punch tempo — focus on snap and explosive extension.';

    const obsCoord = (s: number) =>
      s >= 8
        ? 'Excellent hip-to-shoulder kinetic chain, transferring power efficiently.'
        : s >= 6
          ? 'Good coordination with hip involvement on most combinations.'
          : 'Limited hip rotation — punches are arm-dominant without full body involvement.';

    const obsMovement = (s: number) =>
      s >= 8
        ? 'Active ring movement with effective lateral displacement and upright posture.'
        : s >= 6
          ? 'Moderate footwork with lateral pacing and regular position changes.'
          : 'Flat-footed throughout — prioritise active footwork and ring generalship.';

    return {
      session_id: `mock-session-${Date.now()}`,
      overall_score: overall,
      stance: {
        category: 'stance',
        score: stance,
        observation: obsStance(stance),
        metrics_summary: {
          normalized_width: rnd(0.8, 1.8),
          stance_consistency: rnd(0.5, 0.95),
        },
      },
      balance: {
        category: 'balance',
        score: balance,
        observation: obsBalance(balance),
        metrics_summary: {
          torso_hip_stability: rnd(0.5, 0.95),
          pose_stability: rnd(0.5, 0.9),
        },
      },
      guard: {
        category: 'guard',
        score: guard,
        observation: obsGuard(guard),
        metrics_summary: {
          guard_ratio: rnd(0.3, 0.9),
          chin_protection_ratio: rnd(0.5, 0.9),
        },
      },
      striking: {
        category: 'striking',
        score: striking,
        observation: obsStriking(striking),
        metrics_summary: {
          max_wrist_speed: rnd(1.5, 6.5),
          avg_extension_deg: rnd(130, 175),
        },
      },
      coordination: {
        category: 'coordination',
        score: coordination,
        observation: obsCoord(coordination),
        metrics_summary: { hip_shoulder_sync: rnd(0.4, 0.95) },
      },
      movement: {
        category: 'movement',
        score: movement,
        observation: obsMovement(movement),
        metrics_summary: {
          total_displacement: rnd(1.0, 5.0),
          speed_mps: rnd(0.3, 1.2),
        },
      },
      disclaimer:
        'Heuristic movement observations for athletic training and fitness feedback only. ' +
        'Does not constitute professional judging, officiating, or combat readiness evaluation.',
    };
  },
};

