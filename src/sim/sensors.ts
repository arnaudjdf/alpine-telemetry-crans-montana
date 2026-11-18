import type { GeoFrame } from '../core/geo';
import { gaussian, makeRng } from '../core/math';
import { type RawPacket, SAMPLE_RATE, packetChecksum } from '../core/packet';
import type { AthleteProfile } from './athletes';
import type { TruthRun } from './physics';

/** What was deliberately broken in a feed; the analysis tests check that each one is detected. */
export interface InjectedFault {
  kind: 'dropout' | 'gnss_spike' | 'stuck_imu' | 'duplicate' | 'bad_crc' | 'malformed' | 'clock_step';
  bib: number;
  t: number;          // seconds after start
  detail: number;     // dropout: lost packets; spike: displacement m; stuck: duration s; clock_step: step s; else count/1
}

export interface SensorOutput {
  lines: string[];                 // file content, arrival order
  faults: InjectedFault[];
  packets: number;
}

const r = (v: number, d: number) => Number(v.toFixed(d));    // round to d decimals, as a real logger would
const ANTENNA = 1.0;                                          // m: logger height above the snow

type Rng = () => number;
interface Arrival { pkt: RawPacket; arrival: number }

/** When and how each fault happens in one athlete's feed. Times are seconds after the start. */
interface FaultPlan {
  dropouts: { t: number; dur: number }[];
  spikes: { t: number; n: number; dist: number; ang: number }[];
  stuck: { t: number; dur: number } | null;           // frozen vertical accelerometer (one athlete only)
  clockOffset: number; driftPpm: number;               // device clock vs true time
  clockStep: { t: number; step: number } | null;       // sudden clock correction (one athlete only)
}

/** Draws the fault plan from the seeded RNG (the draw order matters: it keeps the feeds reproducible). */
function planFaults(rng: Rng, bib: number, runEnd: number): FaultPlan {
  const between = (a: number, b: number) => a + rng() * (b - a);
  const dropouts = [between(14, 30), between(45, 70), between(75, Math.max(80, runEnd - 8))]
    .map((t) => ({ t, dur: between(0.35, 1.6) }));
  const spikes = [between(20, 40), between(55, 85)].map((t) => ({
    t, n: 1 + Math.floor(rng() * 3), dist: between(35, 110), ang: rng() * 6.283 /* ~2π */,
  }));
  const stuck = bib === 12 ? { t: between(30, 60), dur: between(1.2, 2.4) } : null;
  const clockOffset = between(0.12, 0.45), driftPpm = between(8, 35);
  const clockStep = bib === 21 ? { t: between(40, 70), step: -0.2 } : null;
  return { dropouts, spikes, stuck, clockOffset, driftPpm, clockStep };
}

/**
 * Turns ground truth into noisy, imperfect logger output. Deterministic for a given profile.
 *   1. plan the faults,  2. render one noisy packet per sample,  3. break the transport (loss, dupes, CRC, truncation).
 */
export function renderFeed(truth: TruthRun, p: AthleteProfile, frame: GeoFrame, startEpoch: number): SensorOutput {
  const rng = makeRng(p.seed * 31 + 5);
  const faults: InjectedFault[] = [];
  const plan = planFaults(rng, p.bib, truth.finishTime);
  const packets = renderPackets(truth, p, frame, startEpoch, plan, rng, faults);
  const lines = breakTransport(packets, truth, p.bib, plan, rng, faults);
  return { lines, faults, packets: packets.length };
}

/** Time (s after start) of the k-th packet. */
const stride = (truth: TruthRun) => Math.round(1 / (SAMPLE_RATE * truth.dt));
const packetTime = (truth: TruthRun, k: number) => truth.t0 + k * stride(truth) * truth.dt;

/** Step 2: one packet per 1/SAMPLE_RATE s, with GNSS noise, IMU noise, device clock error and latency. */
function renderPackets(
  truth: TruthRun, p: AthleteProfile, frame: GeoFrame, startEpoch: number, plan: FaultPlan, rng: Rng, faults: InjectedFault[],
): Arrival[] {
  const g = () => gaussian(rng);
  const total = Math.floor((truth.n - 1) / stride(truth));
  const gnssError = { x: 0, z: 0, alt: 0 };              // AR(1) error: slowly varying, like real multipath
  const frozen = { az: 0 };
  const out: Arrival[] = [];

  for (let k = 0; k <= total; k++) {
    const i = k * stride(truth), t = packetTime(truth, k);

    // --- GNSS position, quality indicators, spikes -----------------------------------------------
    gnssError.x = 0.9 * gnssError.x + 0.436 * 0.32 * g();
    gnssError.z = 0.9 * gnssError.z + 0.436 * 0.32 * g();
    gnssError.alt = 0.9 * gnssError.alt + 0.436 * 0.6 * g();
    let x = truth.x[i] + gnssError.x, z = truth.z[i] + gnssError.z;
    let hdop = 0.85 + Math.abs(g()) * 0.18, nsat = 15 + Math.round(g() * 1.2);
    const spike = plan.spikes.find((s) => t >= s.t && t < s.t + s.n / SAMPLE_RATE);
    if (spike) {                                          // jump away and report poor quality (as a multipath spike would)
      x += Math.cos(spike.ang) * spike.dist; z += Math.sin(spike.ang) * spike.dist;
      hdop = 4 + rng() * 5; nsat = 4 + Math.round(rng() * 2);
      if (t - spike.t < 1 / SAMPLE_RATE) faults.push({ kind: 'gnss_spike', bib: p.bib, t, detail: r(spike.dist, 0) });
    }
    const { lat, lon } = frame.toGeo(x, z);
    const speed = Math.max(0, truth.hv[i] + 0.08 * g());

    // --- IMU: ideal force + broadband noise + snow chatter (grows with speed) ----------------------
    const chatter = truth.air[i] ? 0.2 : 0.9 + (truth.v[i] / 30) * 1.4;
    let az = truth.az[i] + chatter * g();
    const ax = truth.ax[i] + 0.25 * g() + 0.3 * chatter * g();
    const ay = truth.ay[i] + 0.3 * g() + 0.4 * chatter * g();
    if (plan.stuck && t >= plan.stuck.t && t < plan.stuck.t + plan.stuck.dur) {
      if (t - plan.stuck.t < 1 / SAMPLE_RATE) {
        frozen.az = az;
        faults.push({ kind: 'stuck_imu', bib: p.bib, t, detail: r(plan.stuck.dur, 1) });
      }
      az = frozen.az;
    }

    // --- device clock (offset + drift + optional step) and gateway receive time ----------------------------
    const clockError = plan.clockOffset + t * plan.driftPpm * 1e-6 + (plan.clockStep && t >= plan.clockStep.t ? plan.clockStep.step : 0);
    const body = {
      src: p.src, bib: p.bib, seq: k, ts: r(startEpoch + t + clockError, 3), rx: 0, lat: r(lat, 6), lon: r(lon, 6),
      alt: r(truth.y[i] + ANTENNA + gnssError.alt, 1), spd: r(speed, 2), hdop: r(hdop, 1), nsat, ax: r(ax, 2), ay: r(ay, 2), az: r(az, 2),
    };
    const jitter = 0.03 + Math.abs(g()) * 0.02;
    const lateByRadio = rng() < 0.02 ? 0.15 + rng() * 0.25 : 0;   // a few packets arrive late -> out of order in the file
    const rx = r(startEpoch + t + jitter + lateByRadio, 3);
    out.push({ pkt: { ...body, rx, crc: packetChecksum({ ...body, rx }) }, arrival: rx });
  }
  if (plan.clockStep) faults.push({ kind: 'clock_step', bib: p.bib, t: plan.clockStep.t, detail: plan.clockStep.step });
  return out;
}

/** Step 3: drop packets, corrupt checksums, duplicate lines, truncate a few writes; return lines in arrival order. */
function breakTransport(packets: Arrival[], truth: TruthRun, bib: number, plan: FaultPlan, rng: Rng, faults: InjectedFault[]): string[] {
  const lostRanges = plan.dropouts.map((d) => {
    const first = Math.round(d.t * SAMPLE_RATE) - Math.round(truth.t0 * SAMPLE_RATE), count = Math.max(1, Math.round(d.dur * SAMPLE_RATE));
    faults.push({ kind: 'dropout', bib, t: d.t, detail: count });
    return { first, count };
  });
  const isLost = (seq: number) => lostRanges.some((l) => seq >= l.first && seq < l.first + l.count);

  const out: { line: string; arrival: number }[] = [];
  for (const { pkt, arrival } of packets) {
    if (isLost(pkt.seq)) continue;
    const t = packetTime(truth, pkt.seq);
    let line = JSON.stringify(pkt);
    if (rng() < 0.003) { faults.push({ kind: 'bad_crc', bib, t, detail: 1 }); line = JSON.stringify({ ...pkt, crc: '00000000' }); }
    out.push({ line, arrival });
    if (rng() < 0.004) { out.push({ line, arrival: arrival + 0.002 }); faults.push({ kind: 'duplicate', bib, t, detail: 1 }); }
  }
  for (let j = 0; j < 2; j++) {                           // truncated writes (e.g. logger lost power mid-line)
    const src = packets[Math.floor(rng() * packets.length)];
    out.push({ line: JSON.stringify(src.pkt).slice(0, 40 + Math.floor(rng() * 30)), arrival: src.arrival + 0.001 });
    faults.push({ kind: 'malformed', bib, t: packetTime(truth, src.pkt.seq), detail: 1 });
  }
  return out.sort((a, b) => a.arrival - b.arrival).map((o) => o.line);
}
