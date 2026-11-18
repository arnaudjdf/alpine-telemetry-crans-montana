import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AppModel, CameraMode } from '../app/model';
import type { AthleteLayer } from './athleteLayer';
import { onboardPose } from './onboard';

// camera placement, in metres relative to the focus athlete
const CHASE = { back: 13, backPerMs: 0.12, up: 5.2, upPerMs: 0.03, lookAhead: 22, lookUp: 1.2 };
const TV = { side: 42, ahead: 18, up: 13, lookUp: 1.5 };
const HELI = { radius: 190, height: 125, orbitSpeed: 0.07, phase: 0.6 };
const OVERVIEW = { east: 1300, up: 1100, south: 1700, lookDown: 150 };
const MIN_CLEARANCE = 3;                        // m above the terrain
type FollowMode = 'chase' | 'tv' | 'heli';
const FOLLOW_RATE: Record<FollowMode, number> = { chase: 4, tv: 2, heli: 1.6 };   // higher = snappier
const FOV = { normal: 55, onboard: 78 };          // degrees: a helmet camera is wide-angle

/** Moves the camera: three automatic follow modes and a free orbit mode (OrbitControls). */
export class CameraRig {
  private controls: OrbitControls;
  private position = new THREE.Vector3();       // smoothed camera position
  private lookAt = new THREE.Vector3();         // smoothed look-at point
  private initialised = false;
  private lastMode: CameraMode | '' = '';

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, private model: AppModel, private athletes: () => AthleteLayer) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;       // never look from below the ground
    this.controls.enabled = false;
    // grabbing the view with the mouse switches to free mode automatically
    this.controls.addEventListener('start', () => { if (model.camera !== 'free') model.setView({ camera: 'free' }); });
  }

  /** Call when the camera mode may have changed. */
  syncMode(): void {
    const mode = this.model.camera;
    if (mode === this.lastMode) return;
    this.lastMode = mode;
    this.controls.enabled = mode === 'free';
    if (mode !== 'free') return;
    this.controls.target.copy(this.athletes().positionOf(this.model.focus));
    if (!this.initialised) this.overview();
  }

  /** Whole-course overview from the south-east, in free mode. */
  overview(): void {
    const course = this.model.world.course, mid = course.pointAt(course.length * 0.5, 0);
    this.camera.position.set(mid.x + OVERVIEW.east, mid.y + OVERVIEW.up, mid.z + OVERVIEW.south);
    this.controls.target.set(mid.x, mid.y - OVERVIEW.lookDown, mid.z);
    this.position.copy(this.camera.position);
    this.lookAt.copy(this.controls.target);
    this.initialised = true;
    this.model.setView({ camera: 'free' });
  }

  update(dt: number): void {
    const mode = this.model.camera;
    this.setFov(mode === 'onboard' ? FOV.onboard : FOV.normal);
    if (mode !== 'onboard') this.camera.up.set(0, 1, 0);
    if (mode === 'free') { this.controls.update(); this.position.copy(this.camera.position); return; }
    if (mode === 'onboard') { this.updateOnboard(); return; }

    const { desired, look } = this.target(mode as FollowMode);
    // never let the camera dip into the mountain
    desired.y = Math.max(desired.y, this.model.world.terrain.heightAt(desired.x, desired.z) + MIN_CLEARANCE);
    if (!this.initialised) { this.position.copy(desired); this.lookAt.copy(look); this.initialised = true; }
    const k = 1 - Math.exp(-dt * FOLLOW_RATE[mode as FollowMode]);        // frame-rate independent exponential smoothing
    this.position.lerp(desired, k);
    this.lookAt.lerp(look, k);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookAt);
  }

  /** First-person view from the focus athlete's helmet: no smoothing, the shake and banking are part of the look. */
  private updateOnboard(): void {
    const pose = onboardPose(this.model, this.athletes(), this.model.focusRun);
    this.position.copy(pose.position);
    this.lookAt.copy(pose.target);
    this.camera.position.copy(pose.position);
    this.camera.up.copy(pose.up);
    this.camera.lookAt(pose.target);
  }

  private setFov(fov: number): void {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Where the camera wants to be and what it wants to look at, for a follow mode. */
  private target(mode: FollowMode): { desired: THREE.Vector3; look: THREE.Vector3 } {
    const m = this.model;
    const s = m.sampleFor(m.focusRun), p = this.athletes().positionOf(m.focus);
    const dx = Math.sin(s.heading), dz = -Math.cos(s.heading);        // unit travel direction in the ground plane
    const desired = new THREE.Vector3(), look = new THREE.Vector3();

    if (mode === 'chase') {                                           // behind and above, pulling back with speed
      const back = CHASE.back + s.v * CHASE.backPerMs;
      desired.set(p.x - dx * back, p.y + CHASE.up + s.v * CHASE.upPerMs, p.z - dz * back);
      look.set(p.x + dx * CHASE.lookAhead, p.y + CHASE.lookUp, p.z + dz * CHASE.lookAhead);
    } else if (mode === 'tv') {                                       // beside the piste, slightly ahead
      desired.set(p.x + dz * TV.side + dx * TV.ahead, p.y + TV.up, p.z - dx * TV.side + dz * TV.ahead);
      look.set(p.x, p.y + TV.lookUp, p.z);
    } else {                                                          // helicopter: slow orbit around the athlete
      const angle = m.time * HELI.orbitSpeed + HELI.phase;
      desired.set(p.x + Math.cos(angle) * HELI.radius, p.y + HELI.height, p.z + Math.sin(angle) * HELI.radius);
      look.copy(p);
    }
    return { desired, look };
  }
}
