import * as THREE from 'three';
import type { Terrain } from '../core/terrain';

export interface TerrainHandle { mesh: THREE.Mesh; uniforms: { uSnow: THREE.IUniform<number>; uContours: THREE.IUniform<number>; uFogDensity: THREE.IUniform<number> } }

const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying float vElev; varying float vDepth;
void main() {
  vUv = uv; vN = normal; vElev = position.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

// Display-space shading: the aerial photo is treated as raw colour, a winter layer is synthesised from
// altitude, slope and vegetation (dark pixels), with optional 50 m contour lines.
const FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uSun; uniform float uSnow; uniform float uContours;
uniform vec3 uFog; uniform float uFogDensity;
varying vec2 vUv; varying vec3 vN; varying float vElev; varying float vDepth;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 n = normalize(vN);
  vec3 tex = texture2D(uMap, vUv).rgb;
  float luma = dot(tex, vec3(0.299, 0.587, 0.114));
  float slope = acos(clamp(n.y, 0.0, 1.0));
  float lit = max(dot(n, normalize(uSun)), 0.0);
  vec3 summer = tex * (0.42 + 0.85 * lit);
  float nz = 0.55 * vnoise(vUv * 1100.0) + 0.45 * vnoise(vUv * 4200.0);
  float alt = smoothstep(1150.0, 1750.0, vElev);
  float steep = 1.0 - smoothstep(0.80, 1.12, slope);
  float forest = 1.0 - smoothstep(0.16, 0.33, luma);
  float cover = uSnow * clamp(0.30 + alt * 0.8, 0.0, 1.0) * steep;
  cover *= mix(1.0, 0.50 + 0.30 * nz, forest);
  cover = smoothstep(0.30, 0.58, cover + (nz - 0.5) * 0.22);
  vec3 snow = vec3(0.92, 0.95, 1.0) * (0.50 + 0.62 * lit) + vec3(0.02, 0.05, 0.12) * (1.0 - lit);
  snow = mix(snow, snow * vec3(0.93, 0.96, 1.0), nz * 0.5);
  vec3 col = mix(summer, snow, cover);
  float e = vElev / 50.0, w = fwidth(e);
  float line = 1.0 - smoothstep(0.0, w * 1.4, abs(fract(e - 0.5) - 0.5));
  col = mix(col, vec3(1.0, 0.62, 0.22), line * 0.55 * uContours);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(mix(col, uFog, clamp(f, 0.0, 1.0)), 1.0);
}`;

/** Builds the terrain mesh from the elevation grid; `texture` is the aerial photo on the same lat/lon grid. */
export function buildTerrainMesh(terrain: Terrain, texture: THREE.Texture, fog: THREE.Color, fogDensity: number, sun: THREE.Vector3): TerrainHandle {
  const { cols, rows } = terrain;
  const pos = new Float32Array(cols * rows * 3), nor = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
  const dx = terrain.width / (cols - 1), dz = terrain.depth / (rows - 1);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      pos[k * 3] = terrain.xAt(i); pos[k * 3 + 1] = terrain.node(i, j); pos[k * 3 + 2] = terrain.zAt(j);
      const gx = (terrain.node(i + 1, j) - terrain.node(i - 1, j)) / (2 * dx);
      const gz = (terrain.node(i, j + 1) - terrain.node(i, j - 1)) / (2 * dz);
      const l = Math.hypot(gx, 1, gz);
      nor[k * 3] = -gx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -gz / l;
      uv[k * 2] = i / (cols - 1); uv[k * 2 + 1] = 1 - j / (rows - 1);
    }
  }
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let o = 0;
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const uniforms = {
    uMap: { value: texture }, uSun: { value: sun }, uSnow: { value: 0.85 }, uContours: { value: 0 },
    uFog: { value: fog }, uFogDensity: { value: fogDensity },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms }));
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
