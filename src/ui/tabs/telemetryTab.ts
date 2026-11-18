import type { AppModel } from '../../app/model';
import type { RunSample } from '../../analysis/sample';
import { FLAG_FILLED, FLAG_SPIKE, FLAG_STUCK } from '../../analysis/types';
import { GRID_STEP } from '../../analysis/metrics';
import { LineChart } from '../chart';
import { h, fmtSigned } from '../dom';
import { athleteLabel } from '../format';
import { chainSeries, gapSeries, profileSeries } from '../series';

/** The live "state vector" cells: key, caption. Order = reading order in the grid. */
const CELLS: [string, string][] = [
  ['v', 'SPEED km/h'], ['s', 'CHAINAGE m'], ['alt', 'ALTITUDE m'],
  ['slope', 'SLOPE °'], ['gLat', 'G LAT'], ['gVert', 'G VERT'],
  ['gLong', 'G LONG'], ['lat', 'LINE OFFSET m'], ['hdg', 'HEADING °'],
  ['rad', 'TURN R m'], ['gap', 'GAP s'], ['state', 'STATE'],
];
const MIN_HEADING_RATE = 0.02;      // rad/s below which a turn radius is meaningless (driving straight)
const MAX_RADIUS = 999;             // m, display cap
const ANTENNA = 1;                  // m, logger height above the snow

/** What the data pipeline knows about the quality of this sample, as one word. */
function stateOf(s: RunSample): { text: string; nominal: boolean } {
  const text = s.air ? 'AIRBORNE' : s.flags & FLAG_STUCK ? 'IMU STUCK' : s.flags & FLAG_SPIKE ? 'GNSS REJECTED'
    : s.flags & FLAG_FILLED ? 'RECONSTRUCTED' : 'NOMINAL';
  return { text, nominal: text === 'NOMINAL' };
}

/** Telemetry tab: state vector of the focus athlete + four charts sharing the chainage axis. */
export function telemetryTab(root: HTMLElement, model: AppModel) {
  // --- static structure ------------------------------------------------------------------------------
  const cells: Record<string, HTMLElement> = {};
  const grid = h('div', { class: 'vector' }, ...CELLS.map(([key, caption]) => {
    cells[key] = h('b', { class: 'mono' }, '—');
    return h('div', { class: 'cell' }, h('span', {}, caption), cells[key]);
  }));
  const title = h('div', { class: 'who mono' });

  const speedChart = new LineChart({ title: 'SPEED', unit: 'km/h · vs chainage m', yMin: 0, decimals: 0, height: 104 });
  const gapChart = new LineChart({ title: 'GAP TO REFERENCE', unit: 's · + focus ahead', zero: true, decimals: 2, height: 84 });
  const loadChart = new LineChart({ title: 'LOADS', unit: 'g · lateral / vertical', zero: true, decimals: 1, height: 84 });
  const profileChart = new LineChart({ title: 'COURSE PROFILE', unit: 'm a.s.l.', decimals: 0, height: 84 });
  const charts = [speedChart, gapChart, loadChart, profileChart];

  // clicking any chart seeks to the moment the focus athlete passes that chainage
  const seekToChainage = (chainage: number) => {
    const run = model.focusRun, index = Math.round(chainage / GRID_STEP);
    model.seek(model.clockAt(run, run.tAt[Math.min(run.tAt.length - 1, Math.max(0, index))]));
  };
  charts.forEach((c) => { c.onSeek = seekToChainage; });
  root.append(title, grid, ...charts.map((c) => c.el));

  // --- data-dependent part: runs when the selection or the data set changes ------------------------------
  const redrawCharts = () => {
    if (!model.world) return;
    const focus = model.focusRun, reference = model.refRun, course = model.world.course;
    const hasReference = model.focus !== model.reference;
    title.innerHTML = `<i style="background:${model.info(focus.bib).color}"></i>${athleteLabel(model, focus.bib)} <em>vs</em> ${hasReference ? athleteLabel(model, reference.bib) : '—'}`;

    const splitMarkers = course.timing.filter((t) => t.id !== 'START' && t.id !== 'FINISH').map((t) => ({ x: t.s, label: t.label }));
    const jumpMarkers = course.features.map((f) => ({ x: f.s, label: f.label, color: '#38e8ff' }));

    speedChart.set(model.visibleRuns.map((run) => ({
      ...chainSeries(run, 'v', 3.6), color: model.info(run.bib).color, label: athleteLabel(model, run.bib).replace(' ', ''),
      width: run.bib === model.focus ? 2 : 1.1, dim: run.bib !== model.focus,
    })), splitMarkers, course.length);
    gapChart.set(hasReference ? [{ ...gapSeries(focus, reference), color: '#2ee59d', fill: true, width: 1.6, label: 'Δ' }] : [], splitMarkers, course.length);
    loadChart.set([
      { ...chainSeries(focus, 'gLat'), color: '#38e8ff', label: 'lat', width: 1.2 },
      { ...chainSeries(focus, 'gVert'), color: '#ff7a1a', label: 'vert', width: 1.2 },
    ], splitMarkers, course.length);
    profileChart.set([{ ...profileSeries(course), color: '#8fb3ff', fill: true, label: 'alt' }], [...splitMarkers, ...jumpMarkers], course.length);
  };

  // --- per-frame part: only touches text that changed -------------------------------------------------
  const setText = (key: string, text: string) => { if (cells[key].textContent !== text) cells[key].textContent = text; };
  const updateCells = () => {
    if (model.tab !== 'telemetry' || !model.world) return;
    const s = model.sampleFor(model.focusRun), gap = model.gapNow(), state = stateOf(s);
    const turning = Math.abs(s.headingRate) > MIN_HEADING_RATE;
    setText('v', (s.v * 3.6).toFixed(0));
    setText('s', s.s.toFixed(0));
    setText('alt', (s.y - ANTENNA).toFixed(0));
    setText('slope', s.slope.toFixed(1));
    setText('gLat', fmtSigned(s.gLat, 1));
    setText('gVert', s.gVert.toFixed(1));
    setText('gLong', fmtSigned(s.gLong, 2));
    setText('lat', fmtSigned(s.lateral, 1));
    setText('hdg', (((s.heading * 180) / Math.PI + 360) % 360).toFixed(0));
    setText('rad', turning ? Math.min(MAX_RADIUS, s.v / Math.abs(s.headingRate)).toFixed(0) : '—');   // radius = speed / turn rate
    setText('gap', model.focus === model.reference ? '—' : fmtSigned(gap));
    cells.gap.style.color = gap >= 0 ? 'var(--ok)' : 'var(--bad)';
    setText('state', state.text);
    cells.state.className = `mono ${state.nominal ? 'okc' : 'warnc'}`;
    charts.forEach((c) => c.setCursor(s.s));
  };

  model.on('time', updateCells);
  return { refresh: () => { redrawCharts(); updateCells(); } };
}
