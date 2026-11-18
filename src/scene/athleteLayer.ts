import * as THREE from 'three';
import type { AppModel } from '../app/model';
import { finishTimeOf } from '../analysis/sample';
import type { RunAnalysis } from '../analysis/types';
import { clamp } from '../core/math';
import { Powder } from './powder';
import { buildGapRibbon, buildSpeedRibbon, GAP_STEP, INDICES_PER_QUAD, type Ribbon } from './ribbons';
import { makeRingTexture, makeSkier, makeSoftTexture } from './skier';

const SERIES_RATE = 20;             // Hz of the analysed series
const ANTENNA_HEIGHT = 1.0;         // m, logger height above the snow
const MARKER_FOCUS = 0.02, MARKER_OTHER = 0.014;  // screen-space marker sizes
const GHOST_OPACITY = 0.22, TRACE_OPACITY = 0.95;
const TRACE_LIFT = 0.35;            // m above the snow, so the line does not z-fight with it

/** Skier orientation: yaw from heading (clockwise from north), nose-down pitch from slope, roll into the turn from lateral g. */
function poseOf(heading: number, slopeDeg: number, gLat: number): THREE.Euler {
  const pitch = (slopeDeg * Math.PI) / 180 * 0.8, roll = clamp(Math.atan(gLat * 0.7), -0.9, 0.9);
  return new THREE.Euler(pitch, Math.atan2(Math.sin(heading), -Math.cos(heading)), roll, 'YXZ');
}

/** Everything the scene shows for one athlete. */
interface Visual {
  run: RunAnalysis;
  group: THREE.Group;             // skier model + beacon
  marker: THREE.Sprite;
  ghost: THREE.Line;              // the whole line, faint
  trace: THREE.Line;              // the part already skied, bright (revealed with drawRange)
  traceCount: number;
  traceStart: number;             // series index of the first traced sample
  powder: Powder;
}

/** Everything that moves: skier models, traces, powder, speed ribbon and gap ribbon. */
export class AthleteLayer {
  readonly root = new THREE.Group();
  private visuals = new Map<number, Visual>();
  private speedRibbon?: Ribbon;
  private gapRibbon?: Ribbon;
  private ribbonKey = '';                          // "focus|reference": ribbons are rebuilt when it changes
  private readonly ring = makeRingTexture();
  private readonly soft = makeSoftTexture();

  constructor(private model: AppModel, private surface: (x: number, z: number) => number) {}

  /** Rebuilds all static geometry after the data set changes. */
  rebuild(): void {
    for (const v of this.visuals.values()) this.root.remove(v.group, v.ghost, v.trace, v.powder.points);
    this.visuals.clear();
    for (const run of this.model.world.runs) this.visuals.set(run.bib, this.makeVisual(run));
    this.ribbonKey = '';
  }

  private makeVisual(run: RunAnalysis): Visual {
    const color = new THREE.Color(this.model.info(run.bib).color);
    const { group, marker } = makeSkier(color, this.ring);
    const { ghost, trace, count, start } = this.makeTraces(run, color);
    const powder = new Powder(this.soft);
    this.root.add(group, powder.points);
    return { run, group, marker, ghost, trace, traceCount: count, traceStart: start, powder };
  }

  /** Two lines through the same points: a faint ghost of the whole run and a bright one that grows with time. */
  private makeTraces(run: RunAnalysis, color: THREE.Color) {
    const S = run.series;
    const start = Math.max(0, Math.round(-S.t[0] * SERIES_RATE));
    const end = Math.min(S.n - 1, Math.round((finishTimeOf(run) + 0.5 - S.t[0]) * SERIES_RATE));
    const count = end - start + 1, points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const k = start + i, y = Math.max(S.y[k] - ANTENNA_HEIGHT, this.surface(S.x[k], S.z[k]));
      points.set([S.x[k], y + TRACE_LIFT, S.z[k]], i * 3);
    }
    const line = (opacity: number) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
      const l = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      l.frustumCulled = false;
      this.root.add(l);
      return l;
    };
    const ghost = line(GHOST_OPACITY), trace = line(TRACE_OPACITY);
    trace.geometry.setDrawRange(0, 0);
    return { ghost, trace, count, start };
  }

  /** (Re)builds the ribbons that depend on the focus and reference athletes. */
  private ensureRibbons(): void {
    const key = `${this.model.focus}|${this.model.reference}`;
    if (key === this.ribbonKey) return;
    this.ribbonKey = key;
    for (const old of [this.speedRibbon, this.gapRibbon]) if (old) { this.root.remove(old.mesh); old.mesh.geometry.dispose(); }
    const m = this.model;
    this.speedRibbon = buildSpeedRibbon(m.focusRun, this.surface);
    this.gapRibbon = m.focus === m.reference ? undefined : buildGapRibbon(m.focusRun, m.refRun, m.world.course.length, this.surface);
    for (const r of [this.speedRibbon, this.gapRibbon]) if (r) this.root.add(r.mesh);
  }

  /** Per-frame update: skier poses, traces, powder, then the two ribbons. `dt` is real seconds. */
  update(dt: number): void {
    this.ensureRibbons();
    for (const visual of this.visuals.values()) this.updateAthlete(visual, dt);
    this.updateRibbons();
  }

  private updateAthlete(v: Visual, dt: number): void {
    const m = this.model, shown = m.selected.has(v.run.bib);
    v.group.visible = shown;
    v.ghost.visible = v.trace.visible = shown && m.layers.traces;
    v.powder.points.visible = shown && m.quality !== 'perf';
    if (!shown) return;

    const s = m.sampleFor(v.run);
    const y = Math.max(s.y - ANTENNA_HEIGHT, this.surface(s.x, s.z));       // never sink below the snow
    v.group.position.set(s.x, y, s.z);
    v.group.quaternion.setFromEuler(poseOf(s.heading, s.slope, s.gLat));

    const isFocus = v.run.bib === m.focus;
    v.marker.visible = m.camera !== 'chase' || !isFocus;                     // hide the beacon in the chase view
    v.marker.scale.setScalar(isFocus ? MARKER_FOCUS : MARKER_OTHER);

    const sampleIndex = Math.round((s.t - v.run.series.t[0]) * SERIES_RATE) - v.traceStart;
    v.trace.geometry.setDrawRange(0, clamp(sampleIndex, 0, v.traceCount));
    if (m.playing) { v.powder.emit(s.x, y, s.z, s.v, s.air, s.heading, s.gLat); v.powder.update(dt); }
  }

  /** Ribbons are revealed progressively up to where the focus athlete currently is. */
  private updateRibbons(): void {
    const m = this.model, focus = m.sampleFor(m.focusRun);
    if (this.speedRibbon?.times) {
      const r = this.speedRibbon, next = r.times!.findIndex((t) => t > focus.t), reached = next < 0 ? r.steps : next;
      r.mesh.visible = m.layers.speedRibbon;
      r.mesh.geometry.setDrawRange(0, Math.max(0, reached - 1) * INDICES_PER_QUAD);
    }
    if (this.gapRibbon) {
      const r = this.gapRibbon, reached = clamp(Math.floor(focus.s / GAP_STEP), 0, r.steps - 1);
      r.mesh.visible = m.layers.gapRibbon;
      r.mesh.geometry.setDrawRange(0, reached * INDICES_PER_QUAD);
    }
  }

  private hidden: { object: THREE.Object3D; visible: boolean }[] = [];

  /** Hides what must not appear in a helmet camera: the owner's own body and spray, and the screen-space markers. */
  beginOnboard(bib: number): void {
    this.hidden = [];
    for (const v of this.visuals.values()) {
      for (const object of v.run.bib === bib ? [v.group, v.marker, v.powder.points] : [v.marker]) {
        this.hidden.push({ object, visible: object.visible });
        object.visible = false;
      }
    }
  }

  /** For the mini map: the athletes are far too small to see as models, so hide bodies, markers and spray (traces stay). */
  beginMap(): void {
    this.hidden = [];
    for (const v of this.visuals.values()) {
      for (const object of [v.group, v.powder.points]) {
        this.hidden.push({ object, visible: object.visible });
        object.visible = false;
      }
    }
  }

  /** Restores the visibility changed by `beginOnboard` or `beginMap`. */
  endHidden(): void {
    for (const h of this.hidden) h.object.visible = h.visible;
    this.hidden = [];
  }

  /** World position used by cameras and labels. */
  positionOf(bib: number, out = new THREE.Vector3()): THREE.Vector3 {
    const v = this.visuals.get(bib);
    return v ? out.copy(v.group.position) : out;
  }
}
