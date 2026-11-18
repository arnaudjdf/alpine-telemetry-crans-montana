import type { AppModel, CameraMode } from '../app/model';
import { finishTimeOf } from '../analysis/sample';
import type { Viewer } from '../scene/Viewer';
import { h, fmtSigned, fmtTime } from './dom';
import { athleteLabel } from './format';

const RATES = [0.25, 0.5, 1, 2, 4];
const CAMERAS: [CameraMode, string][] = [['chase', 'CHASE'], ['tv', 'TV'], ['heli', 'HELI'], ['onboard', 'ONBOARD'], ['free', 'FREE']];
const SHOWN_ANOMALIES = new Set(['dropout', 'gnss_spike', 'stuck_imu', 'clock_step', 'jump', 'high_g']);   // not "transport"/"timing"
const ANTENNA = 1;                  // m, logger height above the snow
const STATUS_EVERY = 6;             // refresh the status bar every N frames

const percent = (value: number, total: number) => `${(Math.max(0, value) / total) * 100}%`;

// =====================================================================================================
// bottom bar
// =====================================================================================================
/** Play/pause, rewind, rate and a scrubber with split / anomaly / jump markers. */
export function mountTransport(host: HTMLElement, model: AppModel): void {
  const play = h('button', { class: 'play', 'aria-label': 'Play / pause', onclick: () => {
    if (model.time >= model.duration - 0.01) model.seek(0);           // pressing play at the end restarts
    model.setPlaying(!model.playing);
  } });
  const rewind = h('button', { title: 'Rewind (R)', onclick: () => { model.seek(0); model.setPlaying(true); } }, '⏮');
  const clock = h('div', { class: 'clock mono' });
  const rates = h('div', { class: 'seg small' });
  // same control as `rates`, but one button that cycles: used when the bar is too narrow for five buttons
  const nextRate = () => RATES[(RATES.indexOf(model.rate) + 1) % RATES.length];
  const rateCycle = h('button', { class: 'rate-cycle', title: 'Playback speed', onclick: () => model.setView({ rate: nextRate() }) });
  const fill = h('div', { class: 'fill' }), thumb = h('div', { class: 'thumb' }), marks = h('div', { class: 'marks' });
  const track = h('div', { class: 'track' }, marks, fill, thumb);

  // scrubbing: pointer position along the track -> time
  const timeAt = (e: PointerEvent) => {
    const rect = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * model.duration;
  };
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); model.seek(timeAt(e)); });
  track.addEventListener('pointermove', (e) => { if (e.buttons) model.seek(timeAt(e)); });

  const drawMarks = () => {
    if (!model.world) return;
    const run = model.focusRun, total = model.duration, delay = model.delayOf(run);
    const splitMarks = run.splits.slice(1).map((s) => h('span', { class: 'mk split', style: `left:${percent(s.gnssTime + delay, total)}` },
      s.id === 'FINISH' ? 'FIN' : s.label.replace('Split ', 'S')));
    const eventMarks = run.anomalies.filter((a) => SHOWN_ANOMALIES.has(a.kind)).map((a) => h('i', {
      class: `mk dot ${a.kind === 'jump' ? 'jump' : a.severity}`, title: a.message, style: `left:${percent(a.t + delay, total)}`,
    }));
    marks.replaceChildren(...splitMarks, ...eventMarks);
  };
  const drawRates = () => { rateCycle.textContent = `${model.rate}×`; };
  const drawRateButtons = () => rates.replaceChildren(...RATES.map((r) =>
    h('button', { class: model.rate === r ? 'on' : '', onclick: () => model.setView({ rate: r }) }, `${r}×`)));
  const drawPlay = () => { play.textContent = model.playing ? '❚❚' : '▶'; };
  const drawClock = () => {
    if (!model.world) return;
    const progress = percent(model.time, model.duration), gap = model.gapNow();
    fill.style.width = progress; thumb.style.left = progress;
    const gapHtml = model.focus === model.reference ? '' : `<em style="color:var(--${gap >= 0 ? 'ok' : 'bad'})">${fmtSigned(gap)} s</em>`;
    const elapsed = fmtTime(Math.max(0, model.runTimeOf(model.focusRun))), total = fmtTime(finishTimeOf(model.focusRun));
    clock.innerHTML = `<b>T+${elapsed}</b><span> / ${total}</span>${gapHtml}`;
  };

  model.on('time', drawClock);
  model.on('play', drawPlay);
  model.on('view', () => { drawRates(); drawRateButtons(); drawMarks(); });
  const onDataChange = () => { drawMarks(); drawClock(); };
  model.on('selection', onDataChange);
  model.on('world', onDataChange);

  host.append(rewind, play, clock, track, rates, rateCycle);
  drawRates(); drawRateButtons(); drawPlay(); drawMarks(); drawClock();
}

// =====================================================================================================
// overlay on the 3D view
// =====================================================================================================
/** Compact speed read-out + camera buttons on the 3D view: keeps the page usable with both panels closed. */
export function mountHud(host: HTMLElement, model: AppModel): void {
  const speed = h('b', { class: 'mono' }, '0'), who = h('span', {}), chainage = h('span', { class: 'mono' });
  const readout = h('div', { class: 'hud' },
    h('div', { class: 'big' }, speed, h('small', {}, 'km/h')),
    h('div', { class: 'sub' }, who, chainage));
  const cameras = h('div', { class: 'camquick seg small' });
  host.append(readout, cameras);

  const drawCameras = () => cameras.replaceChildren(...CAMERAS.map(([mode, name]) =>
    h('button', { class: model.camera === mode ? 'on' : '', onclick: () => model.setView({ camera: mode }) }, name)));
  const drawReadout = () => {
    if (!model.world) return;
    const s = model.sampleFor(model.focusRun);
    speed.textContent = String(Math.round(s.v * 3.6));
    who.innerHTML = `<i style="background:${model.info(model.focus).color}"></i>${athleteLabel(model, model.focus)}`;
    chainage.textContent = `${Math.round(s.s)} m · ${(s.y - ANTENNA).toFixed(0)} m a.s.l.`;
  };

  model.on('time', drawReadout);
  model.on('selection', drawReadout);
  model.on('view', drawCameras);
  drawCameras(); drawReadout();
}

// =====================================================================================================
// status bar
// =====================================================================================================
export function mountStatusBar(host: HTMLElement, model: AppModel, viewer: Viewer): void {
  const cell = (caption: string) => { const value = h('b', { class: 'mono' }); host.append(h('span', {}, caption, ' ', value)); return value; };
  const mission = cell('MISSION'), fps = cell('FPS'), camera = cell('CAM');
  const packets = cell('PACKETS'), pipeline = cell('PIPELINE'), source = cell('SOURCE');

  let frame = 0;
  const draw = () => {
    if (!model.world || frame++ % STATUS_EVERY) return;                  // text updates are cheap but pointless at 60 Hz
    const totalPackets = model.world.runs.reduce((sum, r) => sum + r.report.received, 0);
    mission.textContent = `T+${fmtTime(Math.max(0, model.time))}`;
    fps.textContent = `${viewer.fps.toFixed(0)} · ${model.quality.toUpperCase()}`;
    camera.textContent = model.camera.toUpperCase();
    packets.textContent = `${totalPackets.toLocaleString()} (${model.world.runs.length} loggers)`;
    pipeline.textContent = `${model.pipelineMs.toFixed(0)} ms`;
    source.textContent = model.world.athletes.some((a) => a.nation === 'UNK') ? 'USER LOGS' : 'SYNTHETIC';
  };
  model.on('time', draw);
  model.on('view', draw);
}
