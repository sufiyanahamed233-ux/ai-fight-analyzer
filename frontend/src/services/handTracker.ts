import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

/**
 * Normalised wrist/anchor coordinates in the range [0, 1].
 *
 * x = 0 is the LEFT edge of the raw un-mirrored camera frame.
 * y = 0 is the TOP edge.
 */
export interface WristCoords {
  /** Normalised [0..1] horizontal position in the un-mirrored camera frame. */
  x: number;
  /** Normalised [0..1] vertical position. */
  y: number;
}

/**
 * Tracked glove data for a single hand including position, orientation, and scale.
 */
export interface GloveData {
  /** Normalised anchor position (centered over hand / fist). */
  norm: WristCoords;
  /**
   * Rotation angle in degrees derived from the wrist->knuckles vector,
   * accounting for the mirrored display.
   * 0 = pointing up, positive = clockwise on screen.
   */
  angleDeg: number;
  /**
   * Hand span in canvas pixels (wrist to knuckle distance),
   * providing a scale signal for depth / distance from camera.
   */
  handSpanPx: number;
}

export interface TrackedWrists {
  left: GloveData | null;
  right: GloveData | null;
}

/** Local and CDN paths for MediaPipe Vision WASM assets */
const LOCAL_WASM_PATH = '/wasm';
const CDN_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm';

const LOCAL_MODEL_PATH = '/models/hand_landmarker.task';
const CDN_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function createHandLandmarker(): Promise<HandLandmarker> {
  // Try local offline WASM assets first, fallback to CDN
  let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
  try {
    vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_PATH);
  } catch (localWasmErr) {
    console.warn('Local WASM init failed, falling back to CDN WASM:', localWasmErr);
    vision = await FilesetResolver.forVisionTasks(CDN_WASM_PATH);
  }

  const createWithOptions = async (modelPath: string, delegate: 'GPU' | 'CPU') => {
    return HandLandmarker.createFromOptions(vision!, {
      baseOptions: {
        modelAssetPath: modelPath,
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  };

  const attempts: Array<{ path: string; delegate: 'GPU' | 'CPU'; desc: string }> = [
    { path: LOCAL_MODEL_PATH, delegate: 'GPU', desc: 'Local model with GPU' },
    { path: LOCAL_MODEL_PATH, delegate: 'CPU', desc: 'Local model with CPU' },
    { path: CDN_MODEL_PATH,   delegate: 'GPU', desc: 'CDN model with GPU' },
    { path: CDN_MODEL_PATH,   delegate: 'CPU', desc: 'CDN model with CPU' },
  ];

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const landmarker = await createWithOptions(attempt.path, attempt.delegate);
      return landmarker;
    } catch (err) {
      lastError = err;
      console.warn(`MediaPipe init attempt failed (${attempt.desc}):`, err);
    }
  }

  throw new Error(
    `Failed to initialize MediaPipe HandLandmarker after all fallback attempts: ${String(lastError)}`
  );
}

export function normToCanvas(
  norm: WristCoords,
  canvasWidth: number,
  canvasHeight: number,
  videoWidth?: number,
  videoHeight?: number,
): { cx: number; cy: number } {
  if (!videoWidth || !videoHeight) {
    return {
      cx: (1 - norm.x) * canvasWidth,
      cy: norm.y * canvasHeight,
    };
  }

  const scale = Math.max(canvasWidth / videoWidth, canvasHeight / videoHeight);
  const displayedW = videoWidth * scale;
  const displayedH = videoHeight * scale;
  const offsetX = (canvasWidth - displayedW) / 2;
  const offsetY = (canvasHeight - displayedH) / 2;

  return {
    cx: (1 - norm.x) * displayedW + offsetX,
    cy: norm.y * displayedH + offsetY,
  };
}

export function extractWristCoordinates(
  results: HandLandmarkerResult,
  canvasWidth: number,
  canvasHeight: number,
  videoWidth: number,
  videoHeight: number,
): TrackedWrists {
  if (!results.landmarks || results.landmarks.length === 0) {
    return { left: null, right: null };
  }

  interface Candidate {
    norm: WristCoords;
    angleDeg: number;
    handSpanPx: number;
    leftScore: number;
    canvasX: number;
  }

  const candidates: Candidate[] = [];

  for (let i = 0; i < results.landmarks.length; i++) {
    const landmarks = results.landmarks[i];
    if (!landmarks || landmarks.length === 0) continue;

    const wrist = landmarks[0];
    const indexMcp = landmarks[5] ?? wrist;
    const middleMcp = landmarks[9] ?? wrist;
    const ringMcp = landmarks[13] ?? wrist;
    const pinkyMcp = landmarks[17] ?? wrist;

    // Center of knuckle bridge
    const knuckleX = (indexMcp.x + middleMcp.x * 2 + ringMcp.x + pinkyMcp.x) / 5;
    const knuckleY = (indexMcp.y + middleMcp.y * 2 + ringMcp.y + pinkyMcp.y) / 5;

    // Anchor positioned directly over participant's hand/fist
    const anchorNorm: WristCoords = {
      x: wrist.x * 0.35 + knuckleX * 0.65,
      y: wrist.y * 0.35 + knuckleY * 0.65,
    };

    const wristCanvas = normToCanvas(
      { x: wrist.x, y: wrist.y },
      canvasWidth, canvasHeight, videoWidth, videoHeight
    );
    const knuckleCanvas = normToCanvas(
      { x: knuckleX, y: knuckleY },
      canvasWidth, canvasHeight, videoWidth, videoHeight
    );
    const indexMcpCanvas = normToCanvas(
      { x: indexMcp.x, y: indexMcp.y },
      canvasWidth, canvasHeight, videoWidth, videoHeight
    );
    const pinkyMcpCanvas = normToCanvas(
      { x: pinkyMcp.x, y: pinkyMcp.y },
      canvasWidth, canvasHeight, videoWidth, videoHeight
    );

    // Orientation angle from wrist to knuckles
    const dx = knuckleCanvas.cx - wristCanvas.cx;
    const dy = knuckleCanvas.cy - wristCanvas.cy;
    const angleDeg = Math.atan2(dx, -dy) * (180 / Math.PI);

    // Scale signal from physical skeletal dimensions (invariant to fist/open hand)
    const handLengthPx = Math.hypot(dx, dy);
    const handWidthPx = Math.hypot(
      pinkyMcpCanvas.cx - indexMcpCanvas.cx,
      pinkyMcpCanvas.cy - indexMcpCanvas.cy
    );
    const handSpanPx = Math.max(handLengthPx, handWidthPx * 1.25);

    const { cx } = normToCanvas(anchorNorm, canvasWidth, canvasHeight, videoWidth, videoHeight);

    const handednessCategory = results.handedness?.[i]?.[0];
    const rawLabel = handednessCategory?.categoryName;
    const confidence = handednessCategory?.score ?? 0.8;

    let modelEvidence = 0;
    if (rawLabel === 'Right') {
      modelEvidence = confidence;
    } else if (rawLabel === 'Left') {
      modelEvidence = -confidence;
    }

    const normCanvasX = canvasWidth > 0 ? cx / canvasWidth : 0.5;
    const positionEvidence = (0.5 - normCanvasX) * 2;

    const leftScore = modelEvidence * 1.2 + positionEvidence * 0.8;

    candidates.push({
      norm: anchorNorm,
      angleDeg,
      handSpanPx,
      leftScore,
      canvasX: cx,
    });
  }

  if (candidates.length === 0) {
    return { left: null, right: null };
  }

  if (candidates.length === 1) {
    const single = candidates[0];
    const glove: GloveData = {
      norm: single.norm,
      angleDeg: single.angleDeg,
      handSpanPx: single.handSpanPx,
    };
    if (single.leftScore >= 0) {
      return { left: glove, right: null };
    } else {
      return { left: null, right: glove };
    }
  }

  candidates.sort((a, b) => b.leftScore - a.leftScore);

  let leftCandidate = candidates[0];
  let rightCandidate = candidates[1];

  if (Math.abs(leftCandidate.leftScore - rightCandidate.leftScore) < 0.2) {
    if (leftCandidate.canvasX > rightCandidate.canvasX) {
      const temp = leftCandidate;
      leftCandidate = rightCandidate;
      rightCandidate = temp;
    }
  }

  return {
    left: {
      norm: leftCandidate.norm,
      angleDeg: leftCandidate.angleDeg,
      handSpanPx: leftCandidate.handSpanPx,
    },
    right: {
      norm: rightCandidate.norm,
      angleDeg: rightCandidate.angleDeg,
      handSpanPx: rightCandidate.handSpanPx,
    },
  };
}
