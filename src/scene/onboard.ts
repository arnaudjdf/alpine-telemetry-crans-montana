import * as THREE from 'three';
import type { AppModel } from '../app/model';
import type { RunAnalysis } from '../analysis/types';
import { clamp } from '../core/math';
import type { AthleteLayer } from './athleteLayer';

const HELMET = { height: 0.95, forward: 0.4 };   // m: camera mounted on the front of the helmet
const LOOK_AHEAD = 30;                           // m: point on the snow the camera aims at
const AIM_HEIGHT = 1.2;                          // m above that point
const ROLL_PER_G = 0.35;                         // the camera banks with the athlete, a fraction of the lean
const MAX_ROLL = 0.45;                           // rad
const SHAKE = { amplitude: 0.018, frequency: 47 };   // m at 40 m/s: snow chatter felt through the helmet

export interface OnboardPose { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 }

/** Where a helmet camera on `run` sits and looks right now (follows heading, banks into turns, shakes with speed). */
export function onboardPose(model: AppModel, athletes: AthleteLayer, run: RunAnalysis): OnboardPose {
  const s = model.sampleFor(run), base = athletes.positionOf(run.bib);
  const dx = Math.sin(s.heading), dz = -Math.cos(s.heading);            // direction of travel on the ground
  const shake = SHAKE.amplitude * (s.v / 40) * Math.sin(model.time * SHAKE.frequency + run.bib);
  const position = new THREE.Vector3(base.x + dx * HELMET.forward, base.y + HELMET.height + shake, base.z + dz * HELMET.forward);

  const ax = base.x + dx * LOOK_AHEAD, az = base.z + dz * LOOK_AHEAD;
  const target = new THREE.Vector3(ax, model.world.terrain.heightAt(ax, az) + AIM_HEIGHT, az);

  // bank: tilt "up" toward the right-hand side for a right turn
  const roll = clamp(Math.atan(s.gLat * ROLL_PER_G), -MAX_ROLL, MAX_ROLL);
  const right = new THREE.Vector3(-dz, 0, dx);
  const up = new THREE.Vector3(0, 1, 0).multiplyScalar(Math.cos(roll)).addScaledVector(right, Math.sin(roll));
  return { position, target, up };
}
