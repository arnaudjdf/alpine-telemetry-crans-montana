import type { AppModel } from '../../app/model';
import { finishTimeOf } from '../../analysis/sample';
import type { RunAnalysis } from '../../analysis/types';
import { GRID_STEP } from '../../analysis/metrics';
import { h, fmtSigned } from '../dom';
import { athleteLabel } from '../format';

const DELTA_WARNING = 0.05;         // s: GNSS vs official difference shown in orange
const TIE = 0.005;                  // s: below this two splits count as equal
const STORY_LEAD_IN = 30;           // m shown before the chainage a story caption refers to

interface Caption { title: string; body: string }

/** Splits tab: GNSS vs official timing, section times, run metrics and story captions. */
export function splitsTab(root: HTMLElement, model: AppModel) {
  let aiCaptions: Caption[] = [];
  // optional output of `npm run data:narrate`; absent in the default demo
  fetch(`${import.meta.env.BASE_URL}data/narration.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => { if (json?.captions) { aiCaptions = json.captions; refresh(); } })
    .catch(() => { /* no narration file: fine */ });

  // --- small builders ------------------------------------------------------------------------------------
  const table = (firstColumn: string, runs: RunAnalysis[], rows: HTMLElement[]) => h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, h('th', {}, firstColumn),
      ...runs.map((r) => h('th', { style: `color:${model.info(r.bib).color}` }, athleteLabel(model, r.bib))))),
    h('tbody', {}, ...rows));

  /** One cell of the timing table: GNSS time, gap to the best athlete, and difference to the official time. */
  const timingCell = (run: RunAnalysis, runs: RunAnalysis[], point: number) => {
    const split = run.splits[point], best = Math.min(...runs.map((r) => r.splits[point].gnssTime));
    const lead = split.gnssTime - best, isStart = point === 0;
    const suspicious = split.delta !== undefined && Math.abs(split.delta) > DELTA_WARNING;
    const official = split.officialTime !== undefined ? `Official ${split.officialTime.toFixed(2)} s (${split.officialStatus})` : '';
    return h('td', { class: suspicious ? 'warnc' : '', title: official },
      h('b', { class: 'mono' }, isStart ? '0.00' : split.gnssTime.toFixed(2)),
      h('small', { class: 'mono' }, isStart ? '' : lead < TIE ? 'BEST' : fmtSigned(lead)),
      split.delta !== undefined && !isStart ? h('small', { class: `mono d${suspicious ? ' bad' : ''}` }, `Δ ${fmtSigned(split.delta)}`) : false);
  };

  const timingRows = (runs: RunAnalysis[]) => model.world.course.timing.map((point, i) => h('tr', {},
    h('td', {}, h('b', {}, point.label), h('small', {}, `${Math.round(point.s)} m`)),
    ...runs.map((run) => timingCell(run, runs, i))));

  const sectionRows = (runs: RunAnalysis[]) => {
    const timing = model.world.course.timing;
    return timing.slice(1).map((to, i) => {
      const best = Math.min(...runs.map((r) => r.sections[i].time));
      return h('tr', {}, h('td', {}, h('b', {}, `${timing[i].label} → ${to.label}`)),
        ...runs.map((r) => h('td', { class: r.sections[i].time === best ? 'okc' : '' },
          h('b', { class: 'mono' }, r.sections[i].time.toFixed(2)),
          h('small', { class: 'mono' }, `${r.sections[i].avgKmh.toFixed(0)} km/h`))));
    });
  };

  const metricRows = (runs: RunAnalysis[]) => {
    const row = (name: string, value: (r: RunAnalysis) => string) =>
      h('tr', {}, h('td', {}, name), ...runs.map((r) => h('td', { class: 'mono' }, value(r))));
    return [
      row('Top speed km/h', (r) => r.summary.topSpeedKmh.toFixed(0)), row('Avg speed km/h', (r) => r.summary.avgKmh.toFixed(1)),
      row('Max lateral g', (r) => r.summary.maxGLat.toFixed(1)), row('Max vertical g', (r) => r.summary.maxGVert.toFixed(1)),
      row('Airtime s', (r) => r.summary.airtime.toFixed(1)), row('Jumps', (r) => String(r.jumps.length)),
      row('Line RMS m', (r) => r.summary.lineRms.toFixed(1)),
    ];
  };

  /** Clicking a story card focuses its athlete and seeks to where the story happens. */
  const insightCards = () => model.world.insights.map((insight) => h('button', {
    class: 'insight',
    onclick: () => {
      if (insight.bib !== undefined) model.setFocus(insight.bib);
      if (insight.s === undefined) return;
      const run = model.focusRun, index = Math.round(Math.max(0, insight.s - STORY_LEAD_IN) / GRID_STEP);
      model.seek(model.clockAt(run, run.tAt[Math.min(index, run.tAt.length - 1)]));
    },
  }, h('b', {}, insight.title), h('span', {}, insight.body)));

  const captionCards = () => aiCaptions.length ? [
    h('h4', {}, 'AI CAPTIONS · LLM FROM VALIDATED METRICS'),
    h('div', { class: 'insights' }, ...aiCaptions.map((c) => h('div', { class: 'insight' }, h('b', {}, c.title), h('span', {}, c.body)))),
  ] : [];

  // --- the tab -----------------------------------------------------------------------------------------------
  const refresh = () => {
    if (!model.world) return;
    const runs = [...model.visibleRuns].sort((a, b) => finishTimeOf(a) - finishTimeOf(b));
    root.replaceChildren(
      h('h4', {}, 'TIMING · GNSS vs OFFICIAL'), table('POINT', runs, timingRows(runs)),
      h('p', { class: 'hint' }, 'GNSS time is derived from the cleaned track. Δ compares it to the photocell export; orange = beyond 50 ms.'),
      h('h4', {}, 'SECTIONS'), table('SECTION', runs, sectionRows(runs)),
      h('h4', {}, 'RUN METRICS'), table('METRIC', runs, metricRows(runs)),
      h('h4', {}, 'STORY'), h('div', { class: 'insights' }, ...insightCards()),
      ...captionCards(),
    );
  };
  return { refresh };
}
