/**
 * handPoseEstimator.ts
 *
 * Extracts a stable 3D hand pose from MediaPipe HandLandmarker results.
 *
 * COORDINATE SYSTEM
 * -----------------
 * MediaPipe provides landmarks in [0..1] normalised space where:
 *   x: 0 = left edge of raw (un-mirrored) frame, 1 = right edge
 *   y: 0 = top edge, 1 = bottom edge
 *   z: rough depth estimate (smaller = closer to camera)
 *
 * The camera preview is CSS-mirrored (scaleX(-1)).
 * All x coordinates are therefore flipped for display purposes.
 *
 * ORIENTATION ESTIMATION
 * ----------------------
 * We build a local hand coordinate frame from:
 *   - Origin:  wrist (landmark 0)
 *   - Long axis (finger direction): wrist → middle-MCP centroid
 *   - Transverse axis (knuckle row): index-MCP → pinky-MCP
 *   - Normal (palm normal): cross product
 *
 * From these axes we derive Euler angles suitable for Three.js.
 *
 * LIMITATIONS
 * -----------
 * Monocular RGB depth (z) from MediaPipe is relative, not metric.
 * Pitch estimation (hand tipping toward/away camera) is limited.
 * We use a heuristic combining geometry ratios to infer pitch.
 */

import type { HandLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';

// ────────────────────────────────────────────────────────────────────────────
// Output types
// ────────────────────────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Full 3D hand pose for one glove.
 */
export interface HandPose {
  /**
   * Normalised anchor position [0..1] in the mirrored display frame.
   * x=0 is the left edge of the displayed (mirrored) image.
   */
  anchorNorm: { x: number; y: number };

  /**
   * 3D orientation quaternion representing the hand basis in Three.js coordinates.
   */
  quat: Quat;

  /**
   * Approximate hand span in normalised units (not pixels).
   * Used for perspective-corrected scale computation.
   */
  handSpanNorm: number;

  /**
   * Palm width: distance from index MCP (lm 5) to pinky MCP (lm 17)
   * in normalised [0..1] screen space. Primary signal for wearable glove sizing.
   * Typical range: 0.05 (far) – 0.20 (close).
   */
  palmWidthNorm: number;

  /** MediaPipe handedness label ('Left' or 'Right') on the participant's actual hand. */
  side: 'left' | 'right';

  /** Normalized longitudinal vector: wrist -> middle MCP. */
  longVector: Vec3;

  /** Normalized palm normal vector. */
  palmNormal: Vec3;
}

export interface TrackedPoses {
  left: HandPose | null;
  right: HandPose | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Vector math helpers (pure functions, no Three.js dependency)
// ────────────────────────────────────────────────────────────────────────────

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Converts a 3x3 orthonormal rotation matrix to a unit quaternion {x, y, z, w}.
 * Matrix elements are given row-by-row:
 *   [ m00 m01 m02 ]
 *   [ m10 m11 m12 ]
 *   [ m20 m21 m22 ]
 */
function basisToQuaternion(
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number
): Quat {
  const tr = m00 + m11 + m22;
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 1;

  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  const len = Math.hypot(x, y, z, w);
  if (len < 1e-9) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

/** Convert a NormalizedLandmark to Vec3 */
function lm(l: NormalizedLandmark): Vec3 {
  return { x: l.x, y: l.y, z: l.z ?? 0 };
}

// ────────────────────────────────────────────────────────────────────────────
// Pose extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extracts HandPose from all detected hands in a HandLandmarkerResult.
 *
 * Camera feed is horizontally mirrored, so the "left" hand on screen
 * maps to the participant's right hand, and vice versa. MediaPipe's
 * handedness label is in the camera (un-mirrored) frame, so we flip it.
 */
export function extractHandPoses(results: HandLandmarkerResult): TrackedPoses {
  if (!results.landmarks || results.landmarks.length === 0) {
    return { left: null, right: null };
  }

  const poses: HandPose[] = [];

  for (let i = 0; i < results.landmarks.length; i++) {
    const lms = results.landmarks[i];
    if (!lms || lms.length < 21) continue;

    // Key landmarks
    const wrist = lm(lms[0]);
    const indexMcp = lm(lms[5]);
    const middleMcp = lm(lms[9]);
    const ringMcp = lm(lms[13]);
    const pinkyMcp = lm(lms[17]);
    const pinkyTip = lm(lms[20]);
    void pinkyTip;

    // ── Build knuckle centroid & anchor ─────────────────────────────────────
    const knuckleCentroid: Vec3 = {
      x: (indexMcp.x + middleMcp.x * 2 + ringMcp.x + pinkyMcp.x) / 5,
      y: (indexMcp.y + middleMcp.y * 2 + ringMcp.y + pinkyMcp.y) / 5,
      z: (indexMcp.z + middleMcp.z * 2 + ringMcp.z + pinkyMcp.z) / 5,
    };

    // We want the glove cuff to be at the wrist and knuckles to cover the fist.
    const anchorNorm = {
      // Mirror x: display x = 1 - raw x
      x: 1 - (wrist.x * 0.35 + knuckleCentroid.x * 0.65),
      y: wrist.y * 0.35 + knuckleCentroid.y * 0.65,
    };

    // ── Hand span (normalised) ──────────────────────────────────────────────
    const wristToKnuckleDist = Math.hypot(
      knuckleCentroid.x - wrist.x,
      knuckleCentroid.y - wrist.y,
    );
    const knuckleWidth = Math.hypot(
      pinkyMcp.x - indexMcp.x,
      pinkyMcp.y - indexMcp.y,
    );
    const handSpanNorm = Math.max(wristToKnuckleDist, knuckleWidth * 1.2);

    // ── Handedness ──────────────────────────────────────────────────────────
    // MediaPipe handedness is in the un-mirrored (camera) frame.
    // In mirrored display: MediaPipe "Right" = participant's LEFT hand
    const handednessRaw = results.handedness?.[i]?.[0]?.categoryName ?? 'Right';
    const side: 'left' | 'right' = handednessRaw === 'Right' ? 'left' : 'right';

    // ── Build stable 3D orthonormal hand basis ─────────────────────────────
    // Convert landmark displacements to mirrored display frame:
    // Raw camera: x right, y down, z depth into scene (smaller = closer).
    // Mirrored display: x left-to-right (flipped), y up (+Y), z towards camera (+Z).
    // Scale monocular z by 2.5 to match visual scale with x/y.
    const depthScale = 2.5;
    const longVec: Vec3 = {
      x: -(middleMcp.x - wrist.x),
      y: -(middleMcp.y - wrist.y),
      z: -(middleMcp.z - wrist.z) * depthScale,
    };
    const longAxis = normalize3(longVec);

    // Transverse vector across knuckles:
    // For right hand: index MCP -> pinky MCP
    // For left hand: pinky MCP -> index MCP (matching mirrored GLB scale.x = -1)
    const transVec: Vec3 = side === 'right' ? {
      x: -(pinkyMcp.x - indexMcp.x),
      y: -(pinkyMcp.y - indexMcp.y),
      z: -(pinkyMcp.z - indexMcp.z) * depthScale,
    } : {
      x: -(indexMcp.x - pinkyMcp.x),
      y: -(indexMcp.y - pinkyMcp.y),
      z: -(indexMcp.z - pinkyMcp.z) * depthScale,
    };
    const transAxis = normalize3(transVec);

    // Palm normal: points toward camera (+Z)
    let palmNorm = cross3(transAxis, longAxis);
    const palmLen = Math.hypot(palmNorm.x, palmNorm.y, palmNorm.z);
    if (palmLen < 1e-9) {
      palmNorm = { x: 0, y: 0, z: 1 };
    } else {
      palmNorm = { x: palmNorm.x / palmLen, y: palmNorm.y / palmLen, z: palmNorm.z / palmLen };
    }

    // Right-handed orthonormal basis [bX, bY, bZ]:
    // bY = longAxis (forearm / fingers pointing up)
    // bZ = palmNorm (knuckles / palm facing forward toward camera)
    // bX = cross(bY, bZ) (transverse knuckle direction)
    const bY: Vec3 = longAxis;
    let bZ: Vec3 = palmNorm;
    let bX: Vec3 = normalize3(cross3(bY, bZ));
    bZ = normalize3(cross3(bX, bY));

    // Convert orthonormal 3x3 basis matrix to unit quaternion:
    // Matrix columns are bX, bY, bZ.
    const quat = basisToQuaternion(
      bX.x, bY.x, bZ.x,
      bX.y, bY.y, bZ.y,
      bX.z, bY.z, bZ.z,
    );

    poses.push({
      anchorNorm,
      quat,
      handSpanNorm,
      palmWidthNorm: knuckleWidth,
      side,
      longVector: longAxis,
      palmNormal: palmNorm,
    });
  }

  if (poses.length === 0) return { left: null, right: null };

  // Assign left/right by declared side
  if (poses.length === 1) {
    const p = poses[0];
    if (p.side === 'left') return { left: p, right: null };
    return { left: null, right: p };
  }

  // Two hands: pick the one with side='left' for left, side='right' for right.
  // If both claim the same side (unlikely but possible), use screen position.
  const leftPose = poses.find(p => p.side === 'left') ?? null;
  const rightPose = poses.find(p => p.side === 'right') ?? null;

  // If both claim the same side, split by x position
  if (leftPose && rightPose) {
    return { left: leftPose, right: rightPose };
  }

  // Both claimed same side — split by anchor x (left = lower x in mirrored space)
  const [a, b] = poses.sort((pa, pb) => pa.anchorNorm.x - pb.anchorNorm.x);
  return {
    left: { ...a, side: 'left' },
    right: { ...b, side: 'right' },
  };
}
