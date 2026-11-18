/**
 * Stage 4 of the pipeline: turn everything the earlier stages noticed into one flat, time-sorted list of
 * events the UI can show and seek through. Nothing is computed here, it only describes and classifies.
 */
import { interp } from '../core/math';
import type { MetricsResult } from './metrics';
import type { Anomaly, CleanReport, ParseResult, Severity } from './types';

const TIMING_WARN = 0.05;           // s: GNSS vs official difference worth showing
const TIMING_ERROR = 0.12;          // s: difference that suggests a timing problem
const LONG_DROPOUT = 1;             // s: dropouts longer than this are warnings, shorter ones info
const HIGH_G = 2.4;                 // g: lateral load peak worth a note
const HIGH_G_SPACING = 4;           // s between two reported peaks

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

type Draft = Omit<Anomaly, 'id' | 'bib' | 's'>;

// ---------------------------------------------------------------------------------------------------
// one function per source of anomalies; each returns drafts in *run time*
// ---------------------------------------------------------------------------------------------------
function fromCleaning(report: CleanReport, toRunTime: (t: number) => number): Draft[] {
  const out: Draft[] = [];
  for (const d of report.dropouts) {
    out.push({
      kind: 'dropout', severity: d.seconds > LONG_DROPOUT ? 'warn' : 'info', t: toRunTime(d.t),
      message: `${d.lost} packets lost (${d.seconds.toFixed(2)} s); position reconstructed by Hermite interpolation`,
    });
  }
  for (const s of report.spikes) {
    out.push({
      kind: 'gnss_spike', severity: 'warn', t: toRunTime(s.t),
      message: `GNSS jump of ${s.maxDisplacement.toFixed(0)} m over ${plural(s.samples, 'sample')} rejected (low satellite count / high HDOP)`,
    });
  }
  for (const s of report.stuck) {
    out.push({
      kind: 'stuck_imu', severity: 'warn', t: toRunTime(s.t),
      message: `IMU ${s.channel} frozen for ${s.seconds.toFixed(1)} s; flight/g-load detection suspended`,
    });
  }
  for (const c of report.clock.steps) {
    out.push({
      kind: 'clock_step', severity: 'error', t: toRunTime(c.t),
      message: `Device clock stepped by ${c.seconds.toFixed(2)} s; timeline rebuilt from the packet counter`,
    });
  }
  return out;
}

/** Duplicates, re-ordering, malformed lines and bad checksums are summarised in a single note. */
function fromTransport(parse: ParseResult, report: CleanReport): Draft[] {
  const notes: string[] = [];
  if (report.duplicates) notes.push(`${report.duplicates} duplicates dropped`);
  if (report.outOfOrder) notes.push(`${report.outOfOrder} packets re-ordered`);
  if (parse.malformed) notes.push(`${parse.malformed} malformed lines skipped`);
  if (parse.badCrc) notes.push(`${parse.badCrc} checksum failures discarded`);
  return notes.length ? [{ kind: 'transport', severity: 'info', t: 0, message: notes.join(', ') }] : [];
}

/** GNSS-derived split times that disagree with the official photocell timing. */
function fromTiming(m: MetricsResult): Draft[] {
  const out: Draft[] = [];
  for (const split of m.splits) {
    if (split.delta === undefined || split.id === 'START') continue;
    const size = Math.abs(split.delta);
    if (size <= TIMING_WARN) continue;
    const status = split.officialStatus && split.officialStatus !== 'OK' ? `, timing status ${split.officialStatus}` : '';
    const severity: Severity = size > TIMING_ERROR ? 'error' : 'warn';
    out.push({
      kind: 'timing', severity, t: split.gnssTime,
      message: `${split.label}: GNSS ${split.gnssTime.toFixed(2)} s vs official ${split.officialTime!.toFixed(2)} s (${signed(split.delta)} s)${status}`,
    });
  }
  return out;
}

function fromJumps(m: MetricsResult): Draft[] {
  return m.jumps.map((j, k) => ({
    kind: 'jump', severity: 'info', t: j.tTakeoff,
    message: `Jump ${k + 1}: ${j.distance.toFixed(0)} m, ${j.airtime.toFixed(2)} s airtime, ${j.height.toFixed(1)} m high at ${j.speedKmh.toFixed(0)} km/h`,
  }));
}

/** Local maxima of lateral load above HIGH_G, at least HIGH_G_SPACING seconds apart. */
function fromLoads(m: MetricsResult): Draft[] {
  const { gLat, t, s } = m.series, out: Draft[] = [];
  let lastReported = -Infinity;
  for (let k = 1; k < gLat.length - 1; k++) {
    const g = Math.abs(gLat[k]);
    const isPeak = g > HIGH_G && g >= Math.abs(gLat[k - 1]) && g >= Math.abs(gLat[k + 1]);
    if (!isPeak || t[k] - lastReported <= HIGH_G_SPACING || s[k] <= 5) continue;
    out.push({ kind: 'high_g', severity: 'info', t: t[k], message: `Lateral load peak ${g.toFixed(1)} g in a ${gLat[k] > 0 ? 'right' : 'left'} turn` });
    lastReported = t[k];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
/** Collects everything noteworthy about one run into a flat, time-sorted list. */
export function detectAnomalies(bib: number, parse: ParseResult, report: CleanReport, m: MetricsResult): Anomaly[] {
  const toRunTime = (cleanTime: number) => cleanTime - m.t0;                 // clean-track time -> run time (0 = start)
  const drafts = [
    ...fromCleaning(report, toRunTime), ...fromTransport(parse, report),
    ...fromTiming(m), ...fromJumps(m), ...fromLoads(m),
  ];
  return drafts
    .map((d, i): Anomaly => ({ ...d, id: `${bib}-${i}`, bib, s: interp(m.series.t, m.series.s, d.t) }))   // add chainage
    .sort((a, b) => a.t - b.t);
}
