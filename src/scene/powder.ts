import * as THREE from 'three';

const COUNT = 260;                  // particles per skier (ring buffer)
const LIFETIME = 0.95;              // s
const GRAVITY = 3;                  // m/s^2 (snow dust falls slowly)
const SPAWN_PER_FRAME = 3;
const MIN_SPEED = 14;               // m/s below which no powder is kicked up
const OPACITY = 0.32;               // faint: a haze, not confetti
const SIZE = 0.3;

/**
 * Snow spray behind a skier. Fine, soft particles are thrown mostly backwards and, in a turn, away from the
 * inside edge (a "rooster tail"), then fall and fade. A ring buffer keeps the cost constant.
 */
export class Powder {
  readonly points: THREE.Points;
  private position = new Float32Array(COUNT * 3).fill(-1e5);   // parked far away until used
  private velocity = new Float32Array(COUNT * 3);
  private color = new Float32Array(COUNT * 3);
  private age = new Float32Array(COUNT).fill(LIFETIME * 10);
  private head = 0;

  constructor(soft: THREE.Texture) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: SIZE, map: soft, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
  }

  /**
   * Throws new particles from the skis. `heading` is the direction of travel (radians, clockwise from north);
   * `gLat` (+ = right turn) pushes the spray to the outside of the turn, proportionally to the load.
   */
  emit(x: number, y: number, z: number, speed: number, airborne: boolean, heading: number, gLat: number): void {
    if (airborne || speed <= MIN_SPEED) return;
    const forwardX = Math.sin(heading), forwardZ = -Math.cos(heading), rightX = -forwardZ, rightZ = forwardX;
    const jitter = () => Math.random() - 0.5;
    const outward = -Math.max(-1, Math.min(1, gLat)) * (0.6 + 0.2 * Math.abs(gLat)) * 2.2;    // m/s sideways, to the outside
    for (let n = 0; n < SPAWN_PER_FRAME; n++) {
      const i = this.head;
      this.head = (this.head + 1) % COUNT;
      this.position.set([x + jitter() * 0.5, y + 0.05, z + jitter() * 0.5], i * 3);
      const back = -speed * 0.06 * (0.5 + Math.random()), up = 0.6 + Math.random() * 1.6, side = outward + jitter() * 1.2;
      this.velocity.set([forwardX * back + rightX * side, up, forwardZ * back + rightZ * side], i * 3);
      this.age[i] = 0;
    }
  }

  /** Moves, ages and fades every particle (fading = colour to black, since blending is additive). */
  update(dt: number): void {
    for (let i = 0; i < COUNT; i++) {
      this.age[i] += dt;
      for (let axis = 0; axis < 3; axis++) this.position[i * 3 + axis] += this.velocity[i * 3 + axis] * dt;
      this.velocity[i * 3 + 1] -= GRAVITY * dt;
      const t = this.age[i] / LIFETIME, brightness = t >= 1 ? 0 : (1 - t) * (1 - t) * OPACITY;      // quadratic fade
      this.color[i * 3] = this.color[i * 3 + 1] = this.color[i * 3 + 2] = brightness;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}
