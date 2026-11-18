/**
 * Stage 3 of the pipeline: clean track -> sporting metrics.
 *
 * Each exported-quantity has its own small function so it can be explained on its own:
 *   chainage        where the athlete is along the course (projection on the centre line)
 *   start time      when the run really begins (integrated Doppler speed)
 *   kinematics      speed, slope, heading
 *   loads           g-forces from the IMU
 *   jumps           flight detection (specific force ~ 0)
 *   time curve      run time at every chainage -> splits, sections and gaps between athletes
 *   summary         headline numbers
 */
import type { Course } from '../core/course';
import { G, gaussianSmooth, interp } from '../core/math';
import type { TimingEvent } from '../core/packet';
import {
  type CleanTrack, FLAG_STUCK, type Jump, type RunSeries, type RunSummary, type SectionResult, type SplitResult,
} from './types';

export const GRID_STEP = 5;            // m, chainage grid of the time-at-chainage curve
const START_DISTANCE = 0.5;            // m covered after which the run officially "started"
const FINISH_LEAD = 4;                 // m before the line from which the finish time is extrapolated
const ANTENNA = 1.0;                   // m above the snow (back protector)
const MIN_AIRTIME = 0.35;              // s, shorter flights are terrain noise
const AIR_FORCE = 3.2;                 // m/s^2, total specific force below this = weightless
const DEG = 180 / Math.PI;

export interface MetricsResult {
  series: RunSeries;
  splits: SplitResult[];
  sections: SectionResult[];
  jumps: Jump[];
  summary: RunSummary;
  sGrid: Float64Array;
  tAt: Float64Array;
  t0: number;
}

// ---------------------------------------------------------------------------------------------------
// chainage
// ---------------------------------------------------------------------------------------------------
/**
 * Projects every sample onto the course centre line. The search is a *forward-tracking* window around the
 * previous result, which is both faster and immune to jumping to another part of the course that passes nearby.
 * Chainage is then smoothed and forced to be non-decreasing (the athlete never goes back up).
 */
function projectOnCourse(track: CleanTrack, course: Course): { s: Float64Array; lateral: Float64Array } {
  const n = track.n, raw = new Float64Array(n), lateral = new Float64Array(n);
  let hint: number | undefined;
  for (let k = 0; k < n; k++) {
    const p = course.project(track.x[k], track.z[k], hint, 60);
    raw[k] = p.s; lateral[k] = p.lateral; hint = p.index;
  }
  const smooth = gaussianSmooth(raw, 2), s = new Float64Array(n);
  let top = -Infinity;
  for (let k = 0; k < n; k++) { top = Math.max(top, smooth[k]); s[k] = top; }
  return { s, lateral };
}

// ---------------------------------------------------------------------------------------------------
// start time
// ---------------------------------------------------------------------------------------------------
/**
 * Time at which the athlete has covered START_DISTANCE, from the integrated Doppler speed.
 * (GNSS position noise at standstill is ~0.3 m, which would blur a position-based start by ~0.2 s;
 * Doppler speed noise is ~0.08 m/s and is ignored below 0.3 m/s.)
 */
function detectStart(track: CleanTrack): number {
  const dt = 1 / track.rate;
  let covered = 0;
  for (let k = 1; k < track.n; k++) {
    const speed = track.spd[k] > 0.3 ? track.spd[k] : 0, step = speed * dt;
    if (speed > 0 && covered + step >= START_DISTANCE) return track.t[k] - dt + ((START_DISTANCE - covered) / step) * dt;
    covered += step;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------
// kinematics
// ---------------------------------------------------------------------------------------------------
interface Kinematics { v: Float64Array; slope: Float64Array; heading: Float64Array; groundSpeed: Float64Array }

/**
 * - ground speed from position differences (noisy, only used as a quality cross-check),
 * - heading from the motion direction, falling back to the course direction when almost standing still,
 * - slope from altitude change over distance,
 * - 3D speed = Doppler ground speed / cos(slope): Doppler is far cleaner than differentiated positions.
 */
function kinematics(track: CleanTrack, course: Course, s: Float64Array): Kinematics {
  const n = track.n, dt = 1 / track.rate;
  const dx = new Float64Array(n), dy = new Float64Array(n), dz = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2), span = (b - a) * dt;
    dx[k] = (track.x[b] - track.x[a]) / span;
    dy[k] = (track.alt[b] - track.alt[a]) / span;
    dz[k] = (track.z[b] - track.z[a]) / span;
  }
  const groundSpeed = gaussianSmooth(Float64Array.from(dx, (_, k) => Math.hypot(dx[k], dz[k])), 3);
  const heading = Float64Array.from(dx, (_, k) => {
    if (groundSpeed[k] > 4) return Math.atan2(dx[k], -dz[k]);
    const [cx, cz] = course.directionAt(s[k]);            // GNSS heading is noise at low speed
    return Math.atan2(cx, -cz);
  });
  const slope = gaussianSmooth(Float64Array.from(dx, (_, k) => Math.atan2(-dy[k], Math.max(0.5, groundSpeed[k])) * DEG), 8);
  const v = Float64Array.from(track.spd, (doppler, k) => doppler / Math.cos(slope[k] / DEG));
  return { v, slope, heading, groundSpeed };
}

// ---------------------------------------------------------------------------------------------------
// loads
// ---------------------------------------------------------------------------------------------------
/** IMU specific force in g. Lateral is positive to the right (a right turn pushes the body right). */
function loads(track: CleanTrack) {
  const g = (src: Float64Array, sign: number, sigma: number) => gaussianSmooth(Float64Array.from(src, (a) => (sign * a) / G), sigma);
  return { gLat: g(track.ay, -1, 2), gLong: g(track.ax, 1, 2), gVert: g(track.az, 1, 1.5) };
}

// ---------------------------------------------------------------------------------------------------
// jumps
// ---------------------------------------------------------------------------------------------------
/** In flight the IMU feels almost no force (only drag): total specific force ~ 0 at high speed. */
function detectJumps(track: CleanTrack, course: Course, s: Float64Array, lateral: Float64Array, v: Float64Array, t: Float64Array) {
  const n = track.n, dt = 1 / track.rate;
  const air = new Uint8Array(n), jumps: Jump[] = [];
  for (let k = 0; k < n; k++) {
    const force = Math.hypot(track.ax[k], track.ay[k], track.az[k]);
    air[k] = force < AIR_FORCE && v[k] > 10 && !(track.flags[k] & FLAG_STUCK) ? 1 : 0;
  }
  for (let k = 0; k < n; k++) {
    if (!air[k]) continue;
    let end = k;
    while (end < n && air[end]) end++;
    if ((end - k) * dt < MIN_AIRTIME) { for (let j = k; j < end; j++) air[j] = 0; k = end; continue; }
    let height = 0;
    for (let j = k; j < end; j++) height = Math.max(height, track.alt[j] - ANTENNA - course.pointAt(s[j], lateral[j]).y);
    jumps.push({
      start: k, end, tTakeoff: t[k], airtime: (end - k) * dt, height, speedKmh: v[k] * 3.6, s: s[k],
      distance: Math.hypot(track.x[end - 1] - track.x[k], track.z[end - 1] - track.z[k]),
    });
    k = end;
  }
  return { air, jumps };
}

// ---------------------------------------------------------------------------------------------------
// time curve, splits, sections
// ---------------------------------------------------------------------------------------------------
/** Strictly increasing (chainage, time) pairs so that time can be interpolated at any chainage. */
function monotone(s: ArrayLike<number>, t: ArrayLike<number>): { x: number[]; y: number[] } {
  const x: number[] = [], y: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < s.length; i++) if (s[i] > last + 1e-4) { x.push(s[i]); y.push(t[i]); last = s[i]; }
  return { x, y };
}

/** Run time at every 5 m of chainage: the common currency for splits, sections and athlete-to-athlete gaps. */
function timeCurve(s: Float64Array, t: Float64Array, course: Course) {
  const m = monotone(s, t);
  const timeAt = (c: number) => interp(m.x, m.y, c);
  const sGrid = Float64Array.from({ length: Math.floor(course.length / GRID_STEP) + 1 }, (_, i) => i * GRID_STEP);
  const tAt = gaussianSmooth(Float64Array.from(sGrid, timeAt), 1.5);
  return { timeAt, sGrid, tAt };
}

/** The projection saturates at the line, so the finish is extrapolated from FINISH_LEAD metres before it. */
function finishTime(timeAt: (c: number) => number, course: Course, t: Float64Array, v: Float64Array): number {
  const before = timeAt(course.length - FINISH_LEAD), speed = Math.max(5, interp(t, v, before));
  return before + FINISH_LEAD / speed;
}

function buildSplits(course: Course, timeAt: (c: number) => number, finish: number, official: TimingEvent[]): SplitResult[] {
  return course.timing.map((tp) => {
    const gnss = tp.id === 'START' ? 0 : tp.s >= course.length - 1 ? finish : timeAt(tp.s);
    const off = official.find((e) => e.point === tp.id);
    return {
      id: tp.id, label: tp.label, chainage: Math.round(tp.s), gnssTime: gnss,
      officialTime: off?.time, officialStatus: off?.status, delta: off ? gnss - off.time : undefined,
    };
  });
}

function buildSections(course: Course, splits: SplitResult[], s: Float64Array, v: Float64Array, gLat: Float64Array): SectionResult[] {
  return course.timing.slice(1).map((to, i) => {
    const from = course.timing[i];
    let vSum = 0, vMax = 0, gSum = 0, count = 0;
    for (let k = 0; k < s.length; k++) {
      if (s[k] < from.s || s[k] >= to.s) continue;
      vSum += v[k]; vMax = Math.max(vMax, v[k]); gSum += Math.abs(gLat[k]); count++;
    }
    return {
      from: from.label, to: to.label, time: splits[i + 1].gnssTime - splits[i].gnssTime,
      avgKmh: count ? (vSum / count) * 3.6 : 0, maxKmh: vMax * 3.6, avgGLat: count ? gSum / count : 0,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------------------------------
function summarize(
  course: Course, track: CleanTrack, runTime: number,
  q: { t: Float64Array; s: Float64Array; lateral: Float64Array; v: Float64Array; groundSpeed: Float64Array; air: Uint8Array;
       gLat: Float64Array; gVert: Float64Array },
): RunSummary {
  const dt = 1 / track.rate;
  let topSpeed = 0, topAt = 0, maxGLat = 0, maxGVert = 0, latSq = 0, resSq = 0, airtime = 0, count = 0;
  for (let k = 0; k < track.n; k++) {
    if (q.t[k] < 0 || q.s[k] >= course.length - 1) continue;           // only the timed part of the run
    count++;
    if (q.v[k] > topSpeed) { topSpeed = q.v[k]; topAt = q.t[k]; }
    maxGLat = Math.max(maxGLat, Math.abs(q.gLat[k]));
    if (!q.air[k] && !(track.flags[k] & FLAG_STUCK)) maxGVert = Math.max(maxGVert, q.gVert[k]);   // ignore landings/frozen IMU
    latSq += q.lateral[k] ** 2;
    resSq += (track.spd[k] - q.groundSpeed[k]) ** 2;                    // Doppler vs differentiated GNSS
    airtime += q.air[k] * dt;
  }
  return {
    runTime, topSpeedKmh: topSpeed * 3.6, topSpeedAt: topAt, avgKmh: (course.length / runTime) * 3.6,
    maxGLat, maxGVert, lineRms: Math.sqrt(latSq / Math.max(1, count)), airtime,
    speedResidual: Math.sqrt(resSq / Math.max(1, count)),
  };
}

// ---------------------------------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------------------------------
/** Derives chainage, kinematics, loads, jumps and timing from a cleaned track. */
export function computeMetrics(track: CleanTrack, course: Course, official: TimingEvent[] = []): MetricsResult {
  const { s, lateral } = projectOnCourse(track, course);
  const t0 = detectStart(track);
  const t = Float64Array.from(track.t, (v) => v - t0);                  // run time: 0 = start
  const { v, slope, heading, groundSpeed } = kinematics(track, course, s);
  const { gLat, gLong, gVert } = loads(track);
  const { air, jumps } = detectJumps(track, course, s, lateral, v, t);

  const { timeAt, sGrid, tAt } = timeCurve(s, t, course);
  const splits = buildSplits(course, timeAt, finishTime(timeAt, course, t, v), official);
  const sections = buildSections(course, splits, s, v, gLat);
  const summary = summarize(course, track, splits[splits.length - 1].gnssTime, { t, s, lateral, v, groundSpeed, air, gLat, gVert });

  const series: RunSeries = {
    n: track.n, t, s, lateral, x: track.x, y: track.alt, z: track.z, v, vDoppler: track.spd, slope, heading,
    gLat, gLong, gVert, air, flags: track.flags,
  };
  return { series, splits, sections, jumps, summary, sGrid, tAt, t0 };
}

/** Time gained on `ref` along the course (positive = `a` is ahead of `ref`). */
export function gapAlong(a: { tAt: Float64Array }, ref: { tAt: Float64Array }): Float64Array {
  const n = Math.min(a.tAt.length, ref.tAt.length);
  return Float64Array.from({ length: n }, (_, i) => ref.tAt[i] - a.tAt[i]);
}
