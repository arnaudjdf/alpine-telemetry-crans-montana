import type { AppModel, CameraMode } from './model';

const CAMERA_KEYS: Record<string, CameraMode> = { '1': 'chase', '2': 'tv', '3': 'heli', '4': 'onboard', '5': 'free' };
const SEEK_STEP = 1, SEEK_STEP_FAST = 5;      // seconds for arrow / shift+arrow

/** Keyboard shortcuts. Ignored while typing in an input or when a modifier key is held. */
export function bindShortcuts(model: AppModel): void {
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    const step = e.shiftKey ? SEEK_STEP_FAST : SEEK_STEP;
    if (e.code === 'Space') { e.preventDefault(); model.setPlaying(!model.playing); }
    else if (e.key in CAMERA_KEYS) model.setView({ camera: CAMERA_KEYS[e.key] });
    else if (e.key === 'r' || e.key === 'R') { model.seek(0); model.setPlaying(true); }
    else if (e.key === 'ArrowRight') model.seek(model.time + step);
    else if (e.key === 'ArrowLeft') model.seek(model.time - step);
    else if (e.key === '[') model.setView({ rate: Math.max(0.25, model.rate / 2) });
    else if (e.key === ']') model.setView({ rate: Math.min(4, model.rate * 2) });
    else if (e.key === 'f' || e.key === 'F') {                 // cycle the focus athlete
      const order = [...model.selected];
      model.setFocus(order[(order.indexOf(model.focus) + 1) % order.length]);
    }
  });
}

/** On narrow screens the side panels are drawers: one open at a time, a scrim closes them. */
export function bindDrawers(app: HTMLElement, leftButton: HTMLElement, rightButton: HTMLElement, scrim: HTMLElement): void {
  const toggle = (side: 'left' | 'right') => {
    const wasOpen = app.classList.contains(`open-${side}`);
    app.classList.remove('open-left', 'open-right');
    if (!wasOpen) app.classList.add(`open-${side}`);
  };
  leftButton.onclick = () => toggle('left');
  rightButton.onclick = () => toggle('right');
  scrim.onclick = () => app.classList.remove('open-left', 'open-right');
}

/** Drag & drop of log files anywhere on the page. `depth` counts nested dragenter/dragleave events. */
export function bindDropZone(zone: HTMLElement, onFiles: (files: File[]) => void): void {
  let depth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('on'); });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('on'); } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0; zone.classList.remove('on');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
}
