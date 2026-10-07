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
    anchorX: x,
    anchorY: y,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scale: 1,
    visible: false,
    lastSeenMs: 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Lerp helpers
// ────────────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(cur: number, tgt: number, t: number): number {
  let diff = tgt - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return cur + diff * t;
}

function findBoxingGloveMesh(scene: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      if (m.name.includes('Boxing Glove.002') || (!found && m.name.includes('Boxing Glove'))) {
        found = m;
      }
    }
  });
  return found;
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

  private disposed = false;

  constructor(canvas: HTMLCanvasElement, onLoadError?: (err: Error) => void) {
    this.onLoadError = onLoadError;
    this.width = canvas.offsetWidth || 1280;
    this.height = canvas.offsetHeight || 720;

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

        // Isolate "Boxing Glove.002" (production LOD mesh, 8128 vertices)
        const targetMesh = findBoxingGloveMesh(gltf.scene);
        if (!targetMesh) {
          const err = new Error('Target mesh "Boxing Glove.002" not found in GLB');
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

          // 3. Rotate 180 degrees around Y so the knuckle padding faces forward (+Z toward camera)
          container.rotation.y = Math.PI;

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
    group.position.set(worldPos.x, worldPos.y, worldPos.z);

    // Apply orientation from hand pose estimator
    group.rotation.set(state.rotX, state.rotY, state.rotZ, 'XYZ');

    // Scale: handSpanNorm is ~0.08–0.25 in normalised units.
    // Map to world units:
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
    const dx = targetX - state.anchorX;
    const dy = targetY - state.anchorY;
    const dist = Math.hypot(dx, dy);
    const posAlpha = Math.min(0.90, Math.max(0.40, 0.40 + dist * 12.0));

    if (!state.visible) {
      // First time seeing the hand: snap immediately, no lerp
      state.anchorX = targetX;
      state.anchorY = targetY;
      state.rotX = pose.rotX;
      state.rotY = pose.rotY;
      state.rotZ = pose.rotZ;
      state.scale = pose.handSpanNorm;
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
