import * as THREE from 'three';

const COUNT = 420;                  // particles in the ring buffer
const PER_BURST = 90;
const LIFETIME = 3.2;               // s
const GRAVITY = 5;                  // m/s^2
const FLUTTER = 1.4;                // m/s: sideways wobble, so the pieces drift instead of falling like stones
const PALETTE = [0xf2f4f8, 0xff7a1a, 0x38bdf8, 0xf6c945, 0xe8566b];

/** Small coloured pieces thrown into the air when an athlete crosses the finish line. */
export class Confetti {
  readonly points: THREE.Points;
  private position = new Float32Array(COUNT * 3).fill(-1e5);
  private velocity = new Float32Array(COUNT * 3);
  private color = new Float32Array(COUNT * 3);
  private age = new Float32Array(COUNT).fill(LIFETIME * 10);
  private head = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.28, vertexColors: true, sizeAttenuation: true }));
    this.points.frustumCulled = false;
  }

  /** Throws a burst up and outward from `origin`. */
  burst(origin: THREE.Vector3): void {
    const c = new THREE.Color(), spread = () => (Math.random() - 0.5) * 2;
    for (let n = 0; n < PER_BURST; n++) {
      const i = this.head;
      this.head = (this.head + 1) % COUNT;
      this.position.set([origin.x + spread() * 3, origin.y + 6, origin.z + spread() * 3], i * 3);
      this.velocity.set([spread() * 6, 6 + Math.random() * 6, spread() * 6], i * 3);
      c.setHex(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      this.color.set([c.r, c.g, c.b], i * 3);
      this.age[i] = 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < COUNT; i++) {
      if (this.age[i] > LIFETIME) { this.position[i * 3 + 1] = -1e5; continue; }                // expired: park out of sight
      this.age[i] += dt;
      this.velocity[i * 3 + 1] -= GRAVITY * dt;
      this.velocity[i * 3] += Math.sin(this.age[i] * 5 + i) * FLUTTER * dt;
      for (let axis = 0; axis < 3; axis++) this.position[i * 3 + axis] += this.velocity[i * 3 + axis] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
