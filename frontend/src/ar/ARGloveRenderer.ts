/**
 * ARGloveRenderer.ts
 *
 * Three.js WebGL AR renderer for virtual boxing gloves using a realistic GLB model.
 *
 * ARCHITECTURE
 * ────────────
 * - One WebGLRenderer (transparent canvas, overlaid on the camera video).
 * - One PerspectiveCamera that maps to screen space.
 * - One scene with left and right glove instances created from /assets/models/boxing_glove.glb.
 * - Extracts "Boxing Glove.002" from the GLB (avoiding the 4 LOD/showroom layout).
 * - MediaPipe hand poses drive glove position + rotation + scale every frame.
 * - RELATIVE orientation: on first stable frame per hand, a neutral quaternion is
 *   captured; subsequent frames compute relativeQuat = inverse(neutral) * current,
 *   giving a wearable try-on feel that tracks natural hand rotation.
 * - Velocity-adaptive exponential smoothing prevents jitter without adding lag.
 * - Gloves remain hidden until the asynchronous GLTF load completes successfully.
 * - Disposes geometries, materials, and textures cleanly upon cleanup.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HandPose } from './handPoseEstimator';

// ────────────────────────────────────────────────────────────────────────────
// Smoothed hand state
// ────────────────────────────────────────────────────────────────────────────

interface GloveState {
  // Normalised anchor [0..1] in mirrored display space
  anchorX: number;
  anchorY: number;

  // Predicted 3D depth Z in Three.js world units
  anchorZ: number;

  // 3D orientation quaternion (smoothed and target)
  // Holds the RELATIVE rotation from neutral pose.
  quat: THREE.Quaternion;
  targetQuat: THREE.Quaternion;

  // Scale factor (palm width in normalised units, smoothed)
  scale: number;

  // Visibility
  visible: boolean;
  lastSeenMs: number;

  // Wearable calibration: neutral quaternion captured on first visible frame.
  // relativeQuat = inverse(neutralQuat) * rawQuat
  neutralQuat: THREE.Quaternion;
  isCalibrated: boolean;

  // ── Motion prediction ────────────────────────────────────────────
  // Previous raw (unsmoothed) pose values for velocity estimation.
  prevRawX:       number;   // anchorNorm.x from previous frame
  prevRawY:       number;   // anchorNorm.y from previous frame
  prevPalmWidth:  number;   // palmWidthNorm from previous frame
  prevPoseTimeMs: number;   // performance.now() when previous frame arrived
  // Estimated velocity (normalised-units per millisecond)
  velX:          number;
  velY:          number;
  velPalmWidth:  number;
}

function makeInitialState(x: number, y: number): GloveState {
  return {
    anchorX: x,
    anchorY: y,
    anchorZ: 0,
    quat: new THREE.Quaternion(),
    targetQuat: new THREE.Quaternion(),
    scale: 1,
    visible: false,
    lastSeenMs: 0,
    neutralQuat: new THREE.Quaternion(),
    isCalibrated: false,
    // prediction
    prevRawX:       x,
    prevRawY:       0.5,
    prevPalmWidth:  0.10,
    prevPoseTimeMs: 0,
    velX:           0,
    velY:           0,
    velPalmWidth:   0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Lerp helpers
// ────────────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Traverse the loaded GLB scene and select the boxing glove mesh.
 *
 * The GLB contains 5 mesh nodes named "Boxing Glove.NNN_Glove Material_0"
 * (LOD variants). The node parent groups are "Boxing Glove.NNN" but the
 * actual THREE.Mesh objects carry the full "_Glove Material_0" suffix.
 *
 * Target: "Boxing Glove.002_Glove Material_0" (8 128 vertices, mid-LOD).
 *
 * Fallback strategy (in order):
 *   1. Exact name match on "Boxing Glove.002_Glove Material_0"
 *   2. First mesh whose name includes "Boxing Glove.002"
 *   3. Mesh with vertex count closest to 8 128
 *   4. First mesh found
 */
function findBoxingGloveMesh(scene: THREE.Object3D): THREE.Mesh | null {
  const TARGET_NAME = 'Boxing Glove.002_Glove Material_0';
  const TARGET_VERTS = 8128;

  const allMeshes: THREE.Mesh[] = [];
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      allMeshes.push(obj as THREE.Mesh);
    }
  });

  if (allMeshes.length === 0) return null;

  // Log every mesh so future name changes are visible in the console
  console.info(
    '[ARGlove] GLB mesh inventory:\n' +
    allMeshes.map((m) => {
      const verts = (m.geometry?.attributes?.position?.count ?? '?');
      return `  • "${m.name}" — ${verts} vertices`;
    }).join('\n')
  );

  // 1. Exact name
  let found = allMeshes.find((m) => m.name === TARGET_NAME) ?? null;
  if (found) {
    console.info(`[ARGlove] Selected glove mesh (exact): "${found.name}"`);
    return found;
  }

  // 2. Partial name includes "Boxing Glove.002"
  found = allMeshes.find((m) => m.name.includes('Boxing Glove.002')) ?? null;
  if (found) {
    console.info(`[ARGlove] Selected glove mesh (partial name): "${found.name}"`);
    return found;
  }

  // 3. Closest vertex count to TARGET_VERTS
  let best: THREE.Mesh | null = null;
  let bestDiff = Infinity;
  for (const m of allMeshes) {
    const verts = m.geometry?.attributes?.position?.count ?? 0;
    const diff = Math.abs(verts - TARGET_VERTS);
    if (diff < bestDiff) { bestDiff = diff; best = m; }
  }
  if (best) {
    console.info(`[ARGlove] Selected glove mesh (vertex count ~${TARGET_VERTS}): "${best.name}"`);
    return best;
  }

  // 4. First mesh
  console.info(`[ARGlove] Selected glove mesh (first available): "${allMeshes[0].name}"`);
  return allMeshes[0];
}


// ────────────────────────────────────────────────────────────────────────────
// ARGloveRenderer class
// ────────────────────────────────────────────────────────────────────────────

export class ARGloveRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Per-hand objects
  private leftGlove: THREE.Group;
  private rightGlove: THREE.Group;
  private leftState: GloveState;
  private rightState: GloveState;

  // Canvas info
  private width: number = 1;
  private height: number = 1;

  // Loading state & error handler
  private isLoaded: boolean = false;
  private onLoadError?: (err: Error) => void;

  // GLB model-local base correction quaternion (180° around Y).
  // Applied as: finalQuat = glbBaseQuat * relativeHandQuat
  private readonly glbBaseQuat: THREE.Quaternion;

  // TEMP DIAGNOSTICS — throttle per hand (remove after physical verification)
  private diagLastLogMs: { left: number; right: number } = { left: 0, right: 0 };
  private diagMeshConfirmed: { left: boolean; right: boolean } = { left: false, right: false };

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, onLoadError?: (err: Error) => void) {
    this.onLoadError = onLoadError;
    this.width = canvas.offsetWidth || 1280;
    this.height = canvas.offsetHeight || 720;

    // Pre-compute the GLB model-local base correction (180° around Y).
    // This keeps knuckles facing the camera (+Z) in Three.js world space.
    this.glbBaseQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));

    // ── Renderer ────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true, // transparent background (shows camera feed below)
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 0); // fully transparent clear
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── Scene ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Lighting ─────────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambient);

    // Key light – upper left (participant perspective)
    const keyLight = new THREE.DirectionalLight(0xfff5e8, 1.9);
    keyLight.position.set(-3, 5, 4);
    this.scene.add(keyLight);

    // Fill light – softer, lower right
    const fillLight = new THREE.DirectionalLight(0xe0eeff, 0.75);
    fillLight.position.set(3, -1, 3);
    this.scene.add(fillLight);

    // Rim light – subtle highlight from behind for contour depth
    const rimLight = new THREE.PointLight(0xff6666, 0.45, 12);
    rimLight.position.set(0, 2, -5);
    this.scene.add(rimLight);

    // Hemisphere light for natural ambient gradation
    const hemi = new THREE.HemisphereLight(0x445577, 0x221100, 0.35);
    this.scene.add(hemi);

    // ── Camera ──────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    // ── Glove parent groups ──────────────────────────────────────────────────
    this.leftGlove = new THREE.Group();
    this.rightGlove = new THREE.Group();
    this.leftGlove.visible = false;
    this.rightGlove.visible = false;
    this.scene.add(this.leftGlove);
    this.scene.add(this.rightGlove);

    this.leftState = makeInitialState(0.30, 0.55);
    this.rightState = makeInitialState(0.70, 0.55);

    // ── Asynchronously load realistic GLB boxing glove ──────────────────────
    this.loadGLBModel();
  }

  private loadGLBModel(): void {
    const loader = new GLTFLoader();
    loader.load(
      '/assets/models/boxing_glove.glb',
      (gltf) => {
        if (this.disposed) {
          this.disposeHierarchy(gltf.scene);
          return;
        }

        // Select the target mesh (robust 4-tier fallback — see findBoxingGloveMesh)
        const targetMesh = findBoxingGloveMesh(gltf.scene);
        if (!targetMesh) {
          const err = new Error('No meshes found in GLB — file may be corrupt or empty');
          console.warn('[ARGlove]', err);
          this.onLoadError?.(err);
          return;
        }

        // Calculate geometry bounds to normalize scale and center pivot
        const geom = targetMesh.geometry;
        geom.computeBoundingBox();
        const bbox = geom.boundingBox ?? new THREE.Box3();
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const center = new THREE.Vector3();
        bbox.getCenter(center);

        // Normalize height to 1.0 world unit (matching procedural glove height)
        const baseScale = size.y > 0 ? 1.0 / size.y : 0.001;

        // Ensure materials are DoubleSide for clean reflection rendering
        const mats = Array.isArray(targetMesh.material) ? targetMesh.material : [targetMesh.material];
        for (const m of mats) {
          if (m) {
            m.side = THREE.DoubleSide;
            m.needsUpdate = true;
          }
        }

        const createInstance = () => {
          const container = new THREE.Group();
          const mesh = targetMesh.clone();

          if (Array.isArray(targetMesh.material)) {
            mesh.material = (targetMesh.material as THREE.Material[]).map((mat: THREE.Material) => mat.clone());
          } else if (targetMesh.material) {
            mesh.material = targetMesh.material.clone();
          }

          // Center geometry at origin (0, 0, 0)
          mesh.position.set(-center.x, -center.y, -center.z);
          container.add(mesh);

          // 1. Scale down from model millimeter space (~1000) to unit space (~1.0).
          // 2. The native GLB is a left glove. We flip X (-baseScale) so the base
          //    template is a right glove. applyStateToMesh then scales rightGlove with +clampedScale (right glove)
          //    and mirrors leftGlove with -clampedScale (left glove).
          container.scale.set(-baseScale, baseScale, baseScale);

          // NOTE: The 180° Y rotation is now composed into applyStateToMesh via
          // glbBaseQuat, so we do NOT set container.rotation.y here.

          return container;
        };

        this.leftGlove.clear();
        this.rightGlove.clear();

        this.leftGlove.add(createInstance());
        this.rightGlove.add(createInstance());

        this.isLoaded = true;
        console.info('[ARGlove] 3D GLB boxing glove loaded successfully.');
      },
      undefined,
      (err) => {
        console.warn('[ARGlove] Failed to load 3D GLB boxing glove:', err);
        this.onLoadError?.(err instanceof Error ? err : new Error(String(err)));
      }
    );
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  resize(width: number, height: number): void {
    if (this.disposed) return;
    if (width === this.width && height === this.height) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  // ── Update from hand poses ────────────────────────────────────────────────

  /**
   * Feed new hand poses from MediaPipe.
   * Call every frame *before* render().
   */
  update(left: HandPose | null, right: HandPose | null, nowMs: number): void {
    if (this.disposed) return;

    this.updateGloveState(this.leftState, left, nowMs);
    this.updateGloveState(this.rightState, right, nowMs);
    this.applyStateToMesh(this.leftState, this.leftGlove);
    this.applyStateToMesh(this.rightState, this.rightGlove);
  }

  /** Apply smoothed state to a Three.js glove Group. */
  private applyStateToMesh(state: GloveState, group: THREE.Group): void {
    const hiddenMs = performance.now() - state.lastSeenMs;
    const visible = this.isLoaded && state.visible && hiddenMs < 500;
    group.visible = visible;

    if (!visible) return;

    // Convert anchor norm [0..1] → world coords
    const worldPos = this.normToWorld(state.anchorX, state.anchorY);
    group.position.set(worldPos.x, worldPos.y, state.anchorZ);

    // Compose final orientation:
    //   glbBaseQuat  = 180° Y rotation (knuckle-forward model correction)
    //   state.quat   = smoothed relative hand rotation from neutral pose
    // Result: glove starts knuckle-forward, then follows the hand's actual movement.
    const finalQuat = this.glbBaseQuat.clone().multiply(state.quat);
    group.quaternion.copy(finalQuat);

    // ── TEMP DIAGNOSTIC: one-shot mesh confirmation (remove after physical verification) ──
    const meshSide: 'left' | 'right' = (group === this.leftGlove) ? 'left' : 'right';
    if (!this.diagMeshConfirmed[meshSide]) {
      this.diagMeshConfirmed[meshSide] = true;
      console.log(
        `[REL-ROT][${meshSide.toUpperCase()}] Boxing Glove.002 mesh IS visible. ` +
        `finalQuat applied: (${finalQuat.x.toFixed(3)},${finalQuat.y.toFixed(3)},${finalQuat.z.toFixed(3)},w=${finalQuat.w.toFixed(3)})`
      );
    }
    // ── END TEMP DIAGNOSTIC ───────────────────────────────────────────────────

    // ── WEARABLE SCALE ────────────────────────────────────────────────────────
    //
    // GLB model after normalization (baseScale = 1/1006.76 mm):
    //   normalizedHeight = 1.0 wu
    //   normalizedWidth  = 0.5984 wu   (measured from GLB bounding box)
    //
    // Camera: FOV=60°, Z=5
    //   verticalWorldSpan   = 2 × tan(30°) × 5     = 5.774 wu
    //   horizontalWorldSpan = verticalWorldSpan × aspect
    //
    // palmWidthNorm is a horizontal measurement → must use horizontal span:
    //   palmWidthWorld = palmWidthNorm × horizontalWorldSpan
    //
    // A real boxing glove knuckle-box is ~1.40× the bare palm width.
    //   targetGloveWidthWorld = palmWidthWorld × 1.40
    //
    // worldScale = targetGloveWidthWorld / normalizedGloveWidth
    //            = palmWidthNorm × horizontalWorldSpan × 1.40 / 0.5984
    //
    // Clamp: [0.55, 6.0] — lower bound allows distant hands to shrink naturally.
    const NORM_GLOVE_WIDTH  = 0.5984; // measured from GLB bounding box (W/H)
    const GLOVE_MULT        = 1.40;   // glove knuckle-box ≈ 1.40× bare palm
    const aspect            = this.width > 0 && this.height > 0 ? this.width / this.height : 16 / 9;
    const vertSpan          = 2 * Math.tan((60 * Math.PI / 180) / 2) * 5; // 5.774 wu
    const horizSpan         = vertSpan * aspect;
    const worldScale        = state.scale * horizSpan * GLOVE_MULT / NORM_GLOVE_WIDTH;
    const clampedScale      = Math.min(6.0, Math.max(0.55, worldScale));
    group.scale.set(clampedScale, clampedScale, clampedScale);

    // Re-mirror left glove after uniform scale
    if (group === this.leftGlove) {
      group.scale.x = -clampedScale;
    }
  }

  /**
   * Smooth incoming HandPose into GloveState with velocity-adaptive lerp and quaternion slerp.
   *
   * WEARABLE RELATIVE ORIENTATION
   * ──────────────────────────────
   * On the first visible frame, the raw hand quaternion is stored as neutralQuat.
   * For every subsequent frame:
   *   relativeQuat = inverse(neutralQuat) * rawQuat
   * This quaternion represents ONLY the change from the initial pose.
   * The result is stored in state.quat (smoothed) and applied in applyStateToMesh
   * composed with the GLB model-local base correction.
   */
  private updateGloveState(state: GloveState, pose: HandPose | null, nowMs: number): void {
    if (pose === null) {
      // Don't instantly hide – let the mesh linger 500ms (handled in applyStateToMesh)
      return;
    }

    const rawTargetX = pose.anchorNorm.x;
    const rawTargetY = pose.anchorNorm.y;
    const rawPalmWidth = pose.palmWidthNorm;

    // Raw quaternion from the hand pose estimator
    const rawQuat = new THREE.Quaternion(pose.quat.x, pose.quat.y, pose.quat.z, pose.quat.w);

    if (!state.visible) {
      // ── First frame for this hand ──────────────────────────────────────────
      // Snap position and scale immediately (no lerp).
      state.anchorX = rawTargetX;
      state.anchorY = rawTargetY;
      state.anchorZ = 0;
      state.scale = rawPalmWidth;
      state.visible = true;

      state.prevRawX = rawTargetX;
      state.prevRawY = rawTargetY;
      state.prevPalmWidth = rawPalmWidth;
      state.prevPoseTimeMs = nowMs;
      state.velX = 0;
      state.velY = 0;
      state.velPalmWidth = 0;

      // Calibrate: store neutral orientation for this hand.
      state.neutralQuat.copy(rawQuat);
      state.isCalibrated = true;

      // At calibration, relative rotation = identity → glove points knuckle-forward.
      state.quat.identity();
      state.targetQuat.identity();

    } else {
      // ── Subsequent frames ──────────────────────────────────────────────────

      // ── Velocity estimation ─────────────────────────────────────────────
      const dtMs = nowMs - state.prevPoseTimeMs;
      if (dtMs > 5 && dtMs < 200) {
        const rawVelX = (rawTargetX - state.prevRawX) / dtMs;
        const rawVelY = (rawTargetY - state.prevRawY) / dtMs;
        const rawVelPW = (rawPalmWidth - state.prevPalmWidth) / dtMs;

        state.velX = lerp(state.velX, rawVelX, 0.6);
        state.velY = lerp(state.velY, rawVelY, 0.6);
        state.velPalmWidth = lerp(state.velPalmWidth, rawVelPW, 0.6);
      } else {
        state.velX = 0;
        state.velY = 0;
        state.velPalmWidth = 0;
      }

      state.prevRawX = rawTargetX;
      state.prevRawY = rawTargetY;
      state.prevPalmWidth = rawPalmWidth;
      state.prevPoseTimeMs = nowMs;

      // ── Motion metrics & Fast-motion detection ───────────────────────────
      const posSpeed = Math.hypot(state.velX, state.velY); // norm/ms
      const pwSpeed = Math.abs(state.velPalmWidth);         // norm/ms

      // Normalized speed metric (0 at rest, ~1.0 for fast punch)
      const speedMetric = Math.min(1.5, Math.max(0, posSpeed * 2000.0 + pwSpeed * 4000.0));

      // Adaptive prediction horizon (0ms when static, 30-40ms fast, max 60ms)
      let predictionMs = 0;
      if (speedMetric > 0.15) {
        predictionMs = Math.min(60, 25 + speedMetric * 25.0);
      }

      // Predicted targets
      let targetX = rawTargetX;
      let targetY = rawTargetY;
      let targetPalmWidth = rawPalmWidth;
      let rawPredictedZ = 0;

      if (predictionMs > 0) {
        targetX += state.velX * predictionMs;
        targetY += state.velY * predictionMs;
        targetPalmWidth = Math.max(0.01, targetPalmWidth + state.velPalmWidth * predictionMs);

        // Z-depth prediction: forward punch pushes glove forward in world Z space
        const aspect = this.width > 0 && this.height > 0 ? this.width / this.height : 16 / 9;
        const horizSpan = 2 * Math.tan((60 * Math.PI / 180) / 2) * 5 * aspect;
        rawPredictedZ = Math.min(1.2, Math.max(-0.5, state.velPalmWidth * predictionMs * horizSpan * 0.8));
      }

      // ── FAST-MOTION ADAPTIVE ALPHAS ──────────────────────────────────────
      // For slow motion: pos 0.70, rot 0.35, scale 0.55
      // For fast motion: pos 0.95-1.0, rot 0.95-1.0, scale 0.90-1.0
      const dx = targetX - state.anchorX;
      const dy = targetY - state.anchorY;
      const dist = Math.hypot(dx, dy);

      const posAlpha   = Math.min(1.0, Math.max(0.70, 0.70 + dist * 35.0 + speedMetric * 0.30));

      const relativeQuat = state.neutralQuat.clone().invert().multiply(rawQuat);
      state.targetQuat.copy(relativeQuat);

      const angle = state.quat.angleTo(state.targetQuat);
      const rotAlpha   = Math.min(1.0, Math.max(0.35, 0.35 + angle * 2.5 + speedMetric * 0.60));

      const scaleDelta = Math.abs(targetPalmWidth - state.scale);
      const scaleAlpha = Math.min(1.0, Math.max(0.55, 0.55 + scaleDelta * 30.0 + speedMetric * 0.40));

      // Apply state updates
      state.anchorX = lerp(state.anchorX, targetX, posAlpha);
      state.anchorY = lerp(state.anchorY, targetY, posAlpha);
      state.anchorZ = lerp(state.anchorZ, rawPredictedZ, posAlpha);
      state.quat.slerp(state.targetQuat, rotAlpha);
      state.scale = lerp(state.scale, targetPalmWidth, scaleAlpha);

      // ── Diagnostics [AR-FINAL] (throttled 500ms) ────────────────────────
      const diagKey = pose.side as 'left' | 'right';
      if (nowMs - this.diagLastLogMs[diagKey] > 500) {
        this.diagLastLogMs[diagKey] = nowMs;
        const totalPoseAgeMs = performance.now() - nowMs;
        console.log(
          `[AR-FINAL][${pose.side.toUpperCase()}] ` +
          `totalPoseAgeMs=${totalPoseAgeMs.toFixed(1)}ms ` +
          `speed=${speedMetric.toFixed(2)} ` +
          `predictionMs=${predictionMs.toFixed(1)}ms ` +
          `posAlpha=${posAlpha.toFixed(2)} ` +
          `scaleAlpha=${scaleAlpha.toFixed(2)} ` +
          `rotAlpha=${rotAlpha.toFixed(2)}`
        );
      }
    }

    state.lastSeenMs = nowMs;
  }

  // ── World coordinate mapping ──────────────────────────────────────────────

  /**
   * Convert normalised [0..1] screen position (in the mirrored display frame)
   * to Three.js world coordinates at a fixed Z=0 plane.
   */
  private normToWorld(nx: number, ny: number): THREE.Vector3 {
    // NDC: x ∈ [-1, 1], y ∈ [-1, 1] (y is flipped from screen space)
    const ndcX = nx * 2 - 1;
    const ndcY = -(ny * 2 - 1);

    // Unproject from NDC at depth z=0 in clip space
    const aspect = this.width / this.height;
    const halfH = Math.tan(((60 * Math.PI) / 180) / 2) * 5; // tan(FOV/2) * camZ
    const halfW = halfH * aspect;

    return new THREE.Vector3(ndcX * halfW, ndcY * halfH, 0);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  private disposeHierarchy(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (!mat) continue;
          const stdMat = mat as THREE.MeshStandardMaterial;
          if (stdMat.map) stdMat.map.dispose();
          if (stdMat.normalMap) stdMat.normalMap.dispose();
          if (stdMat.roughnessMap) stdMat.roughnessMap.dispose();
          if (stdMat.metalnessMap) stdMat.metalnessMap.dispose();
          if (stdMat.aoMap) stdMat.aoMap.dispose();
          if (stdMat.emissiveMap) stdMat.emissiveMap.dispose();
          mat.dispose();
        }
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.disposeHierarchy(this.leftGlove);
    this.disposeHierarchy(this.rightGlove);
    this.disposeHierarchy(this.scene);

    this.renderer.dispose();
    this.renderer.forceContextLoss();

    this.scene.clear();
  }

  get isModelLoaded(): boolean {
    return this.isLoaded;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
