import type { AppModel } from '../app/model';
import { buildArchitecture } from './aboutArchitecture';
import { NOTES, PITCH } from './aboutContent';
import { h } from './dom';

const ROUTE = '#about';             // deep link: https://<host>/#about

/** Dialog explaining how the project is built. Opens from the header button, the `?` key or the `#about` URL. */
export function mountAboutPanel(host: HTMLElement, _model: AppModel, openButton: HTMLElement): void {
  const close = h('button', { class: 'about-close', 'aria-label': 'Close', onclick: () => setOpen(false) }, '✕');

  const dialog = h('div', { class: 'about', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'How it is built', hidden: true },
    h('div', { class: 'about-panel' },
      h('header', {}, h('h2', {}, "How it's built"), close),
      h('p', { class: 'lead' }, PITCH),
      buildArchitecture(),
      ...NOTES.map((n) => h('p', { class: 'note' }, n))));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) setOpen(false); });     // click on the backdrop closes
  host.appendChild(dialog);

  // The URL is the single source of truth: `#about` = open. That makes the panel linkable and the Back button work.
  const isOpen = () => !dialog.hasAttribute('hidden');

  /** Shows or hides the dialog to match the URL (also called on load and on Back/Forward). */
  function syncWithUrl(): void {
    const open = location.hash === ROUTE;
    if (open === isOpen()) return;
    dialog.toggleAttribute('hidden', !open);
    if (open) close.focus(); else openButton.focus();
  }

  /** Changes the URL; opening adds a history entry, closing removes the hash without reloading. */
  function setOpen(open: boolean): void {
    if (open) location.hash = ROUTE;                                      // fires `hashchange`
    else { history.pushState(null, '', location.pathname + location.search); syncWithUrl(); }
  }

  openButton.onclick = (e) => { e.preventDefault(); setOpen(!isOpen()); };
  addEventListener('hashchange', syncWithUrl);
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Escape' && isOpen()) setOpen(false);
    else if (e.key === '?' || (e.key === 'i' && !e.metaKey && !e.ctrlKey)) setOpen(!isOpen());
  });
  syncWithUrl();                                                          // opened straight from a shared link
}
