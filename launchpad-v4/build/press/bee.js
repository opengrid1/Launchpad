import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export function renderBee(canvas, { yaw = -0.38, pitch = 0.08, zoom = 6.2, lift = 0 } = {}) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(2); r.setSize(W, H, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.85; r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const cam = new THREE.PerspectiveCamera(28, W / H, 0.1, 100); cam.position.set(0, 0.15 + lift, zoom); cam.lookAt(0, 0.12 + lift, 0);
  const bee = new THREE.Group(); scene.add(bee);
  // body: soft fuzzy stripes
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 1024; const g = cv.getContext('2d');
  g.fillStyle = '#ffb000'; g.fillRect(0, 0, 64, 1024);
  for (const [a, b] of [[500, 590], [665, 755], [830, 920]]) { const gr = g.createLinearGradient(0, a - 8, 0, b + 8); gr.addColorStop(0, '#ffb000'); gr.addColorStop(0.06, '#120a02'); gr.addColorStop(0.94, '#120a02'); gr.addColorStop(1, '#ffb000'); g.fillStyle = gr; g.fillRect(0, a - 8, 64, b - a + 16); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffd27a'), envMapIntensity: 0.55 }));
  body.scale.set(1, 1.1, 0.96); bee.add(body);
  const black = new THREE.MeshPhysicalMaterial({ color: '#0e0904', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
  const onBody = (x, y) => { const z = Math.sqrt(Math.max(0, 1 - x * x - (y / 1.1) ** 2)) * 0.96; return new THREE.Vector3(x, y, z); };
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.135, 64, 64), black); const p = onBody(0.29 * s, 0.34); e.position.copy(p); e.scale.set(1, 1.18, 0.55); e.lookAt(p.clone().multiplyScalar(2)); bee.add(e);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.038, 32, 32), new THREE.MeshBasicMaterial({ color: '#ffffff' })); hl.position.copy(p).add(new THREE.Vector3(-0.04, 0.06, 0.07)); bee.add(hl);
    const ch = new THREE.Mesh(new THREE.SphereGeometry(0.1, 48, 48), new THREE.MeshStandardMaterial({ color: '#ff7f6e', roughness: 0.6, transparent: true, opacity: 0.55 })); const q = onBody(0.5 * s, 0.13); ch.position.copy(q); ch.scale.set(1.25, 0.8, 0.25); ch.lookAt(q.clone().multiplyScalar(2)); bee.add(ch);
    const pts = [new THREE.Vector3(0.2 * s, 0.98, 0.25), new THREE.Vector3(0.3 * s, 1.32, 0.32), new THREE.Vector3(0.52 * s, 1.55, 0.3)];
    bee.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.032, 16), black));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 48, 48), black); tip.position.copy(pts[2]); bee.add(tip);
    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#fff3d6', emissiveIntensity: 0.22, roughness: 0.05, metalness: 0, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.5, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 }));
    wing.scale.set(0.42, 0.68, 0.035); wing.position.set(0.78 * s, 0.78, -0.35); wing.rotation.set(-0.35, 0.35 * s, -0.75 * s); bee.add(wing);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 24, 64, Math.PI), black); const sp = onBody(0, 0.2); smile.position.copy(sp).add(new THREE.Vector3(0, 0.02, 0.005)); smile.rotation.set(-0.2, 0, Math.PI); bee.add(smile);
  const sting = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 48), black); sting.position.set(0, -1.15, -0.05); sting.rotation.x = Math.PI; bee.add(sting);
  bee.rotation.set(pitch, yaw, 0.06);
  const key = new THREE.DirectionalLight('#fff0d0', 1.7); key.position.set(-3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight('#ffb02e', 3.2); rim.position.set(4, 2, -4); scene.add(rim);
  const fill = new THREE.DirectionalLight('#ffd9a0', 0.35); fill.position.set(-4, -2, 2); scene.add(fill);
  r.render(scene, cam); return true;
}
