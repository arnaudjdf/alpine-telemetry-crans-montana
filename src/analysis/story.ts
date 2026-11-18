import type { Course } from '../core/course';
import { gapAlong } from './metrics';
import type { RunAnalysis } from './types';

export interface Insight { id: string; title: string; body: string; bib?: number; s?: number }

const fmt = (v: number, d = 2) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);

/** Deterministic data-storytelling captions derived from the analysis (no LLM involved). */
export function buildInsights(runs: RunAnalysis[], course: Course, names: Record<number, string>): Insight[] {
  if (runs.length < 1) return [];
  const out: Insight[] = [];
  const ranked = [...runs].sort((a, b) => a.summary.runTime - b.summary.runTime);
  const [first, second] = ranked;
  const label = (r: RunAnalysis) => names[r.bib] ?? `Bib ${r.bib}`;

  if (second) {
    out.push({ id: 'winner', bib: first.bib, title: `${label(first)} leads at the line`,
      body: `${first.summary.runTime.toFixed(2)} s, ${(second.summary.runTime - first.summary.runTime).toFixed(2)} s ahead of ${label(second)}.` });
    // where the gap to second was made or lost
    const gap = gapAlong(first, second), win = 40;       // 200 m windows on the 5 m grid
    let best = 0, bestI = 0;
    for (let i = win; i < gap.length; i++) { const d = gap[i] - gap[i - win]; if (d > best) { best = d; bestI = i; } }
    if (best > 0.02) out.push({ id: 'swing', bib: first.bib, s: bestI * 5 - 100, title: 'Where the race was won',
      body: `${label(first)} took ${best.toFixed(2)} s from ${label(second)} between ${Math.max(0, bestI * 5 - 200).toFixed(0)} m and ${(bestI * 5).toFixed(0)} m.` });
  }
  // fastest section per timing interval
  const sections = ranked[0].sections.map((s, i) => ({ s, i }));
  for (const { s, i } of sections) {
    const best = [...runs].sort((a, b) => a.sections[i].time - b.sections[i].time)[0];
    out.push({ id: `sec${i}`, bib: best.bib, s: course.timing[i].s, title: `${s.from} → ${s.to}`,
      body: `Fastest: ${label(best)} in ${best.sections[i].time.toFixed(2)} s (${best.sections[i].avgKmh.toFixed(0)} km/h average).` });
  }
  const fastest = [...runs].sort((a, b) => b.summary.topSpeedKmh - a.summary.topSpeedKmh)[0];
  out.push({ id: 'top', bib: fastest.bib, title: 'Top speed',
    body: `${label(fastest)} reached ${fastest.summary.topSpeedKmh.toFixed(0)} km/h at t = ${fastest.summary.topSpeedAt.toFixed(1)} s.` });
  const jumper = runs.flatMap((r) => r.jumps.map((j) => ({ r, j }))).sort((a, b) => b.j.distance - a.j.distance)[0];
  if (jumper) out.push({ id: 'jump', bib: jumper.r.bib, s: jumper.j.s, title: 'Longest jump',
    body: `${label(jumper.r)}: ${jumper.j.distance.toFixed(0)} m in ${jumper.j.airtime.toFixed(2)} s, ${jumper.j.height.toFixed(1)} m above the snow.` });
  const gmax = [...runs].sort((a, b) => b.summary.maxGLat - a.summary.maxGLat)[0];
  out.push({ id: 'g', bib: gmax.bib, title: 'Highest lateral load',
    body: `${label(gmax)} pulled ${gmax.summary.maxGLat.toFixed(1)} g in the turns (${fmt(gmax.summary.lineRms, 1)} m RMS from the centre line).` });
  return out;
}
