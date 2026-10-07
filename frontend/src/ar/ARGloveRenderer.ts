/**
 * ARGloveRenderer.ts
 *
 * Three.js WebGL AR renderer for virtual boxing gloves.
 *
 * ARCHITECTURE
 * ────────────
 * - One WebGLRenderer (transparent canvas, overlaid on the camera video).
 * - One PerspectiveCamera that maps to screen space.
 * - One scene per hand (left + right), containing a procedural 3D boxing glove mesh.
 * - MediaPipe hand poses drive glove position + rotation + scale every frame.
 * - Velocity-adaptive exponential smoothing prevents jitter without adding lag.
 *
 * GLOVE GEOMETRY
 * ──────────────
 * Built procedurally from Three.js primitives (no external GLB required):
 *
 *   Main body    — CapsuleGeometry  (the main padding / knuckle dome)
 *   Knuckle pad  — SphereGeometry   (raised padded knuckle section)
 *   Thumb        — CapsuleGeometry  (thumb protrusion)
 *   Wrist cuff   — CylinderGeometry (cuff/cuff sleeve)
 *   Wrist strap  — TorusGeometry    (decorative strap band)
 *
 * Materials use MeshStandardMaterial (PBR: albedo, roughness, metalness)
 * which produces realistic leather-like shading under the scene lights.
 *
 * LIGHTING
 * ────────
 * - AmbientLight   : soft fill from all directions
 * - DirectionalLight (key): from upper-left, casts subtle shadow-like shading
 * - PointLight (fill): from lower-right, prevents pure black shadows
 * - HemisphereLight: sky/ground color split for environment tone
 *
 * COORDINATE MAPPING
 * ──────────────────
 * MediaPipe: x∈[0,1] left→right (raw/un-mirrored), y∈[0,1] top→bottom
 * Camera CSS: mirrored (scaleX(-1))
 * Hand pose estimator: already converts to mirrored display coords
 *
 * We map the normalised anchor [0..1] × [0..1] → NDC [-1..1] × [1..-1]
 * then unproject to Three.js world space at a fixed Z depth plane.
 *
 * RESOURCE MANAGEMENT
 * ───────────────────
 * Call dispose() when LIVE FIGHT ends.
 * All geometries, materials, lights, and the renderer are disposed.
 * The canvas element is removed from the DOM.
 */

import * as THREE from 'three';
import type { HandPose } from './handPoseEstimator';

// ────────────────────────────────────────────────────────────────────────────
// Smoothed hand state
// ────────────────────────────────────────────────────────────────────────────

interface GloveState {
  // Normalised anchor [0..1] in mirrored display space
  anchorX: number;
  anchorY: number;

  // Three.js Euler rotation (radians)
  rotX: number;
  rotY: number;
  rotZ: number;

  // Scale factor (world units)
  scale: number;

  // Visibility
  visible: boolean;
  lastSeenMs: number;
}

function makeInitialState(x: number, y: number): GloveState {
  return {
    anchorX: x, anchorY: y,
    rotX: 0, rotY: 0, rotZ: 0,
    scale: 1,
    visible: false,
    lastSeenMs: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Glove mesh builder
// ────────────────────────────────────────────────────────────────────────────

const GLOVE_RED         = new THREE.Color(0xcc1111);
const GLOVE_RED_DARK    = new THREE.Color(0x880808);
const GLOVE_RED_BRIGHT  = new THREE.Color(0xff3333);
const GLOVE_BLACK       = new THREE.Color(0x111111);
const GLOVE_GRAY        = new THREE.Color(0x222222);
const GLOVE_STITCH      = new THREE.Color(0xddcccc);

/** Build a disposal-safe THREE.Group representing one boxing glove. */
function buildGlove(isLeft: boolean): THREE.Group {
  const group = new THREE.Group();

  // ── Shared material factory ─────────────────────────────────────────────

  const mat = (color: THREE.Color, roughness = 0.65, metalness = 0.0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.FrontSide });

  const redMat   = mat(GLOVE_RED, 0.68, 0.02);
  const darkMat  = mat(GLOVE_RED_DARK, 0.80, 0.01);
  const blackMat = mat(GLOVE_BLACK, 0.85, 0.0);
  const grayMat  = mat(GLOVE_GRAY, 0.90, 0.0);
  const stitchMat = mat(GLOVE_STITCH, 0.55, 0.1);

  // We flip the thumb side for left vs right glove.
  const thumbSide = isLeft ? 1 : -1;

  // ── Main palm / body ────────────────────────────────────────────────────
  // A capsule that forms the main padded body of the glove.
  // Oriented vertically: bottom = cuff, top = knuckle dome.
  {
    const geo = new THREE.CapsuleGeometry(0.38, 0.42, 12, 20);
    const mesh = new THREE.Mesh(geo, redMat);
    mesh.position.set(0, 0.16, 0);
    group.add(mesh);
  }

  // ── Knuckle dome ────────────────────────────────────────────────────────
  // Raised padded section at the top / front of the glove.
  {
    const geo = new THREE.SphereGeometry(0.40, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const mesh = new THREE.Mesh(geo, mat(GLOVE_RED_BRIGHT, 0.60, 0.03));
    mesh.rotation.x = -Math.PI * 0.08;
    mesh.position.set(0, 0.36, 0.12);
    group.add(mesh);
  }

  // ── Individual knuckle bumps (4) ────────────────────────────────────────
  {
    const bumpGeo = new THREE.SphereGeometry(0.10, 10, 8);
    const bumpMat = mat(GLOVE_RED_BRIGHT, 0.55, 0.04);
    for (let k = 0; k < 4; k++) {
      const x = (k - 1.5) * 0.195;
      const mesh = new THREE.Mesh(bumpGeo, bumpMat);
      mesh.scale.set(1, 0.82, 1);
      mesh.position.set(x, 0.54, 0.24);
      group.add(mesh);
    }
  }

  // ── Thumb ────────────────────────────────────────────────────────────────
  {
    const geo = new THREE.CapsuleGeometry(0.13, 0.22, 8, 12);
    const mesh = new THREE.Mesh(geo, redMat);
    mesh.rotation.z = thumbSide * 0.65;
    mesh.rotation.x = -0.3;
    mesh.position.set(thumbSide * 0.40, 0.14, 0.12);
    group.add(mesh);

    // Thumb tip
    const tipGeo = new THREE.SphereGeometry(0.13, 10, 8);
    const tip = new THREE.Mesh(tipGeo, mat(GLOVE_RED_BRIGHT, 0.58, 0.02));
    tip.scale.set(1, 0.85, 0.95);
    tip.position.set(thumbSide * 0.51, 0.30, 0.15);
    group.add(tip);
  }

  // ── Palm back panel (slightly darker, shows depth) ───────────────────────
  {
    const geo = new THREE.BoxGeometry(0.66, 0.60, 0.10, 2, 3, 1);
    const mesh = new THREE.Mesh(geo, darkMat);
    mesh.position.set(0, 0.14, -0.22);
    mesh.rotation.x = 0.15;
    group.add(mesh);
  }

  // ── Wrist cuff sleeve ───────────────────────────────────────────────────
  {
    const geo = new THREE.CylinderGeometry(0.33, 0.30, 0.48, 20, 2, false);
    const mesh = new THREE.Mesh(geo, darkMat);
    mesh.position.set(0, -0.20, 0);
    group.add(mesh);
  }

  // ── Cuff end cap (bottom of cuff) ────────────────────────────────────────
  {
    const geo = new THREE.TorusGeometry(0.315, 0.025, 10, 30);
    const mesh = new THREE.Mesh(geo, blackMat);
    mesh.position.set(0, -0.44, 0);
    group.add(mesh);
  }

  // ── Velcro strap band ────────────────────────────────────────────────────
  {
    const geo = new THREE.TorusGeometry(0.34, 0.042, 10, 30);
    const strap = new THREE.Mesh(geo, grayMat);
    strap.position.set(0, -0.10, 0);
    group.add(strap);

    // Strap label rectangle
    const labelGeo = new THREE.BoxGeometry(0.24, 0.10, 0.01);
    const label = new THREE.Mesh(labelGeo, blackMat);
    label.position.set(0, -0.10, 0.35);
    group.add(label);
  }

  // ── Panel seam stitching lines (decorative) ──────────────────────────────
  {
    const stitchGeo = new THREE.TorusGeometry(0.38, 0.012, 6, 30, Math.PI * 1.4);
    const stitch = new THREE.Mesh(stitchGeo, stitchMat);
    stitch.rotation.z = Math.PI * 0.1;
    stitch.position.set(0, 0.16, 0.25);
    group.add(stitch);
  }

  // ── Wrist-knuckle panel seam (horizontal line) ───────────────────────────
  {
    const geo = new THREE.TorusGeometry(0.40, 0.010, 6, 30, Math.PI);
    const seam = new THREE.Mesh(geo, stitchMat);
    seam.rotation.z = Math.PI / 2;
    seam.position.set(0, 0.06, 0.22);
    group.add(seam);
  }

  // Mirror the entire group for the left-hand glove (reflection across X axis)
  if (isLeft) {
    group.scale.x = -1;
  }

  return group;
}

// ────────────────────────────────────────────────────────────────────────────
// Lerp helpers
// ────────────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(cur: number, tgt: number, t: number): number {
  let diff = tgt - cur;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return cur + diff * t;
}

// ────────────────────────────────────────────────────────────────────────────
// ARGloveRenderer class
// ────────────────────────────────────────────────────────────────────────────

export class ARGloveRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene:    THREE.Scene;
  private camera:   THREE.PerspectiveCamera;

  // Per-hand objects
  private leftGlove:  THREE.Group;
  private rightGlove: THREE.Group;
  private leftState:  GloveState;
  private rightState: GloveState;

  // Canvas info
  private width:  number = 1;
  private height: number = 1;

  // Resource tracking for proper disposal
  private geometries: THREE.BufferGeometry[] = [];
  private materials:  THREE.Material[] = [];

  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.width  = canvas.offsetWidth  || 1280;
    this.height = canvas.offsetHeight || 720;

    // ── Renderer ────────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,           // transparent background (shows camera feed below)
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x000000, 0);  // fully transparent clear
    this.renderer.shadowMap.enabled = false;    // shadows off for perf
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // ── Scene ───────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Lighting ─────────────────────────────────────────────────────────────
    // Soft ambient – prevents pure black shadows
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);

    // Key light – upper left (from participant's perspective)
    const keyLight = new THREE.DirectionalLight(0xfff5e8, 1.8);
    keyLight.position.set(-3, 5, 4);
    this.scene.add(keyLight);

    // Fill light – softer, from lower right
    const fillLight = new THREE.DirectionalLight(0xe0eeff, 0.7);
    fillLight.position.set(3, -1, 3);
    this.scene.add(fillLight);

    // Rim light – thin highlight from behind for depth separation
    const rimLight = new THREE.PointLight(0xff6666, 0.45, 12);
    rimLight.position.set(0, 2, -5);
    this.scene.add(rimLight);

    // Hemisphere for subtle sky/ground colour gradient
    const hemi = new THREE.HemisphereLight(0x334466, 0x221100, 0.35);
    this.scene.add(hemi);

    // ── Camera ──────────────────────────────────────────────────────────────
    // We use an orthographic-like perspective with a large FOV so that
    // gloves positioned in NDC space match screen coordinates predictably.
    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 100);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    // ── Glove meshes ─────────────────────────────────────────────────────────
    this.leftGlove  = buildGlove(true);
    this.rightGlove = buildGlove(false);
    this.leftGlove.visible  = false;
    this.rightGlove.visible = false;
    this.scene.add(this.leftGlove);
    this.scene.add(this.rightGlove);

    this.leftState  = makeInitialState(0.30, 0.55);
    this.rightState = makeInitialState(0.70, 0.55);

    // Track all geometries and materials for disposal
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        this.geometries.push(mesh.geometry);
        if (Array.isArray(mesh.material)) {
          this.materials.push(...mesh.material);
        } else {
          this.materials.push(mesh.material);
        }
      }
    });
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  resize(width: number, height: number): void {
    if (this.disposed) return;
    if (width === this.width && height === this.height) return;
    this.width  = Math.max(1, width);
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

    this.updateGloveState(this.leftState,  left,  nowMs);
    this.updateGloveState(this.rightState, right, nowMs);
    this.applyStateToMesh(this.leftState,  this.leftGlove);
    this.applyStateToMesh(this.rightState, this.rightGlove);
  }

  /** Apply smoothed state to a Three.js glove Group. */
  private applyStateToMesh(state: GloveState, group: THREE.Group): void {
    const hiddenMs = performance.now() - state.lastSeenMs;
    const visible  = state.visible && hiddenMs < 500;
    group.visible = visible;

    if (!visible) return;

    // Convert anchor norm [0..1] → world coords
    const worldPos = this.normToWorld(state.anchorX, state.anchorY);
    group.position.set(worldPos.x, worldPos.y, worldPos.z);

    // Apply orientation from hand pose estimator
    group.rotation.set(state.rotX, state.rotY, state.rotZ, 'XYZ');

    // Scale: handSpanNorm is ~0.08–0.25 in normalised units.
    // Map to world units. The world "height" at depth z=0 via our camera:
    // worldHeight = 2 * tan(FOV/2) * cameraZ = 2 * tan(30°) * 5 ≈ 5.77
    // A hand span of 0.12 in normalised units should map to ~0.9 world units.
    const worldScale = state.scale * (this.height > 0 ? this.height / 400 : 1.8);
    const clampedScale = Math.min(4.5, Math.max(0.5, worldScale));
    group.scale.set(clampedScale, clampedScale, clampedScale);
    // Re-mirror left glove after uniform scale
    if (group === this.leftGlove) {
      group.scale.x = -clampedScale;
    }
  }

  /**
   * Smooth incoming HandPose into GloveState with velocity-adaptive lerp.
   */
  private updateGloveState(state: GloveState, pose: HandPose | null, nowMs: number): void {
    if (pose === null) {
      // Don't instantly hide – let the mesh linger 500ms (handled in applyStateToMesh)
      return;
    }

    const targetX = pose.anchorNorm.x;
    const targetY = pose.anchorNorm.y;

    // Adaptive alpha: faster when moving quickly
    const dx   = targetX - state.anchorX;
    const dy   = targetY - state.anchorY;
    const dist = Math.hypot(dx, dy);
    const posAlpha = Math.min(0.90, Math.max(0.40, 0.40 + dist * 12.0));

    if (!state.visible) {
      // First time seeing the hand: snap immediately, no lerp
      state.anchorX = targetX;
      state.anchorY = targetY;
      state.rotX    = pose.rotX;
      state.rotY    = pose.rotY;
      state.rotZ    = pose.rotZ;
      state.scale   = pose.handSpanNorm;
      state.visible = true;
    } else {
      state.anchorX = lerp(state.anchorX, targetX, posAlpha);
      state.anchorY = lerp(state.anchorY, targetY, posAlpha);

      // Rotation smoothing – slower than position for stability
      const rotAlpha = Math.min(0.75, Math.max(0.30, 0.30 + dist * 8.0));
      state.rotX = lerpAngle(state.rotX, pose.rotX, rotAlpha);
      state.rotY = lerpAngle(state.rotY, pose.rotY, rotAlpha);
      state.rotZ = lerpAngle(state.rotZ, pose.rotZ, rotAlpha);

      // Scale smoothing (depth)
      state.scale = lerp(state.scale, pose.handSpanNorm, 0.30);
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
    // Using the camera: world = inv(projection * view) * NDC
    const aspect = this.width / this.height;
    const halfH  = Math.tan((60 * Math.PI / 180) / 2) * 5; // tan(FOV/2) * camZ
    const halfW  = halfH * aspect;

    return new THREE.Vector3(ndcX * halfW, ndcY * halfH, 0);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  // ── Dispose ───────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Dispose all tracked geometries and materials
    for (const geo of this.geometries) {
      geo.dispose();
    }
    for (const mat of this.materials) {
      mat.dispose();
    }

    // Dispose the renderer (releases WebGL context)
    this.renderer.dispose();
    this.renderer.forceContextLoss();

    // Clear scene
    this.scene.clear();
  }

  /** Returns true if dispose() has been called. */
  get isDisposed(): boolean {
    return this.disposed;
  }
}
