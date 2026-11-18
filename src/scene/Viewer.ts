import * as THREE from 'three';
import type { AppModel, Quality } from '../app/model';
import { AthleteLayer } from './athleteLayer';
import { CameraRig } from './cameraRig';
import { buildCourseLayers, type CourseLayers } from './courseLayer';
import { LabelLayer } from './labelLayer';
import { MiniMap } from './miniMap';
import { OnboardCams } from './onboardCams';
import { Venue } from './venue';
import { makeSky } from './sky';
import { buildTerrainMesh, type TerrainHandle } from './terrainMesh';

const FOG_COLOR = new THREE.Color(0xa9bdd6);
const FOG_DENSITY = 0.00028;
const MAP_BACKGROUND = new THREE.Color(0x0b111c);      // behind the mini map
const ZENITH_COLOR = new THREE.Color(0x3d6aa8);
const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.62, -0.5).normalize();     // low winter sun
const PIXEL_RATIO_CAP: Record<Quality, number> = { perf: 1, bal: 1.5, cine: 2 };
const MAX_FRAME_DT = 0.05;          // s: clamp so a stalled tab does not teleport the athletes
const FPS_WINDOW = 0.5;             // s over which frames are averaged
const GANTRY_HIDE_DISTANCE = 40;    // m: a gantry right next to the camera would fill the screen, so hide it

/** Owns the WebGL renderer and scene, and wires the camera rig, athlete layer and labels together. */
export class Viewer {
  fps = 0;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.5, 14000);
  private terrain!: TerrainHandle;
  private course!: CourseLayers;
  private athletes!: AthleteLayer;
  private rig!: CameraRig;
  private labels!: LabelLayer;
  private pips!: OnboardCams;
  private miniMap!: MiniMap;
  private venue!: Venue;
  private sky!: THREE.Mesh;
  private frames = 0; private fpsClock = 0; private lastTime = 0; private raf = 0;

  constructor(private host: HTMLElement, private model: AppModel) {
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.setupEnvironment();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private setupEnvironment(): void {
    this.scene.background = FOG_COLOR.clone();
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    this.sky = makeSky(ZENITH_COLOR, FOG_COLOR);
    this.scene.add(this.sky);
    this.scene.add(new THREE.HemisphereLight(0xcfe1ff, 0x59664f, 1.15));       // sky / ground bounce light
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(1000);
    this.scene.add(sun);
  }

  /** Builds everything that depends on the loaded world (terrain, course, athletes, labels, camera). */
  async build(): Promise<void> {
    const { terrain, course, pistes } = this.model.world;
    this.terrain = buildTerrainMesh(terrain, await this.loadTexture(), FOG_COLOR, FOG_DENSITY, SUN_DIRECTION);
    this.course = buildCourseLayers(course, pistes, terrain);
    this.athletes = new AthleteLayer(this.model, (x, z) => terrain.heightAt(x, z));
    this.scene.add(this.terrain.mesh, this.course.piste, this.course.gates, this.course.context, this.course.timing, this.athletes.root);
    this.athletes.rebuild();
    this.venue = new Venue(this.model, () => this.athletes);
    this.scene.add(this.venue.object);

    this.rig = new CameraRig(this.camera, this.renderer.domElement, this.model, () => this.athletes);
    this.labels = new LabelLayer(this.host, this.camera, this.model, this.course.anchors);
    this.pips = new OnboardCams(this.host, this.model, this.renderer, this.scene, () => this.athletes);
    this.miniMap = new MiniMap(this.host, this.model, this.renderer, this.scene, () => this.athletes);
    this.applyView();
    this.model.on('view', () => this.applyView());
    this.model.on('world', () => this.athletes.rebuild());
  }

  /** The aerial photo: raw colour values (the terrain shader does its own shading), mip-mapped and anisotropic. */
  private async loadTexture(): Promise<THREE.Texture> {
    const texture = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}data/texture.jpg`);
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    return texture;
  }

  /** Full-course overview (free camera). */
  overview(): void { this.rig.overview(); }

  start(): void {
    const loop = (now: number) => {
      const dt = Math.min(MAX_FRAME_DT, (now - this.lastTime) / 1000 || 0.016);
      this.lastTime = now;
      this.model.tick(dt);                       // advance the playback clock
      this.renderFrame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void { cancelAnimationFrame(this.raf); this.renderer.dispose(); }

  /** Applies layer toggles, snow cover, quality and camera mode from the model. */
  private applyView(): void {
    const { layers, snow, quality } = this.model;
    this.course.piste.visible = layers.course;
    this.course.timing.visible = layers.course;
    this.course.gates.visible = layers.gates;
    this.course.context.visible = layers.pistes;
    this.terrain.uniforms.uSnow.value = snow;
    this.terrain.uniforms.uContours.value = layers.contours ? 1 : 0;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO_CAP[quality]));
    this.resize();
    this.rig.syncMode();
  }

  private resize(): void {
    const width = this.host.clientWidth, height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Timing gantries are huge when the camera starts right under them (e.g. the start gate in chase view). */
  private hideCloseGantries(): void {
    const visible = this.model.layers.course;
    for (const g of this.course.gantries) {
      g.group.visible = visible && this.camera.position.distanceTo(g.position) > GANTRY_HIDE_DISTANCE;
    }
  }

  /** The map is seen from 3 km away: fog and sky would wash it out, so switch them off while it is drawn. */
  private mapLook(): () => void {
    const { scene, sky } = this, fog = scene.fog, background = scene.background, density = this.terrain.uniforms.uFogDensity.value;
    scene.fog = null; scene.background = MAP_BACKGROUND; sky.visible = false; this.terrain.uniforms.uFogDensity.value = 0;
    return () => { scene.fog = fog; scene.background = background; sky.visible = true; this.terrain.uniforms.uFogDensity.value = density; };
  }

  private renderFrame(dt: number): void {
    this.athletes.update(dt);
    this.venue.update(dt);
    this.rig.update(dt);
    this.hideCloseGantries();
    this.labels.update(this.athletes);
    const firstPerson = this.model.camera === 'onboard';
    if (firstPerson) this.athletes.beginOnboard(this.model.focus);          // do not render the camera owner's own body
    this.renderer.render(this.scene, this.camera);
    if (firstPerson) this.athletes.endHidden();
    this.pips.render();
    this.miniMap.render(this.camera, () => this.mapLook());
    this.frames++; this.fpsClock += dt;
    if (this.fpsClock >= FPS_WINDOW) { this.fps = this.frames / this.fpsClock; this.frames = 0; this.fpsClock = 0; }
  }
}
