// Hero background: a real-time 3D robot. Metallic PBR body, environment
// reflections, a grounded shadow, idle float and head tracking on the pointer.
// This is WebGL, not an SVG: it has depth, shading and reflections.
//
// Degrades quietly: no WebGL or reduced-motion preference means a single static
// frame (or nothing) instead of an animation loop.
import * as THREE from "three";
import { RoomEnvironment } from "./RoomEnvironment.js";
import { RoundedBoxGeometry } from "./RoundedBoxGeometry.js";

const canvas = document.getElementById("robot-canvas");
if (canvas) init(canvas);

function init(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    return; // no WebGL, leave the hero clean
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const host = canvas.parentElement;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0.1, 7.4);

  // Environment map drives the metal reflections that sell the realism.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // Lighting: cool key with shadow, warm rim, soft fill.
  const key = new THREE.DirectionalLight(0xfff1d8, 2.1);
  key.position.set(3.5, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0xd8a657, 1.4);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  scene.add(new THREE.HemisphereLight(0x9fb0c8, 0x14130f, 0.5));

  const robot = buildRobot();
  scene.add(robot);

  // Contact shadow on an otherwise invisible floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.34 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.35;
  floor.receiveShadow = true;
  scene.add(floor);

  // Pointer parallax target.
  const pointer = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  function layout() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    // Phones: center and shrink. Wider screens: push to the right of the copy.
    if (w < 760) {
      robot.position.x = 0;
      robot.scale.setScalar(0.82);
      camera.position.z = 8.6;
    } else {
      robot.position.x = 1.65;
      robot.scale.setScalar(1);
      camera.position.z = 7.4;
    }
    camera.updateProjectionMatrix();
  }
  layout();
  window.addEventListener("resize", layout);

  const clock = new THREE.Clock();
  const head = robot.getObjectByName("head");
  const baseRobotRot = robot.rotation.y;

  function frame(t) {
    const dt = clock.getDelta();
    const time = clock.elapsedTime;

    // idle float and slow sway
    robot.position.y = Math.sin(time * 0.9) * 0.09;
    robot.rotation.y = baseRobotRot + Math.sin(time * 0.4) * 0.06 + pointer.x * 0.22;
    robot.rotation.x = Math.sin(time * 0.6) * 0.015 + pointer.y * 0.05;

    // head leads the look
    if (head) {
      head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, pointer.x * 0.4, 0.06);
      head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, pointer.y * 0.22, 0.06);
    }

    renderer.render(scene, camera);
  }

  if (reduceMotion) {
    renderer.render(scene, camera); // one static frame
    return;
  }

  let running = true;
  let raf;
  function loop(t) {
    if (!running) return;
    frame(t);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  // Stop drawing when the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      clock.getDelta();
      raf = requestAnimationFrame(loop);
    }
  });

  // Stop drawing once the hero scrolls out of view.
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries[0].isIntersecting;
      if (visible && !running && !document.hidden) {
        running = true;
        clock.getDelta();
        raf = requestAnimationFrame(loop);
      } else if (!visible && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    },
    { threshold: 0.02 }
  );
  io.observe(host);
}

function buildRobot() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x474b52, metalness: 0.95, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.85, roughness: 0.55 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0d0e11, metalness: 0.7, roughness: 0.12 });
  const amber = new THREE.MeshStandardMaterial({
    color: 0x1a1305,
    emissive: 0xd8a657,
    emissiveIntensity: 1.7,
    metalness: 0.2,
    roughness: 0.3,
  });

  const g = new THREE.Group();
  g.rotation.y = -0.32;

  const box = (w, h, d, r, mat) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 5, r), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const cyl = (rt, rb, h, mat, seg = 24) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.castShadow = true;
    return m;
  };
  const ball = (r, mat) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 20), mat);
    m.castShadow = true;
    return m;
  };

  // torso
  const torso = box(1.32, 1.5, 0.78, 0.14, steel);
  g.add(torso);

  const collar = box(0.95, 0.22, 0.6, 0.08, dark);
  collar.position.y = 0.82;
  g.add(collar);

  const pelvis = box(1.0, 0.42, 0.62, 0.1, dark);
  pelvis.position.y = -0.98;
  g.add(pelvis);

  // chest core glow
  const core = cyl(0.16, 0.16, 0.12, amber);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, 0.12, 0.4);
  g.add(core);
  const coreLight = new THREE.PointLight(0xd8a657, 2.0, 4, 2);
  coreLight.position.set(0, 0.12, 0.7);
  g.add(coreLight);

  // chest panel lines
  const panel = box(0.5, 0.7, 0.04, 0.04, dark);
  panel.position.set(0, -0.2, 0.4);
  g.add(panel);

  // head
  const head = new THREE.Group();
  head.name = "head";
  head.position.y = 1.42;
  g.add(head);

  const skull = box(0.96, 0.8, 0.8, 0.16, steel);
  head.add(skull);

  const visorMesh = box(0.82, 0.34, 0.12, 0.06, visor);
  visorMesh.position.set(0, 0.03, 0.38);
  head.add(visorMesh);

  for (const x of [-0.2, 0.2]) {
    const eye = cyl(0.07, 0.07, 0.06, amber);
    eye.rotation.x = Math.PI / 2;
    eye.position.set(x, 0.03, 0.45);
    head.add(eye);
  }
  const eyeGlow = new THREE.PointLight(0xd8a657, 1.1, 2.4, 2);
  eyeGlow.position.set(0, 0.03, 0.7);
  head.add(eyeGlow);

  // antenna
  const ant = cyl(0.02, 0.02, 0.34, dark, 12);
  ant.position.set(0.3, 0.55, 0);
  head.add(ant);
  const antTip = ball(0.05, amber);
  antTip.position.set(0.3, 0.74, 0);
  head.add(antTip);

  // ears / side units
  for (const x of [-0.52, 0.52]) {
    const ear = box(0.1, 0.34, 0.34, 0.05, dark);
    ear.position.set(x, 0, 0);
    head.add(ear);
  }

  // arms
  const arm = (side) => {
    const a = new THREE.Group();
    a.position.set(side * 0.92, 0.5, 0);

    const shoulder = ball(0.26, dark);
    a.add(shoulder);

    const upper = box(0.32, 0.82, 0.34, 0.12, steel);
    upper.position.y = -0.52;
    a.add(upper);

    const elbow = ball(0.17, dark);
    elbow.position.y = -0.96;
    a.add(elbow);

    const fore = box(0.3, 0.78, 0.3, 0.11, steel);
    fore.position.y = -1.42;
    a.add(fore);

    const hand = box(0.34, 0.32, 0.36, 0.1, dark);
    hand.position.y = -1.9;
    a.add(hand);

    a.rotation.z = side * 0.08;
    return a;
  };
  g.add(arm(-1));
  g.add(arm(1));

  // hint of thighs below the pelvis
  for (const x of [-0.32, 0.32]) {
    const thigh = box(0.36, 0.5, 0.4, 0.1, steel);
    thigh.position.set(x, -1.4, 0);
    g.add(thigh);
  }

  g.position.y = 0.25;
  return g;
}
