import { GeoFrame } from './geo';
import { Terrain } from './terrain';
import { bracket, gaussianSmooth, interp, lerp, makeRng } from './math';

export interface Gate { id: number; s: number; side: 1 | -1; offset: number; x: number; y: number; z: number }
export interface TimingPoint { id: string; label: string; s: number }
export interface CourseFeature { id: string; label: string; s: number; amplitude: number; sigma: number }
export interface Projection { s: number; lateral: number; index: number; distance: number }
export interface RawCourse { name: string; osmId?: number; note?: string; pts: [number, number][] }

const STEP = 2;   // horizontal resampling step of the centre line, metres

/** Centripetal-ish Catmull-Rom evaluation between p1 and p2. */
function catmull(p0: number[], p1: number[], p2: number[], p3: number[], t: number): number[] {
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t
    + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

/**
 * Racing course expressed along a smooth centre line.
 * - `s` is the 3D chainage (slope distance) from the start gate.
 * - Lateral offsets are positive to the right of the direction of travel.
 * - `bump(s)` adds course features (jumps / rollovers) the DEM cannot resolve; they are synthetic.
 */
export class Course {
  readonly n: number;
  readonly s: Float64Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Smoothed profile minus raw DEM height along the centre line (groomed piste surface offset). */
  readonly delta: Float64Array;
  readonly heading: Float64Array;       // radians clockwise from north
  readonly curvature: Float64Array;     // 1/m, + = right turn
  readonly rawY: Float64Array;
  readonly length: number;
  readonly gates: Gate[] = [];
  readonly timing: TimingPoint[];
  readonly features: CourseFeature[];

  constructor(
    readonly name: string, readonly terrain: Terrain,
    x: Float64Array, z: Float64Array, seed = 7,
  ) {
    this.n = x.length;
    this.x = x; this.z = z;
    this.rawY = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) this.rawY[i] = terrain.heightAt(x[i], z[i]);
    const smoothY = gaussianSmooth(this.rawY, 6);
    this.delta = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) this.delta[i] = smoothY[i] - this.rawY[i];

    this.s = new Float64Array(this.n);
    for (let i = 1; i < this.n; i++) {
      this.s[i] = this.s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1], smoothY[i] - smoothY[i - 1]);
    }
    this.length = this.s[this.n - 1];

    this.heading = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
      this.heading[i] = Math.atan2(x[b] - x[a], -(z[b] - z[a]));
    }
    this.curvature = new Float64Array(this.n);
    for (let i = 1; i < this.n - 1; i++) {
      let d = this.heading[i + 1] - this.heading[i - 1];
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      this.curvature[i] = d / (2 * STEP);
    }
    this.curvature[0] = this.curvature[1]; this.curvature[this.n - 1] = this.curvature[this.n - 2];

    const L = this.length;
    const snap = (v: number) => Math.round(v / 10) * 10;
    this.timing = [
      { id: 'START', label: 'Start', s: 0 },
      { id: 'SPLIT1', label: 'Split 1', s: snap(L * 0.25) },
      { id: 'SPLIT2', label: 'Split 2', s: snap(L * 0.5) },
      { id: 'SPLIT3', label: 'Split 3', s: snap(L * 0.75) },
      { id: 'FINISH', label: 'Finish', s: L },
    ];
    this.features = [0.3, 0.55, 0.8].map((f, k) => (
      { id: `JUMP${k + 1}`, label: `Jump ${k + 1}`, s: snap(L * f), amplitude: 2.1, sigma: 6.5 }));
    this.buildGates(seed);
  }

  /** Synthetic gate set: alternating sides, 38-55 m apart. Replace with official data when available. */
  private buildGates(seed: number): void {
    const rng = makeRng(seed);
    let s = 55, id = 0, side: 1 | -1 = 1;
    while (s < this.length - 40) {
      const offset = 6 + rng() * 4;
      const p = this.pointAt(s, side * offset);
      this.gates.push({ id: id++, s, side, offset, x: p.x, y: p.y, z: p.z });
      side = side === 1 ? -1 : 1;
      s += 38 + rng() * 17;
    }
  }

  /** Index range helper: fractional index for chainage s. */
  indexAt(s: number): number {
    const i = bracket(this.s, s);
    const span = this.s[i + 1] - this.s[i];
    return i + (span > 0 ? (Math.min(Math.max(s, this.s[0]), this.length) - this.s[i]) / span : 0);
  }

  /** Height contribution of the course features at chainage s. */
  bump(s: number): number {
    let h = 0;
    for (const f of this.features) { const u = (s - f.s) / f.sigma; h += f.amplitude * Math.exp(-0.5 * u * u); }
    return h;
  }

  /** Centre-line value of any per-node array at chainage s. */
  sample(arr: ArrayLike<number>, s: number): number { return interp(this.s, arr, s); }

  /** Local-frame point at chainage s and lateral offset (m, + right). Height includes groomed surface and features. */
  pointAt(s: number, lateral = 0): { x: number; y: number; z: number } {
    const i = bracket(this.s, s), t = (s - this.s[i]) / Math.max(1e-6, this.s[i + 1] - this.s[i]);
    const cx = lerp(this.x[i], this.x[i + 1], t), cz = lerp(this.z[i], this.z[i + 1], t);
    let tx = this.x[i + 1] - this.x[i], tz = this.z[i + 1] - this.z[i];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const x = cx - tz * lateral, z = cz + tx * lateral;           // right normal = (-tz, tx)
    const delta = lerp(this.delta[i], this.delta[i + 1], t);
    return { x, y: this.terrain.heightAt(x, z) + delta + this.bump(s), z };
  }

  /** Unit travel direction (x, z) at chainage s. */
  directionAt(s: number): [number, number] {
    const h = this.sample(this.heading, s);
    return [Math.sin(h), -Math.cos(h)];
  }

  /**
   * Projects a local point onto the centre line.
   * `hint` (node index) narrows the search window for forward tracking; omit for a global search.
   */
  project(x: number, z: number, hint?: number, window = 40): Projection {
    const lo = hint === undefined ? 0 : Math.max(0, hint - window);
    const hi = hint === undefined ? this.n - 1 : Math.min(this.n - 1, hint + window);
    let best = lo, bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    // refine on the neighbouring segments
    let bs = this.s[best], bl = 0, bdist = Math.sqrt(bd), bidx = best;
    for (const i of [best - 1, best]) {
      if (i < 0 || i >= this.n - 1) continue;
      const ax = this.x[i], az = this.z[i], bx = this.x[i + 1], bz = this.z[i + 1];
      const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / len2));
      const px = ax + vx * t, pz = az + vz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (dist <= bdist + 1e-9) {
        bdist = dist; bs = lerp(this.s[i], this.s[i + 1], t); bidx = i + Math.round(t);
        const len = Math.sqrt(len2);
        bl = ((x - px) * -vz + (z - pz) * vx) / len;                // signed distance along the right normal
      }
    }
    return { s: bs, lateral: bl, index: bidx, distance: bdist };
  }

  get startElevation(): number { return this.rawY[0] + this.delta[0]; }
  get finishElevation(): number { return this.rawY[this.n - 1] + this.delta[this.n - 1]; }
  get verticalDrop(): number { return this.startElevation - this.finishElevation; }
}

/** Builds the course from the raw OSM polyline (lat/lon). */
export function buildCourse(raw: RawCourse, terrain: Terrain, frame: GeoFrame = terrain.frame): Course {
  const pts = raw.pts.map(([lat, lon]) => { const p = frame.toLocal(lat, lon); return [p.x, p.z]; });
  // OSM downhill ways are drawn top -> bottom; keep that direction. Densify with Catmull-Rom, then resample.
  const dense: number[][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 10; k++) dense.push(catmull(p0, p1, p2, p3, k / 10));
  }
  dense.push(pts[pts.length - 1]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = cum[cum.length - 1], n = Math.floor(total / STEP) + 1;
  const xs = new Float64Array(n), zs = new Float64Array(n);
  const cx = dense.map((p) => p[0]), cz = dense.map((p) => p[1]);
  for (let i = 0; i < n; i++) { xs[i] = interp(cum, cx, i * STEP); zs[i] = interp(cum, cz, i * STEP); }
  // light smoothing removes the OSM vertex kinks while keeping the corners
  const sx = gaussianSmooth(xs, 6), sz = gaussianSmooth(zs, 6);
  sx[0] = xs[0]; sz[0] = zs[0]; sx[n - 1] = xs[n - 1]; sz[n - 1] = zs[n - 1];
  return new Course(raw.name, terrain, sx, sz);
}
