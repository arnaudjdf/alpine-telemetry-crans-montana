import * as THREE from 'three';
import type { AppModel } from '../app/model';
import { flagMarkup } from '../ui/flags';
import type { AthleteLayer } from './athleteLayer';
import type { LabelAnchor } from './courseLayer';

const ATHLETE_LABEL_HEIGHT = 6;     // m above the skier
const TIMING_VISIBLE_UNTIL = 2600;  // m camera distance beyond which a label hides
const FEATURE_VISIBLE_UNTIL = 700;
const EDGE = 6;                     // px kept free between a label and the edge of the view
const OVERLAP = { dx: 96, dy: 18 };   // px: two athlete tags closer than this are stacked, each pushed up by dy

/** HTML labels pinned to 3D positions: athlete tags, timing gantries and jump names. */
export class LabelLayer {
  private elements = new Map<string, HTMLDivElement>();
  private readonly root = document.createElement('div');

  constructor(host: HTMLElement, private camera: THREE.PerspectiveCamera, private model: AppModel, private anchors: LabelAnchor[]) {
    this.root.className = 'labels';
    host.appendChild(this.root);
  }

  /** Gets (or creates) the element for an id. */
  private element(id: string, cssClass: string): HTMLDivElement {
    let el = this.elements.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = `lbl ${cssClass}`;
      this.root.appendChild(el);
      this.elements.set(id, el);
    }
    return el;
  }

  /** Screen position (px) of a world point, or null when it is off-screen or behind the camera. */
  private project(world: THREE.Vector3): { x: number; y: number } | null {
    const ndc = world.clone().project(this.camera);
    if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) return null;
    return { x: ((ndc.x + 1) / 2) * this.root.clientWidth, y: ((1 - ndc.y) / 2) * this.root.clientHeight };
  }

  private show(el: HTMLDivElement, at: { x: number; y: number } | null): void {
    if (!at) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    // keep the whole label inside the view: a label centred near an edge would otherwise be cut off
    const half = el.offsetWidth / 2, x = Math.min(Math.max(at.x, half + EDGE), this.root.clientWidth - half - EDGE);
    const y = Math.max(at.y, el.offsetHeight + EDGE);
    el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
  }

  /** Projects a world position and moves the label there (hidden when `visible` is false or off-screen). */
  private place(el: HTMLDivElement, world: THREE.Vector3, visible: boolean): void {
    this.show(el, visible ? this.project(world) : null);
  }

  update(athletes: AthleteLayer): void {
    const show = this.model.layers.labels;
    this.updateAthletes(athletes, show);
    this.updateAnchors(show);
  }

  private updateAthletes(athletes: AthleteLayer, show: boolean): void {
    const m = this.model, placed: { el: HTMLDivElement; x: number; y: number }[] = [];
    for (const run of m.visibleRuns) {
      const el = this.element(`a${run.bib}`, 'athlete'), info = m.info(run.bib), speed = Math.round(m.sampleFor(run).v * 3.6);
      const html = `${flagMarkup(info.nation, 10)} <b style="color:${info.color}">${String(run.bib).padStart(2, '0')}</b> ${info.nation} <span>${speed} km/h</span>`;
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }       // only touch the DOM when it changed
      el.classList.toggle('focus', run.bib === m.focus);
      const at = show ? this.project(athletes.positionOf(run.bib).add(new THREE.Vector3(0, ATHLETE_LABEL_HEIGHT, 0))) : null;
      if (at) placed.push({ el, ...at }); else this.show(el, null);
    }
    this.separate(placed);
    for (const [id, el] of this.elements) {                           // hide tags of athletes that were deselected
      if (id.startsWith('a') && !m.selected.has(Number(id.slice(1)))) el.style.display = 'none';
    }
  }

  /** Stacks overlapping tags: walking from the bottom up, a tag too close to one below it is pushed up. */
  private separate(labels: { el: HTMLDivElement; x: number; y: number }[]): void {
    const sorted = [...labels].sort((a, b) => b.y - a.y);
    sorted.forEach((label, i) => {
      for (let j = 0; j < i; j++) {
        const other = sorted[j];
        if (Math.abs(label.x - other.x) < OVERLAP.dx && Math.abs(label.y - other.y) < OVERLAP.dy) label.y = other.y - OVERLAP.dy;
      }
      this.show(label.el, label);
    });
  }

  private updateAnchors(show: boolean): void {
    for (const anchor of this.anchors) {
      const el = this.element(anchor.id, anchor.kind);
      if (!el.textContent) el.textContent = anchor.text;
      const limit = anchor.kind === 'timing' ? TIMING_VISIBLE_UNTIL : FEATURE_VISIBLE_UNTIL;
      this.place(el, anchor.pos, show && this.camera.position.distanceTo(anchor.pos) < limit);
    }
  }
}
