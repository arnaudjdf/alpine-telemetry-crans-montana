import type { AppModel, CameraMode, Layers, Quality, SyncMode } from '../app/model';
import { finishTimeOf } from '../analysis/sample';
import { h, fmtTime } from './dom';
import { flagElement } from './flags';

const CAMS: [CameraMode, string, string][] = [   // mode, label, shortcut key
  ['chase', 'CHASE', '1'], ['tv', 'TV SIDE', '2'], ['heli', 'HELI', '3'], ['onboard', 'ONBOARD', '4'], ['free', 'FREE', '5'],
];
const SYNC_MODES: [SyncMode, string][] = [['time', 'SAME TIME'], ['chainage', 'SAME CHAINAGE']];
const QUALITIES: [Quality, string][] = [['perf', 'PERF'], ['bal', 'BAL'], ['cine', 'CINE']];
const LAYERS: [keyof Layers, string][] = [
  ['course', 'Course & timing'], ['gates', 'Gates'], ['venue', 'Spectators & venue'], ['traces', 'Ghost traces'], ['speedRibbon', 'Speed ribbon'],
  ['gapRibbon', 'Gap ribbon'], ['pips', 'Onboard cams'], ['minimap', 'Mini map'], ['labels', 'Labels'],
  ['pistes', 'Resort pistes'], ['contours', '50 m contours'],
];

export interface ControlHooks { onFiles(files: File[]): void; onExport(): void; onReset(): void; onOverview(): void }

/** Left panel: athletes, camera, layers, quality and data import/export. */
export function mountControlPanel(host: HTMLElement, model: AppModel, hooks: ControlHooks): void {
  const athletes = h('div', { class: 'athletes' });
  const cams = h('div', { class: 'seg' }), sync = h('div', { class: 'seg' }), quality = h('div', { class: 'seg' });
  const layers = h('div', { class: 'toggles' });
  const snow = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: model.snow, 'aria-label': 'Snow cover' }) as HTMLInputElement;
  snow.addEventListener('input', () => model.setView({ snow: Number(snow.value) }));
  // seconds between athletes leaving the gate (0 = everyone starts together)
  const interval = h('input', {
    type: 'range', min: 0, max: 10, step: 0.5, value: model.startInterval, 'aria-label': 'Start interval',
  }) as HTMLInputElement;
  const intervalValue = h('b', { class: 'mono' }, `${model.startInterval} s`);
  interval.addEventListener('input', () => {
    model.setView({ startInterval: Number(interval.value) });
    intervalValue.textContent = `${interval.value} s`;
  });
  const file = h('input', { type: 'file', multiple: true, accept: '.ndjson,.jsonl,.json,.txt', hidden: true }) as HTMLInputElement;
  file.addEventListener('change', () => { if (file.files?.length) hooks.onFiles([...file.files]); file.value = ''; });

  const seg = <T extends string>(box: HTMLElement, items: [T, string, string?][], get: () => T, set: (v: T) => void) => {
    box.replaceChildren(...items.map(([value, label, key]) => h('button', {
      class: get() === value ? 'on' : '', title: key ? `Key ${key}` : '', onclick: () => set(value),
    }, label)));
  };

  const render = () => {
    athletes.replaceChildren(...[...model.world.runs].sort((a, b) => finishTimeOf(a) - finishTimeOf(b)).map((run, rank) => {
      const info = model.info(run.bib), on = model.selected.has(run.bib), focus = model.focus === run.bib, ref = model.reference === run.bib;
      return h('div', { class: `ath${focus ? ' focus' : ''}${on ? '' : ' off'}` },
        h('button', {
          class: 'vis', style: `--c:${info.color}`, title: on ? 'Hide' : 'Show', onclick: () => model.toggleSelected(run.bib),
        }, on ? '●' : '○'),
        h('button', { class: 'name', onclick: () => model.setFocus(run.bib) },
          h('span', { class: 'bib mono' }, String(run.bib).padStart(2, '0')), flagElement(info.nation, 11), h('span', {}, `${info.nation}`),
          h('span', { class: 'rank mono' }, `P${rank + 1}`), h('span', { class: 'time mono' }, fmtTime(finishTimeOf(run)))),
        h('button', { class: `refbtn${ref ? ' on' : ''}`, title: 'Use as comparison reference', onclick: () => model.setReference(run.bib) }, 'REF'));
    }));
    seg(cams, CAMS, () => model.camera, (v) => model.setView({ camera: v }));
    seg(sync, SYNC_MODES, () => model.sync, (v) => model.setView({ sync: v }));
    seg(quality, QUALITIES, () => model.quality, (v) => model.setView({ quality: v }));
    layers.replaceChildren(...LAYERS.map(([k, label]) => h('label', { class: 'tg' }, h('input', {
      type: 'checkbox', ...(model.layers[k] ? { checked: true } : {}),
      onchange: (e: Event) => model.setLayer(k, (e.target as HTMLInputElement).checked),
    }), h('span', {}, label))));
  };
  model.on('selection', render); model.on('view', render); model.on('world', render);

  host.append(
    section('ATHLETES', 'click = focus · eye = show · REF = comparison', athletes),
    section('CAMERA', '', cams, h('button', { class: 'wide', onclick: hooks.onOverview }, 'FULL COURSE OVERVIEW')),
    section('START INTERVAL', 'seconds between athletes leaving the gate',
      h('label', { class: 'slider' }, h('span', {}, 'Gap'), interval, intervalValue)),
    section('SYNC MODE', 'same chainage shows the pure time gap as a ghost', sync),
    section('LAYERS', '', layers),
    section('ENVIRONMENT', '', h('label', { class: 'slider' }, h('span', {}, 'Snow cover'), snow)),
    section('RENDER QUALITY', 'sets pixel ratio and particle effects', quality),
    section('DATA', 'Drop NDJSON logger files anywhere to re-run the pipeline on your own data.',
      h('div', { class: 'btnrow' },
        h('button', { onclick: () => file.click() }, 'LOAD RAW LOGS…'),
        h('button', { onclick: hooks.onExport }, 'EXPORT ANALYSIS'),
        h('button', { onclick: hooks.onReset }, 'RESET DEMO')),
      file),
    h('p', { class: 'fine' }, 'Terrain: swisstopo SWISSIMAGE + AWS terrain tiles. Pistes: © OpenStreetMap contributors. Athlete data is synthetic.'),
  );
  render();
}

function section(title: string, hint: string, ...kids: (Node | string)[]): HTMLElement {
  return h('section', { class: 'sec' }, h('h3', {}, title), hint ? h('p', { class: 'hint' }, hint) : false, ...kids);
}
