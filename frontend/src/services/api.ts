import {
  CalibrationStatus,
  type CalibrationResponse,
  type IApiService,
} from '../types/calibration.ts';
import type {
  FightAnalysisRequest,
  FightObservationResult,
} from '../types/analysis.ts';
import { mockApiService } from './mockApi.ts';
import { checkPhone1StreamAvailable, PHONE1_STREAM_URL } from './camera.ts';

// Configurable backend configuration via Vite environment variables
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// Defaults to mock mode unless explicitly disabled (e.g. VITE_USE_MOCK_DATA=false)
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA !== 'false';

/**
 * Real API service communicating with the local computer-vision / backend server.
 * Will connect to the backend developer's HTTP/WebSocket endpoints in subsequent phases.
 */
class RealApiService implements IApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  subscribeCalibration(
    onUpdate: (data: CalibrationResponse) => void
  ): () => void {
    let isCancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isReady = false;

    const checkStream = async () => {
      if (isCancelled || isReady) return;

      try {
        const isAvailable = await checkPhone1StreamAvailable();
        if (isCancelled || isReady) return;

        if (isAvailable) {
          isReady = true;
          onUpdate({
            status: CalibrationStatus.READY,
            person_detected: true,
            device_label: 'Phone 1 (MJPEG Stream)',
          });
          return; // Stop polling once ready!
        } else {
          onUpdate({
            status: CalibrationStatus.DETECTING,
            person_detected: false,
            error: `Phone 1 stream offline at ${PHONE1_STREAM_URL}. Please ensure DroidCam is running.`,
          });
        }
      } catch (err: unknown) {
        if (!isCancelled && !isReady) {
          const message =
            err instanceof Error
              ? err.message
              : 'Failed to access Phone 1 stream.';
          onUpdate({
            status: CalibrationStatus.DETECTING,
            person_detected: false,
            error: message,
          });
        }
      }

      // Schedule next check sequentially after 1200ms
      if (!isCancelled && !isReady) {
        timerId = setTimeout(checkStream, 1200);
      }
    };

    void checkStream();

    return () => {
      isCancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }

  async getCalibrationStatus(): Promise<CalibrationResponse> {
    try {
      const isAvailable = await checkPhone1StreamAvailable();
      if (isAvailable) {
        return {
          status: CalibrationStatus.READY,
          person_detected: true,
          device_label: 'Phone 1 (MJPEG Stream)',
        };
      }
      return {
        status: CalibrationStatus.DETECTING,
        person_detected: false,
        error: `Phone 1 stream offline at ${PHONE1_STREAM_URL}.`,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Phone 1 stream unavailable.';
      return {
        status: CalibrationStatus.DETECTING,
        person_detected: false,
        error: message,
      };
    }
  }

  async analyzeFight(
    request?: FightAnalysisRequest
  ): Promise<FightObservationResult> {
    const duration = request?.duration_seconds ?? request?.duration ?? 10;
    const payload: Record<string, unknown> = {
      duration_seconds: duration,
      duration: duration,
    };
    if (request?.front_source) payload.front_source = request.front_source;
    if (request?.side_source) payload.side_source = request.side_source;

    const res = await fetch(`${this.baseUrl}/api/v1/fight/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let errorDetail = `HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        if (errorJson && typeof errorJson.detail === 'string') {
          errorDetail = errorJson.detail;
        } else if (errorJson && typeof errorJson.message === 'string') {
          errorDetail = errorJson.message;
        }
      } catch {
        if (res.statusText) {
          errorDetail = `${res.status} ${res.statusText}`;
        }
      }
      throw new Error(`Fight analysis failed: ${errorDetail}`);
    }

    return res.json();
  }
}

/**
 * Unified application API client.
 * Decouples the UI from whether mock data or the real local backend is running.
 */
export const apiService: IApiService = USE_MOCK_DATA
  ? mockApiService
  : new RealApiService(API_BASE_URL);

export { USE_MOCK_DATA, API_BASE_URL };
