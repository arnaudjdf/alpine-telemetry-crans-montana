import { analyzeAthlete } from '../analysis/pipeline';
import { parseTimingCsv } from '../analysis/parse';
import { buildInsights, type Insight } from '../analysis/story';
import type { RunAnalysis } from '../analysis/types';
import { buildCourse, type Course, type RawCourse } from '../core/course';
import type { AthleteInfo, FeedManifest, TimingEvent } from '../core/packet';
import { terrainFromBuffers, type Terrain, type TerrainMeta } from '../core/terrain';

export interface Piste { id: number; name: string; difficulty: string; pts: [number, number][] }

export interface World {
  terrain: Terrain;
  course: Course;
  pistes: Piste[];
  manifest: FeedManifest;
  timing: TimingEvent[];
  athletes: AthleteInfo[];
  runs: RunAnalysis[];
  insights: Insight[];
  /** Raw log text per bib, kept for the "export" and "reanalyse" features. */
  logs: Map<number, string>;
  pipelineMs: number;
}

const base = import.meta.env.BASE_URL + 'data/';
const getJson = async <T>(f: string): Promise<T> => {
  const r = await fetch(base + f);
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
};
const getText = async (f: string): Promise<string> => {
  const r = await fetch(base + f);
  if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  return r.text();
};

const PALETTE = ['#ff7a1a', '#38bdf8', '#a3e635', '#f472b6', '#facc15', '#c084fc', '#2dd4bf', '#fb7185'];

export function analyse(world: Pick<World, 'course' | 'athletes' | 'timing'>, logs: Map<number, string>): { runs: RunAnalysis[]; insights: Insight[] } {
  const runs = world.athletes.filter((a) => logs.has(a.bib)).map((a) => analyzeAthlete(logs.get(a.bib)!, world.course, world.timing));
  const names = Object.fromEntries(world.athletes.map((a) => [a.bib, `${a.nation} ${String(a.bib).padStart(2, '0')}`]));
  return { runs, insights: buildInsights(runs, world.course, names) };
}

export async function loadWorld(onProgress: (msg: string) => void = () => {}): Promise<World> {
  onProgress('Loading terrain model…');
  const [meta, binRes, rawCourse, pistes, manifest] = await Promise.all([
    getJson<TerrainMeta>('terrain.json'), fetch(base + 'terrain.bin'), getJson<RawCourse>('course.json'),
    getJson<Piste[]>('pistes.json'), getJson<FeedManifest>('feeds/manifest.json'),
  ]);
  const terrain = terrainFromBuffers(meta, await binRes.arrayBuffer());
  const course = buildCourse(rawCourse, terrain);

  onProgress('Fetching raw logger feeds…');
  const [timingText, ...texts] = await Promise.all([getText(`feeds/${manifest.timingFile}`), ...manifest.athletes.map((a) => getText(`feeds/${a.file}`))]);
  const logs = new Map(manifest.athletes.map((a, i) => [a.bib, texts[i]]));
  const timing = parseTimingCsv(timingText);

  onProgress('Running ingest and analysis pipeline…');
  const partial = { course, athletes: manifest.athletes, timing };
  const t0 = performance.now();
  const { runs, insights } = analyse(partial, logs);
  return { terrain, course, pistes, manifest, timing, athletes: manifest.athletes, runs, insights, logs, pipelineMs: performance.now() - t0 };
}

/** Re-runs the pipeline on user-supplied NDJSON logs (drag & drop). Unknown bibs get a palette colour. */
export function withUserLogs(world: World, files: { name: string; text: string }[]): World {
  const athletes: AthleteInfo[] = [], logs = new Map<number, string>();
  files.forEach((f, i) => {
    const first = f.text.split('\n').find((l) => l.trim().startsWith('{'));
    let bib = 900 + i, src = 'USER';
    try { const p = JSON.parse(first ?? ''); if (Number.isFinite(p.bib)) bib = p.bib; if (p.src) src = p.src; } catch { /* keep defaults */ }
    const known = world.athletes.find((a) => a.bib === bib);
    athletes.push(known ?? { bib, name: `Athlete ${bib}`, nation: 'UNK', color: PALETTE[i % PALETTE.length], src, file: f.name, startEpoch: 0 });
    logs.set(bib, f.text);
  });
  const t0 = performance.now();
  const { runs, insights } = analyse({ course: world.course, athletes, timing: world.timing }, logs);
  return { ...world, athletes, runs, insights, logs, pipelineMs: performance.now() - t0 };
}
