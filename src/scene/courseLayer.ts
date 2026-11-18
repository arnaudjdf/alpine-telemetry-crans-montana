import * as THREE from 'three';
import type { Course } from '../core/course';
import type { Piste } from '../app/loader';
import type { Terrain } from '../core/terrain';

/** One timing gantry (poles, beam, photocell plane) and where it stands. */
export interface Gantry { group: THREE.Group; position: THREE.Vector3 }

export interface LabelAnchor { id: string; pos: THREE.Vector3; text: string; kind: 'timing' | 'feature' }

export interface CourseLayers {
  piste: THREE.Group;       // groomed strip + safety nets
  gates: THREE.Group;
  context: THREE.Group;     // other pistes of the resort
  timing: THREE.Group;      // gantries and split lines
  gantries: Gantry[];       // the same gantries individually, so they can be hidden when the camera is next to them
  anchors: LabelAnchor[];
}

const HALF_WIDTH = 15;              // m, half width of the groomed race corridor
const NET_OPACITY = 0.38;          // safety-net curtains
const BEAM_PLANE_OPACITY = 0.16;   // photocell plane across the corridor
const CONTEXT_LIFT = 4;            // m: other pistes are drawn above the snow so they stay visible

/** Flat-coloured, see-through, double-sided material that does not write depth (so overlaps blend). */
const translucent = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });

/** Groomed race corridor draped over the terrain (includes the synthetic jump features). */
function buildPiste(course: Course): THREE.Group {
  const g = new THREE.Group();
  const lat = [-HALF_WIDTH, -10, -5, 0, 5, 10, HALF_WIDTH];
  const rows = Math.ceil(course.length / 4), cols = lat.length;
  const pos = new Float32Array(rows * cols * 3);
  for (let r = 0; r < rows; r++) {
    const s = Math.min(course.length, (r / (rows - 1)) * course.length);
    lat.forEach((l, c) => {
      const p = course.pointAt(s, l);
      // taper the corridor edge into the terrain so it blends rather than floating
      const edge = Math.abs(l) === HALF_WIDTH ? -0.25 : 0.18;
      const k = (r * cols + c) * 3;
      pos[k] = p.x; pos[k + 1] = p.y + edge; pos[k + 2] = p.z;
    });
  }
  const idx: number[] = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    idx.push(a, b, d, b, e, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const strip = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: 0xe9f1ff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
  }));
  strip.frustumCulled = false;
  g.add(strip);

  // safety nets: two vertical orange curtains
  for (const side of [-1, 1]) {
    const np = new Float32Array(rows * 2 * 3), ni: number[] = [];
    for (let r = 0; r < rows; r++) {
      const s = Math.min(course.length, (r / (rows - 1)) * course.length), p = course.pointAt(s, side * (HALF_WIDTH + 1.5));
      np.set([p.x, p.y, p.z, p.x, p.y + 1.1, p.z], r * 6);
      if (r < rows - 1) ni.push(r * 2, r * 2 + 1, r * 2 + 2, r * 2 + 1, r * 2 + 3, r * 2 + 2);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(np, 3));
    ng.setIndex(ni);
    const net = new THREE.Mesh(ng, translucent(0xff7a1a, NET_OPACITY));
    net.frustumCulled = false;
    g.add(net);
  }
  return g;
}

function buildGates(course: Course): THREE.Group {
  const g = new THREE.Group(), n = course.gates.length;
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), new THREE.MeshLambertMaterial({ color: 0x20242c }), n * 2);
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.95, 0.04), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  course.gates.forEach((gate, i) => {
    const [dx, dz] = course.directionAt(gate.s);
    q.setFromAxisAngle(up, Math.atan2(dx, dz));
    // each gate = outside pole + inside pole 3 m toward the centre, panel stretched between them
    for (let k = 0; k < 2; k++) {
      const lateral = gate.side * (k === 0 ? gate.offset : Math.max(1, gate.offset - 3));
      const p = course.pointAt(gate.s, lateral);
      m.compose(new THREE.Vector3(p.x, p.y + 1.7, p.z), q, one);
      poles.setMatrixAt(i * 2 + k, m);
    }
    const mid = course.pointAt(gate.s, gate.side * (gate.offset - 1.5));
    m.compose(new THREE.Vector3(mid.x, mid.y + 2.6, mid.z), q, one);
    panels.setMatrixAt(i, m);
    panels.setColorAt(i, new THREE.Color(gate.side > 0 ? 0xe5262b : 0x1f5bd6));
  });
  poles.instanceMatrix.needsUpdate = true; panels.instanceMatrix.needsUpdate = true;
  if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
  poles.frustumCulled = false; panels.frustumCulled = false;
  g.add(poles, panels);
  return g;
}

function buildTiming(course: Course, anchors: LabelAnchor[]): { group: THREE.Group; gantries: Gantry[] } {
  const group = new THREE.Group(), gantries: Gantry[] = [];
  const poleGeometry = new THREE.CylinderGeometry(0.12, 0.12, 7.2, 8);
  for (const tp of course.timing) {
    const isEnd = tp.id === 'START' || tp.id === 'FINISH';
    const color = isEnd ? 0xff7a1a : 0x38e8ff;
    const material = new THREE.MeshBasicMaterial({ color });
    const left = course.pointAt(tp.s, -HALF_WIDTH - 2), right = course.pointAt(tp.s, HALF_WIDTH + 2), mid = course.pointAt(tp.s, 0);
    const gantry = new THREE.Group();
    for (const p of [left, right]) {
      const pole = new THREE.Mesh(poleGeometry, material);
      pole.position.set(p.x, p.y + 3.5, p.z);
      gantry.add(pole);
    }
    const width = Math.hypot(right.x - left.x, right.z - left.z), yaw = -Math.atan2(right.z - left.z, right.x - left.x);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, 0.14, 0.14), material);
    beam.position.set(mid.x, mid.y + 7.2, mid.z);
    beam.rotation.y = yaw;
    const photocell = new THREE.Mesh(new THREE.PlaneGeometry(width, 5), translucent(color, BEAM_PLANE_OPACITY));
    photocell.position.set(mid.x, mid.y + 2.5, mid.z);
    photocell.rotation.y = yaw;
    gantry.add(beam, photocell);
    group.add(gantry);
    gantries.push({ group: gantry, position: new THREE.Vector3(mid.x, mid.y + 3.5, mid.z) });
    anchors.push({
      id: tp.id, kind: 'timing', pos: new THREE.Vector3(mid.x, mid.y + 9.5, mid.z),
      text: `${tp.label.toUpperCase()} · ${Math.round(tp.s)} m`,
    });
  }
  for (const f of course.features) {
    const p = course.pointAt(f.s, 0);
    anchors.push({ id: f.id, pos: new THREE.Vector3(p.x, p.y + 5, p.z), text: f.label.toUpperCase(), kind: 'feature' });
  }
  return { group, gantries };
}

function buildContext(pistes: Piste[], terrain: Terrain): THREE.Group {
  const g = new THREE.Group();
  const colors: Record<string, number> = { novice: 0x7fe08a, easy: 0x4aa3ff, intermediate: 0xff4d4d, advanced: 0x222733, freeride: 0xffb020 };
  for (const p of pistes) {
    if (p.pts.length < 2) continue;
    const pts = p.pts.map(([lat, lon]) => {
      const local = terrain.frame.toLocal(lat, lon);
      return new THREE.Vector3(local.x, terrain.heightAt(local.x, local.z) + CONTEXT_LIFT, local.z);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: colors[p.difficulty] ?? 0xcfd8e8, transparent: true, opacity: 0.75 }));
    line.frustumCulled = false;
    g.add(line);
  }
  return g;
}

export function buildCourseLayers(course: Course, pistes: Piste[], terrain: Terrain): CourseLayers {
  const anchors: LabelAnchor[] = [];
  const timing = buildTiming(course, anchors);
  return {
    piste: buildPiste(course), gates: buildGates(course), context: buildContext(pistes, terrain),
    timing: timing.group, gantries: timing.gantries, anchors,
  };
}
