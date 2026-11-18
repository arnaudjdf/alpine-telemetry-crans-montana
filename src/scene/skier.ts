import * as THREE from 'three';

/** Thin ring with a tiny centre dot: a discreet position marker instead of a filled blob. */
export function makeRingTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  g.strokeStyle = '#fff'; g.lineWidth = 3;
  g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 3, 0, Math.PI * 2); g.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft radial falloff for snow dust: no hard edge, so particles blend into a cloud instead of showing as dots. */
export function makeSoftTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient; g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A capsule between two points (local coordinates), the building block of the body. */
function limb(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const direction = to.clone().sub(from), length = Math.max(0.001, direction.length() - 2 * radius);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 3, 8), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

const v = (y: number, z: number, x = 0) => new THREE.Vector3(x, y, z);     // (height, forward, sideways) for readability

/**
 * A downhill racer in the aerodynamic tuck, facing +Z with the origin on the snow: boots on skis, shins and thighs
 * folded, back almost flat, forearms forward under the chin, poles tucked along the body. About 1.0 m tall in this pose.
 * A small ring marker floats above so the athlete stays findable from far away.
 */
export function makeSkier(color: THREE.Color, ring: THREE.Texture): { group: THREE.Group; marker: THREE.Sprite } {
  const suit = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.55, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.6 });
  const helmet = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.35 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.15, metalness: 0.6 });
  const pole = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.4, metalness: 0.6 });
  const group = new THREE.Group();

  for (const side of [-1, 1]) {
    const x = side * 0.16;
    // ski with a coloured top stripe, and a boot on it
    const ski = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.025, 1.75), dark);
    ski.position.set(x, 0.02, 0.25);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 1.2), accent);
    stripe.position.set(x, 0.036, 0.3);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.2, 0.3), dark);
    boot.position.set(x, 0.14, 0.02);
    // leg: boot -> knee (far forward in the tuck) -> hip
    const shin = limb(v(0.22, 0.0, x), v(0.46, 0.3, x), 0.065, suit);
    const thigh = limb(v(0.46, 0.3, x), v(0.62, -0.2, x), 0.085, suit);
    // arm: shoulder -> elbow tucked at the ribs -> hand forward under the chin; pole runs back along the body
    const shoulder = v(0.78, 0.2, side * 0.17), elbow = v(0.62, 0.22, side * 0.2), hand = v(0.72, 0.62, side * 0.08);
    const upperArm = limb(shoulder, elbow, 0.05, suit);
    const forearm = limb(elbow, hand, 0.045, suit);
    const rod = limb(hand, v(0.55, -0.85, side * 0.14), 0.011, pole);
    group.add(ski, stripe, boot, shin, thigh, upperArm, forearm, rod);
  }

  const torso = limb(v(0.64, -0.22), v(0.8, 0.3), 0.15, suit);               // back almost flat
  const backProtector = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.38), dark);
  backProtector.position.set(0, 0.86, 0.02);
  backProtector.rotation.x = 0.28;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), helmet);
  head.position.set(0, 0.88, 0.45);
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.07), visor);
  goggles.position.set(0, 0.875, 0.55);
  group.add(torso, backProtector, head, goggles);

  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring, color, depthTest: false, transparent: true, opacity: 0.9, sizeAttenuation: false }));
  marker.scale.setScalar(0.016);
  marker.position.y = 2.2;
  marker.renderOrder = 10;
  group.add(marker);
  return { group, marker };
}
