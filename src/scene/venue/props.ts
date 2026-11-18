import * as THREE from 'three';
import { makeRng } from '../../core/math';
import type { Frame } from './frame';
import type { Spot } from './crowd';
import { drawFlag } from '../../ui/flags';

/** Distance of the safety nets from the centre line (see courseLayer). */
const NET_EDGE = 16.5;
/** Nothing for spectators may be closer than this to any part of the piste, even a different branch of a hairpin. */
const CLEARANCE = NET_EDGE + 3;

const matte = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
const STAND = matte(0x536078), STAND_EDGE = matte(0x3b4659), WHITE = matte(0xeef1f6), POLE = matte(0x9aa2ad);

// ---------------------------------------------------------------------------------------------------
// grandstand with spectators
// ---------------------------------------------------------------------------------------------------
export interface StandOptions { side: 1 | -1; from: number; to: number; steps: number; group: number; fill?: number; seed?: number }

/** A stepped grandstand beside the piste, from `from` to `to` metres along it, with spectators standing on every step. */
export function grandstand(frame: Frame, o: StandOptions): { object: THREE.Group; spots: Spot[] } {
  const object = new THREE.Group(), spots: Spot[] = [], rng = makeRng(o.seed ?? 5);
  const SEGMENT = 10, STEP_DEPTH = 2.2, STEP_HEIGHT = 0.9, SPACING = 1.1, FIRST = NET_EDGE + 5;
  for (let k = 0; k < o.steps; k++) {
    const v = o.side * (FIRST + k * STEP_DEPTH), top = (k + 1) * STEP_HEIGHT;
    for (let u = o.from; u < o.to; u += SEGMENT) {
      const centre = frame.at(u + SEGMENT / 2, v);
      if (![0, SEGMENT / 2, SEGMENT].every((du) => frame.isClear(frame.at(u + du, v), CLEARANCE))) continue;   // would sit on the piste
      const box = new THREE.Mesh(new THREE.BoxGeometry(STEP_DEPTH, top + 0.5, SEGMENT), k % 2 ? STAND : STAND_EDGE);
      box.position.set(centre.x, centre.y + top / 2 - 0.25, centre.z);       // sunk 0.25 m so it never floats on a slope
      box.rotation.y = frame.yawAt(u + SEGMENT / 2);
      object.add(box);
      for (let i = 0; i < SEGMENT / SPACING; i++) {                           // a row of people, with some empty places
        if (rng() > (o.fill ?? 0.85)) continue;
        const p = frame.at(u + i * SPACING + (rng() - 0.5) * 0.4, v + (rng() - 0.5) * 0.5);
        p.y = centre.y + top;
        spots.push({ position: p, group: o.group, phase: rng() * 6.28 });
      }
    }
  }
  return { object, spots };
}

/** People standing in a line behind the nets, between `from` and `to`. */
export function lineOfSpectators(frame: Frame, side: 1 | -1, from: number, to: number, spacing: number, group: number, seed: number): Spot[] {
  const rng = makeRng(seed), spots: Spot[] = [];
  for (let u = from; u < to; u += spacing) {
    if (rng() < 0.2) continue;
    const position = frame.at(u + (rng() - 0.5), side * (NET_EDGE + 2 + rng() * 2.5));
    if (frame.isClear(position, CLEARANCE - 1)) spots.push({ position, group, phase: rng() * 6.28 });
  }
  return spots;
}

// ---------------------------------------------------------------------------------------------------
// advertising boards (generic text, no real brands)
// ---------------------------------------------------------------------------------------------------
const BOARD_STYLES: [string, string, string][] = [   // text, background, text colour
  ['CRANS-MONTANA', '#12263f', '#f2f4f8'], ['ALPINE 2027', '#ff7a1a', '#101722'], ['FINISH AREA', '#f2f4f8', '#12263f'],
  ['SPEED · TIMING', '#1f5bd6', '#f2f4f8'], ['WELCOME', '#243a2f', '#f2f4f8'],
];
const boardMaterials = (): THREE.MeshBasicMaterial[] => BOARD_STYLES.map(([text, bg, fg]) => {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.fillStyle = fg; g.font = '700 52px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
});

/** Boards along both sides of the piste, one every `every` metres, facing the athletes' side. */
export function boards(frame: Frame, from: number, to: number, every: number, seed: number): THREE.Group {
  const object = new THREE.Group(), materials = boardMaterials(), rng = makeRng(seed), geometry = new THREE.PlaneGeometry(4.2, 1.05);
  for (const side of [-1, 1] as const) {
    for (let u = from; u <= to; u += every) {
      const board = new THREE.Mesh(geometry, materials[Math.floor(rng() * materials.length)]);
      const p = frame.at(u, side * (NET_EDGE + 1.2));
      if (!frame.isClear(p, NET_EDGE)) continue;
      board.position.set(p.x, p.y + 1.15, p.z);
      board.rotation.y = frame.facingPiste(side, u);
      object.add(board);
    }
  }
  return object;
}

// ---------------------------------------------------------------------------------------------------
// bunting, flags, tents, start house
// ---------------------------------------------------------------------------------------------------
const BUNTING_COLORS = [0xf2f4f8, 0xff7a1a, 0x38bdf8, 0xf6c945, 0xe8566b].map((c) => new THREE.Color(c));

/** A string of small flags hanging across the piste at distance `u`, sagging like a real rope. */
export function bunting(frame: Frame, u: number, height = 7.5): THREE.Mesh {
  const FLAGS = 44, HALF = NET_EDGE + 1, SAG = 1.6, positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < FLAGS; i++) {
    const v = -HALF + ((i + 0.5) / FLAGS) * 2 * HALF, drop = SAG * (1 - (v / HALF) ** 2);         // parabola: low in the middle
    const a = frame.at(u, v - 0.35), b = frame.at(u, v + 0.35), mid = frame.at(u, v);
    const y = mid.y + height - SAG + drop;                                                          // rope height at this v
    positions.push(a.x, y, a.z, b.x, y, b.z, mid.x, y - 0.8, mid.z);
    const c = BUNTING_COLORS[i % BUNTING_COLORS.length];
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  return mesh;
}

const flagTextures = new Map<string, THREE.CanvasTexture>();
/** A texture of the national flag, drawn once per nation. */
function flagTexture(nation: string): THREE.CanvasTexture {
  let texture = flagTextures.get(nation);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 200;
    drawFlag(canvas.getContext('2d')!, nation, 0, 0, 300, 200);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    flagTextures.set(nation, texture);
  }
  return texture;
}

/** Flag poles beside the piste, every `every` metres, flying the flags of `nations` in turn. */
export function flagPoles(frame: Frame, from: number, to: number, every: number, nations: string[]): THREE.Group {
  const object = new THREE.Group(), poleGeometry = new THREE.CylinderGeometry(0.06, 0.08, 9, 6), flagGeometry = new THREE.PlaneGeometry(2.7, 1.8);
  let n = 0;
  for (const side of [-1, 1] as const) {
    for (let u = from; u <= to; u += every, n++) {
      const base = frame.at(u, side * (NET_EDGE + 2.5)), pole = new THREE.Mesh(poleGeometry, POLE);
      if (!frame.isClear(base, NET_EDGE + 1)) continue;
      pole.position.set(base.x, base.y + 4.5, base.z);
      const along = frame.at(u + 1.4, side * (NET_EDGE + 2.5)), cloth = new THREE.Mesh(flagGeometry,
        new THREE.MeshBasicMaterial({ map: flagTexture(nations[n % nations.length]), side: THREE.DoubleSide }));
      cloth.position.set(along.x, base.y + 7.9, along.z);
      cloth.rotation.y = frame.yawAt(u);
      object.add(pole, cloth);
    }
  }
  return object;
}

/** A small white event tent: a box with a pyramid roof and a coloured band. */
export function tent(frame: Frame, u: number, v: number, accent: number): THREE.Group | null {
  const object = new THREE.Group(), base = frame.at(u, v);
  if (!frame.isClear(base, CLEARANCE + 4)) return null;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 5), WHITE);
  walls.position.y = 1.2;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.2, 1.6, 4), matte(accent));
  roof.position.y = 3.2; roof.rotation.y = Math.PI / 4;
  object.add(walls, roof);
  object.position.copy(base);
  object.rotation.y = frame.yawAt(u);
  return object;
}

/** The start hut: a timing cabin with a roof and a sign. */
export function startHut(frame: Frame, u: number, v: number): THREE.Group | null {
  const object = new THREE.Group(), base = frame.at(u, v);
  if (!frame.isClear(base, CLEARANCE + 3)) return null;
  const body = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.8, 4), matte(0x2b3445));
  body.position.y = 1.4;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.3, 4.8), matte(0x151a24));
  roof.position.y = 3;
  const window = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1), new THREE.MeshBasicMaterial({ color: 0xffd38a }));
  window.position.set(0, 1.7, 2.01);
  object.add(body, roof, window);
  object.position.copy(base);
  object.rotation.y = frame.facingPiste(Math.sign(v) || 1, u);
  return object;
}
