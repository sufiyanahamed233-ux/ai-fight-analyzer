/**
 * Camera 1 Phone Stream service.
 *
 * Connects directly to the verified Phone 1 DroidCam MJPEG stream:
 * http://127.0.0.1:4747/video
 *
 * Avoids browser getUserMedia and the Windows virtual webcam placeholder.
 */

const rawBaseUrl =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const API_BASE_URL = rawBaseUrl.replace('localhost', '127.0.0.1');

export const FRONT_STREAM_URL =
  import.meta.env.VITE_FRONT_STREAM_URL || `${API_BASE_URL}/api/v1/stream/front`;

export const FRONT_STREAM_STATUS_URL =
  import.meta.env.VITE_FRONT_STREAM_STATUS_URL || `${API_BASE_URL}/api/v1/stream/front/status`;

// Legacy alias pointing to backend shared stream
export const PHONE1_STREAM_URL = FRONT_STREAM_URL;

/**
 * Checks if the shared front camera stream from the backend is available.
 * Queries the backend non-blocking status endpoint first, with Image probe fallback.
 */
export async function checkPhone1StreamAvailable(): Promise<boolean> {
  // 1. Fetch probe to backend status endpoint
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(FRONT_STREAM_STATUS_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      return Boolean(data.available);
    }
  } catch {
    // Fall back to Image probe on backend stream
  }

  // 2. Image element probe fallback on backend stream
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      resolve(false);
    }, 2500);

    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };

    img.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };

    img.src = `${FRONT_STREAM_URL}?_probe=${Date.now()}`;
  });
}
