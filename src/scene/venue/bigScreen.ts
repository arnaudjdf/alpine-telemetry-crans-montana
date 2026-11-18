import * as THREE from 'three';
import type { AppModel } from '../../app/model';
import { finishTimeOf } from '../../analysis/sample';
import { fmtTime } from '../../ui/dom';
import { drawFlag } from '../../ui/flags';
import { athleteLabel } from '../../ui/format';
import type { Frame } from './frame';

const SIZE = { width: 14, height: 7.5, canvasW: 1024, canvasH: 548 };
const REDRAW_EVERY = 0.2;           // s: a screen does not need to refresh at 60 Hz
const SHOWN = 5;                    // rows in the result list

/** A large LED screen near the finish: the selected athlete's clock and the results as athletes cross the line. */
export class BigScreen {
  readonly object = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private sinceDraw = 1;

  constructor(frame: Frame, u: number, private model: AppModel) {
    this.canvas.width = SIZE.canvasW; this.canvas.height = SIZE.canvasH;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const base = frame.at(u, 0), steel = new THREE.MeshStandardMaterial({ color: 0x1b212d, roughness: 0.6 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(SIZE.width, SIZE.height), new THREE.MeshBasicMaterial({ map: this.texture }));
    const frameBox = new THREE.Mesh(new THREE.BoxGeometry(SIZE.width + 0.8, SIZE.height + 0.8, 0.5), steel);
    board.position.z = 0.28;
    const screen = new THREE.Group();
    screen.add(frameBox, board);
    screen.position.y = 3.2 + SIZE.height / 2;
    for (const x of [-SIZE.width / 2 + 1.5, SIZE.width / 2 - 1.5]) {                     // two legs
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.6, 0.5), steel);
      leg.position.set(x, 1.8, -0.1);
      this.object.add(leg);
    }
    this.object.add(screen);
    this.object.position.copy(base);
    this.object.rotation.y = frame.yawAt(u) + Math.PI;                                       // facing back up the piste, toward the athletes
    this.draw();
  }

  update(dt: number): void {
    this.sinceDraw += dt;
    if (this.sinceDraw < REDRAW_EVERY || !this.object.visible) return;
    this.sinceDraw = 0;
    this.draw();
  }

  private draw(): void {
    const m = this.model, g = this.canvas.getContext('2d')!, { canvasW: w, canvasH: h } = SIZE;
    g.fillStyle = '#070b13'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, w, 10);
    g.textBaseline = 'alphabetic';

    g.fillStyle = '#9aa7bd'; g.font = '600 30px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText('CRANS-MONTANA 2027 · LIVE', 40, 70);
    const focus = m.focusRun;
    g.fillStyle = m.info(focus.bib).color; g.font = '700 54px system-ui, sans-serif';
    g.fillText(athleteLabel(m, focus.bib), 40, 160);
    g.fillStyle = '#f2f4f8'; g.font = '700 150px ui-monospace, Menlo, monospace';
    g.fillText(fmtTime(Math.max(0, Math.min(m.runTimeOf(focus), finishTimeOf(focus)))), 40, 330);
    g.fillStyle = '#9aa7bd'; g.font = '600 28px system-ui, sans-serif';
    g.fillText('RUN TIME', 40, 380);

    // results: those who have crossed the line, fastest first
    const results = m.visibleRuns.filter((r) => m.runTimeOf(r) >= finishTimeOf(r)).sort((a, b) => finishTimeOf(a) - finishTimeOf(b)).slice(0, SHOWN);
    g.fillStyle = '#9aa7bd'; g.font = '600 28px system-ui, sans-serif'; g.fillText('RESULTS', 620, 70);
    if (!results.length) { g.fillStyle = '#5b6578'; g.font = '500 30px system-ui, sans-serif'; g.fillText('waiting for the first finisher', 620, 130); }
    results.forEach((run, i) => {
      const y = 130 + i * 62;
      g.fillStyle = '#9aa7bd'; g.font = '600 34px ui-monospace, Menlo, monospace'; g.fillText(String(i + 1), 620, y);
      drawFlag(g, m.info(run.bib).nation, 666, y - 26, 36, 24);
      g.fillStyle = '#f2f4f8'; g.font = '600 36px system-ui, sans-serif'; g.fillText(athleteLabel(m, run.bib), 716, y);
      g.textAlign = 'right'; g.font = '600 36px ui-monospace, Menlo, monospace'; g.fillText(fmtTime(finishTimeOf(run)), w - 40, y); g.textAlign = 'left';
    });
    this.texture.needsUpdate = true;
  }
}
