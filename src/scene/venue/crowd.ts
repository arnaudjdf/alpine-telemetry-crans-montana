import * as THREE from 'three';
import { makeRng } from '../../core/math';

/** Where one spectator stands. `group` says which cheering zone (start, finish, a jump) they belong to. */
export interface Spot { position: THREE.Vector3; group: number; phase: number }

const COATS = [0x1f2a44, 0x7a1f2b, 0x20242c, 0xc2561f, 0x2f5d46, 0x5b6270, 0xe8ebf0, 0x35527d, 0x8a6f2b];
const SKIN_AND_HATS = [0xe0b394, 0xc98f6a, 0x8d5a3b, 0xf1d2b8, 0x20242c, 0x7a1f2b, 0xe8ebf0, 0x35527d];
const HOP_HEIGHT = 0.16;            // m, how high a cheering spectator bounces
const HOP_SPEED = 7;                // rad/s

/**
 * Hundreds of spectators drawn with two instanced meshes (bodies and heads), so the whole crowd is two draw calls.
 * Each one bounces in time with a random phase, as much as the excitement of their zone says.
 */
export class Crowd {
  readonly object = new THREE.Group();
  private readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();

  constructor(private spots: Spot[], seed = 11) {
    const rng = makeRng(seed), n = spots.length;
    this.bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.75, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), n);
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.bodies.setColorAt(i, color.setHex(COATS[Math.floor(rng() * COATS.length)]));
      this.heads.setColorAt(i, color.setHex(SKIN_AND_HATS[Math.floor(rng() * SKIN_AND_HATS.length)]));
    }
    for (const mesh of [this.bodies, this.heads]) { mesh.frustumCulled = false; this.object.add(mesh); }
    this.update(0, []);
  }

  /** `excitement[group]` in 0..1: 0 = standing still, 1 = jumping up and down. */
  update(time: number, excitement: number[]): void {
    this.spots.forEach((spot, i) => {
      const hop = (excitement[spot.group] ?? 0) * HOP_HEIGHT * Math.abs(Math.sin(time * HOP_SPEED + spot.phase));
      const { x, y, z } = spot.position;
      this.matrix.makeTranslation(x, y + 0.6 + hop, z);
      this.bodies.setMatrixAt(i, this.matrix);
      this.matrix.makeTranslation(x, y + 1.32 + hop, z);
      this.heads.setMatrixAt(i, this.matrix);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
