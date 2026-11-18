import type { Anomaly, RunAnalysis } from '../analysis/types';
import { finishTimeOf, sampleAt, timeAtChainage, type RunSample } from '../analysis/sample';
import type { World } from './loader';

export type CameraMode = 'chase' | 'tv' | 'heli' | 'onboard' | 'free';
export type SyncMode = 'time' | 'chainage';
export type Quality = 'perf' | 'bal' | 'cine';
export type TabId = 'telemetry' | 'splits' | 'log';
/** Which scene layers are visible (toggled from the left panel). */
export interface Layers {
  course: boolean; gates: boolean; pistes: boolean; traces: boolean;
  speedRibbon: boolean; gapRibbon: boolean; labels: boolean; contours: boolean; pips: boolean; minimap: boolean; venue: boolean;
}
/** View settings that can be changed together with `setView`. */
type ViewPatch = Partial<Pick<AppModel, 'camera' | 'sync' | 'quality' | 'snow' | 'tab' | 'rate' | 'startInterval'>>;

type Event = 'world' | 'selection' | 'view' | 'time' | 'play';

/** Single source of truth for the UI and the 3D viewer. Views subscribe to coarse events. */
export class AppModel {
  world!: World;
  time = 0;
  playing = true;
  rate = 1;
  selected = new Set<number>();
  focus = 0;
  reference = 0;
  camera: CameraMode = 'heli';
  sync: SyncMode = 'time';
  quality: Quality = 'bal';
  snow = 0.85;
  tab: TabId = 'telemetry';
  pipelineMs = 0;
  /** Seconds between two athletes leaving the gate, so they are not stacked on top of each other (start order = bib order). */
  startInterval = 2;
  private startOrder: number[] = [];
  layers: Layers = {
    course: true, gates: true, pistes: false, traces: true, speedRibbon: true, gapRibbon: true,
    labels: true, contours: false, pips: true, minimap: true, venue: true,
  };
  private handlers = new Map<Event, Set<() => void>>();

  on(ev: Event, fn: () => void): () => void {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return () => this.handlers.get(ev)!.delete(fn);
  }
  emit(ev: Event): void { this.handlers.get(ev)?.forEach((f) => f()); }

  setWorld(w: World): void {
    this.world = w;
    this.pipelineMs = w.pipelineMs;
    const bibs = w.runs.map((r) => r.bib);
    this.selected = new Set(bibs);
    const byTime = [...w.runs].sort((a, b) => finishTimeOf(a) - finishTimeOf(b));
    this.focus = byTime[0]?.bib ?? 0;
    this.reference = byTime[1]?.bib ?? byTime[0]?.bib ?? 0;
    this.startOrder = w.runs.map((r) => r.bib).sort((a, b) => a - b);
    this.time = 0; this.playing = true;
    this.emit('world'); this.emit('selection');
  }

  /** Seconds after the clock starts at which this athlete leaves the gate. */
  delayOf(run: RunAnalysis): number { return Math.max(0, this.startOrder.indexOf(run.bib)) * this.startInterval; }
  /** Time since this athlete's own start (negative before they leave the gate). */
  runTimeOf(run: RunAnalysis, clock = this.time): number { return clock - this.delayOf(run); }
  /** Clock value at which this athlete is at run time `t`. */
  clockAt(run: RunAnalysis, t: number): number { return t + this.delayOf(run); }

  get duration(): number { return Math.max(...this.world.runs.map((r) => finishTimeOf(r) + this.delayOf(r))) + 2; }
  run(bib: number): RunAnalysis | undefined { return this.world.runs.find((r) => r.bib === bib); }
  get focusRun(): RunAnalysis { return this.run(this.focus) ?? this.world.runs[0]; }
  get refRun(): RunAnalysis { return this.run(this.reference) ?? this.focusRun; }
  info(bib: number) { return this.world.athletes.find((a) => a.bib === bib)!; }
  get visibleRuns(): RunAnalysis[] { return this.world.runs.filter((r) => this.selected.has(r.bib)); }

  /** State of any run at the current clock, honouring the sync mode (equal time vs equal chainage). */
  sampleFor(run: RunAnalysis): RunSample {
    const own = (r: RunAnalysis) => Math.min(this.runTimeOf(r), finishTimeOf(r) + 2);
    if (this.sync === 'time' || run.bib === this.focus) return sampleAt(run, own(run));
    const c = sampleAt(this.focusRun, own(this.focusRun)).s;
    return sampleAt(run, timeAtChainage(run, Math.min(c, this.world.course.length)));
  }

  /** Gap in seconds of the focus run to the reference at the focus's current chainage (+ = focus ahead). */
  gapNow(): number {
    const f = this.focusRun, r = this.refRun;
    if (f === r) return 0;
    const c = Math.min(this.world.course.length, Math.max(0, sampleAt(f, this.runTimeOf(f)).s));
    return timeAtChainage(r, c) - timeAtChainage(f, c);
  }

  seek(t: number): void { this.time = Math.min(this.duration, Math.max(-1, t)); this.emit('time'); }
  setPlaying(p: boolean): void { this.playing = p; this.emit('play'); }
  /** Jumps to just before an event of the log analysis (2 s of lead-in), focusing the athlete it belongs to. */
  seekAnomaly(a: Anomaly): void {
    this.focus = a.bib;
    this.selected.add(a.bib);
    this.seek(Math.max(0, this.clockAt(this.run(a.bib) ?? this.focusRun, a.t - 2)));
    this.emit('selection');
  }

  tick(dt: number): void {
    if (!this.playing) return;
    this.time += dt * this.rate;
    if (this.time >= this.duration) { this.time = this.duration; this.playing = false; this.emit('play'); }
    this.emit('time');
  }
  setView(patch: ViewPatch): void {
    Object.assign(this, patch);
    this.emit('view');
  }
  setLayer(k: keyof Layers, v: boolean): void { this.layers[k] = v; this.emit('view'); }
  /** Focus an athlete (shown if hidden). The reference must differ from the focus, so it moves if needed. */
  setFocus(bib: number): void {
    this.focus = bib;
    this.selected.add(bib);
    if (this.reference === bib) this.reference = [...this.selected].find((b) => b !== bib) ?? bib;
    this.emit('selection');
  }
  setReference(bib: number): void { this.reference = bib; this.emit('selection'); }
  toggleSelected(bib: number): void {
    if (this.selected.has(bib) && this.selected.size > 1) this.selected.delete(bib); else this.selected.add(bib);
    if (!this.selected.has(this.focus)) this.focus = [...this.selected][0];
    if (!this.selected.has(this.reference)) this.reference = [...this.selected].find((b) => b !== this.focus) ?? this.focus;
    this.emit('selection');
  }
}
