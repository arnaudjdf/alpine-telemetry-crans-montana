import * as THREE from 'three';
import type { AppModel } from '../app/model';
import type { Course } from '../core/course';
import { h } from '../ui/dom';
import type { AthleteLayer } from './athleteLayer';
import { makeRingTexture } from './skier';

const MAP_LAYER = 1;                                   // objects only the map camera sees (course line, dots, camera pointer)
const VIEW = { fov: 36, height: 2300, back: 2500, lookDown: 120 };   // map camera: high above, north-up, centred on the piste
const DOT = { size: 0.05, focusSize: 0.085, ringScale: 1.5 };        // screen-space sprite sizes, as a fraction of the tile height
const LIFT = 40;                                       // m above the snow so lines and dots are not buried by the relief
const LINE_STEP = 40;                                  // m between points of the course line
const POINTER = { radius: 70, length: 230 };           // m: the "the camera is here and looks this way" cone
const COLORS = { line: 0xff7a1a, ring: 0xffffff, pointer: 0xffffff };
const ORDER = { dot: 10, ring: 11, pointer: 12 };      // draw order: dots above the line, pointer on top

/**
 * A small 3D map of the mountain in a corner of the view: the whole piste, every athlete as a coloured dot, the
 * selected athlete ringed, and a pointer showing where the main camera is and which way it looks.
 * It is drawn by the main renderer into the tile's rectangle, like the helmet cameras.
 */
export class MiniMap {
  private readonly tile: HTMLElement;
  private readonly progress = h('span', { class: 'here mono' });
  private readonly camera = new THREE.PerspectiveCamera(VIEW.fov, 4 / 3, 50, 20000);
  private readonly ringTexture = makeRingTexture();
  private readonly dots = new Map<number, THREE.Sprite>();
  private readonly focusRing: THREE.Sprite;
  private readonly pointer: THREE.Mesh;

  constructor(host: HTMLElement, private model: AppModel, private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private athletes: () => AthleteLayer) {
    this.tile = h('button', { class: 'minimap', type: 'button', title: 'Where we are. Click to enlarge.', onclick: () => this.tile.classList.toggle('big') },
      h('span', { class: 'cap' }, 'MAP'), this.progress);
    host.appendChild(this.tile);

    const course = model.world.course;
    this.focusRing = this.makeSprite(COLORS.ring, ORDER.ring, DOT.focusSize * DOT.ringScale);
    this.pointer = this.makePointer();
    scene.add(this.makeCourseLine(course), this.focusRing, this.pointer);
    this.placeCamera(course);

    for (const event of ['selection', 'world'] as const) model.on(event, () => this.rebuildDots());
    this.rebuildDots();
  }

  // ---- construction -----------------------------------------------------------------------------------
  /** A ring sprite that only the map camera sees. */
  private makeSprite(color: number | string, order: number, size: number): THREE.Sprite {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ringTexture, color, depthTest: false, transparent: true, sizeAttenuation: false }));
    sprite.scale.setScalar(size);
    sprite.layers.set(MAP_LAYER);
    sprite.renderOrder = order;
    return sprite;
  }

  private makeCourseLine(course: Course): THREE.Line {
    const points: THREE.Vector3[] = [];
    for (let s = 0; s <= course.length; s += LINE_STEP) {
      const p = course.pointAt(s, 0);
      points.push(new THREE.Vector3(p.x, p.y + LIFT, p.z));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: COLORS.line }));
    line.frustumCulled = false;
    line.layers.set(MAP_LAYER);
    return line;
  }

  private makePointer(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ color: COLORS.pointer, transparent: true, opacity: 0.75, depthTest: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(POINTER.radius, POINTER.length, 4), material);
    cone.layers.set(MAP_LAYER);
    cone.renderOrder = ORDER.pointer;
    return cone;
  }

  /** North-up view from the south: the piste runs from the top-left to the bottom-right of the tile. */
  private placeCamera(course: Course): void {
    const mid = course.pointAt(course.length * 0.5, 0);
    this.camera.position.set(mid.x, mid.y + VIEW.height, mid.z + VIEW.back);
    this.camera.lookAt(mid.x, mid.y - VIEW.lookDown, mid.z);
    this.camera.layers.enable(MAP_LAYER);
  }

  /** One coloured dot per visible athlete. */
  private rebuildDots(): void {
    for (const dot of this.dots.values()) { this.scene.remove(dot); dot.material.dispose(); }
    this.dots.clear();
    for (const run of this.model.visibleRuns) {
      const dot = this.makeSprite(this.model.info(run.bib).color, ORDER.dot, DOT.size);
      this.scene.add(dot);
      this.dots.set(run.bib, dot);
    }
  }

  // ---- per frame --------------------------------------------------------------------------------------
  /** Moves the dots, the ring and the pointer to the current positions. */
  private update(mainCamera: THREE.PerspectiveCamera): void {
    const m = this.model, athletes = this.athletes();
    for (const [bib, dot] of this.dots) {
      dot.position.copy(athletes.positionOf(bib)).y += LIFT;
      dot.scale.setScalar(bib === m.focus ? DOT.focusSize : DOT.size);
    }
    this.focusRing.visible = this.dots.has(m.focus);
    this.focusRing.position.copy(athletes.positionOf(m.focus)).y += LIFT;

    // the pointer starts at the main camera and points the way it looks
    const forward = mainCamera.getWorldDirection(new THREE.Vector3());
    this.pointer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
    this.pointer.position.copy(mainCamera.position).addScaledVector(forward, POINTER.length / 2);

    this.progress.textContent = `${Math.round(m.sampleFor(m.focusRun).s)} / ${Math.round(m.world.course.length)} m`;
  }

  /**
   * Draws the map into its tile. `prepare` switches the scene to its "map look" (no fog or sky, dark background)
   * and returns the function that switches it back.
   */
  render(mainCamera: THREE.PerspectiveCamera, prepare: () => () => void): void {
    const visible = this.model.layers.minimap;
    this.tile.hidden = !visible;
    if (!visible) return;
    const canvas = this.renderer.domElement.getBoundingClientRect(), rect = this.tile.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    this.update(mainCamera);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();

    const x = rect.left - canvas.left, y = canvas.height - (rect.bottom - canvas.top);     // WebGL's origin is bottom-left
    const restoreLook = prepare();
    const athletes = this.athletes();
    athletes.beginMap();
    this.renderer.setScissorTest(true);
    this.renderer.setViewport(x, y, rect.width, rect.height);
    this.renderer.setScissor(x, y, rect.width, rect.height);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, canvas.width, canvas.height);
    athletes.endHidden();
    restoreLook();
  }
}
