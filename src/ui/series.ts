import { sampleAt } from '../analysis/sample';
import type { RunAnalysis } from '../analysis/types';
import type { Course } from '../core/course';

type Key = 'v' | 'gLat' | 'gVert' | 'gLong' | 'slope' | 'lateral';
const cache = new WeakMap<RunAnalysis, Map<string, { x: Float64Array; y: Float64Array }>>();

/** A run quantity resampled on the 5 m chainage grid (what every chart plots against). */
export function chainSeries(run: RunAnalysis, key: Key, scale = 1): { x: Float64Array; y: Float64Array } {
  let m = cache.get(run); if (!m) { m = new Map(); cache.set(run, m); }
  const id = `${key}*${scale}`, hit = m.get(id);
  if (hit) return hit;
  const y = Float64Array.from(run.sGrid, (_, i) => (sampleAt(run, run.tAt[i])[key] as number) * scale);
  const out = { x: run.sGrid, y }; m.set(id, out); return out;
}

/** Time gap of `a` to `ref` along the course (+ = a ahead). */
export function gapSeries(a: RunAnalysis, ref: RunAnalysis): { x: Float64Array; y: Float64Array } {
  const n = Math.min(a.tAt.length, ref.tAt.length);
  return { x: a.sGrid.subarray(0, n), y: Float64Array.from({ length: n }, (_, i) => ref.tAt[i] - a.tAt[i]) };
}

export function profileSeries(course: Course): { x: Float64Array; y: Float64Array } {
  const y = Float64Array.from(course.s, (_, i) => course.rawY[i] + course.delta[i] + course.bump(course.s[i]));
  return { x: course.s, y };
}
