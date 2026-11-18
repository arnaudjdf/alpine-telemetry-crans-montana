import type { Course } from '../core/course';
import { interp, makeRng, gaussian } from '../core/math';
import type { FeedManifest, TimingEvent } from '../core/packet';
import { ATHLETES, type AthleteProfile } from './athletes';
import { simulateRun, type TruthRun } from './physics';
import { type InjectedFault, renderFeed } from './sensors';

export interface GeneratedFeeds {
  manifest: FeedManifest;
  files: Record<string, string>;
  faults: InjectedFault[];
  truth: Record<number, TruthRun>;
  timing: TimingEvent[];
}

export const RACE_EPOCH = Date.UTC(2027, 1, 6, 11, 0, 0) / 1000;   // 2027-02-06 11:00 UTC (illustrative)

/** Time (s after start) at which the truth run reaches chainage s. */
export function truthTimeAtChainage(run: TruthRun, s: number): number {
  const ts = new Float64Array(run.n), ss = new Float64Array(run.n);
  let last = -1;
  const idx: number[] = [];
  for (let i = 0; i < run.n; i++) if (run.s[i] > last + 1e-6) { idx.push(i); last = run.s[i]; }
  idx.forEach((i, k) => { ts[k] = run.t0 + i * run.dt; ss[k] = run.s[i]; });
  return interp(ss.subarray(0, idx.length), ts.subarray(0, idx.length), s);
}

/** Official-style timing: photocell beams at the course timing points, hundredth resolution. */
function officialTiming(course: Course, p: AthleteProfile, run: TruthRun): TimingEvent[] {
  const rng = makeRng(p.seed * 53 + 1);
  const t0 = truthTimeAtChainage(run, 0.5);
  return course.timing.map((tp, i) => {
    const raw = i === 0 ? 0 : truthTimeAtChainage(run, Math.min(tp.s, run.s[run.n - 1] - 0.01)) - t0 + 0.004 * gaussian(rng);
    const missed = p.bib === 33 && tp.id === 'SPLIT2';           // a photocell miss: the system reports an estimate
    return {
      bib: p.bib, point: tp.id, chainage: Math.round(tp.s),
      time: Number((raw + (missed ? 0.17 : 0)).toFixed(2)), status: missed ? 'ESTIMATED' : 'OK',
    };
  });
}

export function generateFeeds(course: Course, athletes: AthleteProfile[] = ATHLETES): GeneratedFeeds {
  const files: Record<string, string> = {};
  const faults: InjectedFault[] = [];
  const truth: Record<number, TruthRun> = {};
  const timing: TimingEvent[] = [];
  const manifestAthletes: FeedManifest['athletes'] = [];
  athletes.forEach((p, k) => {
    const run = simulateRun(course, p);
    truth[p.bib] = run;
    const startEpoch = RACE_EPOCH + k * 95;
    const out = renderFeed(run, p, course.terrain.frame, startEpoch);
    const file = `bib${String(p.bib).padStart(2, '0')}.ndjson`;
    files[file] = out.lines.join('\n') + '\n';
    faults.push(...out.faults);
    timing.push(...officialTiming(course, p, run));
    manifestAthletes.push({ bib: p.bib, name: p.name, nation: p.nation, color: p.color, src: p.src, file, startEpoch });
  });
  files['timing.csv'] = ['bib,point,chainage_m,time_s,status',
    ...timing.map((e) => `${e.bib},${e.point},${e.chainage},${e.time.toFixed(2)},${e.status}`)].join('\n') + '\n';
  const manifest: FeedManifest = {
    event: 'FIS Alpine World Championships Crans-Montana 2027 (concept demo)', date: '2027-02-06',
    course: course.name,
    disclaimer: 'Synthetic data: physics-based simulation on real terrain. Course geometry from OpenStreetMap, not the official line.',
    athletes: manifestAthletes, timingFile: 'timing.csv', sampleRate: 20,
  };
  files['manifest.json'] = JSON.stringify(manifest, null, 2);
  return { manifest, files, faults, truth, timing };
}
