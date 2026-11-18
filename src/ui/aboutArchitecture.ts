import { h } from './dom';
import { LOGOS, type LogoKey } from './logos';

/**
 * Interactive architecture diagram.
 * Every element has an id; `LINKS` says which ids are connected. Hovering (or focusing) an element lights it and
 * everything connected to it and dims the rest; clicking pins the selection. A strip under the diagram explains
 * the selected element and lists what it connects to.
 */

// ---------------------------------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------------------------------
interface Info { name: string; text: string; code?: string[] }
interface Tech { id: string; logo?: LogoKey; mark?: string; kind?: 'aws' | 'swiss'; name: string }

const INFO: Record<string, Info> = {
  // real data
  's-aws': { name: 'AWS Terrain Tiles', text: 'Elevation for a 5 km square around Crans-Montana, downloaded once and stored as a grid.', code: ['scripts/fetch-data.mjs'] },
  's-swiss': { name: 'swisstopo imagery', text: 'Aerial photos of the same square. A shader turns the summer picture into a winter one.', code: ['scripts/fetch-data.mjs', 'src/scene/terrainMesh.ts'] },
  's-osm': { name: 'OpenStreetMap', text: 'The line of the Piste Nationale. It is approximate, not the official race line.', code: ['scripts/fetch-data.mjs'] },
  // backend
  'node': { name: 'Node.js', text: 'Runs every script of the backend. Nothing stays running after deployment.', code: ['scripts/'] },
  'sharp': { name: 'sharp', text: 'Decodes the map tiles and resamples them onto one common grid.', code: ['scripts/fetch-data.mjs'] },
  'ts-back': { name: 'TypeScript', text: 'The same language as the frontend. It simulates the skiers (gravity, drag, jumps) and then damages the data on purpose.', code: ['src/sim/physics.ts', 'src/sim/sensors.ts'] },
  'vitest': { name: 'Vitest', text: 'Checks that the analysis finds every fault the simulator injected: gaps, GPS spikes, frozen sensor, clock step.', code: ['tests/pipeline.test.ts'] },
  'anthropic': { name: 'Anthropic API', text: 'Optional. Turns already-validated numbers into short captions. It never sees the raw data.', code: ['scripts/narrate.ts'] },
  'b-fetch': { name: 'Fetch data', text: 'Downloads elevation, imagery and the piste line, then resamples them.', code: ['scripts/fetch-data.mjs'] },
  'b-sim': { name: 'Simulate', text: 'Four fictional athletes ski the real terrain with a simple physics model.', code: ['src/sim/physics.ts'] },
  'b-faults': { name: 'Add faults', text: 'Adds sensor noise and breaks the logs: lost packets, duplicates, GPS jumps, clock drift.', code: ['src/sim/sensors.ts'] },
  'b-write': { name: 'Write files', text: 'Saves everything as plain files that any web server can host.', code: ['public/data/'] },
  // files and wires
  'f-terrain': { name: 'terrain.bin', text: 'Elevation grid, 650 × 700 points.' },
  'f-texture': { name: 'texture.jpg', text: 'Aerial photo draped over the terrain.' },
  'f-course': { name: 'course.json', text: 'The piste line and the other pistes of the resort.' },
  'f-logs': { name: 'logs .ndjson', text: 'One raw log per athlete, plus the official timing. You can drop your own files instead.' },
  'w-write': { name: 'writes', text: 'The backend only produces files. It never talks to the browser.' },
  'w-fetch': { name: 'fetch()', text: 'At page load the browser downloads the files over plain HTTP. There is no API.' },
  // frontend
  'ts-front': { name: 'TypeScript', text: 'Holds the analysis pipeline and the app state. It runs in your browser in about 100 ms.', code: ['src/analysis/', 'src/app/model.ts'] },
  'three': { name: 'Three.js', text: 'Draws the terrain, the athletes, the ribbons and the helmet cameras.', code: ['src/scene/'] },
  'webgl': { name: 'WebGL', text: 'Custom shaders for the winter terrain and the sky.', code: ['src/scene/terrainMesh.ts', 'src/scene/sky.ts'] },
  'html': { name: 'HTML', text: 'The panels are plain DOM elements. There is no UI framework.', code: ['src/ui/'] },
  'css': { name: 'CSS', text: 'Grid layout that turns the side panels into drawers on small screens.', code: ['src/style.css'] },
  'canvas': { name: 'Canvas 2D', text: 'The charts are drawn by hand on two stacked canvases.', code: ['src/ui/chart.ts'] },
  'vite': { name: 'Vite', text: 'Dev server and bundler. Its output is the static site.', code: ['vite.config.ts'] },
  'f-load': { name: 'Load', text: 'Fetches the files and starts the analysis.', code: ['src/app/loader.ts'] },
  'f-analyse': { name: 'Analyse', text: 'Parse, clean, measure, explain. Splits, g-forces and jumps come out of raw packets.', code: ['src/analysis/pipeline.ts'] },
  'f-state': { name: 'State', text: 'One model holds the time, the selection and the camera, and tells the views when they change.', code: ['src/app/model.ts'] },
  'f-render': { name: '3D + UI', text: 'The 3D scene and the panels redraw from the state every frame.', code: ['src/scene/Viewer.ts', 'src/ui/'] },
};

/** Which ids are connected. Links work both ways; the chains also follow the order of the steps. */
const LINKS: [string, string][] = [
  ['s-aws', 'b-fetch'], ['s-aws', 'f-terrain'], ['s-swiss', 'b-fetch'], ['s-swiss', 'f-texture'], ['s-osm', 'b-fetch'], ['s-osm', 'f-course'],
  ['node', 'b-fetch'], ['node', 'b-sim'], ['node', 'b-faults'], ['node', 'b-write'],
  ['sharp', 'b-fetch'], ['sharp', 'f-terrain'], ['sharp', 'f-texture'],
  ['ts-back', 'b-sim'], ['ts-back', 'b-faults'], ['vitest', 'b-faults'], ['vitest', 'f-analyse'], ['anthropic', 'b-write'],
  ['b-fetch', 'b-sim'], ['b-sim', 'b-faults'], ['b-faults', 'b-write'], ['b-sim', 'f-logs'], ['b-faults', 'f-logs'],
  ['b-write', 'w-write'], ['w-write', 'f-terrain'], ['w-write', 'f-texture'], ['w-write', 'f-course'], ['w-write', 'f-logs'],
  ['f-terrain', 'w-fetch'], ['f-texture', 'w-fetch'], ['f-course', 'w-fetch'], ['f-logs', 'w-fetch'], ['w-fetch', 'f-load'],
  ['f-load', 'f-analyse'], ['f-analyse', 'f-state'], ['f-state', 'f-render'],
  ['f-load', 'ts-front'], ['f-analyse', 'ts-front'], ['f-analyse', 'f-logs'], ['f-state', 'ts-front'],
  ['f-render', 'three'], ['f-render', 'webgl'], ['f-render', 'html'], ['f-render', 'css'], ['f-render', 'canvas'],
  ['f-render', 'f-terrain'], ['f-render', 'f-texture'], ['f-render', 'f-course'],
  ['vite', 'f-load'], ['vite', 'f-render'],
];

const SOURCES: Tech[] = [
  { id: 's-aws', mark: 'aws', kind: 'aws', name: 'Terrain Tiles' },
  { id: 's-swiss', mark: '', kind: 'swiss', name: 'swisstopo' },
  { id: 's-osm', logo: 'osm', name: 'OpenStreetMap' },
];
const BACKEND_TECH: Tech[] = [
  { id: 'node', logo: 'node', name: 'Node.js' }, { id: 'sharp', logo: 'sharp', name: 'sharp' }, { id: 'ts-back', logo: 'typescript', name: 'TypeScript' },
  { id: 'vitest', logo: 'vitest', name: 'Vitest' }, { id: 'anthropic', logo: 'anthropic', name: 'Anthropic' },
];
const FRONTEND_TECH: Tech[] = [
  { id: 'ts-front', logo: 'typescript', name: 'TypeScript' }, { id: 'three', logo: 'three', name: 'Three.js' }, { id: 'webgl', logo: 'webgl', name: 'WebGL' },
  { id: 'html', logo: 'html5', name: 'HTML' }, { id: 'css', logo: 'css3', name: 'CSS' }, { id: 'canvas', mark: '2D', name: 'Canvas' }, { id: 'vite', logo: 'vite', name: 'Vite' },
];
const BACKEND_FLOW = ['b-fetch', 'b-sim', 'b-faults', 'b-write'];
const FRONTEND_FLOW = ['f-load', 'f-analyse', 'f-state', 'f-render'];
const FILES = ['f-terrain', 'f-texture', 'f-course', 'f-logs'];

const HINT = 'Hover or click a technology, a step or a file to see what it does and what it connects to.';

// ---------------------------------------------------------------------------------------------------
// elements
// ---------------------------------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';

function logoSvg(key: LogoKey): SVGElement {
  const { path, color, title } = LOGOS[key];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', color);
  svg.appendChild(p);
  return svg;
}

/** Logo tile: the mark on top, the name below. */
function tile(t: Tech): HTMLElement {
  const mark = h('span', { class: `mark${t.kind ? ` ${t.kind}` : ''}` });
  if (t.logo) mark.appendChild(logoSvg(t.logo)); else mark.textContent = t.mark ?? '';
  return h('li', {}, h('button', { class: 'tile', 'data-id': t.id, type: 'button' }, mark, h('span', { class: 'name' }, t.name)));
}

const step = (id: string) => h('button', { class: 'step', 'data-id': id, type: 'button' }, INFO[id].name);

/** Steps joined by arrows: what happens, in order, inside a block. */
const flow = (ids: string[]) => h('div', { class: 'flow' },
  ...ids.flatMap((id, i) => [...(i ? [h('i', { 'aria-hidden': 'true' })] : []), step(id)]));

const block = (title: string, subtitle: string, tech: Tech[], steps: string[], kind: string) => h('div', { class: `arch-block ${kind}` },
  h('h4', {}, title), h('p', {}, subtitle), h('ul', {}, ...tech.map(tile)), flow(steps));

/** An animated line with a label; the dashes move in the direction the data travels. */
const wire = (id: string) => h('div', { class: 'wire', 'data-id': id }, h('span', {}, INFO[id].name), h('i', { 'aria-hidden': 'true' }));

// ---------------------------------------------------------------------------------------------------
// interaction
// ---------------------------------------------------------------------------------------------------
const neighbours = new Map<string, Set<string>>();
for (const [a, b] of LINKS) {
  if (!neighbours.has(a)) neighbours.set(a, new Set());
  if (!neighbours.has(b)) neighbours.set(b, new Set());
  neighbours.get(a)!.add(b);
  neighbours.get(b)!.add(a);
}

/** The explanation strip: name, sentence, source files, and the names of what is connected. */
function details(id: string, related: Set<string>, pinned: boolean): HTMLElement[] {
  const i = INFO[id];
  return [
    h('div', { class: 'what' }, h('b', {}, i.name), pinned ? h('small', {}, 'pinned · click again or press Esc to release') : false, h('p', {}, i.text),
      ...(i.code ? [h('div', { class: 'code' }, ...i.code.map((c) => h('code', {}, c)))] : [])),
    h('div', { class: 'with' }, h('small', {}, 'Connected to'), h('div', {}, ...[...related].filter((r) => INFO[r]).map((r) => h('span', {}, INFO[r].name)))),
  ];
}

/** Wires hover, focus and click behaviour onto the diagram. Hover previews; a click pins; Esc or a second click unpins. */
function makeInteractive(root: HTMLElement, info: HTMLElement): void {
  let hovered: string | null = null, pinned: string | null = null;
  const idOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest?.('[data-id]')?.getAttribute('data-id') ?? null;

  const render = () => {
    const active = hovered ?? pinned, related = active ? neighbours.get(active) ?? new Set<string>() : new Set<string>();
    root.classList.toggle('focusing', active !== null);
    root.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
      const id = el.dataset.id!;
      el.classList.toggle('main', id === active);
      el.classList.toggle('lit', id === active || related.has(id));
      el.setAttribute('aria-pressed', String(id === pinned));
    });
    info.replaceChildren(...(active ? details(active, related, pinned === active) : [h('p', { class: 'hint' }, HINT)]));
  };

  root.addEventListener('pointerover', (e) => { hovered = idOf(e.target); render(); });
  root.addEventListener('pointerleave', () => { hovered = null; render(); });
  root.addEventListener('focusin', (e) => { hovered = idOf(e.target); render(); });
  root.addEventListener('focusout', () => { hovered = null; render(); });
  root.addEventListener('click', (e) => { const id = idOf(e.target); pinned = id && id !== pinned ? id : null; render(); });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pinned) { e.stopPropagation(); pinned = null; render(); }      // first Esc unpins, the next closes the dialog
  });
  render();
}

/** Real data comes in on top, the backend writes files, the browser fetches them and does the rest. */
export function buildArchitecture(): HTMLElement {
  const info = h('div', { class: 'arch-info', 'aria-live': 'polite' });
  const root = h('div', { class: 'arch' },
    h('div', { class: 'sources' }, h('span', { class: 'cap' }, 'Real data'), h('ul', {}, ...SOURCES.map(tile)), h('span', { class: 'cap' }, 'fetched once, at build time')),
    block('Backend', 'Node scripts that run before deployment. No live server.', BACKEND_TECH, BACKEND_FLOW, 'backend'),
    h('div', { class: 'middle' }, wire('w-write'),
      h('div', { class: 'files' }, h('b', {}, 'Static files'), ...FILES.map((id) => h('button', { class: 'file', 'data-id': id, type: 'button' }, INFO[id].name))),
      wire('w-fetch')),
    block('Frontend', 'Runs in the browser, including the analysis.', FRONTEND_TECH, FRONTEND_FLOW, 'frontend'),
    info);
  makeInteractive(root, info);
  return root;
}
