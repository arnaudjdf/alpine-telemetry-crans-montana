import * as THREE from 'three';
import type { AppModel } from '../app/model';
import { h } from '../ui/dom';
import { flagElement } from '../ui/flags';
import { athleteLabel } from '../ui/format';
import type { AthleteLayer } from './athleteLayer';
import { onboardPose } from './onboard';

const FOV = 78;

/**
 * Picture-in-picture "helmet cameras", one per visible athlete. The tiles are DOM elements that only reserve
 * the space and show text; the pictures are rendered by the main WebGL renderer into the tile rectangles
 * (scissor + viewport), so there is a single canvas and no extra GPU context.
 */
export class OnboardCams {
  private readonly root = h('div', { class: 'pips' });
  private tiles = new Map<number, { el: HTMLElement; speed: HTMLElement }>();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.15, 6000);

  constructor(
    host: HTMLElement, private model: AppModel, private renderer: THREE.WebGLRenderer, private scene: THREE.Scene,
    private athletes: () => AthleteLayer,
  ) {
    host.appendChild(this.root);
    for (const event of ['selection', 'world', 'view'] as const) model.on(event, () => this.rebuild());
    this.rebuild();
  }

  /** One tile per visible athlete; clicking a tile focuses that athlete. */
  private rebuild(): void {
    const m = this.model;
    this.root.hidden = !m.layers.pips;
    this.root.replaceChildren();
    this.tiles.clear();
    if (!m.world || !m.layers.pips) return;
    for (const run of m.visibleRuns) {
      const speed = h('b', { class: 'mono' }, '0');
      const el = h('button', { class: `pip${run.bib === m.focus ? ' focus' : ''}`, style: `--c:${m.info(run.bib).color}`, title: 'Focus this athlete',
        onclick: () => m.setFocus(run.bib) },
        h('span', { class: 'rec' }, '●'),
        h('span', { class: 'cam' }, flagElement(m.info(run.bib).nation, 9), ` CAM ${athleteLabel(m, run.bib)}`),
        h('span', { class: 'spd' }, speed, ' km/h'));
      this.tiles.set(run.bib, { el, speed });
      this.root.appendChild(el);
    }
  }

  /** Renders every tile after the main view. Call once per frame. */
  render(): void {
    const m = this.model;
    if (!m.layers.pips || !this.tiles.size) return;
    const canvas = this.renderer.domElement.getBoundingClientRect();
    this.renderer.setScissorTest(true);
    for (const [bib, tile] of this.tiles) {
      const run = m.run(bib);
      const rect = tile.el.getBoundingClientRect();
      if (!run || rect.width < 8 || rect.height < 8) continue;               // hidden (e.g. on small screens)
      tile.speed.textContent = String(Math.round(m.sampleFor(run).v * 3.6));
      const x = rect.left - canvas.left, y = canvas.height - (rect.bottom - canvas.top);
      this.renderer.setViewport(x, y, rect.width, rect.height);
      this.renderer.setScissor(x, y, rect.width, rect.height);

      const pose = onboardPose(m, this.athletes(), run);
      this.camera.aspect = rect.width / rect.height;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(pose.position);
      this.camera.up.copy(pose.up);
      this.camera.lookAt(pose.target);

      const athletes = this.athletes();
      athletes.beginOnboard(bib);                                            // hide the owner's body and the markers
      this.renderer.render(this.scene, this.camera);
      athletes.endHidden();
    }
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);
  }
}
