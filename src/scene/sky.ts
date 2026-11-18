import * as THREE from 'three';

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// vertical gradient: horizon colour at the bottom, zenith colour above
const FRAGMENT = /* glsl */ `
uniform vec3 top; uniform vec3 bottom; varying vec3 vDir;
void main() {
  float h = clamp(vDir.y * 1.6 + 0.08, 0.0, 1.0);
  gl_FragColor = vec4(mix(bottom, top, pow(h, 0.7)), 1.0);
}`;

/** Large inside-out sphere with a gradient; the horizon colour matches the fog so terrain fades into it. */
export function makeSky(zenith: THREE.Color, horizon: THREE.Color): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: zenith }, bottom: { value: horizon } },
    vertexShader: VERTEX, fragmentShader: FRAGMENT,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 24, 12), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
