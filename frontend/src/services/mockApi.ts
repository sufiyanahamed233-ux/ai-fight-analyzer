import {
  CalibrationStatus,
  type CalibrationResponse,
  type IApiService,
} from '../types/calibration.ts';

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
};
