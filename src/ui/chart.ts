import { h } from './dom';

export interface ChartSeries { x: ArrayLike<number>; y: ArrayLike<number>; color: string; width?: number; fill?: boolean; label?: string; dim?: boolean }
export interface ChartMarker { x: number; label?: string; color?: string }
export interface ChartOptions { title: string; unit?: string; yMin?: number; yMax?: number; zero?: boolean; decimals?: number; height?: number }

const PADDING = { left: 38, right: 8, top: 6, bottom: 16 };
const Y_TICKS = 4;
const Y_HEADROOM = { below: 0.05, above: 0.08 };      // fraction of the data range added around auto-scaled axes
const FONT = '9px ui-monospace, Menlo, monospace';
const cssColor = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

/**
 * Small canvas line chart. Two stacked canvases keep it cheap:
 *   - `base`  : axes, grid, series. Redrawn only when data or size change.
 *   - `over`  : playback cursor and hover read-out. Redrawn every frame (a few draw calls).
 * All charts of the app share the chainage axis, so a click maps to `onSeek(chainage)`.
 */
export class LineChart {
  readonly el: HTMLElement;
  onSeek?: (x: number) => void;

  private base = h('canvas');
  private over = h('canvas', { class: 'over' });
  private readout = h('div', { class: 'readout mono' });
  private series: ChartSeries[] = [];
  private markers: ChartMarker[] = [];
  private xMin = 0; private xMax = 1;
  private yMin = 0; private yMax = 1;
  private cursor: number | null = null;
  private hover: number | null = null;

  constructor(private opts: ChartOptions) {
    this.el = h('div', { class: 'chart' },
      h('div', { class: 'chart-title' }, opts.title, h('span', { class: 'unit' }, opts.unit ?? '')),
      h('div', { class: 'chart-body', style: `height:${opts.height ?? 96}px` }, this.base, this.over, this.readout));
    new ResizeObserver(() => this.resize()).observe(this.el.querySelector('.chart-body')!);
    this.bindPointer();
  }

  // ---- public API -------------------------------------------------------------------------------------
  /** Replaces the plotted data and rescales the axes. */
  set(series: ChartSeries[], markers: ChartMarker[] = [], xMax?: number): void {
    this.series = series;
    this.markers = markers;
    this.xMin = 0;
    this.xMax = xMax ?? Math.max(1, ...series.map((s) => s.x[s.x.length - 1] ?? 0));
    this.fitYAxis();
    this.drawBase();
    this.drawOver();
  }

  setCursor(x: number | null): void { this.cursor = x; this.drawOver(); }

  // ---- scaling ------------------------------------------------------------------------------------------
  private fitYAxis(): void {
    const { yMin, yMax, zero } = this.opts;
    let lo = yMin ?? Infinity, hi = yMax ?? -Infinity;
    for (const s of this.series) {
      for (let i = 0; i < s.y.length; i++) {
        if (yMin === undefined) lo = Math.min(lo, s.y[i]);
        if (yMax === undefined) hi = Math.max(hi, s.y[i]);
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const span = hi - lo || 1;
    this.yMin = yMin ?? lo - span * Y_HEADROOM.below;
    this.yMax = yMax ?? hi + span * Y_HEADROOM.above;
  }

  private toPx(x: number): number {
    const width = this.base.clientWidth - PADDING.left - PADDING.right;
    return PADDING.left + ((x - this.xMin) / (this.xMax - this.xMin || 1)) * width;
  }
  private toPy(y: number): number {
    const height = this.base.clientHeight - PADDING.top - PADDING.bottom;
    return this.base.clientHeight - PADDING.bottom - ((y - this.yMin) / (this.yMax - this.yMin || 1)) * height;
  }
  private fromPx(clientX: number): number {
    const rect = this.over.getBoundingClientRect(), width = rect.width - PADDING.left - PADDING.right;
    return this.xMin + ((clientX - rect.left - PADDING.left) / width) * (this.xMax - this.xMin);
  }

  private valueAt(s: ChartSeries, x: number): number {
    const n = s.x.length;
    if (!n) return NaN;
    if (x <= s.x[0]) return s.y[0];
    if (x >= s.x[n - 1]) return s.y[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s.x[mid] <= x) lo = mid; else hi = mid; }
    return s.y[lo] + ((s.y[hi] - s.y[lo]) * (x - s.x[lo])) / (s.x[hi] - s.x[lo] || 1);
  }

  // ---- interaction ----------------------------------------------------------------------------------------
  private bindPointer(): void {
    this.over.addEventListener('pointermove', (e) => {
      this.hover = this.fromPx(e.clientX);
      if (e.buttons) this.onSeek?.(this.hover);            // dragging scrubs
      this.drawOver();
    });
    this.over.addEventListener('pointerleave', () => { this.hover = null; this.drawOver(); });
    this.over.addEventListener('pointerdown', (e) => { this.over.setPointerCapture(e.pointerId); this.onSeek?.(this.fromPx(e.clientX)); });
  }

  private resize(): void {
    const body = this.base.parentElement!, w = body.clientWidth, height = body.clientHeight, dpr = Math.min(2, devicePixelRatio);
    for (const canvas of [this.base, this.over]) {
      canvas.width = w * dpr; canvas.height = height * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${height}px`;
      canvas.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.drawBase();
    this.drawOver();
  }

  // ---- base layer ------------------------------------------------------------------------------------------
  private drawBase(): void {
    const g = this.base.getContext('2d')!, w = this.base.clientWidth, height = this.base.clientHeight;
    g.clearRect(0, 0, w, height);
    if (!w) return;
    this.drawGrid(g, w, height);
    this.drawMarkers(g, height);
    // dimmed series first so the focus line is drawn on top
    for (const s of [...this.series.filter((q) => q.dim), ...this.series.filter((q) => !q.dim)]) this.drawSeries(g, s);
  }

  private drawGrid(g: CanvasRenderingContext2D, w: number, height: number): void {
    const decimals = this.opts.decimals ?? (this.yMax - this.yMin > 20 ? 0 : 1);
    g.font = FONT; g.lineWidth = 1;
    g.strokeStyle = cssColor('--grid'); g.fillStyle = cssColor('--dim');

    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let i = 0; i <= Y_TICKS; i++) {
      const value = this.yMin + ((this.yMax - this.yMin) * i) / Y_TICKS, y = Math.round(this.toPy(value)) + 0.5;
      g.beginPath(); g.moveTo(PADDING.left, y); g.lineTo(w - PADDING.right, y); g.stroke();
      g.fillText(value.toFixed(decimals), PADDING.left - 4, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const step = this.xMax > 2500 ? 500 : 250;
    for (let x = 0; x <= this.xMax; x += step) g.fillText(`${x}`, this.toPx(x), height - PADDING.bottom + 4);

    if (this.yMin < 0 && this.yMax > 0) {                  // emphasise the zero line when it is inside the plot
      g.strokeStyle = cssColor('--axis');
      const y = Math.round(this.toPy(0)) + 0.5;
      g.beginPath(); g.moveTo(PADDING.left, y); g.lineTo(w - PADDING.right, y); g.stroke();
    }
  }

  private drawMarkers(g: CanvasRenderingContext2D, height: number): void {
    g.lineWidth = 1; g.setLineDash([2, 3]);
    for (const m of this.markers) {
      g.strokeStyle = m.color ?? cssColor('--axis');
      const x = Math.round(this.toPx(m.x)) + 0.5;
      g.beginPath(); g.moveTo(x, PADDING.top); g.lineTo(x, height - PADDING.bottom); g.stroke();
    }
    g.setLineDash([]);
  }

  private tracePath(g: CanvasRenderingContext2D, s: ChartSeries): void {
    g.beginPath();
    for (let i = 0; i < s.x.length; i++) {
      const x = this.toPx(s.x[i]), y = this.toPy(s.y[i]);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
  }

  private drawSeries(g: CanvasRenderingContext2D, s: ChartSeries): void {
    if (s.fill) {                                          // translucent area down to the baseline, then the line on top
      const baseline = this.toPy(Math.max(this.yMin, 0));
      this.tracePath(g, s);
      g.lineTo(this.toPx(s.x[s.x.length - 1]), baseline); g.lineTo(this.toPx(s.x[0]), baseline); g.closePath();
      g.globalAlpha = 0.18; g.fillStyle = s.color; g.fill();
    }
    this.tracePath(g, s);
    g.globalAlpha = s.dim ? 0.55 : 1;
    g.strokeStyle = s.color; g.lineWidth = s.width ?? 1.4; g.stroke();
    g.globalAlpha = 1;
  }

  // ---- overlay layer -----------------------------------------------------------------------------------------
  private drawOver(): void {
    const g = this.over.getContext('2d')!, height = this.over.clientHeight;
    g.clearRect(0, 0, this.over.clientWidth, height);
    const vline = (x: number, color: string, dashed: boolean) => {
      g.strokeStyle = color; g.lineWidth = 1; g.setLineDash(dashed ? [3, 3] : []);
      const px = Math.round(this.toPx(x)) + 0.5;
      g.beginPath(); g.moveTo(px, PADDING.top); g.lineTo(px, height - PADDING.bottom); g.stroke();
      g.setLineDash([]);
    };

    if (this.cursor !== null) {                            // playback cursor with a dot on every visible series
      vline(this.cursor, cssColor('--accent'), false);
      for (const s of this.series.filter((q) => !q.dim)) {
        g.fillStyle = s.color; g.beginPath(); g.arc(this.toPx(this.cursor), this.toPy(this.valueAt(s, this.cursor)), 3, 0, 2 * Math.PI); g.fill();
      }
    }
    if (this.hover !== null) vline(this.hover, cssColor('--dim'), true);

    const x = this.hover ?? this.cursor;                    // read-out follows the mouse, else the playback cursor
    if (x === null) return;
    const decimals = this.opts.decimals ?? (this.yMax - this.yMin > 20 ? 0 : 2);
    const values = this.series.filter((s) => !s.dim && s.label).map((s) => `${s.label} ${this.valueAt(s, x).toFixed(decimals)}`);
    this.readout.textContent = `${Math.round(x)} m  ${values.join('  ')}`;
  }
}
