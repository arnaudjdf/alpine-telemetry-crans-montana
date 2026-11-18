import type { AppModel, TabId } from '../app/model';
import { h } from './dom';
import { logTab } from './tabs/logTab';
import { splitsTab } from './tabs/splitsTab';
import { telemetryTab } from './tabs/telemetryTab';

/** Right-hand side panel: a tab bar and one pane per tab. Each tab exposes `refresh()` for data changes. */
export function mountRightPanel(host: HTMLElement, model: AppModel): void {
  const tabs: [TabId, string][] = [['telemetry', 'TELEMETRY'], ['splits', 'SPLITS'], ['log', 'LOG ANALYSIS']];
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const pane = () => h('div', { class: 'pane' });
  const panes: Record<TabId, HTMLElement> = { telemetry: pane(), splits: pane(), log: pane() };
  const tel = telemetryTab(panes.telemetry, model), spl = splitsTab(panes.splits, model), log = logTab(panes.log, model);
  const showTab = () => {
    bar.replaceChildren(...tabs.map(([id, label]) => h('button', {
      role: 'tab', 'aria-selected': model.tab === id, class: model.tab === id ? 'on' : '', onclick: () => model.setView({ tab: id }),
    }, label)));
    (Object.keys(panes) as TabId[]).forEach((id) => panes[id].toggleAttribute('hidden', id !== model.tab));
    if (model.tab === 'telemetry') tel.refresh(); else if (model.tab === 'splits') spl.refresh(); else log.refresh();
  };
  host.append(bar, panes.telemetry, panes.splits, panes.log);
  model.on('view', showTab);
  model.on('selection', () => { tel.refresh(); spl.refresh(); log.refresh(); });
  model.on('world', () => { tel.refresh(); spl.refresh(); log.refresh(); });
  showTab();
}

