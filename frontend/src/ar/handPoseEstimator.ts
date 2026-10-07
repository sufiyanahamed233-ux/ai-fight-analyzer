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

/**
 * Full 3D-ish hand pose for one glove.
 */
export interface HandPose {
  /**
   * Normalised anchor position [0..1] in the mirrored display frame.
   * x=0 is the left edge of the displayed (mirrored) image.
   */
  anchorNorm: { x: number; y: number };

  /**
   * Euler angles in RADIANS for Three.js (XYZ order).
   *
   * rotX: pitch – hand tip toward / away from camera.
   * rotY: yaw   – hand rotates left / right around vertical axis.
   * rotZ: roll  – hand rolls clockwise / counter-clockwise in the image plane.
   */
  rotX: number;
  rotY: number;
  rotZ: number;

  /**
   * Approximate hand span in normalised units (not pixels).
   * Used for perspective-corrected scale computation.
   */
  handSpanNorm: number;

  /** MediaPipe handedness label ('Left' or 'Right') on the participant's actual hand. */
  side: 'left' | 'right';
}

export interface TrackedPoses {
  left: HandPose | null;
  right: HandPose | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Vector math helpers (pure functions, no Three.js dependency)
// ────────────────────────────────────────────────────────────────────────────

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

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
    if (!lms || lms.length < 18) continue;

    // Key landmarks
    const wrist = lm(lms[0]);
    const thumb1 = lm(lms[1]);
    const thumb4 = lm(lms[4]);
    const indexMcp = lm(lms[5]);
    const indexTip = lm(lms[8]);
    const middleMcp = lm(lms[9]);
    const ringMcp = lm(lms[13]);
    const pinkyMcp = lm(lms[17]);
    const pinkyTip = lm(lms[20]);

    // ── Build hand local frame ──────────────────────────────────────────────

    // Axis 1 (finger direction): wrist → knuckle centroid
    const knuckleCentroid: Vec3 = {
      x: (indexMcp.x + middleMcp.x * 2 + ringMcp.x + pinkyMcp.x) / 5,
      y: (indexMcp.y + middleMcp.y * 2 + ringMcp.y + pinkyMcp.y) / 5,
      z: (indexMcp.z + middleMcp.z * 2 + ringMcp.z + pinkyMcp.z) / 5,
    };
    const fingerAxis = normalize3(sub3(knuckleCentroid, wrist));

    // Axis 2 (transverse/knuckle row): index-MCP → pinky-MCP
    const transverseAxis = normalize3(sub3(pinkyMcp, indexMcp));

    // Axis 3 (palm normal): fingerAxis × transverseAxis
    let palmNormal = normalize3(cross3(fingerAxis, transverseAxis));

    // ── Compute Euler angles from the hand frame ────────────────────────────

    // ROLL (rotation around the finger axis – in-plane hand roll):
    // We project the transverse axis onto the XY plane to get the in-plane rotation.
    // MediaPipe x is mirrored, so negate x for display frame.
    const transDisplayX = -transverseAxis.x;
    const transDisplayY = -transverseAxis.y; // Y increases downward in image
    // Angle of knuckle row relative to horizontal
    const roll = Math.atan2(transDisplayY, transDisplayX); // radians

    // YAW (rotation around vertical screen axis):
    // Use the palm normal's x component. When hand faces camera, palmNormal.z ≈ 1.
    // When hand turns right (in mirror = participant turns their right fist away),
    // palmNormal.x changes.
    // Clamp to ±60° for stability.
    const yaw = Math.asin(Math.min(1, Math.max(-1, palmNormal.x)));

    // PITCH (hand tilting toward/away from camera):
    // Estimate using ratio of apparent hand height vs width.
    // When hand is horizontal (pitched forward), the wrist→knuckle vector
    // appears foreshortened. We can use the 3D z-depth difference.
    //
    // fingerAxis.z gives the z-slope of the hand. Negative = tips toward camera.
    // MediaPipe z is in palm-width units (roughly), negative = toward camera.
    const pitchRaw = Math.asin(Math.min(1, Math.max(-1, -fingerAxis.z * 3)));
    // Scale down pitch aggressively since monocular z is noisy
    const pitch = pitchRaw * 0.45;

    // ── Anchor position (in mirrored display space) ─────────────────────────

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
    // Because we CSS-mirror the display, Left and Right are swapped visually.
    // A person's LEFT hand appears on the RIGHT side of the mirrored preview.
    // MediaPipe calls it 'Left' (camera-left = participant left hand).
    // After mirroring, it's on the display-right. We keep the participant frame:
    const handednessRaw = results.handedness?.[i]?.[0]?.categoryName ?? 'Right';
    // In a mirrored camera: MediaPipe "Right" = participant's LEFT hand
    const side: 'left' | 'right' = handednessRaw === 'Right' ? 'left' : 'right';

    // Suppress linter warnings for landmarks extracted but only used for
    // the coordinate frame computation above (not all are directly referenced below)
    void thumb1; void thumb4; void indexTip; void pinkyTip; void palmNormal;

    poses.push({
      anchorNorm,
      rotX: pitch,
      rotY: -yaw, // negate for mirrored display
      rotZ: -roll, // negate: Three.js Z-rot is counter-clockwise
      handSpanNorm,
      side,
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
