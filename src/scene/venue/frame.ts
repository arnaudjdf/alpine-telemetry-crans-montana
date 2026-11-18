import * as THREE from 'three';
import type { Course } from '../../core/course';

/**
 * A coordinate frame that follows the piste: `u` metres along it from chainage `s0`, `v` metres to the right of the
 * centre line. Beyond the start or the finish it continues straight. Because it follows the real course (which
 * bends), stands and crowds placed with it stay beside the piste instead of cutting across a curve.
 */
export class Frame {
  constructor(private course: Course, private s0: number) {}

  private chainage(u: number): number { return Math.min(Math.max(this.s0 + u, 0), this.course.length); }

  /** World position of (u, v), standing on the terrain. */
  at(u: number, v: number): THREE.Vector3 {
    const s = this.s0 + u, c = this.chainage(u), p = this.course.pointAt(c, v), [dx, dz] = this.course.directionAt(c);
    const x = p.x + dx * (s - c), z = p.z + dz * (s - c);                    // past an end: continue straight along the last direction
    return new THREE.Vector3(x, this.course.terrain.heightAt(x, z), z);
  }

  /** True if `p` is farther than `margin` metres from every part of the course (the piste can double back on itself). */
  isClear(p: THREE.Vector3, margin: number): boolean {
    return this.course.project(p.x, p.z).distance > margin;
  }

  /** Rotation about Y that makes an object's +Z axis point along the direction of travel at `u`. */
  yawAt(u: number): number {
    const [dx, dz] = this.course.directionAt(this.chainage(u));
    return Math.atan2(dx, dz);
  }

  /** Rotation about Y that makes an object's +Z axis point toward the piste, for something on side `side` (+1 right, -1 left). */
  facingPiste(side: number, u: number): number {
    const [dx, dz] = this.course.directionAt(this.chainage(u));
    return Math.atan2(side * dz, -side * dx);
  }
}

/** The frame at chainage `s` of the course centre line. */
export const frameAt = (course: Course, s: number): Frame => new Frame(course, s);
