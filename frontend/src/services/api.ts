import {
  CalibrationStatus,
  type CalibrationResponse,
  type IApiService,
} from '../types/calibration.ts';
import { mockApiService } from './mockApi.ts';

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

    const poll = async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/calibration/status`);
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        const data: CalibrationResponse = await res.json();
        if (!isCancelled) {
          onUpdate(data);
        }
      } catch {
        if (!isCancelled) {
          onUpdate({
            status: CalibrationStatus.DETECTING,
            person_detected: false,
          });
        }
      }
    };

    poll();
    const interval = setInterval(poll, 500);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }

  async getCalibrationStatus(): Promise<CalibrationResponse> {
    const res = await fetch(`${this.baseUrl}/api/calibration/status`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
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
