/**
 * Stage 2 of the pipeline: raw packets -> one clean, uniformly sampled track.
 *
 * Raw loggers are messy, so the work is split into small, individually explainable steps:
 *
 *   1. dedupe & order     duplicates, out-of-order arrival
 *   2. counter grid       one slot per packet counter value; holes become visible
 *   3. dropouts           runs of missing slots
 *   4. GNSS validation    reject position spikes (quality gate + plausibility test)
 *   5. stuck IMU          detect a frozen channel
 *   6. fill & smooth      interpolate holes, light low-pass filtering
 *   7. clock analysis     device clock vs packet counter (offset, drift, steps)
 *
 * Key design choice: the time axis is rebuilt from the packet counter (`seq / rate`), never from the
 * device clock, because the counter survives drift and clock steps.
 */
import type { GeoFrame } from '../core/geo';
import { gaussianSmooth, median } from '../core/math';
import { SAMPLE_RATE, type RawPacket } from '../core/packet';
import {
  type CleanReport, type CleanTrack, type ClockReport, type DropoutGap, FLAG_FILLED, FLAG_SPIKE, FLAG_STUCK,
  type SpikeEvent, type StuckEvent,
} from './types';

// --- tunables ----------------------------------------------------------------------------------------
const MAX_HDOP = 3;                 // GNSS quality gate
const MIN_SATS = 7;
const JUMP_TOLERANCE = 12;          // m, base tolerance against the constant-velocity prediction
const MAX_SPEED = 55;               // m/s, physical ceiling for alpine skiing
const REACQUIRE_AFTER = 12;         // consecutive rejected samples (0.6 s) before the validator re-locks
const STUCK_MIN_SAMPLES = 8;        // identical consecutive IMU values that count as "frozen"
const MIN_DROPOUT = 4;              // packets; shorter holes are single lost frames (CRC rejects), not dropouts
const VELOCITY_WINDOW = 8;          // accepted samples used to estimate the current velocity

/** Raw channels laid out on the packet-counter grid (slot k = counter value seq0 + k). */
interface Grid {
  n: number;
  seq0: number;
  present: Uint8Array;              // 1 where a packet arrived
  x: Float64Array; z: Float64Array; alt: Float64Array; spd: Float64Array;
  ax: Float64Array; ay: Float64Array; az: Float64Array;
  hdop: Float64Array; nsat: Float64Array;
}

// =====================================================================================================
// 1. dedupe & order
// =====================================================================================================
interface Ordered { bySeq: Map<number, RawPacket>; seqs: number[]; duplicates: number; outOfOrder: number }

/** Keeps the first copy of every counter value; counts how many were repeated or arrived late. */
function dedupeAndOrder(packets: RawPacket[]): Ordered {
  const bySeq = new Map<number, RawPacket>();
  let duplicates = 0, outOfOrder = 0, maxSeq = -Infinity;
  for (const p of packets) {                       // packets are in arrival order here
    if (bySeq.has(p.seq)) { duplicates++; continue; }
    bySeq.set(p.seq, p);
    if (p.seq < maxSeq) outOfOrder++;              // a smaller counter after a larger one = late packet
    maxSeq = Math.max(maxSeq, p.seq);
  }
  return { bySeq, seqs: [...bySeq.keys()].sort((a, b) => a - b), duplicates, outOfOrder };
}

// =====================================================================================================
// 2. counter grid
// =====================================================================================================
function buildGrid({ bySeq, seqs }: Ordered, frame: GeoFrame): Grid {
  const seq0 = seqs[0], n = seqs[seqs.length - 1] - seq0 + 1;
  const channel = () => new Float64Array(n);
  const g: Grid = {
    n, seq0, present: new Uint8Array(n), x: channel(), z: channel(), alt: channel(), spd: channel(),
    ax: channel(), ay: channel(), az: channel(), hdop: channel(), nsat: channel(),
  };
  for (const seq of seqs) {
    const k = seq - seq0, p = bySeq.get(seq)!, local = frame.toLocal(p.lat, p.lon);
    g.present[k] = 1; g.x[k] = local.x; g.z[k] = local.z; g.alt[k] = p.alt; g.spd[k] = p.spd;
    g.ax[k] = p.ax; g.ay[k] = p.ay; g.az[k] = p.az; g.hdop[k] = p.hdop; g.nsat[k] = p.nsat;
  }
  return g;
}

// =====================================================================================================
// 3. dropouts
// =====================================================================================================
/** Runs of missing slots of at least MIN_DROPOUT packets. */
function findDropouts(g: Grid, dt: number): DropoutGap[] {
  const out: DropoutGap[] = [];
  for (let k = 1; k < g.n; k++) {
    if (g.present[k] || !g.present[k - 1]) continue;       // look for the first slot of a hole
    let end = k;
    while (end < g.n && !g.present[end]) end++;
    if (end - k >= MIN_DROPOUT) out.push({ seqStart: g.seq0 + k, lost: end - k, t: k * dt, seconds: (end - k) * dt });
    k = end;
  }
  return out;
}

// =====================================================================================================
// 4. GNSS validation
// =====================================================================================================
/**
 * Decides, sample by sample, whether the GNSS position can be trusted.
 *
 * A sample is rejected when (a) the receiver itself reports poor quality (HDOP / satellites), or
 * (b) it is physically implausible compared with the last accepted samples:
 *    - short gap: distance to the constant-velocity prediction must be small (grows with the gap, since
 *      the skier accelerates sideways in turns);
 *    - long gap (> 0.5 s): prediction is meaningless, only a speed ceiling is enforced.
 * If many consecutive samples are rejected, the validator re-locks on the new track: a persistent track
 * is more likely the truth than our stale reference.
 */
function validateGnss(g: Grid, dt: number): { valid: Uint8Array; spikes: SpikeEvent[] } {
  const valid = new Uint8Array(g.present);
  const spikes: SpikeEvent[] = [];
  const accepted: number[] = [];
  let rejectedRun = 0, openSpike: SpikeEvent | null = null;

  const qualityOk = (k: number) => g.hdop[k] <= MAX_HDOP && g.nsat[k] >= MIN_SATS;

  /** Distance of sample k to where the last accepted samples say it should be (or to the last one). */
  const deviation = (k: number): { disp: number; limit: number } => {
    const last = accepted[accepted.length - 1], ref = accepted[Math.max(0, accepted.length - VELOCITY_WINDOW)];
    const rawGap = (k - last) * dt;
    if (rawGap > 0.5) {
      return { disp: Math.hypot(g.x[k] - g.x[last], g.z[k] - g.z[last]), limit: MAX_SPEED * rawGap + 15 };
    }
    const span = Math.max(1, last - ref) * dt, gap = Math.min(rawGap, 3);
    const vx = last === ref ? 0 : (g.x[last] - g.x[ref]) / span, vz = last === ref ? 0 : (g.z[last] - g.z[ref]) / span;
    return {
      disp: Math.hypot(g.x[k] - (g.x[last] + vx * gap), g.z[k] - (g.z[last] + vz * gap)),
      limit: JUMP_TOLERANCE + 12.5 * gap * gap,
    };
  };

  for (let k = 0; k < g.n; k++) {
    if (!g.present[k]) continue;
    let bad = !qualityOk(k), disp = 0;
    if (accepted.length) {
      const dev = deviation(k);
      disp = dev.disp;
      if (dev.disp > dev.limit) bad = true;
      if (bad && rejectedRun >= REACQUIRE_AFTER && qualityOk(k)) bad = false;      // re-acquire
    }
    if (!bad) { rejectedRun = 0; accepted.push(k); continue; }

    rejectedRun++;
    valid[k] = 0;
    const continuesSpike = openSpike && k - openSpike.t / dt <= openSpike.samples + 2;
    if (openSpike && continuesSpike) {
      openSpike.samples++;
      openSpike.maxDisplacement = Math.max(openSpike.maxDisplacement, disp);
    } else {
      openSpike = { t: k * dt, samples: 1, maxDisplacement: disp };
      spikes.push(openSpike);
    }
  }
  return { valid, spikes };
}

// =====================================================================================================
// 5. stuck IMU
// =====================================================================================================
/** A channel that returns exactly the same value many times in a row is frozen, not measuring. */
function findStuckImu(g: Grid, dt: number): { imuValid: Uint8Array; stuck: StuckEvent[] } {
  const imuValid = new Uint8Array(g.present);
  const stuck: StuckEvent[] = [];
  for (let k = 1; k < g.n; k++) {
    let end = k;
    while (end < g.n && g.present[end] && g.present[end - 1] && g.az[end] === g.az[end - 1]) end++;
    const length = end - k + 1;
    if (length < STUCK_MIN_SAMPLES) continue;
    for (let j = k - 1; j < end; j++) imuValid[j] = 0;
    stuck.push({ t: (k - 1) * dt, seconds: length * dt, channel: 'az' });
    k = end;
  }
  return { imuValid, stuck };
}

// =====================================================================================================
// 6. fill & smooth
// =====================================================================================================
/** Cubic Hermite fill of `values` wherever `valid` is false, using local finite-difference slopes. */
function hermiteFill(values: Float64Array, valid: Uint8Array, dt: number): void {
  const n = values.length;
  let i = 0;
  while (i < n) {
    if (valid[i]) { i++; continue; }
    const a = i - 1;                                       // last good sample before the hole
    let b = i;
    while (b < n && !valid[b]) b++;                        // first good sample after the hole
    if (a < 0) { for (let k = 0; k < b; k++) values[k] = values[b]; i = b; continue; }
    if (b >= n) { for (let k = a + 1; k < n; k++) values[k] = values[a]; break; }
    const slope = (from: number, dir: 1 | -1) => {        // average slope over up to 3 neighbouring good samples
      let j = from, steps = 0;
      while (steps < 3 && j + dir >= 0 && j + dir < n && valid[j + dir]) { j += dir; steps++; }
      return steps ? ((values[from] - values[j]) / (from - j)) / dt : 0;
    };
    const ma = slope(a, -1), mb = slope(b, 1), span = (b - a) * dt;
    for (let k = a + 1; k < b; k++) {
      const u = (k - a) / (b - a), u2 = u * u, u3 = u2 * u;
      values[k] = (2 * u3 - 3 * u2 + 1) * values[a] + (u3 - 2 * u2 + u) * span * ma
                + (-2 * u3 + 3 * u2) * values[b] + (u3 - u2) * span * mb;
    }
    i = b;
  }
}

// =====================================================================================================
// 7. clock analysis
// =====================================================================================================
const percentile = (values: number[], p: number): number => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN;
};

/** Least-squares slope of y over x. */
function slopeOf(xs: number[], ys: number[]): number {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  ys.forEach((y, i) => { num += (xs[i] - mx) * (y - my); den += (xs[i] - mx) ** 2; });
  return den ? num / den : 0;
}

/**
 * Compares the device clock with the packet counter.
 * residual(k) = ts_k - k/rate:  constant = clock offset, slope = drift, jump = clock step.
 * Steps are found where the median before/after a window differs by > 0.1 s; the centre of the plateau
 * of that difference is the step position. Drift is the slope after removing the steps.
 */
function analyseClock(o: Ordered, seq0: number, dt: number): { clock: ClockReport; epoch0: number } {
  const WINDOW = 40, STEP_THRESHOLD = 0.1;
  const ks = o.seqs.map((s) => s - seq0);
  const residual = o.seqs.map((s, i) => o.bySeq.get(s)!.ts - ks[i] * dt);
  const epoch0 = median(residual.slice(0, 200));
  const corrected = residual.map((v) => v - epoch0);
  const diffAt = (j: number) => median(corrected.slice(j, j + WINDOW)) - median(corrected.slice(j - WINDOW, j));

  const steps: { t: number; seconds: number }[] = [];
  for (let i = WINDOW; i < corrected.length - WINDOW; i++) {
    if (Math.abs(diffAt(i)) <= STEP_THRESHOLD) continue;
    const hi = Math.min(corrected.length - WINDOW, i + 2 * WINDOW);
    let peak = 0;
    for (let j = i; j < hi; j++) peak = Math.max(peak, Math.abs(diffAt(j)));
    const plateau: number[] = [];
    for (let j = i; j < hi; j++) if (Math.abs(diffAt(j)) >= 0.97 * peak) plateau.push(j);
    const at = Math.round((plateau[0] + plateau[plateau.length - 1]) / 2), size = diffAt(at);
    steps.push({ t: ks[at] * dt, seconds: size });
    for (let j = at; j < corrected.length; j++) corrected[j] -= size;        // remove the step, keep looking
    i = at + WINDOW;
  }

  const driftPpm = (slopeOf(ks, corrected) / dt) * 1e6;
  const latency = o.seqs.map((s) => o.bySeq.get(s)!.rx - o.bySeq.get(s)!.ts);
  const offset = median(latency);
  return { epoch0, clock: { offsetToGateway: offset, driftPpm, steps, latencyP95: percentile(latency, 0.95) - offset } };
}

// =====================================================================================================
// orchestration
// =====================================================================================================
/** Turns raw packets (arrival order, with duplicates, gaps, spikes, clock trouble) into a uniform track. */
export function cleanPackets(packets: RawPacket[], frame: GeoFrame, rate = SAMPLE_RATE): { track: CleanTrack; report: CleanReport } {
  if (!packets.length) throw new Error('no valid packets to clean');
  const dt = 1 / rate;

  const ordered = dedupeAndOrder(packets);
  const grid = buildGrid(ordered, frame);
  const dropouts = findDropouts(grid, dt);
  const { valid, spikes } = validateGnss(grid, dt);
  const { imuValid, stuck } = findStuckImu(grid, dt);

  // per-sample provenance flags, shown in the UI ("RECONSTRUCTED", "GNSS REJECTED", "IMU STUCK")
  const flags = new Uint8Array(grid.n);
  for (let k = 0; k < grid.n; k++) {
    if (!grid.present[k]) flags[k] |= FLAG_FILLED;
    else {
      if (!valid[k]) flags[k] |= FLAG_SPIKE;
      if (!imuValid[k]) flags[k] |= FLAG_STUCK;
    }
  }

  // position-type channels are filled over holes AND rejected samples; IMU over holes (az also over freezes)
  for (const channel of [grid.x, grid.z, grid.alt, grid.spd]) hermiteFill(channel, valid, dt);
  for (const channel of [grid.ax, grid.ay]) hermiteFill(channel, grid.present, dt);
  hermiteFill(grid.az, imuValid, dt);

  const { clock, epoch0 } = analyseClock(ordered, grid.seq0, dt);
  const track: CleanTrack = {
    bib: packets[0].bib, src: packets[0].src, rate, n: grid.n, epoch0, flags,
    t: Float64Array.from({ length: grid.n }, (_, k) => k * dt),
    x: gaussianSmooth(grid.x, 1.5), z: gaussianSmooth(grid.z, 1.5), alt: gaussianSmooth(grid.alt, 2), spd: gaussianSmooth(grid.spd, 1),
    ax: gaussianSmooth(grid.ax, 1), ay: gaussianSmooth(grid.ay, 1), az: gaussianSmooth(grid.az, 0.7),
  };
  const report: CleanReport = {
    received: ordered.seqs.length, expected: grid.n, duplicates: ordered.duplicates, outOfOrder: ordered.outOfOrder,
    dropouts, spikes, stuck, clock, completeness: ordered.seqs.length / grid.n,
  };
  return { track, report };
}
