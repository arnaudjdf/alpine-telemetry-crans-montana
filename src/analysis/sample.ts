import type { RunAnalysis } from './types';

/** Interpolated state of one run at a given run time. */
export interface RunSample {
  t: number; s: number; lateral: number;
  x: number; y: number; z: number;
  v: number; slope: number; heading: number;
  gLat: number; gLong: number; gVert: number;
  air: boolean; flags: number;
  /** v^2 / (g * gLat) style turn radius is derived in the UI; here the raw heading rate (rad/s). */
  headingRate: number;
}

const RATE = 20;

export const finishTimeOf = (run: RunAnalysis): number => run.splits[run.splits.length - 1].gnssTime;

/** Linear sampling of the run series. T is clamped to the logged range. */
export function sampleAt(run: RunAnalysis, T: number): RunSample {
  const S = run.series, last = S.n - 1;
  const f = Math.min(last, Math.max(0, (T - S.t[0]) * RATE));
  const i = Math.floor(f), j = Math.min(last, i + 1), a = f - i;
  const L = (arr: ArrayLike<number>) => arr[i] + (arr[j] - arr[i]) * a;
  const hx = Math.sin(S.heading[i]) * (1 - a) + Math.sin(S.heading[j]) * a;
  const hz = Math.cos(S.heading[i]) * (1 - a) + Math.cos(S.heading[j]) * a;
  const k0 = Math.max(0, i - 1), k1 = Math.min(last, i + 2);
  let dh = S.heading[k1] - S.heading[k0];
  if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
  return {
    t: T, s: L(S.s), lateral: L(S.lateral), x: L(S.x), y: L(S.y), z: L(S.z), v: L(S.v), slope: L(S.slope),
    heading: Math.atan2(hx, hz), gLat: L(S.gLat), gLong: L(S.gLong), gVert: L(S.gVert),
    air: S.air[i] === 1 || S.air[j] === 1, flags: S.flags[i], headingRate: dh / ((k1 - k0) / RATE),
  };
}

/** Run time at which the run reaches chainage c (uses the 5 m grid). */
export function timeAtChainage(run: RunAnalysis, c: number): number {
  const g = c / 5, i = Math.min(run.tAt.length - 2, Math.max(0, Math.floor(g))), a = Math.min(1, Math.max(0, g - i));
  return run.tAt[i] + (run.tAt[i + 1] - run.tAt[i]) * a;
}
