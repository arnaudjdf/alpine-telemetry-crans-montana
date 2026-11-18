import type { Course } from '../core/course';
import { G, bracket, gaussianSmooth, interp, makeRng, smoothstep, wrapAngle } from '../core/math';
import type { AthleteProfile } from './athletes';

/** Ground-truth state of a simulated run, uniformly sampled. Time 0 = start gate opens. */
export interface TruthRun {
  dt: number;
  t0: number;                 // time of first sample (negative: pre-start)
  n: number;
  s: Float32Array;            // centre-line chainage, m
  x: Float32Array; y: Float32Array; z: Float32Array;   // local frame, m
  v: Float32Array;            // speed along path, m/s
  hv: Float32Array;           // horizontal ground speed, m/s
  air: Uint8Array;
  ax: Float32Array; ay: Float32Array; az: Float32Array; // ideal IMU specific force
  finishTime: number;         // s after start
}

const RHO = 1.0;              // air density at ~1900 m, kg/m^3
const EDGE_LOSS = 0.032;       // speed loss per unit lateral acceleration
const PRE = 6, POST = 6, DT = 0.01;

/** Lateral offset of the racing line at every centre-line node (m, + right). */
function racingLine(course: Course, p: AthleteProfile): Float64Array {
  const rng = makeRng(p.seed * 977);
  const nodes = [{ s: 0, l: 0 }, ...course.gates.map((g) => ({ s: g.s, l: g.side * Math.max(1, g.offset - 2.5) * p.lineGain })),
    { s: course.length, l: 0 }];
  const waves = [0, 1, 2].map(() => ({ a: 0.5 + rng() * 0.6, lam: 160 + rng() * 260, ph: rng() * 6.28 }));
  const nodeS = nodes.map((q) => q.s);
  const out = new Float64Array(course.n);
  for (let i = 0; i < course.n; i++) {
    const s = course.s[i], k = Math.min(nodes.length - 2, bracket(nodeS, s));
    const u = smoothstep(nodes[k].s, nodes[k + 1].s, s);
    let l = nodes[k].l + (nodes[k + 1].l - nodes[k].l) * u;
    for (const w of waves) l += w.a * Math.sin((2 * Math.PI * s) / w.lam + w.ph);
    out[i] = Math.max(-14, Math.min(14, l));
  }
  return out;
}

/** The line an athlete skis, as arrays indexed by course node, plus the derived quantities the dynamics need. */
interface RacePath {
  x: Float64Array; z: Float64Array;       // local frame position of the racing line
  y: Float64Array;                        // snow surface height along the line (incl. jump features)
  H: Float64Array;                        // horizontal arc length along the line
  slope: Float64Array;                    // dy/dH (smoothed), > 0 uphill
  curvV: Float64Array;                    // d2y/dH2: vertical curvature (negative on a crest)
  curvH: Float64Array;                    // heading change per metre: horizontal curvature (+ right)
}

/** Racing line -> geometry: positions, surface profile, slope and the two curvatures. */
function buildRacePath(course: Course, p: AthleteProfile): RacePath {
  const m = course.n, lateral = racingLine(course, p);
  const x = new Float64Array(m), z = new Float64Array(m), terrainY = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    x[i] = course.x[i] + Math.cos(course.heading[i]) * lateral[i];      // right-hand normal of the centre line
    z[i] = course.z[i] + Math.sin(course.heading[i]) * lateral[i];
    terrainY[i] = course.terrain.heightAt(x[i], z[i]) + course.delta[i];
  }
  // smooth the DEM noise, then add the jump features (which must stay sharp)
  const smoothY = gaussianSmooth(terrainY, 3), y = Float64Array.from(smoothY, (v, i) => v + course.bump(course.s[i]));

  const H = new Float64Array(m);
  for (let i = 1; i < m; i++) H[i] = H[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);

  const around = (i: number) => [Math.max(0, i - 1), Math.min(m - 1, i + 1)] as const;   // central-difference neighbours
  const rawSlope = new Float64Array(m), heading = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const [a, b] = around(i);
    rawSlope[i] = (y[b] - y[a]) / (H[b] - H[a]);
    heading[i] = Math.atan2(x[b] - x[a], -(z[b] - z[a]));
  }
  const slope = gaussianSmooth(rawSlope, 2);
  const rawCurvV = new Float64Array(m), rawCurvH = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const [a, b] = around(i), dH = H[b] - H[a];
    rawCurvV[i] = (slope[b] - slope[a]) / dH;
    rawCurvH[i] = wrapAngle(heading[b] - heading[a]) / dH;
  }
  return { x, z, y, H, slope, curvV: gaussianSmooth(rawCurvV, 1.5), curvH: gaussianSmooth(rawCurvH, 2) };
}

// dynamics constants
const START_PUSH = 2.6, START_PUSH_TIME = 4;      // m/s^2 and s: poling out of the gate
const SKATE_ACCEL = 0.9, SKATE_BELOW = 14;        // m/s^2 and m/s: skating on flats
const TUCK_LOSS = 0.5, TUCK_CURVATURE = 50;       // drag grows by up to 50% when the skier un-tucks in a turn
const FLIGHT_DRAG_FACTOR = 1.3, LANDING_LOSS = 0.97, MIN_FLIGHT_TIME = 0.1, MIN_TAKEOFF_SPEED = 8;
const BRAKING = 5;                                // m/s^2 after the finish line

/** Integrates the run: gravity, snow friction, quadratic drag, edge losses, and ballistic flight over crests. */
export function simulateRun(course: Course, p: AthleteProfile): TruthRun {
  const path = buildRacePath(course, p), { H, y } = path, Hend = H[H.length - 1];
  const at = (arr: ArrayLike<number>, h: number) => interp(H, arr, h);

  // One row per time step: [t, H, height, speed, groundSpeed, airborne, fx, fy, fz]  (f = ideal IMU force)
  const steps: number[][] = [];
  for (let k = 0; k < Math.round(PRE / DT); k++) steps.push([-PRE + k * DT, 0, y[0], 0, 0, 0, 0, 0, G]);   // standing in the gate

  let t = 0, h = 0, v = 0, air = false, vx = 0, vy = 0, height = y[0], finishT = -1, airT = 0;
  while (t < 400) {
    const slope = at(path.slope, h), cosT = 1 / Math.sqrt(1 + slope * slope), sinDown = -slope * cosT;
    const kappa = at(path.curvH, h);
    let fx = 0, fy = 0, fz = 0, groundSpeed = 0;

    if (finishT >= 0) {                                           // --- run-out after the line ---------------
      if (t - finishT > POST) break;
      v = Math.max(0, v - BRAKING * DT); h += v * cosT * DT;
      fx = -BRAKING; fz = G * cosT; groundSpeed = v * cosT; height = at(y, h);
    } else if (!air) {                                            // --- on the snow --------------------------
      const tuck = 1 + TUCK_LOSS * Math.min(1, Math.abs(kappa) * TUCK_CURVATURE);
      const drag = 0.5 * RHO * p.cda * tuck * v * v / p.mass;
      const friction = p.mu * G * cosT;
      const edge = EDGE_LOSS * v * v * Math.abs(kappa);           // energy lost carving: grows with lateral acceleration
      let push = 0;
      if (t < START_PUSH_TIME) push += START_PUSH * (1 - t / START_PUSH_TIME);
      if (v < SKATE_BELOW) push += SKATE_ACCEL * (1 - v / SKATE_BELOW);
      const accel = G * sinDown - friction - drag - edge + push;
      v = Math.max(0, v + accel * DT);
      h += v * cosT * DT;
      height = at(y, h);
      // Normal force per unit mass: gravity component + centripetal term. Negative on a fast crest => take off.
      const normal = G * cosT + (v * v * at(path.curvV, h)) / Math.pow(1 + slope * slope, 1.5);
      fx = accel - G * sinDown;                                   // IMU feels only the non-gravity part along the slope
      fy = -v * v * kappa; fz = Math.max(0, normal); groundSpeed = v * cosT;
      if (v > MIN_TAKEOFF_SPEED && normal < 0) { air = true; airT = 0; vx = v * cosT; vy = slope * vx; }
    } else {                                                      // --- ballistic flight ---------------------
      const speed = Math.hypot(vx, vy), dragA = 0.5 * RHO * p.cda * FLIGHT_DRAG_FACTOR * speed / p.mass;
      vx -= dragA * vx * DT; vy -= (G + dragA * vy) * DT;
      h += vx * DT; height += vy * DT;
      fx = -dragA * speed; groundSpeed = vx;                      // weightless: IMU only feels drag
      const ground = at(y, h), groundSlope = at(path.slope, h);
      airT += DT;
      if (airT < MIN_FLIGHT_TIME) height = Math.max(height, ground);   // avoid instant re-landing from numerical chatter
      else if (height <= ground) {                                // landing: keep the velocity component along the slope
        v = Math.max(0, ((vx + vy * groundSlope) / Math.sqrt(1 + groundSlope * groundSlope)) * LANDING_LOSS);
        air = false; height = ground; fz = G * 4;
      }
    }
    steps.push([t, Math.min(h, Hend), height, v, groundSpeed, air ? 1 : 0, fx, fy, fz]);
    if (h >= Hend && finishT < 0) { finishT = t; air = false; }
    t += DT;
  }
  return packTruth(steps, course, path, finishT);
}

/** Row-per-step list -> typed arrays, with chainage and position looked up from the path. */
function packTruth(steps: number[][], course: Course, path: RacePath, finishT: number): TruthRun {
  const n = steps.length, { H } = path, Hend = H[H.length - 1];
  const out: TruthRun = {
    dt: DT, t0: steps[0][0], n, finishTime: finishT,
    s: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
    v: new Float32Array(n), hv: new Float32Array(n), air: new Uint8Array(n),
    ax: new Float32Array(n), ay: new Float32Array(n), az: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const [, h, height, v, groundSpeed, airborne, fx, fy, fz] = steps[i], hh = Math.min(h, Hend);
    out.s[i] = interp(H, course.s, hh); out.x[i] = interp(H, path.x, hh); out.z[i] = interp(H, path.z, hh);
    out.y[i] = height; out.v[i] = v; out.hv[i] = groundSpeed; out.air[i] = airborne;
    out.ax[i] = fx; out.ay[i] = fy; out.az[i] = fz;
  }
  return out;
}
