// Cinematic 3D shot resolution (three.js): ball arcs toward the chosen goal
// cell, the keeper meeple dives to their chosen cell, and the ending matches
// the engine's verdict exactly — caught, off the post, wide, or into the
// correct part of the net.

import * as THREE from '../vendor/three.module.js';
import { TEAM_META } from './data.js';

let renderer = null;
let overlayEl = null;
let skip = false;

// Goal geometry: 3 wide x 2 high aim grid.
const GOAL_W = 4.4;
const GOAL_H = 2.1;
const CELL_X = [-GOAL_W / 3, 0, GOAL_W / 3];
const CELL_Y = [GOAL_H * 0.28, GOAL_H * 0.78]; // low, high

function cellPoint(cell) {
  return new THREE.Vector3(CELL_X[cell.col], CELL_Y[cell.high ? 1 : 0], 0);
}

function buildScene(shooterTeam) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a140c, 12, 30);
  scene.background = new THREE.Color(0x0a140c);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(4, 8, 6);
  scene.add(key);

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x2e7d3a })
  );
  grass.rotation.x = -Math.PI / 2;
  scene.add(grass);

  // stripes
  for (let i = -6; i <= 6; i++) {
    const s = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x2a7335 })
    );
    s.rotation.x = -Math.PI / 2;
    s.position.set(0, 0.005, i * 3.2);
    scene.add(s);
  }

  // goal frame
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const r = 0.07;
  const mk = (geo, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(geo, postMat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    scene.add(m);
    return m;
  };
  const posts = [
    mk(new THREE.CylinderGeometry(r, r, GOAL_H + r, 12), -GOAL_W / 2, GOAL_H / 2, 0),
    mk(new THREE.CylinderGeometry(r, r, GOAL_H + r, 12), GOAL_W / 2, GOAL_H / 2, 0),
    mk(new THREE.CylinderGeometry(r, r, GOAL_W + r * 2, 12), 0, GOAL_H, 0, Math.PI / 2),
  ];

  // net (simple translucent grid texture)
  const nc = document.createElement('canvas');
  nc.width = nc.height = 128;
  const g = nc.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i <= 128; i += 10) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  const netTex = new THREE.CanvasTexture(nc);
  const netMat = new THREE.MeshBasicMaterial({
    map: netTex, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, GOAL_H), netMat);
  back.position.set(0, GOAL_H / 2, -0.9);
  scene.add(back);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_W, 0.95), netMat);
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, GOAL_H, -0.45);
  scene.add(top);

  // keeper meeple: body capsule + head, colored by defending team
  const defTeam = shooterTeam === 'home' ? 'away' : 'home';
  const color = new THREE.Color(TEAM_META[defTeam].color);
  const keeper = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.72, 6, 14),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.66;
  keeper.add(body);
  const arms = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.11, 1.05, 4, 10),
    new THREE.MeshStandardMaterial({ color })
  );
  arms.rotation.z = Math.PI / 2;
  arms.position.y = 0.95;
  keeper.add(arms);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xeebd93 })
  );
  head.position.y = 1.42;
  keeper.add(head);
  scene.add(keeper);

  // ball
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.062, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x222222 })
  );
  dot.position.set(0.12, 0.08, 0.06);
  ball.add(dot);
  scene.add(ball);

  return { scene, keeper, ball, posts };
}

const bez = (a, b, c, t, out) => {
  const u = 1 - t;
  out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z
  );
};

// outcome: 'goal' | 'save' | 'rebound' | 'wide'. dive may be null (stranded).
export function playGoalScene({ aim, dive, outcome, shooterTeam }, speed = 1) {
  if (!overlayEl) {
    overlayEl = document.getElementById('cutscene');
    overlayEl.addEventListener('click', () => (skip = true));
  }
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    overlayEl.appendChild(renderer.domElement);
  }
  skip = false;
  overlayEl.classList.add('visible');
  const w = overlayEl.clientWidth;
  const h = overlayEl.clientHeight;
  renderer.setSize(w, h, false);
  const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 60);
  camera.position.set(0.6, 1.7, 8.6);
  camera.lookAt(0, GOAL_H * 0.5, 0);

  const { scene, keeper, ball } = buildScene(shooterTeam);

  // targets
  const aimPt = cellPoint(aim);
  let endPt = aimPt.clone();
  if (outcome === 'wide') {
    // shove past the frame on the aim side
    endPt.x += aim.col === 0 ? -1.3 : aim.col === 2 ? 1.3 : 0;
    if (aim.col === 1) endPt.y = GOAL_H + 1.1;
    endPt.z = -1.6;
  } else if (outcome === 'rebound') {
    // clip the nearest bit of frame
    endPt = new THREE.Vector3(
      aim.col === 1 ? aimPt.x : Math.sign(aimPt.x) * (GOAL_W / 2),
      aim.col === 1 ? GOAL_H : aimPt.y,
      0
    );
  } else if (outcome === 'goal') {
    endPt.z = -0.75; // into the net
  }

  // keeper start/dive
  const stranded = !dive;
  keeper.position.set(stranded ? 5.2 : 0, 0, stranded ? 3.4 : 0.32);
  const divePt = dive ? cellPoint(dive) : null;
  if (outcome === 'save' && divePt) endPt = new THREE.Vector3(divePt.x, Math.max(0.4, divePt.y), 0.34);

  const start = new THREE.Vector3(-0.6 + Math.random() * 1.2, 0.16, 7.2);
  const apex = new THREE.Vector3(
    (start.x + endPt.x) / 2,
    Math.max(endPt.y + (aim.high ? 1.0 : 0.35), 1.1),
    (start.z + endPt.z) / 2
  );
  ball.position.copy(start);

  const FLIGHT = 1050 / speed;
  const TAIL = 900 / speed;

  return new Promise((resolve) => {
    const t0 = performance.now();
    let bounced = false;
    const vel = new THREE.Vector3();
    function frame(now) {
      if (skip) {
        overlayEl.classList.remove('visible');
        return resolve();
      }
      const el = now - t0;
      const t = Math.min(1, el / FLIGHT);
      if (t < 1) {
        bez(start, apex, endPt, t, ball.position);
        ball.rotation.x -= 0.25;
      } else if (outcome === 'rebound') {
        if (!bounced) {
          bounced = true;
          vel.set((Math.random() - 0.5) * 2, 2.2, 5.2);
        }
        vel.y -= 0.16;
        ball.position.addScaledVector(vel, 1 / 60);
        if (ball.position.y < 0.16) {
          ball.position.y = 0.16;
          vel.y = Math.abs(vel.y) * 0.5;
        }
      } else if (outcome === 'goal') {
        ball.position.y = Math.max(0.16, ball.position.y - 0.03);
      }
      // keeper dive
      if (!stranded && divePt) {
        const kt = Math.min(1, Math.max(0, (el - FLIGHT * 0.3) / (FLIGHT * 0.62)));
        const ease = kt * kt * (3 - 2 * kt);
        keeper.position.x = divePt.x * ease;
        keeper.position.y = Math.max(0, (divePt.y - 0.9) * ease);
        keeper.rotation.z = -Math.sign(divePt.x || 0.001) * ease * (Math.abs(divePt.x) > 0.5 ? 1.05 : 0.25);
        if (outcome === 'save' && t >= 1) {
          // caught: ball rides with the keeper's chest
          ball.position.set(
            keeper.position.x,
            Math.max(0.45, divePt.y),
            keeper.position.z + 0.05
          );
        }
      }
      // gentle camera push
      camera.position.z = 8.6 - Math.min(1, el / (FLIGHT + TAIL)) * 1.1;
      camera.lookAt(0, GOAL_H * 0.45, 0);
      renderer.render(scene, camera);
      if (el < FLIGHT + TAIL) requestAnimationFrame(frame);
      else {
        overlayEl.classList.remove('visible');
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
