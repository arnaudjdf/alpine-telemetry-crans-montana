import * as THREE from 'three';
import { finishTimeOf, sampleAt, timeAtChainage } from '../analysis/sample';
import type { RunAnalysis } from '../analysis/types';
import { clamp } from '../core/math';

export const INDICES_PER_QUAD = 6;          // two triangles per ribbon segment
export const GAP_STEP = 8;                  // m between gap-ribbon cross sections
const SERIES_RATE = 20;                     // Hz of the analysed series
const ANTENNA = 1.0;                        // m, logger height above the snow
const SPEED_RIBBON = { halfWidth: 0.45, lift: 0.5, every: 2, topSpeed: 42, standstill: 6 };   // topSpeed (m/s) = last colour of the ramp
const GAP_RIBBON = { lift: 2.2, saturatesAt: 0.6 };                                          // s: gap at which the colour is fully red/green

export interface Ribbon { mesh: THREE.Mesh; steps: number; times?: Float64Array }

/** Inferno-like colour ramp for speed (t in 0..1). */
const RAMP = [0x1b0c41, 0x6a176e, 0xbc3754, 0xf1711a, 0xfac127, 0xfcffa4].map((hex) => new THREE.Color(hex));
function ramp(t: number, out = new THREE.Color()): THREE.Color {
  const f = clamp(t, 0, 1) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(f));
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], f - i);
}

/**
 * A strip of quads. `positions` and `colors` hold two vertices (left, right) per cross-section, so section i
 * uses vertices 2i and 2i+1. The strip starts empty; the layer reveals it with `setDrawRange`.
 */
function stripMesh(positions: Float32Array, colors: Float32Array, sections: number, opacity: number, depthWrite: boolean): THREE.Mesh {
  const indices: number[] = [];
  for (let i = 0; i < sections - 1; i++) indices.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity, depthWrite }));
  mesh.frustumCulled = false;
  return mesh;
}

/** Writes the same colour to both vertices of cross-section i. */
function setSectionColor(colors: Float32Array, i: number, c: THREE.Color): void {
  colors.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
}

/** Ribbon laid along the athlete's own path, coloured by speed. `surface(x, z)` is the snow height. */
export function buildSpeedRibbon(run: RunAnalysis, surface: (x: number, z: number) => number): Ribbon {
  const S = run.series, { halfWidth, lift, every, topSpeed, standstill } = SPEED_RIBBON;
  let first = Math.max(0, Math.round(-S.t[0] * SERIES_RATE));
  while (first < S.n - 1 && S.v[first] < standstill) first++;                 // skip the noisy standstill at the gate
  const last = Math.min(S.n - 1, Math.round((finishTimeOf(run) - S.t[0]) * SERIES_RATE));
  const samples: number[] = [];
  for (let k = first; k <= last; k += every) samples.push(k);

  const positions = new Float32Array(samples.length * 6), colors = new Float32Array(samples.length * 6);
  const times = new Float64Array(samples.length), color = new THREE.Color();
  samples.forEach((k, i) => {
    const rightX = Math.cos(S.heading[k]), rightZ = Math.sin(S.heading[k]);   // right-hand side of the direction of travel
    const y = Math.max(S.y[k] - ANTENNA, surface(S.x[k], S.z[k])) + lift;
    positions.set([S.x[k] - rightX * halfWidth, y, S.z[k] - rightZ * halfWidth, S.x[k] + rightX * halfWidth, y, S.z[k] + rightZ * halfWidth], i * 6);
    setSectionColor(colors, i, ramp(S.v[k] / topSpeed, color));
    times[i] = S.t[k];
  });
  return { mesh: stripMesh(positions, colors, samples.length, 0.92, true), steps: samples.length, times };
}

/** Ribbon joining athlete `a` and `b` at equal chainage: green where `a` is ahead, red where behind. */
export function buildGapRibbon(a: RunAnalysis, b: RunAnalysis, courseLength: number, surface: (x: number, z: number) => number): Ribbon {
  const sections = Math.floor(courseLength / GAP_STEP) + 1;
  const positions = new Float32Array(sections * 6), colors = new Float32Array(sections * 6);
  const green = new THREE.Color(0x2ee59d), red = new THREE.Color(0xff4d5e), grey = new THREE.Color(0x9aa7bd), color = new THREE.Color();
  const raised = (p: { x: number; y: number; z: number }) => Math.max(p.y - ANTENNA, surface(p.x, p.z)) + GAP_RIBBON.lift;

  for (let i = 0; i < sections; i++) {
    const chainage = Math.min(courseLength, i * GAP_STEP);
    const tA = timeAtChainage(a, chainage), tB = timeAtChainage(b, chainage);
    const pA = sampleAt(a, tA), pB = sampleAt(b, tB), gap = tB - tA;          // gap > 0: a reaches this point first
    positions.set([pA.x, raised(pA), pA.z, pB.x, raised(pB), pB.z], i * 6);
    color.copy(grey).lerp(gap >= 0 ? green : red, clamp(Math.abs(gap) / GAP_RIBBON.saturatesAt, 0, 1));
    setSectionColor(colors, i, color);
  }
  return { mesh: stripMesh(positions, colors, sections, 0.55, false), steps: sections };
}
