import type { AppModel } from '../app/model';
import { finishTimeOf, sampleAt } from '../analysis/sample';
import type { RunAnalysis } from '../analysis/types';
import { flagElement } from './flags';
import { h } from './dom';

/**
 * Live standings on the 3D view, under the speed read-out: athletes ordered by how far they have skied, with
 * flag, bib, nation and current speed. Click an athlete to focus them; Shift+click makes them the comparison reference.
 */
export function mountStandings(host: HTMLElement, model: AppModel): void {
  const list = h('div', { class: 'standings', role: 'list', 'aria-label': 'Live standings' });
  host.appendChild(list);
  const speeds = new Map<number, HTMLElement>();
  let signature = '';

  /** Distance skied by each athlete right now, from their own run time (so the order is the real race order). */
  const progress = (run: RunAnalysis) => sampleAt(run, Math.min(model.runTimeOf(run), finishTimeOf(run) + 1)).s;

  const build = (order: RunAnalysis[]) => {
    speeds.clear();
    list.replaceChildren(...order.map((run, rank) => {
      const info = model.info(run.bib), speed = h('b', { class: 'mono' }, '0');
      speeds.set(run.bib, speed);
      return h('button', {
        class: `entry${run.bib === model.focus ? ' focus' : ''}${run.bib === model.reference && model.reference !== model.focus ? ' ref' : ''}`,
        role: 'listitem', style: `--c:${info.color}`, title: 'Click: focus · Shift+click: compare against',
        onclick: (e: Event) => (e as MouseEvent).shiftKey ? model.setReference(run.bib) : model.setFocus(run.bib),
      }, h('span', { class: 'rank mono' }, String(rank + 1)), h('i', { class: 'dot' }), flagElement(info.nation, 11),
        h('span', { class: 'who' }, `${String(run.bib).padStart(2, '0')} ${info.nation}`), h('span', { class: 'spd' }, speed, ' km/h'));
    }));
  };

  const update = () => {
    if (!model.world) return;
    const order = [...model.visibleRuns].sort((a, b) => progress(b) - progress(a));
    const next = order.map((r) => r.bib).join(',') + `|${model.focus}|${model.reference}`;
    if (next !== signature) { signature = next; build(order); }              // rebuild only when the order or the selection changes
    for (const run of order) {
      const el = speeds.get(run.bib);
      if (el) el.textContent = String(Math.round(model.sampleFor(run).v * 3.6));
    }
  };

  model.on('time', update);
  model.on('selection', update);
  model.on('world', () => { signature = ''; update(); });
  update();
}
