// Real 3D tumbling dice for the roll cinematic (three.js). One shared
// renderer; play(container, a, b) tumbles two dice and settles them on the
// rolled faces.

import * as THREE from '../vendor/three.module.js';

let renderer = null;
let scene = null;
let camera = null;
let dice = [];

function pipTexture(v) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f5f2ea';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 122);
  const P = {
    1: [[64, 64]],
    2: [[36, 36], [92, 92]],
    3: [[36, 36], [64, 64], [92, 92]],
    4: [[36, 36], [92, 36], [36, 92], [92, 92]],
    5: [[36, 36], [92, 36], [64, 64], [36, 92], [92, 92]],
    6: [[36, 32], [36, 64], [36, 96], [92, 32], [92, 64], [92, 96]],
  };
  g.fillStyle = '#222';
  for (const [x, y] of P[v]) {
    g.beginPath();
    g.arc(x, y, 11, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Quaternion that puts value v on the +Y (top) face.
// Face material order below: +x=3, -x=4, +y=1, -y=6, +z=2, -z=5.
function topQuat(v) {
  const e = {
    1: [0, 0, 0],
    6: [Math.PI, 0, 0],
    2: [-Math.PI / 2, 0, 0],
    5: [Math.PI / 2, 0, 0],
    3: [0, 0, Math.PI / 2],
    4: [0, 0, -Math.PI / 2],
  }[v];
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...e));
}

function init() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 2.2, 0.1, 50);
  camera.position.set(0, 3.4, 4.4);
  camera.lookAt(0, 0.2, 0);
  // warm, natural tabletop light
  scene.add(new THREE.AmbientLight(0xfff4e0, 0.8));
  const key = new THREE.DirectionalLight(0xffeccb, 1.5);
  key.position.set(-2.5, 5, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd0ff, 0.35);
  fill.position.set(3, 2, -2);
  scene.add(fill);
  const mats = (order) => order.map((v) => new THREE.MeshStandardMaterial({ map: pipTexture(v) }));
  for (const x of [-0.85, 0.85]) {
    const die = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), mats([3, 4, 1, 6, 2, 5]));
    die.position.set(x, 0, 0);
    scene.add(die);
    dice.push(die);
  }
}

// Tumble then settle on (a, b). Resolves when settled (or shouldSkip).
export function play(container, a, b, ms = 900, shouldSkip = null) {
  init();
  const w = container.clientWidth || 240;
  const h = container.clientHeight || 120;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (renderer.domElement.parentElement !== container) {
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
  }
  const targets = [topQuat(a), topQuat(b)];
  const spins = dice.map(() => ({
    v: new THREE.Vector3(
      6 + Math.random() * 7,
      6 + Math.random() * 7,
      6 + Math.random() * 7
    ),
    q: new THREE.Quaternion().random(),
  }));
  dice.forEach((d, i) => d.quaternion.copy(spins[i].q));

  return new Promise((resolve) => {
    const t0 = performance.now();
    function frame(now) {
      const t = shouldSkip?.() ? 1 : Math.min(1, (now - t0) / ms);
      dice.forEach((d, i) => {
        if (t < 0.65) {
          const dt = 1 / 60;
          const dq = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(spins[i].v.x * dt, spins[i].v.y * dt, spins[i].v.z * dt)
          );
          d.quaternion.multiply(dq);
          d.position.y = Math.abs(Math.sin(t * 9 + i)) * 0.55 * (1 - t);
        } else {
          const k = (t - 0.65) / 0.35;
          d.quaternion.slerp(targets[i], Math.min(1, k * 0.35 + 0.12));
          d.position.y *= 0.82;
        }
      });
      renderer.render(scene, camera);
      if (t < 1) requestAnimationFrame(frame);
      else {
        dice.forEach((d, i) => {
          d.quaternion.copy(targets[i]);
          d.position.y = 0;
        });
        renderer.render(scene, camera);
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
