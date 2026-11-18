import type { AppModel } from '../../app/model';
import { finishTimeOf } from '../../analysis/sample';
import type { Anomaly, RunAnalysis, Severity } from '../../analysis/types';
import { h, fmtTime } from '../dom';
import { athleteLabel } from '../format';

const KIND_COLOR: Record<Anomaly['kind'], string> = {
  dropout: '#8b97ad', gnss_spike: '#ff9f1a', stuck_imu: '#c084fc', clock_step: '#ff4d5e',
  timing: '#facc15', jump: '#38e8ff', high_g: '#a3e635', transport: '#6b7a93',
};
const SEVERITY_COLOR: Record<Severity, string> = { info: 'var(--dim)', warn: 'var(--warn)', error: 'var(--bad)' };

/** Lanes of the data-quality timeline: which anomaly kind goes on which row. */
const LANES: [Anomaly['kind'], string][] = [
  ['dropout', 'DROPOUT'], ['gnss_spike', 'GNSS'], ['stuck_imu', 'IMU'], ['clock_step', 'CLOCK'], ['jump', 'AIR'],
];

type Tone = '' | 'ok' | 'warn' | 'bad';
const toneIf = (condition: boolean, tone: Tone): Tone => (condition ? tone : '');

// ---------------------------------------------------------------------------------------------------
// building blocks (each returns one piece of the tab)
// ---------------------------------------------------------------------------------------------------
function kpi(name: string, value: string, tone: Tone = ''): HTMLElement {
  return h('div', { class: `kpi ${tone}` }, h('span', {}, name), h('b', { class: 'mono' }, value));
}

/** Headline numbers of the ingest + cleaning stages for one run. */
function kpiGrid(run: RunAnalysis): HTMLElement {
  const rep = run.report, parse = run.parse;
  return h('div', { class: 'kpis' },
    kpi('LINES', String(parse.lines)),
    kpi('VALID PACKETS', String(rep.received), 'ok'),
    kpi('COMPLETENESS', `${(rep.completeness * 100).toFixed(1)}%`, rep.completeness > 0.97 ? 'ok' : 'warn'),
    kpi('DUPLICATES', String(rep.duplicates)),
    kpi('RE-ORDERED', String(rep.outOfOrder)),
    kpi('MALFORMED', String(parse.malformed), toneIf(parse.malformed > 0, 'warn')),
    kpi('CRC FAILS', String(parse.badCrc), toneIf(parse.badCrc > 0, 'warn')),
    kpi('DROPOUTS', String(rep.dropouts.length), toneIf(rep.dropouts.length > 0, 'warn')),
    kpi('GNSS SPIKES', String(rep.spikes.length), toneIf(rep.spikes.length > 0, 'warn')),
    kpi('IMU STUCK', String(rep.stuck.length), toneIf(rep.stuck.length > 0, 'warn')),
    kpi('CLOCK DRIFT', `${rep.clock.driftPpm.toFixed(0)} ppm`, toneIf(Math.abs(rep.clock.driftPpm) > 100, 'bad')),
    kpi('CLOCK STEPS', String(rep.clock.steps.length), toneIf(rep.clock.steps.length > 0, 'bad')),
    kpi('LATENCY P95', `${(rep.clock.latencyP95 * 1000).toFixed(0)} ms`),
    kpi('SPEED RESID.', `${run.summary.speedResidual.toFixed(2)} m/s`),
  );
}

/** One row per anomaly kind, each event drawn at its run time; click to seek. */
function qualityTimeline(run: RunAnalysis, model: AppModel): HTMLElement {
  const span = finishTimeOf(run) + 4;                                  // seconds covered by the lane
  const left = (t: number) => (Math.max(0, t) / span) * 100;
  const dropoutWidth = (a: Anomaly) => {                                // a dropout is drawn as wide as it lasted
    const gap = run.report.dropouts.find((d) => Math.abs(d.t - a.t - run.t0) < 0.3);
    return Math.max(0.8, ((gap?.seconds ?? 0.2) / span) * 100);
  };
  const marker = (kind: Anomaly['kind'], a: Anomaly) => h('i', {
    style: `left:${left(a.t)}%;background:${KIND_COLOR[kind]};width:${kind === 'dropout' ? dropoutWidth(a) : 0.9}%`,
    title: a.message, onclick: () => model.seekAnomaly(a),
  });
  return h('div', { class: 'qtl' }, ...LANES.map(([kind, name]) => h('div', { class: 'lane' },
    h('span', {}, name),
    h('div', { class: 'track' }, ...run.anomalies.filter((a) => a.kind === kind).map((a) => marker(kind, a))))));
}

function eventList(events: Anomaly[], model: AppModel): HTMLElement {
  return h('div', { class: 'anoms' }, ...events.map((a) => h('button', { class: `anom ${a.severity}`, onclick: () => model.seekAnomaly(a) },
    h('i', { style: `background:${KIND_COLOR[a.kind]}` }),
    h('span', { class: 'mono t' }, a.kind === 'transport' ? '—' : fmtTime(a.t, 1)),
    h('b', {}, a.kind.replace('_', ' ').toUpperCase()),
    h('span', { class: 'msg' }, a.message))));
}

/** A readable pipeline log: what each stage did, then the raw parse issues. */
function consoleLines(run: RunAnalysis, file: string): [Severity, string][] {
  const rep = run.report, parse = run.parse, line = (s: Severity, text: string): [Severity, string] => [s, text];
  return [
    line('info', `[ingest] ${file}: ${parse.lines} lines, ${parse.packets.length} valid, ${parse.malformed} malformed, ${parse.badCrc} bad checksum`),
    line('info', `[dedupe] ${rep.duplicates} duplicate packets dropped, ${rep.outOfOrder} out-of-order re-sequenced`),
    ...rep.dropouts.map((d) => line('warn', `[gaps] seq ${d.seqStart}: ${d.lost} packets lost (${d.seconds.toFixed(2)} s) -> hermite fill`)),
    ...rep.spikes.map((s) => line('warn', `[gnss] t=${s.t.toFixed(1)} s: ${s.samples} sample(s) rejected, jump ${s.maxDisplacement.toFixed(0)} m`)),
    ...rep.stuck.map((s) => line('warn', `[imu] t=${s.t.toFixed(1)} s: ${s.channel} frozen ${s.seconds.toFixed(1)} s`)),
    ...rep.clock.steps.map((c) => line('error', `[clock] t=${c.t.toFixed(1)} s: device clock step ${c.seconds.toFixed(2)} s, time rebuilt from seq`)),
    line('info', `[clock] drift ${rep.clock.driftPpm.toFixed(1)} ppm, gateway offset ${(rep.clock.offsetToGateway * 1000).toFixed(0)} ms`),
    ...parse.issues.slice(0, 60).map((i) => line(i.severity, `[parse] ${i.message}`)),
    line('info', `[metrics] run time ${run.summary.runTime.toFixed(2)} s, top ${run.summary.topSpeedKmh.toFixed(0)} km/h, ${run.jumps.length} jumps detected`),
  ];
}

// ---------------------------------------------------------------------------------------------------
// the tab
// ---------------------------------------------------------------------------------------------------
/** Log analysis tab: ingest KPIs, data-quality timeline, event list and pipeline console. */
export function logTab(root: HTMLElement, model: AppModel) {
  let selectedBib = 0;
  let severityFilter: Severity | 'all' = 'all';

  const athleteChips = () => h('div', { class: 'seg' }, ...model.world.runs.map((r) => h('button', {
    class: r.bib === selectedBib ? 'on' : '', style: `--c:${model.info(r.bib).color}`,
    onclick: () => { selectedBib = r.bib; refresh(); },
  }, athleteLabel(model, r.bib))));

  const severityButtons = () => h('div', { class: 'seg small' }, ...(['all', 'info', 'warn', 'error'] as const).map((s) => h('button', {
    class: severityFilter === s ? 'on' : '', onclick: () => { severityFilter = s; refresh(); },
  }, s.toUpperCase())));

  const refresh = () => {
    if (!model.world) return;
    if (!model.run(selectedBib)) selectedBib = model.focus;
    const run = model.run(selectedBib)!;
    const events = run.anomalies.filter((a) => severityFilter === 'all' || a.severity === severityFilter);
    const pipelineConsole = h('pre', { class: 'console mono' },
      ...consoleLines(run, model.info(run.bib).file).map(([severity, text]) => h('div', { style: `color:${SEVERITY_COLOR[severity]}` }, text)));

    root.replaceChildren(
      athleteChips(), kpiGrid(run),
      h('h4', {}, 'DATA QUALITY TIMELINE'), qualityTimeline(run, model),
      h('div', { class: 'row' }, h('h4', {}, `EVENTS · ${events.length}`), severityButtons()), eventList(events, model),
      h('h4', {}, 'PIPELINE CONSOLE'), pipelineConsole,
    );
  };
  return { refresh };
}
