/* ============================================================
   MECH-BIO LAB — AR-08 MECHANICAL SPIDER
   A single-authority procedural engineering simulator.
   ============================================================ */
(() => {
'use strict';

const T = window.THREE;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

if (!T) {
  $('#errorScreen')?.classList.add('show');
  return;
}

/* -------- environment capabilities -------- */
const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const LOW_POWER = MOBILE || navigator.hardwareConcurrency <= 4;
const PIXEL_CAP = MOBILE ? 1.35 : 2;
let renderer;
try {
  renderer = new T.WebGLRenderer({
    canvas: $('#viewport'),
    antialias: LOW_POWER,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false
  });
} catch (err) {
  $('#errorText').textContent = 'WebGL context creation failed. ' + (err?.message || '');
  $('#errorScreen').classList.add('show');
  $('#loading')?.classList.add('hide');
  return;
}
const gl = renderer.getContext();
const IS_WEBGL2 = renderer.capabilities.isWebGL2;
const MAX_SAMPLES = IS_WEBGL2 ? Math.min(8, gl.getParameter(gl.MAX_SAMPLES) || 1) : 1;
const rendererInfo = renderer.info;

renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_CAP));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = .9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.setClearColor(0xf2f0ea, 1);

const scene = new T.Scene();
scene.background = new T.Color(0xf2f0ea);
scene.fog = new T.Fog(0xf2f0ea, 18, 54);
const perspectiveCamera = new T.PerspectiveCamera(35, innerWidth / innerHeight, 0.08, 90);
perspectiveCamera.layers.enableAll();
let orthoCamera = makeOrthoCamera(1);
let activeCamera = perspectiveCamera;

const clock = new T.Clock();
const raycaster = new T.Raycaster();
const pointerNDC = new T.Vector2(-10, -10);
const Y_AXIS = new T.Vector3(0, 1, 0);
const tmpV1 = new T.Vector3(), tmpV2 = new T.Vector3(), tmpV3 = new T.Vector3();
const tmpQ = new T.Quaternion(), tmpM = new T.Matrix4();

const COUNTS = { meshes: 0, instances: 0, bolts: 0, vents: 0, gearTeeth: 0 };

/* -------- authoritative simulation state -------- */
const SIM = {
  tab: 'overview',
  mode: 'walk',
  playing: true,
  speed: 1,
  time: 4.32,
  duration: 12,
  autoRotate: true,
  callouts: true,
  explodeCallouts: true,
  explodedAmt: 0,
  selected: 'leg_L1',
  hovered: null,
  manual: false,
  manualLeg: 'L1',
  manualYaw: 0,
  manualReach: 1,
  manualLift: 0,
  transparency: false,
  internalScan: false,
  wireframe: false,
  bpWireframe: false,
  ao: !LOW_POWER,
  jointAxes: false,
  dimensions: true,
  scrubbing: false,
  cut: 'off',
  cutPos: 0,
  blueprintView: 'iso',
  projection: 'ortho',
  gaitFreq: 1,
  gaitStride: 1,
  gaitLift: 1,
  gaitGovernor: true,
  gaitPhase: .02,
  followBody: true,
  distance: 0,
  power: 92.4,
  coreTemp: 46.8,
  hydraulic: 72,
  motorLoad: 38,
  history: [],
  lastChart: 0,
  pausedFromTab: false,
  introSeen: false
};

const MODE_DEFS = {
  walk: {
    id: 'walk', label: 'Walk (Forward)', short: 'WALK', icon: 'walk',
    speed: 0.46, freq: 1.15, stride: 0.62, lift: 0.30, bodyY: 0, pitch: 0,
    swing: 0.23, footY: 0, spread: 1, load: 40, hint: 'Alternating tetrapod / 4-point contact'
  },
  sideways: {
    id: 'sideways', label: 'Strafe (Lateral)', short: 'STRAFE', icon: 'walk',
    speed: 0.34, freq: 1.03, stride: 0.54, lift: 0.24, bodyY: -0.015, pitch: 0,
    swing: 0.24, footY: 0, spread: 1, load: 36, hint: 'Lateral gait / body remains forward-facing'
  },
  crawl: {
    id: 'crawl', label: 'Crawl (Stealth)', short: 'CRAWL', icon: 'crawl',
    speed: 0.18, freq: 0.70, stride: 0.42, lift: 0.105, bodyY: -0.105, pitch: 0.015,
    swing: 0.34, footY: 0, spread: 1.10, load: 22, hint: 'Low profile / reduced acoustic signature'
  },
  climb: {
    id: 'climb', label: 'Climb (Vertical)', short: 'CLIMB', icon: 'climb',
    speed: 0, freq: 0.55, stride: 0.35, lift: 0.18, bodyY: 0.16, pitch: -0.23,
    swing: 0.34, footY: 0, spread: 1.03, frontRaise: 1.18, load: 61, pose: true,
    hint: 'Elevated front carriage / wall-contact posture'
  },
  dash: {
    id: 'dash', label: 'Dash (High Speed)', short: 'DASH', icon: 'dash',
    speed: 1.05, freq: 1.90, stride: 0.82, lift: 0.42, bodyY: 0.035, pitch: -0.035,
    swing: 0.17, footY: 0, spread: 0.94, load: 88, hint: 'Maximum stride / high actuator load'
  },
  defense: {
    id: 'defense', label: 'Defense (Threat)', short: 'DEFEND', icon: 'climb',
    speed: 0, freq: 0.62, stride: 0.3, lift: 0.16, bodyY: 0.1, pitch: -0.30,
    swing: 0.3, footY: 0, spread: 1.08, frontRaise: 1.82, fangOpen: 1, load: 54, pose: true,
    hint: 'Rear weight bias / front limbs raised'
  },
  idle: {
    id: 'idle', label: 'Idle (Standby)', short: 'IDLE', icon: 'idle',
    speed: 0, freq: 0.6, stride: 0.16, lift: 0.08, bodyY: 0, pitch: 0,
    swing: 0.3, footY: 0, spread: 1, load: 14, pose: true, idle: true,
    hint: 'Stationary hold / low-power sensor sweep'
  }
};

const currentMode = {
  speed: MODE_DEFS.walk.speed, freq: MODE_DEFS.walk.freq, stride: MODE_DEFS.walk.stride,
  lift: MODE_DEFS.walk.lift, bodyY: 0, pitch: 0, spread: 1, frontRaise: 0, fangOpen: 0
};

/* -------- world containers -------- */
const world = new T.Group(); world.name = 'AR-08-WORLD'; scene.add(world);
const bodyGroup = new T.Group(); bodyGroup.name = 'BODY';
const legRoot = new T.Group(); legRoot.name = 'LEG-BUS';
const internalsGroup = new T.Group(); internalsGroup.name = 'INTERNALS';
const detailGroup = new T.Group(); detailGroup.name = 'MICRO-DETAILS';
bodyGroup.add(internalsGroup, detailGroup, legRoot);
world.add(bodyGroup);

const FLOOR_Y = 0;
const BODY_BASE_Y = 0.70;
bodyGroup.position.set(0, BODY_BASE_Y, 0);

/* -------- boot scheduling -------- */
const bootTasks = [
  ['MAPPING STUDIO ENVIRONMENT', 12],
  ['CASTING CERAMIC ARMOR', 24],
  ['ASSEMBLING CEPHALOTHORAX', 38],
  ['ROUTING EIGHT LEG ACTUATORS', 56],
  ['BALANCING TETRAPOD GAIT', 70],
  ['INSTANCING FASTENER CLOUDS', 82],
  ['CALIBRATING OPTICAL ARRAY', 92],
  ['READY', 100]
];

function setBoot(progress, message) {
  const bar = $('#bootBar'); if (bar) bar.style.width = progress + '%';
  const log = $('#loadLog'); if (log && message) log.textContent = message;
}

function makeOrthoCamera(size) {
  const aspect = innerWidth / innerHeight;
  const h = size * 0.5, w = h * aspect;
  const cam = new T.OrthographicCamera(-w, w, h, -h, 0.08, 90);
  cam.layers.enableAll();
  return cam;
}

/* iterative critically damped spring */
function springValue(current, velocity, target, omega, dt) {
  const f = 1.0 + 2.0 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1.0 / (f + hhoo);
  const newVel = (velocity + hoo * (target - current)) * detInv;
  const newPos = (f * current + dt * velocity + hhoo * target) * detInv;
  return [newPos, newVel];
}

function roundRectShape(w, h, r, path = new T.Shape()) {
  const rr = Math.min(r, Math.abs(w) * .5, Math.abs(h) * .5);
  path.moveTo(-w / 2 + rr, -h / 2);
  path.lineTo(w / 2 - rr, -h / 2);
  path.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rr);
  path.lineTo(w / 2, h / 2 - rr);
  path.quadraticCurveTo(w / 2, h / 2, w / 2 - rr, h / 2);
  path.lineTo(-w / 2 + rr, h / 2);
  path.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rr);
  path.lineTo(-w / 2, -h / 2 + rr);
  path.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rr, -h / 2);
  return path;
}

function chamferBoxGeometry(w, h, d, radius = 0.025, bevel = 0.012) {
  const shape = roundRectShape(w, d, Math.min(radius, w * .45, d * .45));
  const geo = new T.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, h - bevel * 2), steps: 1, curveSegments: 3,
    bevelEnabled: bevel > 0, bevelSegments: 2, bevelSize: bevel, bevelThickness: bevel
  });
  geo.center();
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/* rounded organic CAD hull, superellipse sections */
function hullGeometry({
  length = 1, width = 0.8, height = 0.5, segZ = 20, segR = 24,
  topPower = 0.9, sidePower = 0.72, profilePower = 0.34, biasY = 0,
  nose = 1, tail = 1, angular = 0
}) {
  const positions = [], indices = [], uvs = [];
  for (let iz = 0; iz <= segZ; iz++) {
    const t = iz / segZ;
    const z = (t - .5) * length;
    const profile = Math.pow(Math.sin(Math.PI * t), profilePower);
    const asymmetric = t < .5 ? lerp(nose, 1, t * 2) : lerp(1, tail, (t - .5) * 2);
    const w = width * .5 * profile * asymmetric;
    const h = height * .5 * profile;
    const yBias = biasY * profile;
    for (let ir = 0; ir < segR; ir++) {
      const a = ir / segR * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const sx = Math.sign(ca) * Math.pow(Math.abs(ca), sidePower);
      const sy = Math.sign(sa) * Math.pow(Math.abs(sa), topPower);
      let x = w * sx;
      let y = h * sy + yBias;
      if (angular) {
        const facet = Math.round(a / TAU * segR);
        x += Math.sin(a * 2) * angular * profile * h;
      }
      positions.push(x, y, z);
      uvs.push(ir / segR, 1 - t);
    }
  }
  for (let iz = 0; iz < segZ; iz++) {
    for (let ir = 0; ir < segR; ir++) {
      const a = iz * segR + ir;
      const b = (iz + 1) * segR + ir;
      const c = (iz + 1) * segR + (ir + 1) % segR;
      const d = iz * segR + (ir + 1) % segR;
      indices.push(a, c, b, a, d, c);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function taperedBeamGeometry(length, w0, h0, w1 = w0 * .7, h1 = h0 * .7, segZ = 7) {
  const positions = [], indices = [];
  const ring = 12;
  for (let iz = 0; iz <= segZ; iz++) {
    const t = iz / segZ;
    const z = t * length;
    const w = lerp(w0, w1, t) * .5;
    const h = lerp(h0, h1, t) * .5;
    const crown = Math.sin(t * Math.PI) * .022;
    for (let ir = 0; ir < ring; ir++) {
      const a = ir / ring * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = w * Math.sign(ca) * Math.pow(Math.abs(ca), .66);
      const y = h * Math.sign(sa) * Math.pow(Math.abs(sa), .8) + crown;
      positions.push(x, y, z);
    }
  }
  for (let iz = 0; iz < segZ; iz++) {
    for (let ir = 0; ir < ring; ir++) {
      const a = iz * ring + ir;
      const b = (iz + 1) * ring + ir;
      const c = (iz + 1) * ring + (ir + 1) % ring;
      const d = iz * ring + (ir + 1) % ring;
      indices.push(a, c, b, a, d, c);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function gearGeometry(radius = .15, teeth = 18, thickness = .035, hole = .055) {
  const shape = new T.Shape();
  const step = TAU / teeth;
  const root = radius * .84, tip = radius;
  for (let i = 0; i < teeth * 4; i++) {
    const phase = i % 4;
    const r = (phase === 1 || phase === 2) ? tip : root;
    const a = i / (teeth * 4) * TAU;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const holePath = new T.Path();
  holePath.absarc(0, 0, hole, 0, TAU, true);
  shape.holes.push(holePath);
  const geo = new T.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelSize: .004, bevelThickness: .004,
    bevelSegments: 1, curveSegments: 2, steps: 1
  });
  geo.center();
  COUNTS.gearTeeth += teeth;
  return geo;
}

/* -------- procedural textures -------- */
const texCache = {};
function labelTexture(kind = 'ar08') {
  if (texCache[kind]) return texCache[kind];
  const c = document.createElement('canvas');
  c.width = 640; c.height = 320;
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  x.textBaseline = 'middle';
  if (kind === 'ar08') {
    x.fillStyle = '#1b1b1a';
    x.font = '800 148px Bahnschrift, Arial Narrow, sans-serif';
    x.letterSpacing = '2px';
    x.fillText('AR-08', 28, 142);
    x.fillStyle = '#ff6a00';
    x.fillRect(30, 220, 300, 9);
    x.fillStyle = '#55524a';
    x.font = '600 22px Consolas, monospace';
    x.fillText('AUTONOMOUS RECON UNIT / MK.08', 30, 253);
    x.font = '400 18px Consolas, monospace';
    x.fillText('SER. 0447-C  •  MECH-BIO LAB', 30, 284);
  } else if (kind === 'warning') {
    x.fillStyle = '#ff6a00';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#1a1a19';
    x.save(); x.translate(0, 0); x.rotate(-.2);
    for (let i = -c.width; i < c.width * 1.4; i += 70) x.fillRect(i, -100, 30, 600);
    x.restore();
    x.fillStyle = 'rgba(255,255,255,.94)';
    x.fillRect(148, 104, 344, 112);
    x.fillStyle = '#151514';
    x.font = '800 42px Bahnschrift, Arial Narrow, sans-serif';
    x.textAlign = 'center';
    x.fillText('CAUTION', 320, 141);
    x.font = '600 21px Consolas, monospace';
    x.fillText('HIGH PRESSURE / 210 BAR', 320, 181);
  } else if (kind === 'serial') {
    x.fillStyle = 'rgba(255,255,255,.02)'; x.fillRect(0, 0, 640, 320);
    x.fillStyle = '#282825';
    x.font = '600 21px Consolas, monospace';
    x.fillText('ASSEMBLY 04 / REV C', 36, 60);
    x.fillStyle = '#5e5a50';
    x.font = '400 17px Consolas, monospace';
    x.fillText('TENSILE  •  TI-6AL-4V', 36, 96);
    x.fillText('CERAMIC  •  AL2O3 / 4.2MM', 36, 124);
    for (let i = 0; i < 42; i++) {
      const bw = i % 3 === 0 ? 8 : 4;
      x.fillStyle = i % 5 === 0 ? '#ff6a00' : '#1b1b19';
      x.fillRect(36 + i * 10, 194, bw, 62);
    }
    x.fillStyle = '#777166'; x.font = '400 16px Consolas, monospace';
    x.fillText('MB-08-0447-C', 36, 284);
  } else if (kind === 'logo') {
    x.translate(320, 160);
    x.strokeStyle = '#1b1b19'; x.lineWidth = 8;
    x.beginPath(); x.arc(0, 0, 112, 0, TAU); x.stroke();
    x.fillStyle = '#ff6a00'; x.beginPath(); x.arc(0, 0, 78, 0, TAU); x.fill();
    x.fillStyle = '#111'; x.font = '800 82px Bahnschrift, Arial Narrow, sans-serif';
    x.textAlign = 'center'; x.fillText('08', 0, 2);
    x.fillStyle = '#1b1b19'; x.font = '700 18px Consolas, monospace';
    x.fillText('MECH-BIO', 0, 146);
  } else if (kind === 'leg') {
    x.fillStyle = '#252521';
    x.font = '800 112px Bahnschrift, Arial Narrow, sans-serif';
    x.fillText('08', 26, 122);
    x.fillStyle = '#ff6a00'; x.fillRect(30, 238, 170, 7);
    x.fillStyle = '#6a655a'; x.font = '600 17px Consolas, monospace';
    x.fillText('LEG ACTUATOR / TI', 30, 269);
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  texCache[kind] = tex;
  return tex;
}

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', warm = false) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  if (warm) {
    g.addColorStop(0, 'rgba(255,255,235,1)');
    g.addColorStop(.12, 'rgba(255,180,80,.85)');
    g.addColorStop(.42, 'rgba(255,106,0,.24)');
    g.addColorStop(1, 'rgba(255,106,0,0)');
  } else {
    g.addColorStop(0, inner); g.addColorStop(.35, 'rgba(20,20,20,.35)'); g.addColorStop(1, outer);
  }
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

function gridTexture() {
  if (texCache.grid) return texCache.grid;
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#f2f0eb'; x.fillRect(0, 0, 1024, 1024);
  // paper grain
  for (let i = 0; i < 7000; i++) {
    x.fillStyle = `rgba(75,69,56,${Math.random() * .015})`;
    x.fillRect(Math.random() * 1024, Math.random() * 1024, 1, 1);
  }
  x.strokeStyle = 'rgba(67,63,53,.055)'; x.lineWidth = 1;
  for (let i = 0; i <= 1024; i += 32) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke();
  }
  x.strokeStyle = 'rgba(67,63,53,.10)'; x.lineWidth = 1.5;
  for (let i = 0; i <= 1024; i += 256) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke();
  }
  x.strokeStyle = 'rgba(255,106,0,.07)'; x.lineWidth = 2;
  x.strokeRect(256, 256, 512, 512);
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(26, 26);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texCache.grid = tex;
  return tex;
}

/* -------- material library -------- */
let MATS = {};
const armorMaterials = [];
const renderMaterials = [];
function defineMaterials() {
  const P = (o) => new T.MeshPhysicalMaterial(o);
  const S = (o) => new T.MeshStandardMaterial(o);
  MATS = {
    ceramic: P({ color: 0xdad4c7, roughness: .38, metalness: .03, clearcoat: .52, clearcoatRoughness: .26, envMapIntensity: .72 }),
    ceramicWarm: P({ color: 0xe5dfd2, roughness: .43, metalness: .02, clearcoat: .4, clearcoatRoughness: .3, envMapIntensity: .66 }),
    ceramicShade: P({ color: 0xbab4a6, roughness: .47, metalness: .04, clearcoat: .22, envMapIntensity: .56 }),
    orange: P({ color: 0xe95400, roughness: .35, metalness: .3, clearcoat: .58, clearcoatRoughness: .24, envMapIntensity: .9 }),
    orangeMatte: P({ color: 0xe95c00, roughness: .52, metalness: .08, clearcoat: .25, envMapIntensity: .8 }),
    orangeDark: S({ color: 0x9f3600, roughness: .5, metalness: .25 }),
    titanium: S({ color: 0x17191c, roughness: .28, metalness: .9, envMapIntensity: 1.25 }),
    titaniumSoft: S({ color: 0x25282b, roughness: .40, metalness: .78, envMapIntensity: 1.0 }),
    blackHull: S({ color: 0x17191a, roughness: .47, metalness: .55, envMapIntensity: .9 }),
    carbon: P({ color: 0x202326, roughness: .52, metalness: .4, clearcoat: .25, clearcoatRoughness: .38 }),
    steel: S({ color: 0xb7bdc0, roughness: .22, metalness: 1.0, envMapIntensity: 1.25 }),
    polished: S({ color: 0xdfe3e5, roughness: .10, metalness: 1.0, envMapIntensity: 1.4 }),
    darkSteel: S({ color: 0x60676d, roughness: .32, metalness: .92 }),
    brass: S({ color: 0x9d7645, roughness: .28, metalness: 1.0, envMapIntensity: 1.0 }),
    rubber: S({ color: 0x111213, roughness: .88, metalness: .02 }),
    rubberSoft: S({ color: 0x242526, roughness: .94, metalness: .0 }),
    lens: P({ color: 0x1a0c02, roughness: .12, metalness: .15, clearcoat: 1, emissive: 0xff4d00, emissiveIntensity: 2.6 }),
    lensAmber: P({ color: 0x180d00, roughness: .2, metalness: .1, clearcoat: 1, emissive: 0xffa042, emissiveIntensity: 1.7 }),
    lensDim: S({ color: 0x0d0e0f, roughness: .18, metalness: .65, emissive: 0xff5a00, emissiveIntensity: .22 }),
    energy: S({ color: 0x1d0c02, roughness: .32, metalness: .3, emissive: 0xff5a00, emissiveIntensity: 2.1 }),
    energySoft: S({ color: 0x1a1208, roughness: .4, metalness: .2, emissive: 0xff8a26, emissiveIntensity: .8 }),
    internal: S({ color: 0x252120, roughness: .42, metalness: .55 }),
    copper: S({ color: 0xb86a35, roughness: .34, metalness: 1.0 }),
    seal: S({ color: 0x0e0f10, roughness: .92, metalness: .02 }),
    glass: P({ color: 0xb9d4dc, roughness: .05, metalness: 0, transmission: 0, transparent: true, opacity: .22, clearcoat: 1 }),
    blueprintFill: new T.MeshBasicMaterial({ color: 0xf4f7fa, transparent: true, opacity: .78, side: T.DoubleSide }),
    blueprintFillDark: new T.MeshBasicMaterial({ color: 0xcbdbe6, transparent: true, opacity: .55, side: T.DoubleSide }),
    gridInk: new T.LineBasicMaterial({ color: 0x41647d, transparent: true, opacity: .38 }),
    orangeLine: new T.LineBasicMaterial({ color: 0xff6a00, transparent: true, opacity: .85 }),
    blueLine: new T.LineBasicMaterial({ color: 0x41647d, transparent: true, opacity: .65 })
  };
  armorMaterials.push(MATS.ceramic, MATS.ceramicWarm, MATS.ceramicShade, MATS.orange, MATS.orangeMatte);
  Object.values(MATS).forEach(m => { if (m.isMaterial) { m.userData.originalOpacity = m.opacity; renderMaterials.push(m); } });
}

/* -------- environment / light / floor -------- */
function buildStudioEnvironment() {
  const envScene = new T.Scene();
  envScene.background = new T.Color(0x17191c);
  const panel = (w, h, pos, look, intensity, tint = 0xffffff) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(tint).multiplyScalar(intensity), side: T.DoubleSide }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(look[0], look[1], look[2]);
    envScene.add(m);
  };
  panel(12, 7, [0, 8, 1], [0, 0, 0], 3.3);
  panel(7, 9, [-7, 3, 4], [0, 1, 0], 2.4);
  panel(6, 7, [7, 3.5, 2], [0, 1, 0], 1.9);
  panel(9, 4, [0, 2.5, 9], [0, 1.5, 0], 1.35);
  panel(4, 8, [0, 1, -8], [0, 1, 0], 1.0, 0xffd8bd);
  panel(10, 2, [0, 7, -2], [0, 0, 0], 1.5, 0xffe4c9);
  const pmrem = new T.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(envScene, .04, .1, 60);
  scene.environment = rt.texture;
  pmrem.dispose();
  envScene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function buildLights() {
  const hemi = new T.HemisphereLight(0xfffbef, 0x8a8172, 0.45);
  scene.add(hemi);
  const key = new T.DirectionalLight(0xfff4e4, 2.5);
  key.position.set(6.8, 9.5, 6.5);
  key.target.position.set(0, .35, 0);
  key.castShadow = true;
  const sm = LOW_POWER ? 1024 : 2048;
  key.shadow.mapSize.set(sm, sm);
  key.shadow.camera.near = .1;
  key.shadow.camera.far = 28;
  key.shadow.camera.left = -6.5; key.shadow.camera.right = 6.5;
  key.shadow.camera.top = 6.5; key.shadow.camera.bottom = -6.5;
  key.shadow.bias = -.00035;
  key.shadow.normalBias = .025;
  key.shadow.radius = LOW_POWER ? 2 : 5;
  key.shadow.blurSamples = 12;
  scene.add(key, key.target);
  const fill = new T.DirectionalLight(0xcfe2f4, .55);
  fill.position.set(-6.5, 4.5, 2.5);
  scene.add(fill);
  const rim = new T.DirectionalLight(0xff9a58, 1.15);
  rim.position.set(-3.5, 4.5, -8);
  scene.add(rim);
  const front = new T.PointLight(0xffd4aa, .35, 15, 2);
  front.position.set(1.5, 1.7, 5.5);
  scene.add(front);
  return { key, fill, rim, front };
}

let floor, groundRing, contactShadow;
const footShadows = [];
let LIGHTS = null;
function buildFloor() {
  const tex = gridTexture();
  const mat = new T.MeshStandardMaterial({
    color: 0xe7e2d8, map: tex, roughness: .9, metalness: .03,
    envMapIntensity: .2, dithering: true
  });
  floor = new T.Mesh(new T.PlaneGeometry(240, 240), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.003;
  floor.receiveShadow = true;
  floor.name = 'TECHNICAL-FLOOR';
  floor.layers.set(1);
  scene.add(floor);

  groundRing = new T.Group();
  const ringMat = new T.MeshBasicMaterial({ color: 0x59544b, transparent: true, opacity: .16, depthWrite: false });
  const ring1 = new T.Mesh(new T.RingGeometry(2.72, 2.732, 128), ringMat);
  const ring2 = new T.Mesh(new T.RingGeometry(3.42, 3.427, 128), ringMat);
  const arcMat = new T.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: .38, depthWrite: false });
  const arc = new T.Mesh(new T.RingGeometry(3.424, 3.438, 32, 1, -0.15, .92), arcMat);
  ring1.rotation.x = ring2.rotation.x = arc.rotation.x = -Math.PI / 2;
  ring1.position.y = ring2.position.y = arc.position.y = .0045;
  groundRing.add(ring1, ring2, arc);
  for (let i = 0; i < 8; i++) {
    const tick = new T.Mesh(new T.PlaneGeometry(.16, .012), ringMat);
    tick.rotation.x = -Math.PI / 2;
    tick.rotation.z = i / 8 * TAU;
    tick.position.set(Math.cos(i / 8 * TAU) * 3.42, .0048, Math.sin(i / 8 * TAU) * 3.42);
    groundRing.add(tick);
  }
  scene.add(groundRing);

  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 4, 128, 128, 116);
    g.addColorStop(0, 'rgba(26,22,17,.58)');
    g.addColorStop(.5, 'rgba(26,22,17,.26)');
    g.addColorStop(1, 'rgba(26,22,17,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return new T.CanvasTexture(c);
  })();
  contactShadow = new T.Mesh(
    new T.PlaneGeometry(6.4, 5.4),
    new T.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: .7, depthWrite: false, toneMapped: false })
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = .006;
  contactShadow.layers.set(1);
  groundRing.traverse(o => o.layers.set(1));
  scene.add(contactShadow);

  // per-foot contact blobs, faded by foot clearance
  for (let i = 0; i < 8; i++) {
    const fs = new T.Mesh(
      new T.PlaneGeometry(.78, .78),
      new T.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: .0, depthWrite: false, toneMapped: false })
    );
    fs.rotation.x = -Math.PI / 2;
    fs.position.y = .0075;
    fs.renderOrder = 2;
    fs.layers.set(1);
    scene.add(fs);
    footShadows.push(fs);
  }
}

/* -------- shared geometry + assembly helpers -------- */
const GEOS = {};
const pickMeshes = [];
const partObjects = {};
const allBaseMaterials = [];
const animatedGears = [];
const jointAxisGroups = [];
const cadEdgeObjects = [];
const eyeGlows = [];
const internalsSpinners = [];
const pistonSystems = [];
let fangLGroup, fangRGroup, pedipalpL, pedipalpR, abdomenGroup, eyeGroup, spinneretGroup, carapaceGroup;

function addMesh(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], opts = {}) {
  const m = new T.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.castShadow = opts.cast !== false && !opts.detail;
  m.receiveShadow = opts.receive !== false && !opts.detail;
  if (opts.detail) m.layers.set(2);
  if (opts.noPick) m.userData.noPick = true;
  if (opts.name) m.name = opts.name;
  if (opts.renderOrder) m.renderOrder = opts.renderOrder;
  parent.add(m);
  COUNTS.meshes++;
  return m;
}

function addBoltField(parent, bolts, material = MATS.steel, opts = {}) {
  if (!bolts.length) return null;
  const geo = GEOS.bolt;
  const mesh = new T.InstancedMesh(geo, material, bolts.length);
  mesh.instanceMatrix.setUsage(T.StaticDrawUsage);
  const p = new T.Vector3(), q = new T.Quaternion(), e = new T.Euler(), s = new T.Vector3();
  bolts.forEach((b, i) => {
    const bp = Array.isArray(b) ? b : b.p;
    const br = (!Array.isArray(b) && b.r) || [0, 0, 0];
    const bs = (!Array.isArray(b) && b.s) || opts.scale || 1;
    p.set(bp[0], bp[1], bp[2]);
    e.set(br[0], br[1], br[2]); q.setFromEuler(e);
    s.setScalar(bs);
    tmpM.compose(p, q, s);
    mesh.setMatrixAt(i, tmpM);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.layers.set(2);
  mesh.userData.noPick = true;
  parent.add(mesh);
  COUNTS.instances += bolts.length; COUNTS.bolts += bolts.length; COUNTS.meshes++;
  return mesh;
}

function addVent(parent, { pos = [0, 0, 0], rot = [0, 0, 0], width = .32, count = 7, spacing = .036, size = .011, material = MATS.titaniumSoft } = {}) {
  const group = new T.Group();
  group.position.set(pos[0], pos[1], pos[2]);
  group.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(group);
  const back = addMesh(group, GEOS.ventBack, MATS.blackHull, [0, 0, -.002], [0, 0, 0], [width / .3, 1, 1], { detail: true });
  const inst = new T.InstancedMesh(GEOS.ventSlat, material, count);
  const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(width / .3, 1, 1);
  for (let i = 0; i < count; i++) {
    p.set(0, (i - (count - 1) / 2) * spacing, .006);
    tmpM.compose(p, q, s);
    inst.setMatrixAt(i, tmpM);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.layers.set(2); inst.castShadow = false; inst.receiveShadow = false;
  group.add(inst);
  COUNTS.instances += count; COUNTS.vents += count; COUNTS.meshes++;
  return group;
}

function addDecal(parent, kind, w, h, pos, rot = [0, 0, 0], opacity = 1) {
  const tex = labelTexture(kind);
  const mat = new T.MeshBasicMaterial({
    map: tex, transparent: true, opacity, depthWrite: false, alphaTest: .02,
    side: T.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const m = addMesh(parent, new T.PlaneGeometry(w, h), mat, pos, rot, [1, 1, 1], { detail: true, renderOrder: 3 });
  m.layers.set(2);
  return m;
}

function addGlow(parent, pos, scale = .5, opacity = .75, kind = 'warm') {
  const mat = new T.SpriteMaterial({
    map: radialTexture(undefined, undefined, kind === 'warm'),
    color: kind === 'warm' ? 0xffffff : 0x9bcfff,
    transparent: true, opacity, blending: T.AdditiveBlending,
    depthWrite: false, toneMapped: false
  });
  const s = new T.Sprite(mat);
  s.position.set(pos[0], pos[1], pos[2]);
  s.scale.setScalar(scale);
  s.layers.set(2);
  parent.add(s);
  return s;
}

function addGear(parent, radius, teeth, thickness, material, pos, axis = 'x', spin = .55) {
  const pivot = new T.Group();
  pivot.position.set(pos[0], pos[1], pos[2]);
  if (axis === 'x') pivot.rotation.y = Math.PI / 2;
  else if (axis === 'y') pivot.rotation.x = -Math.PI / 2;
  else if (axis === 'z') pivot.rotation.y = 0;
  parent.add(pivot);
  const geo = gearGeometry(radius, teeth, thickness, radius * .35);
  const gear = addMesh(pivot, geo, material, [0, 0, 0], [0, 0, 0], [1, 1, 1], { detail: true, noPick: true, cast: false });
  gear.rotation.z = Math.random() * TAU;
  animatedGears.push({ mesh: gear, spin });
  return gear;
}

function addAxle(parent, radius, length, pos, axis = 'x', material = MATS.darkSteel) {
  const geo = new T.CylinderGeometry(radius, radius, length, 12);
  const rotation = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  return addMesh(parent, geo, material, pos, rotation, [1, 1, 1], { detail: true });
}

function addCable(parent, points, radius = .014, material = MATS.rubber) {
  const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(p[0], p[1], p[2])));
  const tube = new T.TubeGeometry(curve, 22, radius, 6, false);
  const m = addMesh(parent, tube, material, [0, 0, 0], [0, 0, 0], [1, 1, 1], { detail: true, cast: false });
  m.receiveShadow = false;
  return m;
}

function addJointAxes(parent, size = .2) {
  const g = new T.Group();
  const axes = [
    [new T.Vector3(0, 0, 0), new T.Vector3(size, 0, 0), 0xff552d],
    [new T.Vector3(0, 0, 0), new T.Vector3(0, size, 0), 0x2b9e66],
    [new T.Vector3(0, 0, 0), new T.Vector3(0, 0, size), 0x2d6d9b]
  ];
  axes.forEach(([a, b, col]) => {
    const geo = new T.BufferGeometry().setFromPoints([a, b]);
    const line = new T.Line(geo, new T.LineBasicMaterial({ color: col, transparent: true, opacity: .92, depthTest: false, toneMapped: false }));
    line.layers.set(3); line.renderOrder = 8;
    g.add(line);
  });
  g.visible = false;
  g.layers.set(3);
  parent.add(g);
  jointAxisGroups.push(g);
  return g;
}

function addCadEdges(mesh, threshold = 28) {
  if (!mesh?.geometry || mesh.isInstancedMesh || !mesh.geometry.attributes.position) return;
  const edges = new T.EdgesGeometry(mesh.geometry, threshold);
  const line = new T.LineSegments(edges, MATS.gridInk);
  line.visible = false;
  line.layers.set(3);
  line.userData.cadEdge = true;
  mesh.add(line);
  cadEdgeObjects.push(line);
}

/* -------- component registry + engineering copy -------- */
const LEG_IDS = ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'];
const PART_DEFS = {
  carapace: {
    name: 'Cephalothorax Shell', category: 'ARMOR / SENSOR HOUSING', preview: 'body',
    function: 'Primary command housing, sensor mast and forward armor',
    material: 'Alumina ceramic over Ti-6Al-4V monocoque',
    joints: 'Bonded shell / 26 service fasteners',
    actuation: 'Static armor, active sensor gimbal',
    range: '—',
    connections: ['Abdomen bus', '8 leg mounts', 'Optic array', 'Chelicerae']
  },
  armor: {
    name: 'Armor Plating System', category: 'PROTECTION', preview: 'body',
    function: 'Modular impact shell with ceramic strike faces and vented backplates',
    material: 'Alumina ceramic / titanium honeycomb / rubber isolation',
    joints: '48 replaceable panels, keyed tongue-and-groove',
    actuation: 'Passive; service panels detachable',
    range: '—',
    connections: ['Cephalothorax', 'Abdomen', 'Leg actuators']
  },
  abdomen: {
    name: 'Segmented Abdomen', category: 'POWER / STORAGE', preview: 'body',
    function: 'Power cells, hydraulic reservoir, compute stack and spinneret feed',
    material: 'Ceramic shells / titanium frame / carbon composite',
    joints: '4 overlapping armor bands / flexible spine',
    actuation: 'Passive flex, active venting',
    range: '0–14° segment flex',
    connections: ['Cephalothorax', 'Spinnerets', 'Cooling loop']
  },
  eyes: {
    name: 'Optical Sensor Array', category: 'PERCEPTION', preview: 'sensor',
    function: 'Multi-spectrum vision, ranging and threat acquisition',
    material: 'Sapphire lens / titanium bezel / ceramic cowl',
    joints: '8 independent gimbal rings',
    actuation: '8 micro-servos, ±24° pan',
    range: '0.08–420 m (design)',
    connections: ['Optic bus', 'Compute stack', 'Forward armor']
  },
  pedipalp_L: {
    name: 'Pedipalp — Left', category: 'MANIPULATION', preview: 'mech',
    function: 'Manipulation, sample handling and fine tactile analysis',
    material: 'Titanium links / ceramic shroud',
    joints: '3 articulation axes + gripper',
    actuation: '3 servo motors + tendon return',
    range: '0–140° / grip 42 N',
    connections: ['Forward chassis', 'Optic network', 'Tool bus']
  },
  pedipalp_R: {
    name: 'Pedipalp — Right', category: 'MANIPULATION', preview: 'mech',
    function: 'Manipulation, sample handling and fine tactile analysis',
    material: 'Titanium links / ceramic shroud',
    joints: '3 articulation axes + gripper',
    actuation: '3 servo motors + tendon return',
    range: '0–140° / grip 42 N',
    connections: ['Forward chassis', 'Optic network', 'Tool bus']
  },
  fang_L: {
    name: 'Chelicera — Left', category: 'TOOL INTERFACE', preview: 'mouth',
    function: 'Gripping, anchoring and tool interface',
    material: 'Hardened steel blade / titanium root',
    joints: '2-axis cheliceral hinge',
    actuation: 'Hydraulic close / spring return',
    range: '0–92° / 620 N clamp',
    connections: ['Forward chassis', 'Hydraulic ring']
  },
  fang_R: {
    name: 'Chelicera — Right', category: 'TOOL INTERFACE', preview: 'mouth',
    function: 'Gripping, anchoring and tool interface',
    material: 'Hardened steel blade / titanium root',
    joints: '2-axis cheliceral hinge',
    actuation: 'Hydraulic close / spring return',
    range: '0–92° / 620 N clamp',
    connections: ['Forward chassis', 'Hydraulic ring']
  },
  spinneret: {
    name: 'Spinneret Cluster', category: 'UTILITY', preview: 'spinneret',
    function: 'Deployable sensor tether and structural line layer',
    material: 'Steel nozzles / ceramic housing / rubber seals',
    joints: '3 rotating nozzles / gimbal housing',
    actuation: '3 stepper motors, feed tensioner',
    range: '360° yaw / 0.9 mm line (design)',
    connections: ['Abdomen reservoir', 'Guidance computer']
  },
  antenna: {
    name: 'Dorsal Antenna Pair', category: 'COMMUNICATION', preview: 'sensor',
    function: 'Long-range comms and electromagnetic survey',
    material: 'Carbon whip / copper core / ceramic base',
    joints: '2-axis flexure',
    actuation: 'Passive flex + active tuning',
    range: '7.4 GHz / 18 km line-of-sight',
    connections: ['Comms stack', 'Abdomen bus']
  },
  core: {
    name: 'Power Core & Compute Stack', category: 'INTERNAL SYSTEM', preview: 'core',
    function: 'Solid-state energy storage, distribution and gait compute',
    material: 'Lithium-titanium cells / copper bus / titanium cage',
    joints: '8-point isolation mount',
    actuation: 'Active thermal control',
    range: '2.8 kWh / 210 bar auxiliary',
    connections: ['All leg actuators', 'Hydraulic ring', 'Optic bus']
  },
  gearbox: {
    name: 'Planetary Joint Gearbox', category: 'TRANSMISSION', preview: 'mech',
    function: 'Torque multiplication and backlash-controlled joint drive',
    material: 'Hardened steel planets / bronze carrier / titanium case',
    joints: '3-stage planetary, 18:1 reduction',
    actuation: 'Brushless servo input / 1.7 Nm holding',
    range: '±160° / 0.02° resolution',
    connections: ['Leg servo loop', 'Hydraulic damper', 'Structural shell']
  },
  hydraulic: {
    name: 'Hydraulic Damper', category: 'SUSPENSION', preview: 'mech',
    function: 'Impact damping, load sharing and stance compliance',
    material: 'Steel rod / titanium body / synthetic seals',
    joints: 'Double-eye spherical bearings',
    actuation: '210 bar closed circuit',
    range: '86 mm stroke / 4.2 kN peak',
    connections: ['Femur', 'Tibia', 'Hydraulic ring']
  },
  claw: {
    name: 'Tarsal Contact Claw', category: 'CONTACT', preview: 'mech',
    function: 'Traction, ground sensing and silent contact release',
    material: 'Hardened steel / tungsten-carbide pads',
    joints: '2 opposing hooks + compliant pad',
    actuation: 'Passive spring / contact sensor',
    range: '0–46 mm grip envelope',
    connections: ['Tarsus', 'Contact sensor bus']
  }
};
LEG_IDS.forEach(id => {
  PART_DEFS['leg_' + id] = {
    name: 'Leg Assembly — ' + id, category: 'LOCOMOTION', preview: 'leg',
    function: 'Loading, stability, terrain adaptation and planted contact',
    material: 'Titanium alloy / carbon composite / ceramic shroud',
    joints: 'Coxa / femur / patella / tibia / tarsus',
    actuation: 'Servo motor + hydraulic damper',
    range: '0–160° / multi-axis',
    connections: ['Thorax mount ' + id.slice(1), 'Hydraulic ring', 'Gait controller']
  };
});

function tagPart(root, id) {
  if (!root) return;
  partObjects[id] = root;
  root.traverse(o => {
    if ((o.isMesh || o.isInstancedMesh) && !o.userData.noPick && !o.isInstancedMesh) {
      o.userData.partId = id;
      if (!pickMeshes.includes(o)) pickMeshes.push(o);
    }
  });
  // major surfaces get CAD edges only
  root.traverse(o => {
    if (o.isMesh && !o.isInstancedMesh && o.userData.noPick !== true) {
      const bs = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
      if (bs && bs.radius > .075) addCadEdges(o);
    }
  });
}

function assignSubpart(mesh, id, label) {
  if (!mesh) return;
  mesh.traverse(o => {
    if (o.isMesh) {
      o.userData.partId = id;
      if (label) o.userData.partLabel = label;
      if (!pickMeshes.includes(o)) pickMeshes.push(o);
    }
  });
}

function initSharedGeometry() {
  GEOS.bolt = new T.CylinderGeometry(.025, .029, .018, 6);
  GEOS.boltSmall = new T.CylinderGeometry(.014, .017, .012, 6);
  GEOS.ventSlat = new T.BoxGeometry(.3, .011, .023);
  GEOS.ventBack = new T.BoxGeometry(.3, .075, .02);
  GEOS.bearingBall = new T.SphereGeometry(.017, 6, 5);
}

const LEG_LAYOUT = [
  { id: 'L1', side: -1, index: 0, hip: [-.58, -.04, .72], foot: [-2.02, 0, 1.92], group: 'A', phase: 0 },
  { id: 'L2', side: -1, index: 1, hip: [-.63, -.05, .32], foot: [-2.54, 0, .82], group: 'B', phase: .5 },
  { id: 'L3', side: -1, index: 2, hip: [-.63, -.06, -.08], foot: [-2.54, 0, -.34], group: 'A', phase: 0 },
  { id: 'L4', side: -1, index: 3, hip: [-.56, -.05, -.48], foot: [-2.02, 0, -1.58], group: 'B', phase: .5 },
  { id: 'R1', side: 1, index: 4, hip: [.58, -.04, .72], foot: [2.02, 0, 1.92], group: 'B', phase: .5 },
  { id: 'R2', side: 1, index: 5, hip: [.63, -.05, .32], foot: [2.54, 0, .82], group: 'A', phase: 0 },
  { id: 'R3', side: 1, index: 6, hip: [.63, -.06, -.08], foot: [2.54, 0, -.34], group: 'B', phase: .5 },
  { id: 'R4', side: 1, index: 7, hip: [.56, -.05, -.48], foot: [2.02, 0, -1.58], group: 'A', phase: 0 }
];
const LEGS = [];

/* ============================================================
   BODY / CEPHALOTHORAX / ABDOMEN
   ============================================================ */
function buildBody() {
  buildChassis();
  buildCarapace();
  buildEyes();
  buildChelicerae();
  buildPedipalps();
  buildAbdomen();
  buildAntennae();
  buildSpinnerets();
  buildInternalSystems();
  buildBodyDetails();

  tagPart(carapaceGroup, 'carapace');
  tagPart(abdomenGroup, 'abdomen');
  tagPart(eyeGroup, 'eyes');
  tagPart(fangLGroup, 'fang_L');
  tagPart(fangRGroup, 'fang_R');
  tagPart(pedipalpL, 'pedipalp_L');
  tagPart(pedipalpR, 'pedipalp_R');
  tagPart(spinneretGroup, 'spinneret');
  tagPart(antennaGroup, 'antenna');
  tagPart(internalsGroup, 'core');
  tagPart(chassisGroup, 'armor');
  partObjects.armor = bodyGroup;
}

const chassisGroup = new T.Group();
let antennaGroup;
bodyGroup.add(chassisGroup);

function buildChassis() {
  const hull = hullGeometry({ length: 1.64, width: 1.04, height: .47, segZ: 22, segR: 26, profilePower: .30, topPower: .92, sidePower: .75 });
  addMesh(chassisGroup, hull, MATS.blackHull, [0, -.035, .22], [0, 0, 0], [1, 1, 1], { name: 'THORAX-UNDERFRAME' });
  const belly = chamferBoxGeometry(.62, .26, 1.42, .016, .01);
  addMesh(chassisGroup, belly, MATS.titaniumSoft, [0, -.23, .22]);
  addMesh(chassisGroup, chamferBoxGeometry(.5, .07, 1.25, .02, .006), MATS.orangeMatte, [0, -.36, .22]);
  addMesh(chassisGroup, chamferBoxGeometry(.3, .06, .86, .02, .006), MATS.blackHull, [0, -.41, .12]);

  // neck / waist bearing collar
  const collar = new T.Mesh(new T.TorusGeometry(.35, .047, 8, 42), MATS.titanium);
  collar.position.set(0, .02, -.54);
  collar.scale.set(1, .8, 1);
  collar.rotation.x = Math.PI / 2;
  collar.castShadow = true;
  chassisGroup.add(collar);

  // hip mounting pucks
  LEG_LAYOUT.forEach((leg, i) => {
    const side = leg.side;
    const hx = leg.hip[0] - side * .04;
    const g = new T.Group();
    g.position.set(hx, leg.hip[1], leg.hip[2]);
    chassisGroup.add(g);
    const cyl = addMesh(g, new T.CylinderGeometry(.16, .18, .16, 18), MATS.titanium, [0, 0, 0], [0, 0, Math.PI / 2]);
    addMesh(g, new T.TorusGeometry(.13, .024, 6, 24), MATS.polished, [side * .047, 0, 0], [0, Math.PI / 2, 0]);
    addMesh(g, new T.TorusGeometry(.17, .013, 5, 24), MATS.orange, [side * .055, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], { detail: true });
    // bolt crown
    const ring = [];
    for (let b = 0; b < 8; b++) {
      const a = b / 8 * TAU;
      ring.push([side * .087, Math.cos(a) * .117, Math.sin(a) * .117]);
    }
    addBoltField(g, ring, MATS.steel, { scale: .72 });
  });

  // underside orange conduits
  addCable(chassisGroup, [[-.32, -.23, .76], [-.38, -.28, .2], [-.36, -.28, -.28]], .017, MATS.orangeDark);
  addCable(chassisGroup, [[.32, -.23, .76], [.38, -.28, .2], [.36, -.28, -.28]], .017, MATS.orangeDark);
  addCable(chassisGroup, [[-.18, -.3, .86], [-.52, -.32, .36], [-.54, -.28, -.18]], .011, MATS.copper);
  addCable(chassisGroup, [[.18, -.3, .86], [.52, -.32, .36], [.54, -.28, -.18]], .011, MATS.copper);
  addVent(chassisGroup, { pos: [0, -.115, .92], rot: [Math.PI / 2, 0, 0], width: .26, count: 6, spacing: .024, size: .008 });

  // front lower sensor bumper
  addMesh(chassisGroup, chamferBoxGeometry(.58, .16, .17, .035, .012), MATS.titanium, [0, -.23, .94]);
  addVent(chassisGroup, { pos: [0, -.215, 1.032], rot: [0, 0, 0], width: .32, count: 5, spacing: .019, material: MATS.darkSteel });
  addMesh(chassisGroup, chamferBoxGeometry(.18, .03, .035, .008, .004), MATS.orange, [0, -.132, 1.026], [0, 0, 0], [1, 1, 1], { detail: true });
}

function buildCarapace() {
  carapaceGroup = new T.Group();
  carapaceGroup.name = 'CARAPACE-SHELL';
  bodyGroup.add(carapaceGroup);

  const main = hullGeometry({ length: 1.08, width: 1.1, height: .57, segZ: 24, segR: 30, profilePower: .28, topPower: .84, sidePower: .68, biasY: .02 });
  addMesh(carapaceGroup, main, MATS.ceramic, [0, .135, -.015], [0, 0, 0], [1, 1, 1], { name: 'CARAPACE-MAIN' });

  const head = hullGeometry({ length: .64, width: .84, height: .44, segZ: 18, segR: 28, profilePower: .30, topPower: .88, sidePower: .7, nose: .9, tail: 1.08 });
  addMesh(carapaceGroup, head, MATS.ceramicWarm, [0, .11, .79], [0, 0, 0], [1, 1, 1], { name: 'HEAD-SHELL' });

  // layered dorsal deck: dark gasket rim + armoured cover + cross ribs
  const dorsalGasket = hullGeometry({ length: 1.0, width: .99, height: .16, segZ: 22, segR: 30, profilePower: .32, topPower: .9, sidePower: .76 });
  addMesh(carapaceGroup, dorsalGasket, MATS.titaniumSoft, [0, .312, .03], [0, 0, 0], [1, 1, 1], { name: 'DORSAL-GASKET' });
  const dorsalCover = hullGeometry({ length: .98, width: .94, height: .22, segZ: 22, segR: 30, profilePower: .32, topPower: .9, sidePower: .76 });
  addMesh(carapaceGroup, dorsalCover, MATS.ceramicShade, [0, .32, .03], [0, 0, 0], [1, 1, 1], { name: 'DORSAL-COVER' });
  const dorsal = hullGeometry({ length: .82, width: .78, height: .27, segZ: 18, segR: 26, profilePower: .3, topPower: .82, sidePower: .76 });
  addMesh(carapaceGroup, dorsal, MATS.ceramic, [0, .33, .16], [0, 0, 0], [1, 1, 1], { name: 'DORSAL-SPINE' });
  addMesh(carapaceGroup, chamferBoxGeometry(.06, .022, .44, .014, .005), MATS.orange, [0, .45, .12], [0, 0, 0], [1, 1, 1]);
  addMesh(carapaceGroup, chamferBoxGeometry(.2, .018, .07, .014, .003), MATS.orange, [0, .445, -.19], [0, 0, 0], [1, 1, 1], { detail: true });
  // raised cross ribs on the dorsal deck
  [
    { z: .27, y: .424, w: .48 },
    { z: .02, y: .438, w: .52 },
    { z: -.25, y: .418, w: .44 }
  ].forEach((r, i) => {
    addMesh(carapaceGroup, chamferBoxGeometry(r.w, .02, .038, .014, .005), MATS.ceramic, [0, r.y, r.z], [0, 0, 0], [1, 1, 1], { detail: true });
    addBoltField(carapaceGroup, [[-r.w * .38, r.y + .014, r.z], [r.w * .38, r.y + .014, r.z]], MATS.steel, { scale: .52 });
  });
  // dorsal shoulder intakes
  for (let s = -1; s <= 1; s += 2) {
    addVent(carapaceGroup, { pos: [s * .315, .41, -.03], rot: [-Math.PI / 2, 0, s * .1], width: .2, count: 4, spacing: .021, material: MATS.darkSteel });
  }
  // head deck seams + hatch
  addMesh(carapaceGroup, chamferBoxGeometry(.014, .008, .38, .004, .002), MATS.titaniumSoft, [0, .334, .72], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(carapaceGroup, chamferBoxGeometry(.2, .016, .22, .035, .006), MATS.ceramicShade, [0, .338, .95], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(carapaceGroup, chamferBoxGeometry(.06, .01, .08, .012, .003), MATS.orange, [0, .348, .95], [0, 0, 0], [1, 1, 1], { detail: true });
  for (let s = -1; s <= 1; s += 2) {
    addVent(carapaceGroup, { pos: [s * .17, .334, .62], rot: [-Math.PI / 2, 0, 0], width: .13, count: 3, spacing: .02, material: MATS.darkSteel });
  }
  // service hatch on the rear dorsal deck
  addMesh(carapaceGroup, chamferBoxGeometry(.31, .012, .35, .05, .004), MATS.titaniumSoft, [0, .427, -.24], [0, -.035, 0], [1, 1, 1], { detail: true });
  addMesh(carapaceGroup, chamferBoxGeometry(.28, .018, .32, .048, .007), MATS.ceramic, [0, .436, -.24], [0, -.035, 0], [1, 1, 1], { detail: true });
  addMesh(carapaceGroup, chamferBoxGeometry(.16, .012, .2, .028, .003), MATS.ceramicShade, [0, .446, -.24], [0, -.035, 0], [1, 1, 1], { detail: true });
  addMesh(carapaceGroup, chamferBoxGeometry(.04, .012, .05, .01, .003), MATS.orange, [0, .453, -.24], [0, -.035, 0], [1, 1, 1], { detail: true });
  addBoltField(carapaceGroup, [[-.1, .446, -.36], [.1, .446, -.36], [-.1, .446, -.12], [.1, .446, -.12]], MATS.polished, { scale: .58 });

  // panel seams
  const seams = [
    [-.32, .31, .63, .022, .012, 0.02],
    [.31, .035, .92, -.012, .01, -.04],
    [-.05, .26, .78, .018, .01, -.02]
  ];
  seams.forEach(([z, y, w, h, d, r]) => {
    addMesh(carapaceGroup, chamferBoxGeometry(w, h, d, .006, .002), MATS.seal, [0, y, z], [0, 0, r], [1, 1, 1], { detail: true });
  });

  // shoulder fenders
  for (let s = -1; s <= 1; s += 2) {
    const f = addMesh(carapaceGroup, chamferBoxGeometry(.25, .25, .62, .06, .035), MATS.ceramic, [s * .48, .01, .38], [0, s * -.05, s * .07]);
    f.name = 'FENDER-' + (s < 0 ? 'L' : 'R');
    addMesh(carapaceGroup, chamferBoxGeometry(.05, .16, .24, .018, .008), MATS.orange, [s * .61, .025, .4], [0, s * -.05, s * .07], [1, 1, 1], { detail: true });
    addVent(carapaceGroup, { pos: [s * .605, -.035, .15], rot: [0, s * Math.PI / 2, 0], width: .28, count: 6, spacing: .022, material: MATS.darkSteel });
  }

  // side armor leaves
  [
    { z: .73, y: .06, l: .42, s: -1 },
    { z: .66, y: .06, l: .4, s: 1 },
    { z: -.29, y: .03, l: .44, s: -1 },
    { z: -.29, y: .03, l: .44, s: 1 }
  ].forEach((p, i) => {
    const plate = addMesh(carapaceGroup, chamferBoxGeometry(.08, .2, p.l, .03, .016), MATS.ceramicShade,
      [p.s * .555, p.y, p.z], [0, p.s * .04, p.s * (i < 2 ? .09 : -.1)]);
    addMesh(plate, chamferBoxGeometry(.015, .028, p.l * .6, .006, .002), MATS.orange, [p.s * .043, .04, 0], [0, 0, 0], [1, 1, 1], { detail: true });
  });

  // front cowl / brow
  addMesh(carapaceGroup, chamferBoxGeometry(.62, .13, .12, .035, .012), MATS.titanium, [0, .10, 1.07]);
  addMesh(carapaceGroup, chamferBoxGeometry(.5, .056, .035, .018, .008), MATS.orange, [0, .18, 1.092], [0, 0, 0], [1, 1, 1], { detail: true });
  addVent(carapaceGroup, { pos: [0, .045, 1.119], rot: [0, 0, 0], width: .46, count: 2, spacing: .04, material: MATS.blackHull });

  // dorsal details: sensor blister + fasteners
  addMesh(carapaceGroup, chamferBoxGeometry(.2, .08, .26, .04, .02), MATS.titanium, [.18, .39, -.24], [0, .12, .02]);
  addMesh(carapaceGroup, new T.CylinderGeometry(.035, .045, .035, 12), MATS.orange, [.18, .445, -.24]);
  addMesh(carapaceGroup, new T.SphereGeometry(.028, 10, 8), MATS.lensDim, [.18, .469, -.24], [0, 0, 0], [1, .6, 1]);

  // bolt fields
  const topBolts = [];
  for (let i = 0; i < 4; i++) {
    const z = -.02 + i * .12;
    topBolts.push([-.24, .452, z], [.24, .452, z]);
  }
  addBoltField(carapaceGroup, topBolts, MATS.steel, { scale: .85 });
  const edgeBolts = [];
  for (let i = 0; i < 6; i++) {
    const z = -.38 + i * .2;
    edgeBolts.push({ p: [-.535, .15 - Math.abs(z) * .06, z], r: [0, 0, Math.PI / 2] }, { p: [.535, .15 - Math.abs(z) * .06, z], r: [0, 0, Math.PI / 2] });
  }
  addBoltField(carapaceGroup, edgeBolts, MATS.darkSteel, { scale: .7 });

  // heat vents at head sides
  addVent(carapaceGroup, { pos: [-.3, .25, .57], rot: [Math.PI / 2, 0, .18], width: .22, count: 4, spacing: .024, material: MATS.darkSteel });
  addVent(carapaceGroup, { pos: [.3, .25, .57], rot: [Math.PI / 2, 0, -.18], width: .22, count: 4, spacing: .024, material: MATS.darkSteel });

  // decals
  addDecal(carapaceGroup, 'ar08', .48, .24, [-.557, .02, .2], [0, -Math.PI / 2, 0], .88);
  addDecal(carapaceGroup, 'ar08', .48, .24, [.557, .02, .2], [0, Math.PI / 2, 0], .88);
  addDecal(carapaceGroup, 'serial', .3, .15, [.18, .395, -.36], [-Math.PI / 2, 0, 0], .8);
  addDecal(carapaceGroup, 'warning', .19, .095, [-.48, .12, .72], [0, -Math.PI / 2, .04], .92);

  // tiny service fasteners on fenders
  const detailBolts = [];
  for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 5; i++) detailBolts.push([s * .53, .12, .12 + i * .1]);
  addBoltField(carapaceGroup, detailBolts, MATS.steel, { scale: .6 });
}

function taperedTubeGeometry(points, r0, r1, radial = 8, tubular = 24) {
  const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(p[0], p[1], p[2])));
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [], idx = [], uv = [];
  const point = new T.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, point);
    const r = lerp(r0, r1, t) * (1 + Math.sin(t * Math.PI) * .08);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = j / radial * TAU, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(point.x + r * (ca * N.x + sa * B.x), point.y + r * (ca * N.y + sa * B.y), point.z + r * (ca * N.z + sa * B.z));
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = (i + 1) * radial + j;
      const c = (i + 1) * radial + (j + 1) % radial;
      const d = i * radial + (j + 1) % radial;
      idx.push(a, d, b, b, d, c);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildEyes() {
  eyeGroup = new T.Group();
  eyeGroup.name = 'OPTIC-ARRAY';
  eyeGroup.position.set(0, .115, 1.10);
  bodyGroup.add(eyeGroup);

  addMesh(eyeGroup, chamferBoxGeometry(.68, .33, .12, .08, .025), MATS.titanium, [0, .01, .005]);
  addMesh(eyeGroup, chamferBoxGeometry(.55, .23, .07, .06, .018), MATS.blackHull, [0, .012, .07]);
  addMesh(eyeGroup, chamferBoxGeometry(.52, .022, .018, .01, .004), MATS.orange, [0, .185, .095], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(eyeGroup, chamferBoxGeometry(.63, .035, .05, .02, .008), MATS.ceramic, [0, -.17, .04], [0, 0, 0], [1, 1, 1]);
  addMesh(eyeGroup, chamferBoxGeometry(.18, .025, .016, .008, .002), MATS.orange, [0, -.17, .078], [0, 0, 0], [1, 1, 1], { detail: true });

  const addLens = (x, y, r, primary = false, amber = false) => {
    const z = primary ? .09 : .085;
    const bez = addMesh(eyeGroup, new T.CylinderGeometry(r * 1.45, r * 1.38, .075, 18), MATS.titanium, [x, y, z], [Math.PI / 2, 0, 0]);
    addMesh(eyeGroup, new T.TorusGeometry(r * 1.23, r * .13, 6, 20), primary ? MATS.orange : MATS.darkSteel, [x, y, z + .035], [0, 0, 0], [1, 1, 1], { detail: true });
    const lens = addMesh(eyeGroup, new T.SphereGeometry(r, 18, 12), amber ? MATS.lensAmber : MATS.lens, [x, y, z + .045], [0, 0, 0], [1, 1, .58]);
    addGlow(eyeGroup, [x, y, z + .13], r * 5.6, primary ? .62 : .36, 'warm');
    eyeGlows.push(lens);
    return lens;
  };
  addLens(-.185, .045, .093, true);
  addLens(.185, .045, .093, true);
  addLens(-.335, -.035, .052);
  addLens(.335, -.035, .052);
  addLens(-.10, .185, .032);
  addLens(.10, .185, .032);
  addLens(-.255, .172, .028, false, true);
  addLens(.255, .172, .028, false, true);

  // optical cooler rails and tiny bolts
  for (let s = -1; s <= 1; s += 2) {
    addMesh(eyeGroup, chamferBoxGeometry(.06, .04, .11, .012, .006), MATS.orange, [s * .342, .11, .03], [0, 0, 0], [1, 1, 1], { detail: true });
    addCable(eyeGroup, [[s * .29, -.14, .03], [s * .39, -.2, -.02], [s * .44, -.18, -.06]], .009, MATS.rubber);
  }
  addBoltField(eyeGroup, [[-.27, .12, .062], [.27, .12, .062], [-.25, -.12, .062], [.25, -.12, .062], [0, .16, .062], [0, -.145, .062]], MATS.polished, { scale: .8 });
}

function buildChelicerae() {
  const buildFang = (side) => {
    const root = new T.Group();
    root.name = 'CHELICERA-' + (side < 0 ? 'L' : 'R');
    root.position.set(side * .22, -.145, .995);
    root.rotation.z = side * -.035;
    bodyGroup.add(root);
    addMesh(root, new T.CylinderGeometry(.095, .12, .18, 14), MATS.titanium, [0, -.02, 0], [0, 0, 0]);
    addMesh(root, new T.TorusGeometry(.093, .016, 6, 20), MATS.orange, [0, -.085, 0], [Math.PI / 2, 0, 0], [1, 1, 1], { detail: true });
    addMesh(root, chamferBoxGeometry(.2, .16, .2, .04, .014), MATS.ceramic, [side * -.01, .02, .02], [0, side * .08, 0]);
    addMesh(root, chamferBoxGeometry(.17, .018, .19, .012, .004), MATS.orange, [side * -.01, .109, .02], [0, side * .08, 0], [1, 1, 1], { detail: true });
    // hydraulic close cylinder
    addMesh(root, new T.CylinderGeometry(.023, .023, .16, 8), MATS.darkSteel, [side * -.09, -.05, -.06], [0, 0, Math.PI / 2]);
    addMesh(root, new T.CylinderGeometry(.011, .011, .12, 8), MATS.polished, [side * -.02, -.05, -.06], [0, 0, Math.PI / 2], [1, 1, 1], { detail: true });

    const bladePts = [
      [0, -.055, .02],
      [side * -.012, -.15, .025],
      [side * -.045, -.29, .10],
      [side * -.07, -.38, .20],
      [side * -.06, -.40, .29]
    ];
    addMesh(root, taperedTubeGeometry(bladePts, .064, .013, 9, 28), MATS.titanium, [0, 0, 0]);
    // orange cutting keel
    const keelPts = bladePts.map((p, i) => [p[0] + side * .012, p[1] + .017, p[2] + .004]);
    addMesh(root, taperedTubeGeometry(keelPts, .018, .004, 6, 20), MATS.orange, [0, 0, 0]);
    // serrations
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      addMesh(root, new T.ConeGeometry(.016, .065, 5), MATS.steel,
        [side * (.02 + t * .02), -.18 - t * .16, .07 + t * .17],
        [0, 0, side * -.9], [1, .7, 1], { detail: true });
    }
    addBoltField(root, [
      [-.06, .02, .09], [.06, .02, .09], [-.06, .02, -.04], [.06, .02, -.04],
      { p: [side * -.14, -.02, 0], r: [0, 0, Math.PI / 2] }
    ], MATS.steel, { scale: .75 });
    return root;
  };
  fangLGroup = buildFang(-1);
  fangRGroup = buildFang(1);
}

function buildPedipalps() {
  const build = (side) => {
    const root = new T.Group();
    root.name = 'PEDIPALP-' + (side < 0 ? 'L' : 'R');
    root.position.set(side * .43, -.19, .95);
    root.rotation.y = side * .29;
    root.rotation.z = side * .03;
    bodyGroup.add(root);

    addMesh(root, new T.CylinderGeometry(.11, .14, .15, 14), MATS.titanium, [0, 0, 0], [0, 0, Math.PI / 2]);
    addMesh(root, new T.TorusGeometry(.105, .019, 6, 20), MATS.orange, [side * .054, 0, 0], [0, Math.PI / 2, 0], [1, 1, 1], { detail: true });

    const segment = (len, w, h, zPos = 0) => {
      const g = new T.Group();
      g.position.z = zPos;
      root.add(g);
      addMesh(g, taperedBeamGeometry(len, w, h, w * .78, h * .8), MATS.titanium, [0, 0, 0]);
      addMesh(g, chamferBoxGeometry(w * 1.4, h * .45, len * .7, .025, .012), MATS.ceramic, [0, h * .3, len * .48]);
      addMesh(g, chamferBoxGeometry(w * 1.2, h * .14, len * .22, .012, .004), MATS.orange, [0, h * .56, len * .5], [0, 0, 0], [1, 1, 1], { detail: true });
      addBoltField(g, [
        [-w * .62, h * .22, len * .17], [w * .62, h * .22, len * .17],
        [-w * .7, h * .17, len * .36], [w * .7, h * .17, len * .36]
      ], MATS.steel, { scale: .55 });
      return g;
    };
    const s1 = segment(.44, .16, .16);
    addMesh(s1, new T.TorusGeometry(.115, .026, 6, 22), MATS.polished, [0, 0, .44], [0, 0, 0]);
    const elbow = new T.Group(); elbow.position.z = .44; elbow.rotation.x = .72; s1.add(elbow);
    addGear(elbow, .1, 14, .025, MATS.brass, [side * .09, 0, 0], 'x', 1.3);
    addMesh(elbow, new T.CylinderGeometry(.105, .105, .15, 14), MATS.titanium, [0, 0, 0], [0, 0, Math.PI / 2]);
    const s2 = segment(.33, .115, .12, 0); // re-parent to elbow below
    elbow.add(s2); s2.position.z = 0;
    addMesh(s2, new T.TorusGeometry(.09, .018, 5, 20), MATS.orange, [0, 0, .33], [0, 0, 0], [1, 1, 1], { detail: true });
    const wrist = new T.Group(); wrist.position.z = .33; wrist.rotation.x = -.45; s2.add(wrist);
    addMesh(wrist, new T.CylinderGeometry(.075, .075, .11, 12), MATS.titanium, [0, 0, 0], [0, 0, Math.PI / 2]);
    addMesh(wrist, chamferBoxGeometry(.12, .09, .17, .024, .01), MATS.ceramic, [0, .02, .09]);
    const finger = (s) => addMesh(wrist, taperedTubeGeometry([[0, 0, .03], [s * .035, -.03, .11], [s * .055, -.055, .2]], .023, .004, 7, 14), MATS.titanium, [0, 0, 0]);
    finger(-1); finger(1);
    addMesh(wrist, new T.SphereGeometry(.012, 8, 6), MATS.orange, [0, -.03, .13], [0, 0, 0], [1, 1, 1], { detail: true });
    root.userData.anim = { base: root, elbow, wrist, side, phase: side < 0 ? 0 : 1.1 };
    return root;
  };
  pedipalpL = build(-1);
  pedipalpR = build(1);
}

let abdomenShell;
function buildAbdomen() {
  abdomenGroup = new T.Group();
  abdomenGroup.name = 'ABDOMEN';
  bodyGroup.add(abdomenGroup);
  abdomenShell = new T.Group();
  abdomenGroup.add(abdomenShell);

  // flexible waist / pedicel linking cephalothorax and abdomen
  addMesh(abdomenGroup, new T.CylinderGeometry(.21, .25, .34, 20), MATS.rubberSoft, [0, .12, -.58], [Math.PI / 2, 0, 0]);
  addMesh(abdomenGroup, new T.TorusGeometry(.215, .026, 8, 26), MATS.titanium, [0, .12, -.5], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(abdomenGroup, new T.TorusGeometry(.228, .012, 6, 26), MATS.orange, [0, .12, -.62], [0, 0, 0], [1, 1, 1], { detail: true });

  // main bulbous belly shell (dark, reads as shadowed gaps between plates)
  addMesh(abdomenGroup, hullGeometry({ length: 1.9, width: 1.04, height: .8, segZ: 28, segR: 30, profilePower: .34, topPower: .96, sidePower: .82 }), MATS.carbon, [0, .05, -1.38], [0, 0, 0], [1, 1, 1], { name: 'ABDOMEN-BULB' });

  // three proud armour bands over the bulb, separated by dark seam rings
  const bands = [
    { z: -.78, l: .48, w: 1.26, h: .92, y: .12, rot: -.06 },
    { z: -1.4, l: .5, w: 1.42, h: 1.06, y: .14, rot: 0 },
    { z: -1.96, l: .46, w: 1.2, h: .9, y: .11, rot: .055 }
  ];
  const seams = [
    { z: -1.085, w: 1.02, h: .72, y: .075 },
    { z: -1.69, w: .98, h: .66, y: .07 }
  ];
  seams.forEach((s, i) => {
    addMesh(abdomenShell, hullGeometry({ length: .055, width: s.w, height: s.h, segZ: 6, segR: 28, profilePower: .4, topPower: .96, sidePower: .82 }), MATS.blackHull, [0, s.y, s.z], [0, 0, 0], [1, 1, 1], { detail: i > 0 });
    // machined tension rings clamping the segment joint
    [-1, 1].forEach(sd => {
      addMesh(abdomenShell, new T.TorusGeometry(1, .0125, 5, 42), MATS.titaniumSoft,
        [0, s.y, s.z + sd * .026], [0, 0, 0], [s.w * .5, s.h * .5, 1], { detail: true });
    });
    const seamBolts = [];
    for (let b = 0; b < 10; b++) {
      const a = b / 10 * TAU - Math.PI / 2;
      seamBolts.push({
        p: [Math.cos(a) * s.w * .505, s.y + Math.sin(a) * s.h * .505, s.z],
        r: [0, 0, a - Math.PI / 2]
      });
    }
    addBoltField(abdomenShell, seamBolts, MATS.steel, { scale: .52 });
  });
  bands.forEach((b, bi) => {
    const shell = hullGeometry({ length: b.l, width: b.w, height: b.h, segZ: 22, segR: 32, profilePower: .28, topPower: .9, sidePower: .75 });
    addMesh(abdomenShell, shell, bi === 1 ? MATS.ceramic : MATS.ceramicWarm, [0, b.y, b.z], [b.rot, 0, 0], [1, 1, 1], { name: 'ABDOMEN-BAND-' + bi });

    // dorsal ridge plating
    addMesh(abdomenShell, chamferBoxGeometry(.22, .022, b.l * .5, .016, .006), MATS.ceramicShade, [0, b.y + b.h * .49, b.z + b.l * .02], [b.rot, 0, 0], [1, 1, 1], { detail: true });
    addMesh(abdomenShell, chamferBoxGeometry(.042, .014, b.l * .4, .01, .003), MATS.orange, [0, b.y + b.h * .508, b.z], [b.rot, 0, 0], [1, 1, 1], { detail: true });
    addBoltField(abdomenShell, [
      [-.105, b.y + b.h * .5, b.z - b.l * .2], [.105, b.y + b.h * .5, b.z - b.l * .2],
      [-.105, b.y + b.h * .5, b.z + b.l * .2], [.105, b.y + b.h * .5, b.z + b.l * .2]
    ], MATS.steel, { scale: .72 });

    // side armour wedges + vents
    for (let s = -1; s <= 1; s += 2) {
      addMesh(abdomenShell, chamferBoxGeometry(.028, .13, b.l * .42, .014, .005), MATS.orange, [s * b.w * .49, b.y + .03, b.z], [b.rot, 0, s * .04], [1, 1, 1], { detail: true });
      addMesh(abdomenShell, chamferBoxGeometry(.055, .035, b.l * .3, .014, .005), MATS.ceramicShade, [s * b.w * .46, b.y + b.h * .32, b.z], [b.rot, 0, s * -.16], [1, 1, 1], { detail: true });
      addVent(abdomenShell, { pos: [s * b.w * .49, b.y + .01, b.z + b.l * .1], rot: [0, s * Math.PI / 2, 0], width: b.l * .34, count: 5, spacing: .021, material: MATS.darkSteel });
    }

    // panel fasteners around each band
    const bolts = [];
    for (let i = 0; i < 5; i++) {
      const z = b.z - b.l * .3 + i * b.l * .15;
      bolts.push({ p: [-b.w * .35, b.y + b.h * .43, z], r: [0, 0, Math.PI / 2] }, { p: [b.w * .35, b.y + b.h * .43, z], r: [0, 0, Math.PI / 2] });
    }
    addBoltField(abdomenShell, bolts, bi === 1 ? MATS.darkSteel : MATS.steel, { scale: .62 });
    if (bi === 1) {
      addDecal(abdomenShell, 'ar08', .46, .23, [-b.w * .503, b.y + .04, b.z + .08], [0, -Math.PI / 2, 0], .85);
      addDecal(abdomenShell, 'warning', .2, .1, [b.w * .503, b.y + .02, b.z - .12], [0, Math.PI / 2, 0], .9);
    }
  });

  // underside keel and service rail
  addMesh(abdomenGroup, chamferBoxGeometry(.68, .17, 1.62, .09, .03), MATS.titaniumSoft, [0, -.235, -1.38]);
  addMesh(abdomenGroup, chamferBoxGeometry(.42, .05, 1.32, .018, .008), MATS.orangeMatte, [0, -.33, -1.38]);
  addVent(abdomenGroup, { pos: [0, -.175, -1.98], rot: [0, 0, 0], width: .48, count: 5, spacing: .023, material: MATS.darkSteel });

  // dorsal heat exchanger on the first band
  const heat = new T.Group(); heat.position.set(0, .595, -.78); abdomenShell.add(heat);
  addMesh(heat, chamferBoxGeometry(.26, .048, .26, .022, .008), MATS.ceramicShade, [0, 0, 0]);
  const finInst = new T.InstancedMesh(new T.BoxGeometry(.22, .012, .19), MATS.darkSteel, 8);
  for (let i = 0; i < 8; i++) {
    const p = new T.Vector3(0, .028, -.11 + i * .032);
    tmpM.compose(p, new T.Quaternion(), new T.Vector3(1, 1, 1));
    finInst.setMatrixAt(i, tmpM);
  }
  finInst.layers.set(2); finInst.castShadow = false; finInst.receiveShadow = false;
  heat.add(finInst);
  COUNTS.instances += 8; COUNTS.vents += 8;
  addMesh(heat, chamferBoxGeometry(.09, .02, .07, .006, .002), MATS.orange, [0, .036, .1], [0, 0, 0], [1, 1, 1], { detail: true });
  addBoltField(heat, [[-.11, .023, -.1], [.11, .023, -.1], [-.11, .023, .1], [.11, .023, .1]], MATS.steel, { scale: .55 });

  // domed rear cap
  addMesh(abdomenShell, hullGeometry({ length: .24, width: .92, height: .58, segZ: 9, segR: 26, profilePower: .3, sidePower: .8, topPower: .94 }), MATS.ceramic, [0, .075, -2.28]);
  addMesh(abdomenShell, chamferBoxGeometry(.38, .035, .03, .016, .006), MATS.orange, [0, .28, -2.36], [0, 0, 0], [1, 1, 1], { detail: true });
  addBoltField(abdomenShell, [[-.34, .07, -2.37], [.34, .07, -2.37], [-.26, .26, -2.35], [.26, .26, -2.35]], MATS.steel, { scale: .68 });
}

function buildAntennae() {
  antennaGroup = new T.Group();
  antennaGroup.name = 'ANTENNAE';
  bodyGroup.add(antennaGroup);
  for (let side = -1; side <= 1; side += 2) {
    const root = new T.Group();
    root.position.set(side * .23, .38, -.56);
    root.rotation.x = -.58;
    root.rotation.z = side * .13;
    antennaGroup.add(root);
    addMesh(root, new T.CylinderGeometry(.045, .065, .11, 10), MATS.titanium, [0, .02, 0]);
    addMesh(root, new T.TorusGeometry(.045, .009, 5, 16), MATS.orange, [0, .075, 0], [Math.PI / 2, 0, 0], [1, 1, 1], { detail: true });
    addMesh(root, new T.CylinderGeometry(.010, .016, .34, 8), MATS.titaniumSoft, [0, .20, 0]);
    addMesh(root, new T.CylinderGeometry(.004, .008, .26, 6), MATS.steel, [0, .40, 0], [0, 0, 0], [1, 1, 1], { detail: true });
    addMesh(root, new T.SphereGeometry(.019, 8, 6), MATS.orange, [0, .555, 0]);
    addMesh(root, new T.CylinderGeometry(.010, .010, .034, 8), MATS.lensAmber, [0, .527, 0], [0, 0, 0], [1, 1, 1], { detail: true });
    addBoltField(root, [[-.045, .02, .01], [.045, .02, .01]], MATS.steel, { scale: .55 });
    // fine tuning wire
    addCable(root, [[0, .09, 0], [side * .02, .24, -.02], [side * .01, .39, .01]], .004, MATS.copper);
  }
}

function buildSpinnerets() {
  spinneretGroup = new T.Group();
  spinneretGroup.name = 'SPINNERETS';
  spinneretGroup.position.set(0, -.03, -2.42);
  bodyGroup.add(spinneretGroup);

  addMesh(spinneretGroup, chamferBoxGeometry(.42, .24, .2, .055, .02), MATS.titanium, [0, 0, 0]);
  addMesh(spinneretGroup, chamferBoxGeometry(.28, .08, .16, .03, .012), MATS.orange, [0, .01, -.03], [0, 0, 0], [1, 1, 1], { detail: true });
  const nozzles = [
    { x: -.12, y: .025, r: .06, l: .32 },
    { x: .12, y: .025, r: .06, l: .32 },
    { x: 0, y: -.075, r: .045, l: .27 }
  ];
  nozzles.forEach((n, i) => {
    const g = new T.Group(); g.position.set(n.x, n.y, 0); g.rotation.x = -Math.PI / 2 + .25; spinneretGroup.add(g);
    addMesh(g, new T.CylinderGeometry(n.r * .55, n.r, n.l, 12), MATS.darkSteel, [0, n.l * .5, 0]);
    addMesh(g, new T.CylinderGeometry(n.r * .75, n.r * .82, .045, 12), MATS.orange, [0, -.02, 0], [0, 0, 0], [1, 1, 1], { detail: true });
    addMesh(g, new T.CylinderGeometry(n.r * .24, n.r * .42, .08, 10), MATS.rubber, [0, n.l * .98, 0], [0, 0, 0], [1, 1, 1], { detail: true });
    addMesh(g, new T.TorusGeometry(n.r * .65, .007, 4, 14), MATS.polished, [0, n.l * .73, 0], [Math.PI / 2, 0, 0], [1, 1, 1], { detail: true });
  });
  // guide eyes / feed tubes
  addCable(spinneretGroup, [[-.12, -.1, .02], [-.16, -.13, -.28], [-.35, -.12, -.58]], .013, MATS.copper);
  addCable(spinneretGroup, [[.12, -.1, .02], [.16, -.13, -.28], [.35, -.12, -.58]], .013, MATS.orangeDark);
  addBoltField(spinneretGroup, [[-.18, .09, .11], [.18, .09, .11], [-.16, .02, -.09], [.16, .02, -.09]], MATS.steel, { scale: .7 });
  addDecal(spinneretGroup, 'serial', .16, .08, [0, .126, .01], [-Math.PI / 2, 0, 0], .8);
}

function buildInternalSystems() {
  // core reactor barrel
  addMesh(internalsGroup, new T.CylinderGeometry(.23, .23, .56, 24), MATS.internal, [0, .055, .03], [Math.PI / 2, 0, 0]);
  addMesh(internalsGroup, new T.CylinderGeometry(.17, .17, .58, 20), MATS.energy, [0, .055, .03], [Math.PI / 2, 0, 0], [.95, .95, .95]);
  for (let i = 0; i < 4; i++) addMesh(internalsGroup, new T.TorusGeometry(.205, .016, 5, 28), MATS.copper, [0, .055, -.22 + i * .16], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(internalsGroup, new T.CylinderGeometry(.27, .27, .06, 24), MATS.titanium, [0, .055, -.3], [Math.PI / 2, 0, 0]);
  addMesh(internalsGroup, new T.CylinderGeometry(.27, .27, .06, 24), MATS.titanium, [0, .055, .36], [Math.PI / 2, 0, 0]);
  const ringGroup = new T.Group(); internalsGroup.add(ringGroup); internalsSpinners.push(ringGroup);
  for (let i = 0; i < 3; i++) addMesh(ringGroup, new T.TorusGeometry(.29, .012, 4, 32), MATS.polished, [0, .055, -.19 + i * .18], [0, 0, 0], [1, 1, 1], { detail: true });
  const coreGlow = addGlow(internalsGroup, [0, .055, .03], 1.1, .45, 'warm');

  // compute / battery stack in abdomen
  const stack = new T.Group(); internalsGroup.add(stack);
  addMesh(stack, chamferBoxGeometry(.5, .22, .7, .04, .012), MATS.carbon, [0, -.03, -1.16]);
  for (let i = 0; i < 6; i++) addMesh(stack, chamferBoxGeometry(.38, .02, .065, .012, .004), MATS.orange, [0, .09, -1.4 + i * .095], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(stack, new T.CylinderGeometry(.12, .12, .65, 16), MATS.internal, [-.26, -.04, -1.55], [Math.PI / 2, 0, 0]);
  addMesh(stack, new T.CylinderGeometry(.12, .12, .65, 16), MATS.internal, [.26, -.04, -1.55], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) {
    addMesh(stack, new T.TorusGeometry(.125, .012, 5, 20), MATS.orange, [-.26, -.04, -1.75 + i * .14], [0, 0, 0], [1, 1, 1], { detail: true });
    addMesh(stack, new T.TorusGeometry(.125, .012, 5, 20), MATS.steel, [.26, -.04, -1.75 + i * .14], [0, 0, 0], [1, 1, 1], { detail: true });
  }
  for (let i = 0; i < 4; i++) {
    addMesh(stack, chamferBoxGeometry(.18, .055, .24, .02, .008), MATS.internal, [-.32 + i * .21, .16, -1.22]);
    addMesh(stack, new T.SphereGeometry(.012, 6, 5), i % 2 ? MATS.lens : MATS.lensAmber, [-.32 + i * .21, .19, -1.21], [0, 0, 0], [1, .6, 1], { detail: true });
  }
  addCable(stack, [[-.24, -.05, -1.0], [-.42, -.14, -.65], [-.48, -.14, -.25]], .015, MATS.orangeDark);
  addCable(stack, [[.24, -.05, -1.0], [.42, -.14, -.65], [.48, -.14, -.25]], .015, MATS.orangeDark);
  addCable(stack, [[-.32, .1, -1.4], [-.46, .28, -1.1], [-.36, .4, -.7]], .009, MATS.copper);
  addCable(stack, [[.32, .1, -1.4], [.46, .28, -1.1], [.36, .4, -.7]], .009, MATS.copper);

  // internal skeletal ribs
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    addMesh(internalsGroup, new T.TorusGeometry(.35 + t * .1, .018, 5, 32), MATS.titaniumSoft, [0, .045, -.42 - t * .32], [0, 0, 0], [1, .72, 1], { detail: true });
  }
  addCable(internalsGroup, [[-.28, .16, .28], [-.55, .24, .43], [-.66, .1, .72]], .016, MATS.rubber);
  addCable(internalsGroup, [[.28, .16, .28], [.55, .24, .43], [.66, .1, .72]], .016, MATS.rubber);
  const coreLight = new T.PointLight(0xff6100, .8, 2.8, 2);
  coreLight.position.set(0, .06, .03);
  internalsGroup.add(coreLight);
  addBoltField(internalsGroup, [[-.19, .24, -.28], [.19, .24, -.28], [-.19, -.12, .3], [.19, -.12, .3]], MATS.steel, { scale: .65 });
}

function buildBodyDetails() {
  // segmented neck bellows
  for (let i = 0; i < 4; i++) {
    addMesh(bodyGroup, new T.TorusGeometry(.36 - i * .018, .025, 6, 32), i % 2 ? MATS.darkSteel : MATS.titaniumSoft,
      [0, .02, -.5 - i * .055], [0, 0, 0], [1, .72, 1]);
  }
  // exposed braided service loops at every hip
  LEG_LAYOUT.forEach((leg, i) => {
    const s = leg.side;
    addCable(bodyGroup, [
      [s * .28, -.18, leg.hip[2] + .08],
      [s * .46, -.25, leg.hip[2] + .12],
      [leg.hip[0] + s * .02, leg.hip[1] - .14, leg.hip[2]]
    ], .012, i % 2 ? MATS.rubber : MATS.orangeDark);
    addCable(bodyGroup, [
      [s * .3, -.14, leg.hip[2] - .04],
      [s * .5, -.18, leg.hip[2] - .08],
      [leg.hip[0] + s * .015, leg.hip[1] - .09, leg.hip[2] - .02]
    ], .008, MATS.copper);
  });
  // fine engraved identifier plates
  addMesh(bodyGroup, chamferBoxGeometry(.09, .012, .24, .008, .003), MATS.steel, [.42, .192, .82], [0, -.1, 0], [1, 1, 1], { detail: true });
  addDecal(bodyGroup, 'leg', .09, .055, [-.57, .14, -.42], [0, -Math.PI / 2, 0], .7);

  // additional armor fasteners and tiny panel seals
  const extra = [];
  for (let i = 0; i < 9; i++) {
    extra.push(
      { p: [-.56, .015, -.35 + i * .13], r: [0, 0, Math.PI / 2] },
      { p: [.56, .015, -.35 + i * .13], r: [0, 0, Math.PI / 2] }
    );
  }
  addBoltField(bodyGroup, extra, MATS.steel, { scale: .52 });
  const abdomenTiny = [];
  for (let i = 0; i < 10; i++) {
    abdomenTiny.push([-.3, .56 - i * .012, -.35 - i * .16], [.3, .56 - i * .012, -.35 - i * .16]);
  }
  addBoltField(abdomenGroup, abdomenTiny, MATS.darkSteel, { scale: .55 });

  // caution chevron strip under thorax
  addDecal(bodyGroup, 'warning', .25, .1, [0, -.3, .64], [0, 0, 0], .82);
}

/* ============================================================
   EIGHT LEG ASSEMBLIES / FIVE-LINK MECHANICAL CHAINS
   ============================================================ */
const FEMUR_LEN = 1.12;
const TIBIA_LEN = 1.38;
const TARSUS_LEN = .40;
const ANKLE_LIFT = .455;
let LEG_GEOS = null;

function initLegGeometries() {
  LEG_GEOS = {
    hipHub: new T.CylinderGeometry(.125, .14, .19, 20),
    hipInner: new T.CylinderGeometry(.092, .10, .21, 16),
    hipRing: new T.TorusGeometry(.112, .016, 6, 28),
    hipRingOrange: new T.TorusGeometry(.138, .007, 4, 28),
    femurCore: taperedBeamGeometry(FEMUR_LEN - .08, .175, .185, .125, .13, 8),
    femurArmor: taperedBeamGeometry(.83, .335, .285, .245, .195, 8),
    femurPlate: chamferBoxGeometry(.26, .08, .34, .055, .022),
    kneeHub: new T.CylinderGeometry(.105, .105, .24, 18),
    kneeHubInner: new T.CylinderGeometry(.062, .062, .27, 14),
    kneeRing: new T.TorusGeometry(.1, .017, 6, 26),
    tibiaCore: taperedBeamGeometry(TIBIA_LEN - .05, .14, .145, .075, .085, 8),
    tibiaArmor: taperedBeamGeometry(.91, .225, .185, .115, .10, 8),
    tibiaPlate: chamferBoxGeometry(.18, .06, .38, .04, .016),
    tarsusCore: taperedBeamGeometry(TARSUS_LEN, .09, .11, .045, .06, 5),
    ankleHub: new T.CylinderGeometry(.072, .072, .15, 14),
    ankleRing: new T.TorusGeometry(.066, .012, 5, 20),
    ventPlate: chamferBoxGeometry(.17, .018, .2, .014, .005),
    jointCap: new T.CylinderGeometry(.075, .09, .04, 14)
  };
}

function buildLegs() {
  initLegGeometries();
  LEG_LAYOUT.forEach(buildLeg);
  // gait ring indicator in world coords
}

function buildLeg(layout, arrayIndex) {
  const side = layout.side, idx = arrayIndex;
  const legGroup = new T.Group();
  legGroup.name = 'LEG-MOUNT-' + layout.id;
  legGroup.position.set(layout.hip[0], layout.hip[1], layout.hip[2]);
  legRoot.add(legGroup);

  // fixed body-side hip collar
  addMesh(legGroup, LEG_GEOS.hipHub, MATS.titanium, [0, 0, 0]);
  addMesh(legGroup, new T.SphereGeometry(.18, 18, 12), MATS.ceramic, [0, .085, 0], [0, 0, 0], [1.16, .56, 1.22], { name: 'HIP-SHROUD-' + layout.id });
  addMesh(legGroup, new T.TorusGeometry(.165, .011, 5, 26), MATS.orange, [0, .055, 0], [Math.PI / 2, 0, 0], [1, 1, 1], { detail: true });
  addMesh(legGroup, LEG_GEOS.hipRing, MATS.steel, [0, .088, 0], [Math.PI / 2, 0, 0], [1, 1, 1], { detail: true });
  addMesh(legGroup, LEG_GEOS.hipRingOrange, MATS.orange, [0, .102, 0], [Math.PI / 2, 0, 0], [1, 1, 1], { detail: true });
  addBoltField(legGroup, (() => {
    const a = [];
    for (let i = 0; i < 8; i++) { const t = i / 8 * TAU; a.push([Math.cos(t) * .108, .108, Math.sin(t) * .108]); }
    return a;
  })(), MATS.steel, { scale: .55 });

  const yaw = new T.Group();
  yaw.name = 'COXA-' + layout.id;
  legGroup.add(yaw);
  addMesh(yaw, LEG_GEOS.hipInner, MATS.darkSteel, [0, 0, 0]);
  addMesh(yaw, new T.CylinderGeometry(.082, .094, .07, 14), MATS.orange, [0, .12, 0], [0, 0, 0], [1, 1, 1], { detail: true });
  addGear(yaw, .084, 14, .024, MATS.brass, [side * .095, .01, 0], 'y', .7);
  addJointAxes(yaw, .21);

  const femur = new T.Group();
  femur.name = 'FEMUR-' + layout.id;
  yaw.add(femur);
  // dark load-bearing spar
  addMesh(femur, LEG_GEOS.femurCore, MATS.titanium, [0, 0, .04]);
  // white upper shell with an exposed dark underside
  addMesh(femur, LEG_GEOS.femurArmor, MATS.ceramic, [0, .055, .12], [0, 0, 0], [1, 1, 1], { name: 'FEMUR-ARMOR-' + layout.id });
  addMesh(femur, chamferBoxGeometry(.24, .035, .4, .03, .012), MATS.ceramicShade, [0, .18, .37], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(femur, chamferBoxGeometry(.05, .018, .38, .01, .004), MATS.orange, [0, .238, .5], [0, 0, 0], [1, 1, 1], { detail: true });
  // longitudinal side accent
  addMesh(femur, chamferBoxGeometry(.012, .045, .4, .006, .002), MATS.orange,
    [side * .168, .12, .48], [0, 0, side * -.04], [1, 1, 1], { detail: true });
  // femur shoulder plates
  addMesh(femur, LEG_GEOS.femurPlate, MATS.ceramicWarm, [side * .11, .06, .13], [0, side * .04, 0]);
  addMesh(femur, chamferBoxGeometry(.04, .035, .14, .012, .004), MATS.orange, [side * .145, .095, .68], [0, 0, side * .08], [1, 1, 1], { detail: true });
  addVent(femur, { pos: [0, .245, .84], rot: [Math.PI / 2, 0, 0], width: .18, count: 5, spacing: .021, material: MATS.darkSteel });
  // femur fasteners
  const femurBolts = [];
  for (let i = 0; i < 6; i++) {
    const z = .22 + i * .13;
    femurBolts.push({ p: [-.155, .105, z], r: [0, 0, Math.PI / 2] }, { p: [.155, .105, z], r: [0, 0, Math.PI / 2] });
  }
  femurBolts.push([-.08, .256, .2], [.08, .256, .2], [-.08, .245, .72], [.08, .245, .72]);
  addBoltField(femur, femurBolts, MATS.steel, { scale: .63 });
  addDecal(femur, 'leg', .105, .055, [side * .174, .11, .52], [0, side * Math.PI / 2, 0], .72);
  addCable(femur, [[side * -.12, -.07, .05], [side * -.16, -.1, .4], [side * -.11, -.05, .9], [0, -.04, 1.04]], .011, MATS.rubber);

  // hydraulic anchor on femur
  const anchorFemurLocal = new T.Vector3(side * .18, .12, .31);
  addMesh(femur, new T.CylinderGeometry(.045, .045, .08, 10), MATS.darkSteel, [anchorFemurLocal.x, anchorFemurLocal.y, anchorFemurLocal.z], [0, 0, Math.PI / 2]);
  addMesh(femur, new T.SphereGeometry(.045, 10, 8), MATS.polished, [anchorFemurLocal.x, anchorFemurLocal.y, anchorFemurLocal.z], [0, 0, 0], [1, 1, 1], { detail: true });

  // knee axle, bearing ring, gearbox covers
  addMesh(femur, LEG_GEOS.kneeHub, MATS.titanium, [0, 0, FEMUR_LEN], [0, 0, Math.PI / 2]);
  addMesh(femur, LEG_GEOS.kneeRing, MATS.orange, [side * .118, 0, FEMUR_LEN], [0, Math.PI / 2, 0], [1, 1, 1], { detail: true });
  addMesh(femur, new T.CylinderGeometry(.082, .082, .04, 16), MATS.polished, [side * .121, 0, FEMUR_LEN], [0, 0, Math.PI / 2], [1, 1, 1], { detail: true });
  addMesh(femur, new T.CylinderGeometry(.082, .095, .045, 16), MATS.ceramic, [side * .137, 0, FEMUR_LEN], [0, 0, Math.PI / 2], [1, 1, 1], { name: 'KNEE-CAP-' + layout.id });
  addMesh(femur, new T.TorusGeometry(.058, .008, 5, 22), MATS.orange, [side * .161, 0, FEMUR_LEN], [0, Math.PI / 2, 0], [1, 1, 1], { detail: true });
  const kneeGear = addGear(femur, .105, 16, .028, MATS.brass, [-side * .147, 0, FEMUR_LEN], 'x', 1.1);
  // knee service plate
  addMesh(femur, chamferBoxGeometry(.22, .085, .21, .04, .016), MATS.ceramicWarm, [0, .135, FEMUR_LEN - .16], [0, 0, 0]);
  addBoltField(femur, [[-.075, .183, FEMUR_LEN - .21], [.075, .183, FEMUR_LEN - .21], [-.075, .183, FEMUR_LEN - .1], [.075, .183, FEMUR_LEN - .1]], MATS.steel, { scale: .55 });

  // tibia
  const tibia = new T.Group();
  tibia.name = 'TIBIA-' + layout.id;
  tibia.position.z = FEMUR_LEN;
  femur.add(tibia);
  addJointAxes(tibia, .19);
  addMesh(tibia, LEG_GEOS.tibiaCore, MATS.titanium, [0, 0, .015]);
  addMesh(tibia, LEG_GEOS.tibiaArmor, MATS.ceramic, [0, .035, .08], [0, 0, 0], [1, 1, 1], { name: 'TIBIA-ARMOR-' + layout.id });
  addMesh(tibia, LEG_GEOS.tibiaPlate, MATS.ceramicWarm, [side * .055, .08, .26], [0, side * .03, .02]);
  addMesh(tibia, chamferBoxGeometry(.22, .05, .3, .03, .01), MATS.ceramicShade, [0, .07, .84]);
  addMesh(tibia, chamferBoxGeometry(.032, .014, .32, .008, .003), MATS.orange, [0, .148, .62], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(tibia, chamferBoxGeometry(.01, .028, .4, .005, .002), MATS.orange, [side * .112, .055, .5], [0, 0, 0], [1, 1, 1], { detail: true });
  addVent(tibia, { pos: [0, .155, .92], rot: [Math.PI / 2, 0, 0], width: .16, count: 5, spacing: .018, material: MATS.darkSteel });
  addVent(tibia, { pos: [side * .12, .02, .43], rot: [0, side * Math.PI / 2, 0], width: .18, count: 4, spacing: .02, material: MATS.darkSteel });
  const tibiaBolts = [];
  for (let i = 0; i < 7; i++) {
    const z = .17 + i * .13;
    tibiaBolts.push({ p: [-.102, .055, z], r: [0, 0, Math.PI / 2] }, { p: [.102, .055, z], r: [0, 0, Math.PI / 2] });
  }
  tibiaBolts.push([-.055, .171, .5], [.055, .171, .5]);
  addBoltField(tibia, tibiaBolts, MATS.steel, { scale: .55 });
  addCable(tibia, [[side * -.075, -.045, .06], [side * -.09, -.065, .38], [side * -.055, -.04, .8], [0, -.03, 1.22]], .0085, MATS.rubber);
  // tibia-side hydraulic anchor
  const anchorTibiaLocal = new T.Vector3(side * .15, .055, .42);
  addMesh(tibia, new T.CylinderGeometry(.04, .04, .07, 10), MATS.darkSteel, [anchorTibiaLocal.x, anchorTibiaLocal.y, anchorTibiaLocal.z], [0, 0, Math.PI / 2]);
  addMesh(tibia, new T.SphereGeometry(.04, 10, 8), MATS.polished, [anchorTibiaLocal.x, anchorTibiaLocal.y, anchorTibiaLocal.z], [0, 0, 0], [1, 1, 1], { detail: true });

  // ankle joint
  addMesh(tibia, LEG_GEOS.ankleHub, MATS.titanium, [0, 0, TIBIA_LEN], [0, 0, Math.PI / 2]);
  addMesh(tibia, LEG_GEOS.ankleRing, MATS.orange, [side * .08, 0, TIBIA_LEN], [0, Math.PI / 2, 0], [1, 1, 1], { detail: true });
  addGear(tibia, .062, 12, .02, MATS.darkSteel, [-side * .082, 0, TIBIA_LEN], 'x', -1.8);

  // tarsus / foot
  const tarsus = new T.Group();
  tarsus.name = 'TARSUS-' + layout.id;
  tarsus.position.z = TIBIA_LEN;
  tibia.add(tarsus);
  addMesh(tarsus, new T.CylinderGeometry(.082, .09, .16, 12), MATS.titanium, [0, 0, .04], [0, 0, Math.PI / 2], [1, 1, 1], { detail: false });
  addMesh(tarsus, LEG_GEOS.tarsusCore, MATS.titaniumSoft, [0, 0, .02]);
  addMesh(tarsus, chamferBoxGeometry(.15, .07, .19, .03, .012), MATS.ceramicWarm, [0, .02, .11]);
  addMesh(tarsus, chamferBoxGeometry(.12, .017, .09, .01, .003), MATS.orange, [0, .063, .12], [0, 0, 0], [1, 1, 1], { detail: true });
  const clawGroup = new T.Group();
  tarsus.add(clawGroup);
  const clawPtsA = [[-.02, 0, .34], [-.055, -.02, .4], [-.075, -.07, .47]];
  const clawPtsB = [[.02, 0, .34], [.055, -.02, .4], [.075, -.07, .47]];
  addMesh(clawGroup, taperedTubeGeometry(clawPtsA, .026, .002, 6, 12), MATS.darkSteel, [0, 0, 0]);
  addMesh(clawGroup, taperedTubeGeometry(clawPtsB, .026, .002, 6, 12), MATS.darkSteel, [0, 0, 0]);
  addMesh(clawGroup, new T.CylinderGeometry(.072, .085, .07, 12), MATS.rubberSoft, [0, 0, .355], [0, 0, 0], [1, 1, 1], { detail: true });
  addMesh(clawGroup, new T.SphereGeometry(.052, 10, 7), MATS.rubber, [0, -.025, .365], [0, 0, 0], [1, .55, 1], { detail: true });
  addMesh(clawGroup, new T.ConeGeometry(.013, .06, 5), MATS.orange, [-.045, -.01, .43], [0, 0, .3], [1, 1, 1], { detail: true });
  addMesh(clawGroup, new T.ConeGeometry(.013, .06, 5), MATS.orange, [.045, -.01, .43], [0, 0, -.3], [1, 1, 1], { detail: true });

  // hydraulic damper group (updated between anchors)
  const pistonGroup = new T.Group();
  yaw.add(pistonGroup);
  const pBodyGeo = new T.CylinderGeometry(.036, .04, 1, 12);
  const pRodGeo = new T.CylinderGeometry(.019, .019, 1, 10);
  const pBody = addMesh(pistonGroup, pBodyGeo, MATS.titanium, [0, 0, 0], [0, 0, 0], [1, .5, 1]);
  const pRod = addMesh(pistonGroup, pRodGeo, MATS.polished, [0, 0, 0], [0, 0, 0], [1, .4, 1], { detail: true });
  const pCollar = addMesh(pistonGroup, new T.CylinderGeometry(.048, .048, .045, 12), MATS.orange, [0, 0, 0], [0, 0, 0], [1, 1, 1], { detail: true });
  const pEnd = addMesh(pistonGroup, new T.CylinderGeometry(.03, .03, .035, 10), MATS.darkSteel, [0, 0, 0], [0, 0, 0], [1, 1, 1], { detail: true });
  pistonGroup.userData = { body: pBody, rod: pRod, collar: pCollar, end: pEnd };

  // bearing balls at knee and ankle
  const kballs = [], aballs = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU;
    kballs.push([side * .122, Math.cos(a) * .062, FEMUR_LEN + Math.sin(a) * .062]);
    aballs.push([side * .078, Math.cos(a) * .044, TIBIA_LEN + Math.sin(a) * .044]);
  }
  addBoltField(femur, kballs, MATS.polished, { scale: .52 });
  addBoltField(tibia, aballs, MATS.polished, { scale: .46 });

  const leg = {
    id: layout.id, side, layout, group: legGroup, yaw, femur, tibia, tarsus,
    L1: FEMUR_LEN, L2: TIBIA_LEN, tarsusLen: TARSUS_LEN,
    model: null, targetWorld: new T.Vector3(), footWorld: new T.Vector3(),
    plantedWorld: new T.Vector3(), swingFrom: new T.Vector3(), swingTo: new T.Vector3(),
    swinging: false, swingStart: 0, swingProgress: 0, gaitGroup: layout.group,
    hip: new T.Vector3(layout.hip[0], layout.hip[1], layout.hip[2]),
    restLocal: new T.Vector3(layout.foot[0], 0, layout.foot[2]),
    theta1: 0, theta2: 0, yawAngle: 0, variant: idx,
    anchorFemurLocal, anchorTibiaLocal, pistonGroup, kneeGear, footContact: false,
    gearboxes: [], claws: clawGroup
  };
  // set initial world target and solved pose
  const f = bodyGroup.localToWorld(new T.Vector3(layout.foot[0], 0, layout.foot[2]));
  leg.footWorld.copy(f); leg.plantedWorld.copy(f); leg.targetWorld.copy(f);
  solveLegIK(leg, f);
  updatePiston(leg);
  LEGS.push(leg);

  // register part after full construction, then specialized clickable subassemblies
  tagPart(legGroup, 'leg_' + layout.id);
  assignSubpart(clawGroup, 'claw', 'Tarsal Contact Claw — ' + layout.id);
  assignSubpart(pistonGroup, 'hydraulic', 'Hydraulic Damper — ' + layout.id);
  assignSubpart(kneeGear, 'gearbox', 'Knee Planetary Gearbox — ' + layout.id);
}

/* ============================================================
   KINEMATICS / GAIT / BODY DYNAMICS
   ============================================================ */
const BODY_STATE = {
  y: BODY_BASE_Y, yVel: 0, pitch: 0, pitchVel: 0, roll: 0, rollVel: 0,
  shadowY: BODY_BASE_Y, activeGroup: null
};
const gaitHistory = { lastPhase: 0, cycles: 0 };

function footTargetsFor(leg, out) {
  const def = MODE_DEFS[SIM.mode];
  const spread = def.spread ?? 1;
  const hip = leg.layout.hip;
  let x = hip[0] + (leg.layout.foot[0] - hip[0]) * spread;
  let z = hip[2] + (leg.layout.foot[2] - hip[2]) * spread;
  let y = 0;
  const pair = leg.variant % 4;
  const frontFactor = [1, .62, .22, 0][pair];
  if (def.frontRaise) {
    y += def.frontRaise * frontFactor;
    z += frontFactor * .2;
    x += leg.side * frontFactor * (modeIsDefensive() ? .2 : .06);
  }
  if (leg.manualOverride) {
    const hipW = bodyGroup.localToWorld(new T.Vector3(hip[0], hip[1], hip[2]));
    const baseDir = new T.Vector3(leg.layout.foot[0] - hip[0], 0, leg.layout.foot[2] - hip[2]);
    const baseAngle = Math.atan2(baseDir.x, baseDir.z);
    const angle = baseAngle + SIM.manualYaw * DEG;
    const radius = baseDir.length() * SIM.manualReach;
    x = hipW.x + Math.sin(angle) * radius;
    z = hipW.z + Math.cos(angle) * radius;
    y = SIM.manualLift;
  } else {
    x += bodyGroup.position.x;
    z += bodyGroup.position.z;
    if (!def.pose && SIM.playing) {
      const dir = SIM.mode === 'sideways' ? -1 : 1;
      if (SIM.mode === 'sideways') x += dir * def.speed * def.stride * .48;
      else z += dir * def.speed * def.stride * .48;
    }
  }
  out.set(x, y, z);
  return out;
}

function modeIsDefensive() { return SIM.mode === 'defense'; }

function solveLegIK(leg, footWorld) {
  bodyGroup.updateWorldMatrix(true, false);
  const local = bodyGroup.worldToLocal(tmpV1.copy(footWorld));
  const hip = leg.layout.hip;
  const dx = local.x - hip[0];
  const dz = local.z - hip[2];
  const horizontal = Math.max(.001, Math.hypot(dx, dz));
  const yaw = Math.atan2(dx, dz);
  leg.yaw.rotation.y = yaw;
  const ankleY = local.y + ANKLE_LIFT;
  const dy = ankleY - hip[1];
  const rawDist = Math.hypot(horizontal, dy);
  const maxD = leg.L1 + leg.L2 - .018;
  const d = clamp(rawDist, .38, maxD);
  const phi = Math.atan2(dy, horizontal);
  const cosA = clamp((leg.L1 * leg.L1 + d * d - leg.L2 * leg.L2) / (2 * leg.L1 * d), -1, 1);
  const cosB = clamp((leg.L1 * leg.L1 + leg.L2 * leg.L2 - d * d) / (2 * leg.L1 * leg.L2), -1, 1);
  const alpha = Math.acos(cosA);
  const beta = Math.acos(cosB);
  const theta1 = phi + alpha;
  // elbow-up two-link solution, angles measured above the local horizontal
  const theta2 = theta1 - Math.PI + beta;
  leg.femur.rotation.x = -theta1;
  leg.tibia.rotation.x = theta1 - theta2;
  // tarsus stays vertical so the contact claw meets the floor plane
  leg.tarsus.rotation.x = Math.PI / 2 - .1;
  leg.theta1 = theta1;
  leg.theta2 = theta2;
  leg.yawAngle = yaw;
  leg.reachClamped = rawDist > maxD;
}

function rotateXVec(v, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new T.Vector3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

function updatePiston(leg) {
  const a = rotateXVec(leg.anchorFemurLocal, -leg.theta1);
  const knee = new T.Vector3(0, Math.sin(leg.theta1) * leg.L1, Math.cos(leg.theta1) * leg.L1);
  const bLocal = rotateXVec(leg.anchorTibiaLocal, -leg.theta2);
  const b = knee.add(bLocal);
  const ab = tmpV2.copy(b).sub(a);
  const dist = Math.max(.12, ab.length());
  const group = leg.pistonGroup;
  const ud = group.userData;
  group.position.copy(a).add(b).multiplyScalar(.5);
  group.quaternion.setFromUnitVectors(Y_AXIS, ab.normalize());
  const bodyLen = Math.min(dist * .62, .55);
  const rodLen = Math.min(dist * .62, .52);
  ud.body.scale.set(1, bodyLen, 1);
  ud.body.position.set(0, -dist / 2 + bodyLen / 2, 0);
  ud.rod.scale.set(1, rodLen, 1);
  ud.rod.position.set(0, dist / 2 - rodLen / 2, 0);
  ud.collar.position.set(0, -dist / 2 + bodyLen * .84, 0);
  ud.end.position.set(0, dist / 2 - .01, 0);
}

function startSwing(leg, target) {
  leg.swinging = true;
  leg.swingProgress = 0;
  leg.swingFrom.copy(leg.footWorld);
  leg.swingTo.copy(target);
  leg.swingLift = (MODE_DEFS[SIM.mode].lift + .04) * SIM.gaitLift;
  leg.swingDuration = Math.max(.12, Math.min(MODE_DEFS[SIM.mode].swing, .40 / Math.max(.6, MODE_DEFS[SIM.mode].freq * SIM.gaitFreq)));
}

function triggerGaitGroup(group) {
  if (!SIM.gaitGovernor) return;
  LEGS.forEach(leg => {
    if (leg.gaitGroup !== group || leg.swinging) return;
    const target = footTargetsFor(leg, new T.Vector3());
    leg.plantedWorld.copy(leg.footWorld);
    startSwing(leg, target);
  });
}

function updateLocomotion(dt, dtSim) {
  const def = MODE_DEFS[SIM.mode];
  const canMove = !def.pose && SIM.playing && SIM.tab !== 'exploded' && SIM.tab !== 'blueprint' && !SIM.manual && !SIM.scrubbing && !explosionIsActive();
  const moving = canMove && SIM.mode !== 'idle';
  const targetSpeed = canMove ? def.speed : 0;
  currentMode.speed = lerp(currentMode.speed, targetSpeed, 1 - Math.exp(-dt * 3.5));

  // body translation follows the gait bus
  if (moving && currentMode.speed > .001) {
    if (SIM.mode === 'sideways') {
      bodyGroup.position.x -= currentMode.speed * dtSim;
      SIM.distance += currentMode.speed * dtSim;
    } else {
      bodyGroup.position.z += currentMode.speed * dtSim;
      SIM.distance += currentMode.speed * dtSim;
    }
  }

  // advance gait phase
  if (SIM.playing && !def.pose && !SIM.manual) {
    const prevPhase = SIM.gaitPhase;
    SIM.gaitPhase = (SIM.gaitPhase + dtSim * def.freq * SIM.gaitFreq) % 1;
    const group = SIM.gaitPhase < .5 ? 'A' : 'B';
    const crossed = SIM.gaitPhase < prevPhase;
    if (moving && (group !== BODY_STATE.activeGroup || crossed)) {
      BODY_STATE.activeGroup = group;
      triggerGaitGroup(group);
    }
  }
}

function updateFeet(dt, dtSim) {
  const def = MODE_DEFS[SIM.mode];
  LEGS.forEach(leg => {
    leg.manualOverride = SIM.manual && leg.id === SIM.manualLeg;
    footTargetsFor(leg, leg.targetWorld);
    if (SIM.manual) {
      if (leg.manualOverride) {
        // direct, softly-sprung manual placement
        const target = leg.targetWorld;
        const k = 1 - Math.exp(-Math.min(dt, .05) * 10);
        leg.footWorld.x = lerp(leg.footWorld.x, target.x, k);
        leg.footWorld.y = lerp(leg.footWorld.y, target.y, k);
        leg.footWorld.z = lerp(leg.footWorld.z, target.z, k);
      }
      leg.swinging = false;
      leg.plantedWorld.copy(leg.footWorld);
      return;
    }
    leg.manualOverride = false;
    if (def.pose) {
      leg.swinging = false;
      // pose feet settle with a gentle embedded spring, preserving plant
      const k = 1 - Math.exp(-Math.min(dt, .05) * (SIM.playing ? 5.5 : 1.6));
      leg.footWorld.x = lerp(leg.footWorld.x, leg.targetWorld.x, k);
      leg.footWorld.z = lerp(leg.footWorld.z, leg.targetWorld.z, k);
      leg.footWorld.y = lerp(leg.footWorld.y, leg.targetWorld.y, k);
      leg.plantedWorld.copy(leg.footWorld);
      return;
    }
    if (leg.swinging) {
      leg.swingProgress += dtSim / leg.swingDuration;
      if (leg.swingProgress >= 1) {
        leg.swingProgress = 1;
        leg.swinging = false;
        leg.footWorld.copy(leg.swingTo);
        leg.plantedWorld.copy(leg.swingTo);
      } else {
        const p = leg.swingProgress;
        const s = p * p * (3 - 2 * p);
        leg.footWorld.lerpVectors(leg.swingFrom, leg.swingTo, s);
        leg.footWorld.y += Math.sin(p * Math.PI) * leg.swingLift;
      }
    } else {
      leg.footWorld.copy(leg.plantedWorld);
      // ungoverned mode: independent opportunistic steps
      if (!SIM.gaitGovernor && SIM.playing && !def.pose && def.speed > 0) {
        const err = leg.targetWorld.distanceTo(leg.footWorld);
        if (err > def.stride * SIM.gaitStride * .38 && (SIM.gaitPhase < .5) === (leg.gaitGroup === 'A')) {
          startSwing(leg, leg.targetWorld);
        }
      } else if (SIM.gaitGovernor && !def.pose && SIM.playing && def.speed > 0) {
        const err = leg.targetWorld.distanceTo(leg.footWorld);
        if (err > def.stride * SIM.gaitStride * 1.9) {
          leg.plantedWorld.copy(leg.footWorld);
        }
      }
    }
  });
}

function updateBody(dt, dtSim) {
  const def = MODE_DEFS[SIM.mode];
  const smooth = 1 - Math.exp(-dt * 2.7);
  ['freq', 'stride', 'lift', 'bodyY', 'pitch', 'spread', 'frontRaise', 'fangOpen'].forEach(k => {
    const t = def[k] ?? 0;
    currentMode[k] = lerp(currentMode[k], t, smooth);
  });

  const moving = !def.pose && SIM.playing && SIM.tab !== 'exploded' && SIM.tab !== 'blueprint' && !SIM.manual && !SIM.scrubbing && !explosionIsActive();
  const speedFactor = moving ? clamp(currentMode.speed / .4, 0, 2.4) : 0;
  const gaitBob = Math.sin(SIM.gaitPhase * TAU * 2) * .017 * speedFactor;
  const idleBreath = Math.sin(SIM.time / SIM.duration * TAU * 2) * .0075;
  const defenseTremor = SIM.mode === 'defense' ? Math.sin(SIM.time * 11) * .004 : 0;
  const targetY = BODY_BASE_Y + currentMode.bodyY + gaitBob + idleBreath + defenseTremor;
  const py = springValue(BODY_STATE.y, BODY_STATE.yVel, targetY, 9, dt);
  BODY_STATE.y = py[0]; BODY_STATE.yVel = py[1];
  bodyGroup.position.y = BODY_STATE.y;

  const targetPitch = currentMode.pitch + (SIM.mode === 'dash' ? Math.sin(SIM.gaitPhase * TAU) * .012 : 0);
  const pp = springValue(BODY_STATE.pitch, BODY_STATE.pitchVel, targetPitch, 7, dt);
  BODY_STATE.pitch = pp[0]; BODY_STATE.pitchVel = pp[1];
  bodyGroup.rotation.x = BODY_STATE.pitch;
  const targetRoll = moving ? Math.sin(SIM.gaitPhase * TAU) * .018 * speedFactor : 0;
  BODY_STATE.roll = lerp(BODY_STATE.roll, targetRoll, 1 - Math.exp(-dt * 5));
  bodyGroup.rotation.z = BODY_STATE.roll;

  // ground tracking apparatus
  const cx = bodyGroup.position.x, cz = bodyGroup.position.z;
  groundRing.position.x = cx; groundRing.position.z = cz;
  contactShadow.position.x = cx; contactShadow.position.z = cz;
  contactShadow.material.opacity = .72 + clamp((BODY_STATE.y - .7) * -.12, -.08, .08);
  const extracted = explosionIsActive();
  footShadows.forEach((fs, i) => {
    const leg = LEGS[i];
    if (!leg) return;
    const clearance = clamp(leg.footWorld.y, 0, .8);
    fs.visible = !extracted;
    fs.position.set(leg.footWorld.x, .0075, leg.footWorld.z);
    fs.material.opacity = .58 * Math.pow(1 - clearance / .8, 1.6);
    const s = .82 + clearance * .55;
    fs.scale.set(s, s, 1);
  });
  if (def.pose) groundRing.rotation.y = lerp(groundRing.rotation.y, 0, .02);
}

function updateSecondary(dt) {
  const t = SIM.time;
  const loop = t / SIM.duration;
  const fangOpen = currentMode.fangOpen;
  if (fangLGroup) {
    fangLGroup.rotation.x = -.05 - fangOpen * .19;
    fangLGroup.rotation.z = .035 + fangOpen * .14;
    fangRGroup.rotation.x = -.05 - fangOpen * .19;
    fangRGroup.rotation.z = -.035 - fangOpen * .14;
  }
  if (pedipalpL && pedipalpR) {
    [pedipalpL, pedipalpR].forEach((p, i) => {
      const anim = p.userData.anim;
      const ph = anim.phase;
      const idle = Math.sin(loop * TAU * 3 + ph) * .035;
      const raised = (SIM.mode === 'defense' ? .22 : SIM.mode === 'climb' ? .12 : 0);
      anim.elbow.rotation.x = .72 + idle * .3 - raised;
      anim.wrist.rotation.x = -.45 + Math.sin(loop * TAU * 2 + ph + .8) * .04;
      anim.base.rotation.y = anim.side * .29 + Math.sin(loop * TAU * 2 + ph) * .025;
    });
  }
  if (eyeGroup) {
    const scan = Math.sin(loop * TAU * 2 + .7) * .035 + Math.sin(loop * TAU * 5) * .012;
    eyeGroup.rotation.y = scan;
    eyeGroup.rotation.x = Math.sin(loop * TAU * 3) * .008;
  }
  if (abdomenGroup) {
    const breath = Math.sin(loop * TAU * 4);
    abdomenGroup.rotation.x = -.012 + breath * .006;
    abdomenGroup.scale.set(1, 1 + breath * .006, 1);
  }
  if (antennaGroup) {
    antennaGroup.children.forEach((a, i) => {
      a.rotation.x = -.58 + Math.sin(loop * TAU * 4 + i * 1.4) * .014;
      a.rotation.z = (i ? 1 : -1) * .13 + Math.sin(loop * TAU * 3 + i) * .012;
    });
  }
  // geared mechanisms move with authoritative sim time; loop-locked revolutions avoid snaps
  animatedGears.forEach((g, i) => {
    const rev = Math.max(1, Math.round(Math.abs(g.spin) * 5));
    const sign = g.spin < 0 ? -1 : 1;
    g.mesh.rotation.z = loop * TAU * rev * sign + i * .73;
  });
  internalsSpinners.forEach((s, i) => {
    s.rotation.z = loop * TAU * (i + 1) * 3;
  });
  eyeGlows.forEach((lens, i) => {
    const pulse = .85 + Math.sin(loop * TAU * 5 + i) * .15;
    lens.material.emissiveIntensity = 2.35 + Math.sin(loop * TAU * 4 + i * .7) * .35;
  });
}

function applyScrubPose() {
  const def = MODE_DEFS[SIM.mode];
  if (def.pose || SIM.manual || explosionIsActive()) return;
  LEGS.forEach(leg => {
    footTargetsFor(leg, leg.targetWorld);
    const stride = def.stride * SIM.gaitStride;
    const cycle = ((SIM.time / SIM.duration) * 3.2 + (leg.gaitGroup === 'A' ? 0 : .5)) % 1;
    let offset, lift = 0;
    if (cycle < .64) {
      offset = stride * (.5 - cycle / .64);
    } else {
      const u = (cycle - .64) / .36;
      offset = stride * (u - .5);
      lift = Math.sin(u * Math.PI) * def.lift * SIM.gaitLift;
    }
    const target = leg.targetWorld;
    if (SIM.mode === 'sideways') target.x -= offset; else target.z += offset;
    target.y += lift;
    leg.footWorld.copy(target);
    leg.plantedWorld.set(target.x, 0, target.z);
    leg.swinging = false;
  });
}

function updateSimulation(dt) {
  const dtSim = SIM.playing ? Math.min(dt, .05) * SIM.speed : 0;
  if (SIM.playing) {
    SIM.time += dtSim;
    if (SIM.time >= SIM.duration) SIM.time -= SIM.duration;
  }
  // dynamic state values (design telemetry)
  const def = MODE_DEFS[SIM.mode];
  const moving = !def.pose && SIM.playing && !SIM.manual && !explosionIsActive() && !SIM.scrubbing;
  const targetLoad = def.load + (moving ? Math.sin(SIM.time * 3.2) * 3 : 0);
  SIM.motorLoad = lerp(SIM.motorLoad, targetLoad, 1 - Math.exp(-dt * 2.2));
  SIM.coreTemp = lerp(SIM.coreTemp, 38 + SIM.motorLoad * .38, 1 - Math.exp(-dt * .18));
  SIM.hydraulic = 68 + Math.sin(SIM.time * 2.1) * 6 + (moving ? 8 : 0);
  SIM.power = clamp(SIM.power - dtSim * (def.pose ? .0007 : .0045), 18, 100);

  updateLocomotion(dt, dtSim);
  if (explosionIsActive()) {
    // extracted assemblies keep their last local joint pose as they separate
  } else {
    updateFeet(dt, dtSim);
    if (SIM.scrubbing) applyScrubPose();
    updateBody(dt, dtSim);
    LEGS.forEach(leg => {
      solveLegIK(leg, leg.footWorld);
      updatePiston(leg);
      leg.footContact = leg.footWorld.y < .015 && !leg.swinging;
    });
  }
  updateSecondary(dt);
}

/* -------- projection / camera rig -------- */
const ORBIT = {
  theta: .60, phi: 1.16, dist: 10.2,
  thetaGoal: .60, phiGoal: 1.16, distGoal: 10.2,
  thetaVel: 0, phiVel: 0, distVel: 0,
  orthoSize: 3.15, orthoGoal: 3.15, orthoVel: 0,
  target: new T.Vector3(0, .88, 0),
  targetGoal: new T.Vector3(0, .88, 0),
  targetVel: new T.Vector3(), targetVelY: 0,
  panOffset: new T.Vector3(),
  focusObject: null, focusBox: new T.Box3(), focusAt: 0, focusRadius: 1,
  dragging: false, lastInteraction: 0, panning: false, dragDistance: 0
};

const CAM_PRESETS = {
  iso: { theta: .60, phi: 1.16, dist: 10.2, ortho: 3.25, label: 'ISOMETRIC' },
  front: { theta: 0, phi: 1.50, dist: 10.2, ortho: 2.55, label: 'FRONT' },
  side: { theta: Math.PI / 2, phi: 1.50, dist: 10.4, ortho: 2.7, label: 'SIDE' },
  top: { theta: 0, phi: .085, dist: 10.6, ortho: 3.1, label: 'TOP' },
  rear: { theta: Math.PI, phi: 1.50, dist: 10.2, ortho: 2.55, label: 'REAR' },
  reset: { theta: .60, phi: 1.16, dist: 10.2, ortho: 3.25, label: 'ISOMETRIC' }
};

function setView(name, quiet = false) {
  const preset = CAM_PRESETS[name] || CAM_PRESETS.reset;
  ORBIT.thetaGoal = preset.theta;
  ORBIT.phiGoal = preset.phi;
  ORBIT.distGoal = preset.dist;
  ORBIT.orthoGoal = preset.ortho;
  ORBIT.panOffset.set(0, 0, 0);
  ORBIT.focusObject = null;
  ORBIT.lastInteraction = performance.now();
  SIM.blueprintView = name === 'reset' ? 'iso' : name;
  $$('.cam-btn').forEach(b => b.classList.toggle('active', b.dataset.camera === (name === 'reset' ? 'iso' : name) || (name === 'reset' && b.dataset.camera === 'reset')));
  $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.bpView === SIM.blueprintView));
  $$('.view-sketch').forEach(b => b.classList.toggle('active', b.dataset.camera === name));
  if (!quiet) toast((preset.label || name).toUpperCase() + ' VIEW');
  updateProjectionMode();
}

function setProjectionMode(mode) {
  SIM.projection = mode;
  activeCamera = mode === 'ortho' ? orthoCamera : perspectiveCamera;
  const tag = $('#cameraModeTag');
  if (tag) tag.textContent = mode === 'ortho' ? 'ORTHOGRAPHIC' : 'PERSPECTIVE';
  const bpTag = $('#bpTag');
  if (bpTag) bpTag.textContent = (SIM.blueprintView || 'iso').toUpperCase() + ' / AR-08-01 / SCALE 1:8';
}
function updateProjectionMode() {
  setProjectionMode(SIM.tab === 'blueprint' ? 'ortho' : 'persp');
}

function focusObjectInView(object, radius) {
  if (!object) return;
  ORBIT.focusObject = object;
  ORBIT.focusRadius = Math.max(.28, radius || .8);
  ORBIT.focusAt = 0;
  ORBIT.lastInteraction = performance.now();
  const half = Math.tan(perspectiveCamera.fov * .5 * DEG);
  ORBIT.distGoal = clamp(ORBIT.focusRadius / half * 1.28, 2.2, 12.5);
  ORBIT.orthoGoal = clamp(ORBIT.focusRadius * 1.85, 1.1, 4.3);
  ORBIT.panOffset.set(0, 0, 0);
}

function focusPart(id, label) {
  const root = partObjects[id];
  if (!root) return;
  root.updateWorldMatrix(true, true);
  const box = new T.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new T.Sphere());
  focusObjectInView(root, sphere.radius);
  ORBIT.targetGoal.copy(sphere.center);
  setSelected(id, label || PART_DEFS[id]?.name, null);
  toast('FOCUS / ' + (label || PART_DEFS[id]?.name || id).toUpperCase());
}

function updateCamera(dt) {
  const now = performance.now();
  const idle = now - (ORBIT.lastInteraction || 0);
  if (SIM.autoRotate && !ORBIT.dragging && idle > 5200 && SIM.tab !== 'blueprint') {
    ORBIT.thetaGoal += dt * .055;
  }
  // spring the orbit angles / scale
  let r;
  r = springValue(ORBIT.theta, ORBIT.thetaVel, ORBIT.thetaGoal, 8.5, dt);
  ORBIT.theta = r[0]; ORBIT.thetaVel = r[1];
  r = springValue(ORBIT.phi, ORBIT.phiVel, ORBIT.phiGoal, 8.5, dt);
  ORBIT.phi = r[0]; ORBIT.phiVel = r[1];
  r = springValue(ORBIT.dist, ORBIT.distVel, ORBIT.distGoal, 7.0, dt);
  ORBIT.dist = r[0]; ORBIT.distVel = r[1];
  r = springValue(ORBIT.orthoSize, ORBIT.orthoVel, ORBIT.orthoGoal, 7.0, dt);
  ORBIT.orthoSize = r[0]; ORBIT.orthoVel = r[1];

  // follow the live body centre or a focused part
  let goalX, goalY, goalZ;
  if (ORBIT.focusObject) {
    ORBIT.focusAt -= dt;
    if (ORBIT.focusAt <= 0) {
      ORBIT.focusAt = .14;
      ORBIT.focusBox.setFromObject(ORBIT.focusObject);
      const c = ORBIT.focusBox.getCenter(new T.Vector3());
      ORBIT.focusBox.getBoundingSphere(new T.Sphere());
      ORBIT.targetGoal.set(c.x, c.y, c.z);
    }
    goalX = ORBIT.targetGoal.x; goalY = ORBIT.targetGoal.y; goalZ = ORBIT.targetGoal.z;
  } else {
    goalX = bodyGroup.position.x + ORBIT.panOffset.x;
    goalY = BODY_STATE.y + .18 + ORBIT.panOffset.y;
    goalZ = bodyGroup.position.z + ORBIT.panOffset.z;
  }
  const follow = 1 - Math.exp(-dt * (ORBIT.focusObject ? 5.4 : 9.0));
  ORBIT.target.x = lerp(ORBIT.target.x, goalX, follow);
  ORBIT.target.y = lerp(ORBIT.target.y, goalY, follow);
  ORBIT.target.z = lerp(ORBIT.target.z, goalZ, follow);

  const phi = clamp(ORBIT.phi, .065, 1.535);
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const dirX = sp * Math.sin(ORBIT.theta), dirY = cp, dirZ = sp * Math.cos(ORBIT.theta);
  const dist = SIM.tab === 'blueprint' ? 15 : ORBIT.dist;
  perspectiveCamera.position.set(
    ORBIT.target.x + dirX * dist,
    ORBIT.target.y + dirY * dist,
    ORBIT.target.z + dirZ * dist
  );
  perspectiveCamera.up.set(0, 1, 0);
  perspectiveCamera.lookAt(ORBIT.target);

  orthoCamera.position.set(ORBIT.target.x + dirX * 15, ORBIT.target.y + dirY * 15, ORBIT.target.z + dirZ * 15);
  orthoCamera.up.set(0, 1, 0);
  orthoCamera.lookAt(ORBIT.target);
  updateOrthoFrustum();
}

function updateOrthoFrustum() {
  const aspect = innerWidth / innerHeight;
  const fitW = (ORBIT.orthoSize * 2.05) / Math.max(.7, aspect);
  const halfH = Math.max(ORBIT.orthoSize, fitW * .5);
  orthoCamera.left = -halfH * aspect;
  orthoCamera.right = halfH * aspect;
  orthoCamera.top = halfH;
  orthoCamera.bottom = -halfH;
  orthoCamera.updateProjectionMatrix();
}

/* ============================================================
   EXPLODED ASSEMBLIES / SPRING DETACHMENT
   ============================================================ */
const EXPLODE = [];
let explodeMax = 0;

function buildExplosionSystem() {
  const defs = [
    { id: 'carapace', label: 'Cephalothorax Shell', sub: 'ARMOR / SENSOR HOUSING', group: carapaceGroup, offset: [0, .95, .10], code: 'A01' },
    { id: 'eyes', label: 'Optic Sensor Array', sub: '8-CHANNEL MULTI-SPECTRUM', group: eyeGroup, offset: [0, .46, .92], code: 'A02' },
    { id: 'fang_L', label: 'Chelicera — Left', sub: 'HYDRAULIC TOOL INTERFACE', group: fangLGroup, offset: [-.60, -.32, .48], code: 'A03' },
    { id: 'fang_R', label: 'Chelicera — Right', sub: 'HYDRAULIC TOOL INTERFACE', group: fangRGroup, offset: [.60, -.32, .48], code: 'A04' },
    { id: 'pedipalp_L', label: 'Pedipalp — Left', sub: '3-AXIS MANIPULATOR', group: pedipalpL, offset: [-.94, -.34, .55], code: 'A05' },
    { id: 'pedipalp_R', label: 'Pedipalp — Right', sub: '3-AXIS MANIPULATOR', group: pedipalpR, offset: [.94, -.34, .55], code: 'A06' },
    { id: 'abdomen', label: 'Segmented Abdomen', sub: 'POWER / STORAGE SHELL', group: abdomenGroup, offset: [0, .28, -1.34], code: 'A07' },
    { id: 'spinneret', label: 'Spinneret Cluster', sub: 'SENSOR TETHER / LINE LAYER', group: spinneretGroup, offset: [0, -.55, -1.05], code: 'A08' },
    { id: 'antenna', label: 'Dorsal Antenna Pair', sub: 'COMMUNICATION / SURVEY', group: antennaGroup, offset: [0, .82, -.38], code: 'A09' },
    { id: 'core', label: 'Power Core & Compute', sub: 'ENERGY / GAIT COMPUTER', group: internalsGroup, offset: [0, .34, .46], code: 'A10' }
  ];
  defs.forEach(d => {
    if (!d.group) return;
    d.base = d.group.position.clone();
    d.p = 0; d.v = 0; d.on = true;
    d.group.updateWorldMatrix(true, true);
    const box = new T.Box3().setFromObject(d.group);
    const c = box.getCenter(new T.Vector3());
    d.centerLocal = d.group.worldToLocal(c.clone());
    d.sphere = box.getBoundingSphere(new T.Sphere());
    EXPLODE.push(d);
  });
  LEGS.forEach((leg, i) => {
    const l = leg.layout;
    const d = {
      id: 'leg_' + leg.id, label: 'Leg Assembly — ' + leg.id, sub: '5-AXIS LOCOMOTION CHAIN',
      group: leg.group, offset: [l.side * 1.28, .46, l.hip[2] * .34], code: 'L' + String(i + 1).padStart(2, '0'),
      base: leg.group.position.clone(), p: 0, v: 0, on: true, isLeg: true
    };
    leg.group.updateWorldMatrix(true, true);
    const box = new T.Box3().setFromObject(leg.group);
    const c = box.getCenter(new T.Vector3());
    d.centerLocal = leg.group.worldToLocal(c.clone());
    d.sphere = box.getBoundingSphere(new T.Sphere());
    EXPLODE.push(d);
  });
}

function updateExplosion(dt) {
  explodeMax = 0;
  const amount = clamp(SIM.explodedAmt, 0, 1);
  EXPLODE.forEach(d => {
    const target = d.on ? amount : 0;
    const r = springValue(d.p, d.v, target, d.isLeg ? 3.4 : 4.2, dt);
    d.p = r[0]; d.v = r[1];
    if (Math.abs(d.p - target) < .0006 && Math.abs(d.v) < .0006) { d.p = target; d.v = 0; }
    explodeMax = Math.max(explodeMax, d.p);
    if (d.p < .0004) {
      d.group.position.copy(d.base);
    } else {
      d.group.position.set(
        d.base.x + d.offset[0] * d.p,
        d.base.y + d.offset[1] * d.p,
        d.base.z + d.offset[2] * d.p
      );
    }
  });
  if (explodeMax < .002) explodeMax = 0;
}
function explosionIsActive() { return explodeMax > .012; }

/* ============================================================
   CALLOUTS / LEADER LINES
   ============================================================ */
const CALLOUT_DEFS = [
  {
    id: 'carapace', label: 'Cephalothorax', sub: 'COMMAND / SENSOR HOUSING', partId: 'carapace',
    anchorLocal: [.02, .42, .22], offset: [-142, -66], getAnchor: () => bodyGroup.localToWorld(new T.Vector3(.02, .42, .22))
  },
  {
    id: 'abdomen', label: 'Segmented Abdomen', sub: 'POWER / STORAGE · 2.8 KWH', partId: 'abdomen',
    anchorLocal: [.05, .40, -1.42], offset: [128, -72], getAnchor: () => bodyGroup.localToWorld(new T.Vector3(.05, .40, -1.42))
  },
  {
    id: 'eyes', label: 'Optical Array', sub: '8-CHANNEL / MULTI-SPECTRUM', partId: 'eyes',
    anchorLocal: [.0, .25, 1.16], offset: [52, -100], getAnchor: () => bodyGroup.localToWorld(new T.Vector3(0, .25, 1.16))
  },
  {
    id: 'leg', label: 'Leg Actuator — L2', sub: 'FEMUR / TIBIA / TARSUS · 5-AXIS', partId: 'leg_L2',
    offset: [-160, 28], getAnchor: () => {
      if (!LEGS[1]) return bodyGroup.localToWorld(new T.Vector3(-1.4, .4, .8));
      return LEGS[1].femur.localToWorld(new T.Vector3(-.08, .12, .62));
    }
  },
  {
    id: 'pedipalp', label: 'Pedipalp', sub: '3-AXIS / 42 N GRIP', partId: 'pedipalp_L',
    offset: [-150, 74], getAnchor: () => {
      if (!pedipalpL) return bodyGroup.localToWorld(new T.Vector3(-.55, -.2, 1.1));
      return pedipalpL.localToWorld(new T.Vector3(0, 0, .55));
    }
  },
  {
    id: 'spinneret', label: 'Spinneret Cluster', sub: 'TETHER / LINE LAYER', partId: 'spinneret',
    offset: [122, 70], getAnchor: () => bodyGroup.localToWorld(new T.Vector3(0, -.08, -2.54))
  }
];
const CALLOUTS = { overview: [], exploded: [], built: false };
const LEADER_NS = 'http://www.w3.org/2000/svg';

function calloutElement(label, sub, onClick, extra = '') {
  const el = document.createElement('button');
  el.className = 'callout';
  el.innerHTML = '<span class="cbar"></span><span class="ctext"><b>' + label + '</b><span>' + sub + '</span></span>';
  el.type = 'button';
  if (onClick) el.addEventListener('click', onClick);
  $('#calloutLayer').appendChild(el);
  const path = document.createElementNS(LEADER_NS, 'path');
  path.setAttribute('class', 'leader-path');
  $('#leaderLayer').appendChild(path);
  const dot = document.createElementNS(LEADER_NS, 'circle');
  dot.setAttribute('class', 'leader-dot');
  dot.setAttribute('r', '2.1');
  $('#leaderLayer').appendChild(dot);
  return { el, path, dot, extra };
}

function buildCallouts() {
  if (CALLOUTS.built) return;
  CALLOUTS.built = true;
  CALLOUT_DEFS.forEach(def => {
    const c = calloutElement(def.label, def.sub, () => setSelected(def.partId, null, null));
    c.def = def; c.type = 'overview';
    CALLOUTS.overview.push(c);
  });
  EXPLODE.forEach(d => {
    const c = calloutElement(d.label, d.sub + ' · ' + d.code, () => {
      setSelected(d.id, d.label, null);
      focusObjectInView(d.group, d.sphere.radius);
    });
    c.def = d; c.type = 'exploded';
    CALLOUTS.exploded.push(c);
  });
}

function setCalloutVisible(c, visible) {
  if (!c) return;
  c.el.classList.toggle('hidden', !visible);
  c.path.style.display = visible ? '' : 'none';
  c.dot.style.display = visible ? '' : 'none';
}

function screenOf(v) {
  const p = v.clone().project(activeCamera);
  return { x: (p.x * .5 + .5) * innerWidth, y: (-p.y * .5 + .5) * innerHeight, behind: p.z > 1 };
}

function drawCallout(c, anchor, labelPos, visible, blueprint = false, bounds = null) {
  setCalloutVisible(c, visible);
  if (!visible) return;
  const a = screenOf(anchor);
  if (a.behind) { setCalloutVisible(c, false); return; }
  const hw = (c.el.offsetWidth || 160) * .5;
  const l = bounds || { left: 24, right: innerWidth - 24, top: 60, bottom: innerHeight - 130 };
  const x = clamp(labelPos.x, l.left + hw, l.right - hw);
  const y = clamp(labelPos.y, l.top + 15, l.bottom - 15);
  c.el.style.left = x + 'px';
  c.el.style.top = y + 'px';
  c.el.classList.toggle('blueprint', blueprint);
  const elbowX = x + (a.x < x ? -hw - 4 : hw + 4);
  const elbowY = y;
  c.path.setAttribute('d', 'M ' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) +
    ' L ' + (a.x + (elbowX - a.x) * .55).toFixed(1) + ' ' + elbowY.toFixed(1) +
    ' L ' + elbowX.toFixed(1) + ' ' + elbowY.toFixed(1));
  c.dot.setAttribute('cx', a.x.toFixed(1));
  c.dot.setAttribute('cy', a.y.toFixed(1));
  c.dot.style.display = a.behind ? 'none' : '';
}

function stageBounds() {
  const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const lr = document.querySelector('.rail-left');
  const rr = document.querySelector('.rail-right');
  const tb = document.querySelector('.topbar');
  const ft = document.querySelector('.footer');
  let left = vis(lr) ? lr.getBoundingClientRect().right + 14 : 24;
  let right = vis(rr) ? rr.getBoundingClientRect().left - 14 : innerWidth - 24;
  if (right - left < 300) { left = 24; right = innerWidth - 24; }
  const top = (vis(tb) ? tb.getBoundingClientRect().bottom : 0) + 14;
  const bottom = (vis(ft) ? ft.getBoundingClientRect().top : innerHeight) - 14;
  return { left, right, top, bottom };
}

/* 1-D vertical de-overlap per side, so labels never stack on each other */
function resolveCalloutColumns(items, gap, top, bottom) {
  ['left', 'right'].forEach(side => {
    const col = items.filter(i => i.side === side).sort((a, b) => a.y - b.y);
    if (!col.length) return;
    let y = top;
    col.forEach(it => { it.y = Math.max(it.y, y); y = it.y + gap; });
    let limit = bottom;
    for (let i = col.length - 1; i >= 0; i--) {
      col[i].y = Math.min(col[i].y, limit);
      limit = col[i].y - gap;
    }
    if (col[0].y < top) {
      const step = Math.min(gap, (bottom - top) / Math.max(1, col.length - 1));
      col.forEach((it, i) => { it.y = top + i * step; });
    }
  });
}

function updateCallouts() {
  if (!CALLOUTS.built) return;
  const bounds = stageBounds();
  const midX = (bounds.left + bounds.right) * .5;
  const overviewOn = SIM.tab === 'overview' && SIM.callouts && !explosionIsActive();
  const overviewItems = [];
  CALLOUTS.overview.forEach(c => {
    if (!overviewOn) { setCalloutVisible(c, false); return; }
    const anchor = c.def.getAnchor();
    if (!anchor) { setCalloutVisible(c, false); return; }
    const a = screenOf(anchor);
    if (a.behind) { setCalloutVisible(c, false); return; }
    const item = { c, anchor, x: a.x + c.def.offset[0], y: a.y + c.def.offset[1], side: a.x < midX ? 'left' : 'right' };
    item.side = item.x < midX ? 'left' : 'right';
    overviewItems.push(item);
  });
  resolveCalloutColumns(overviewItems, 36, bounds.top + 12, bounds.bottom - 12);
  overviewItems.forEach(it => drawCallout(it.c, it.anchor, { x: it.x, y: it.y }, true, false, bounds));

  const explodedOn = (SIM.tab === 'exploded' || (explosionIsActive() && SIM.tab !== 'blueprint')) && SIM.explodeCallouts;
  const center = screenOf(bodyGroup.localToWorld(new T.Vector3(0, .25, 0)));
  const explodedItems = [];
  CALLOUTS.exploded.forEach((c, i) => {
    const d = c.def;
    if (!explodedOn || d.p < .08 || !d.group.visible) { setCalloutVisible(c, false); return; }
    const anchor = d.group.localToWorld(d.centerLocal.clone());
    const a = screenOf(anchor);
    if (a.behind) { setCalloutVisible(c, false); return; }
    let dx = a.x - center.x, dy = a.y - center.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const stagger = ((i % 3) - 1) * 16;
    const item = { c, anchor, x: a.x + dx * 112, y: a.y + dy * 52 + stagger, side: a.x < midX ? 'left' : 'right' };
    explodedItems.push(item);
  });
  resolveCalloutColumns(explodedItems, 30, bounds.top + 10, bounds.bottom - 10);
  explodedItems.forEach(it => drawCallout(it.c, it.anchor, { x: it.x, y: it.y }, true, SIM.tab === 'blueprint', bounds));
}

/* ============================================================
   SECTION CUTS
   ============================================================ */
const sectionClip = new T.Plane(new T.Vector3(0, -1, 0), 0);
const clipMaterials = [];
let sectionVisual, sectionVisualEdge;
function initSectionTools() {
  Object.values(MATS).forEach(m => {
    if (m && m.isMaterial && !m.isLineBasicMaterial && m !== MATS.blueprintFill && m !== MATS.blueprintFillDark) {
      m.clippingPlanes = null;
      m.clipShadows = true;
      clipMaterials.push(m);
    }
  });
  renderer.localClippingEnabled = true;
  sectionVisual = new T.Group();
  const fill = new T.Mesh(
    new T.PlaneGeometry(7.4, 5.2),
    new T.MeshBasicMaterial({ color: 0x6f9dba, transparent: true, opacity: .10, side: T.DoubleSide, depthWrite: false, toneMapped: false })
  );
  const border = new T.LineSegments(
    new T.EdgesGeometry(new T.PlaneGeometry(7.4, 5.2)),
    new T.LineBasicMaterial({ color: 0x2d6f96, transparent: true, opacity: .55, depthTest: false })
  );
  fill.renderOrder = 4; border.renderOrder = 5;
  sectionVisual.add(fill, border);
  sectionVisual.visible = false;
  sectionVisual.traverse(o => o.layers.set(1));
  scene.add(sectionVisual);
}
function updateSectionClip() {
  if (!sectionVisual) return;
  const on = SIM.cut !== 'off';
  sectionVisual.visible = on;
  if (!on) {
    clipMaterials.forEach(m => { m.clippingPlanes = null; });
    return;
  }
  const p = SIM.cutPos;
  const bx = bodyGroup.position.x, bz = bodyGroup.position.z;
  if (SIM.cut === 'x') {
    sectionClip.normal.set(-1, 0, 0);
    sectionClip.constant = bx + p;
    sectionVisual.position.set(bx + p, BODY_STATE.y + .35, bz);
    sectionVisual.rotation.set(0, Math.PI / 2, 0);
  } else if (SIM.cut === 'y') {
    const wy = clamp(BODY_STATE.y + .30 + p * .55, .06, 2.1);
    sectionClip.normal.set(0, -1, 0);
    sectionClip.constant = wy;
    sectionVisual.position.set(bx, wy, bz);
    sectionVisual.rotation.set(-Math.PI / 2, 0, 0);
  } else {
    sectionClip.normal.set(0, 0, -1);
    sectionClip.constant = bz + p;
    sectionVisual.position.set(bx, BODY_STATE.y + .35, bz + p);
    sectionVisual.rotation.set(0, 0, 0);
  }
  sectionClip.normalize();
  clipMaterials.forEach(m => { m.clippingPlanes = [sectionClip]; });
}

/* ============================================================
   PICKING / SELECTION / HOVER
   ============================================================ */
const hoverTip = $('#hoverTip');
let hoveredObject = null, lastHover = 0;
let selectedObject = null, selectedId = null;
let selectionHelper = null;
const selectionBox = new T.Box3();

function getSelectionHelper() {
  if (!selectionHelper) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(12 * 4 * 3), 3));
    const mat = new T.LineBasicMaterial({
      color: 0xff6a00, transparent: true, opacity: .72, depthTest: false,
      depthWrite: false, toneMapped: false
    });
    selectionHelper = new T.LineSegments(geo, mat);
    selectionHelper.frustumCulled = false;
    selectionHelper.renderOrder = 10;
    selectionHelper.layers.set(1);
    scene.add(selectionHelper);
    selectionHelper.visible = false;
  }
  return selectionHelper;
}

/* corner-bracket CAD selector, redrawn from the live world bounding box */
function writeSelectionBrackets() {
  if (!selectionHelper) return;
  const { min, max } = selectionBox;
  const xs = [min.x, max.x], ys = [min.y, max.y], zs = [min.z, max.z];
  const edges = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    edges.push([xs[0], ys[i], zs[j], xs[1], ys[i], zs[j]]);
    edges.push([xs[i], ys[0], zs[j], xs[i], ys[1], zs[j]]);
    edges.push([xs[i], ys[j], zs[0], xs[i], ys[j], zs[1]]);
  }
  const arr = selectionHelper.geometry.attributes.position.array;
  const f = .2;
  let k = 0;
  edges.forEach(e => {
    const [ax, ay, az, bx, by, bz] = e;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    arr[k++] = ax; arr[k++] = ay; arr[k++] = az;
    arr[k++] = ax + dx * f; arr[k++] = ay + dy * f; arr[k++] = az + dz * f;
    arr[k++] = bx - dx * f; arr[k++] = by - dy * f; arr[k++] = bz - dz * f;
    arr[k++] = bx; arr[k++] = by; arr[k++] = bz;
  });
  selectionHelper.geometry.attributes.position.needsUpdate = true;
}

function pickAt(clientX, clientY, forHover = false) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, activeCamera);
  const hits = raycaster.intersectObjects(pickMeshes, false);
  for (const hit of hits) {
    const o = hit.object;
    if (!o.visible) continue;
    let p = o, hidden = false;
    while (p && p !== scene) { if (!p.visible) { hidden = true; break; } p = p.parent; }
    if (hidden) continue;
    if (SIM.internalScan && ['carapace', 'abdomen', 'armor'].includes(o.userData.partId) && !o.userData.partLabel) continue;
    return hit;
  }
  return null;
}

function setSelected(id, label, object) {
  if (!id) { clearSelection(); return; }
  selectedId = id;
  SIM.selected = id;
  selectedObject = object || partObjects[id] || null;
  const def = PART_DEFS[id] || PART_DEFS.armor;
  const name = label || def.name;
  $('#selectedName').textContent = name;
  $('#selectedCategory').textContent = def.category || 'ASSEMBLY';
  $('#selectedFunction').textContent = def.function;
  $('#selectedMaterial').textContent = def.material;
  $('#selectedJoints').textContent = def.joints;
  $('#selectedActuation').textContent = def.actuation;
  $('#selectedRange').textContent = def.range;
  const conns = $('#selectedConnections');
  conns.innerHTML = (def.connections || []).map(c => '<span class="conn">' + c + '</span>').join('');
  $('#selectedPreview').innerHTML = previewSVG(def.preview);
  $$('.chip').forEach(ch => ch.classList.toggle('active', ch.dataset.part === id));
  const helper = getSelectionHelper();
  if (selectedObject) {
    selectedObject.updateWorldMatrix(true, true);
    selectionBox.setFromObject(selectedObject);
    writeSelectionBrackets();
    helper.visible = true;
  } else {
    helper.visible = false;
  }
  // attach the selected sub-part label to clickable chips
  if (object && object.userData?.partLabel) {
    $('#selectedName').textContent = object.userData.partLabel;
  }
}
function clearSelection() {
  selectedId = null; selectedObject = null;
  SIM.selected = null;
  $('#selectedName').textContent = 'No component selected';
  $('#selectedCategory').textContent = 'ASSEMBLY';
  $('#selectedFunction').textContent = 'Click any component in the viewport to inspect its engineering metadata.';
  $('#selectedMaterial').textContent = '—';
  $('#selectedJoints').textContent = '—';
  $('#selectedActuation').textContent = '—';
  $('#selectedRange').textContent = '—';
  $('#selectedConnections').innerHTML = '';
  $('#selectedPreview').innerHTML = previewSVG('spider');
  $$('.chip').forEach(ch => ch.classList.remove('active'));
  if (selectionHelper) selectionHelper.visible = false;
}

function selectHit(hit) {
  if (!hit) return;
  const o = hit.object;
  const id = o.userData.partId;
  if (!id) return;
  const label = o.userData.partLabel || null;
  setSelected(id, label, o.userData.partLabel ? o : (partObjects[id] || o));
  ORBIT.lastInteraction = performance.now();
}

function updateHover(clientX, clientY, now) {
  if (now - lastHover < 65 || ORBIT.dragging) return;
  lastHover = now;
  const hit = pickAt(clientX, clientY, true);
  const o = hit?.object || null;
  if (o !== hoveredObject) {
    hoveredObject = o;
    renderer.domElement.style.cursor = o ? 'pointer' : 'grab';
  }
  if (o) {
    const id = o.userData.partId;
    const def = PART_DEFS[id];
    const label = o.userData.partLabel || def?.name || id;
    if (hoverTip) {
      hoverTip.querySelector('b').textContent = label;
      hoverTip.querySelector('span').textContent = (def?.category || 'ASSEMBLY') + ' / ' + (id || '');
      hoverTip.style.left = clientX + 'px';
      hoverTip.style.top = clientY + 'px';
      hoverTip.classList.add('show');
    }
  } else if (hoverTip) {
    hoverTip.classList.remove('show');
  }
}

function updateSelectionHelper() {
  if (!selectionHelper || !selectionHelper.visible || !selectedObject) return;
  selectedObject.updateWorldMatrix(true, true);
  selectionBox.setFromObject(selectedObject);
  writeSelectionBrackets();
}

function setupPointerControls() {
  const canvas = renderer.domElement;
  let pointerId = null, startX = 0, startY = 0, lastX = 0, lastY = 0, downButton = 0;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    downButton = e.button;
    ORBIT.dragging = true;
    ORBIT.panning = e.button === 2 || e.shiftKey;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    ORBIT.dragDistance = 0;
    ORBIT.lastInteraction = performance.now();
    canvas.setPointerCapture?.(pointerId);
    canvas.classList.add('dragging');
    if (hoverTip) hoverTip.classList.remove('show');
  });
  canvas.addEventListener('pointermove', e => {
    if (!ORBIT.dragging) { updateHover(e.clientX, e.clientY, performance.now()); return; }
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    ORBIT.dragDistance += Math.abs(dx) + Math.abs(dy);
    const scale = innerHeight > 0 ? 1 / innerHeight : .001;
    if (ORBIT.panning) {
      const worldPerPixel = SIM.projection === 'ortho'
        ? (ORBIT.orthoSize * 2) * scale
        : (2 * Math.tan(perspectiveCamera.fov * .5 * DEG) * ORBIT.dist) * scale;
      const right = new T.Vector3().setFromMatrixColumn(activeCamera.matrixWorld, 0);
      const up = new T.Vector3().setFromMatrixColumn(activeCamera.matrixWorld, 1);
      ORBIT.panOffset.addScaledVector(right, -dx * worldPerPixel);
      ORBIT.panOffset.addScaledVector(up, dy * worldPerPixel);
      ORBIT.panOffset.y = clamp(ORBIT.panOffset.y, -2.2, 2.2);
      const maxPan = 8;
      ORBIT.panOffset.x = clamp(ORBIT.panOffset.x, -maxPan, maxPan);
      ORBIT.panOffset.z = clamp(ORBIT.panOffset.z, -maxPan, maxPan);
    } else {
      ORBIT.thetaGoal -= dx * 1.25 * scale;
      ORBIT.phiGoal = clamp(ORBIT.phiGoal - dy * 1.05 * scale, .065, 1.535);
      ORBIT.focusObject = null;
    }
    ORBIT.lastInteraction = performance.now();
  });
  const finish = e => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    const wasDrag = ORBIT.dragDistance > 4;
    ORBIT.dragging = false;
    ORBIT.panning = false;
    canvas.classList.remove('dragging');
    canvas.releasePointerCapture?.(e.pointerId);
    if (!wasDrag && downButton === 0) {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) {
        selectHit(hit);
        ORBIT.lastInteraction = performance.now();
      }
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('pointerleave', () => { if (hoverTip) hoverTip.classList.remove('show'); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    ORBIT.lastInteraction = performance.now();
    if (SIM.projection === 'ortho') {
      ORBIT.orthoGoal = clamp(ORBIT.orthoGoal * Math.exp(e.deltaY * .0011), .8, 5.2);
    } else {
      ORBIT.distGoal = clamp(ORBIT.distGoal * Math.exp(e.deltaY * .0010), 2.2, 16);
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', e => {
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) {
      selectHit(hit);
      const o = hit.object;
      focusObjectInView(o.userData.partLabel ? o : (partObjects[o.userData.partId] || o),
        Math.max(.3, o.geometry.boundingSphere?.radius || .8));
    }
  });
  canvas.addEventListener('pointerdown', e => {
    if (e.detail === 2) e.preventDefault();
  }, { passive: false });
}

function previewSVG(kind) {
  const stroke = 'stroke="#2f302c" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const accent = 'stroke="#ff6a00" stroke-width="1.4" fill="none" stroke-linecap="round"';
  if (kind === 'leg') return '<svg viewBox="0 0 64 64"><g ' + stroke + '><circle cx="13" cy="20" r="5"/><path d="M17 22 34 12l12 18-9 20"/><path d="M34 12l5-6M37 50l3 8M28 50l-6 8"/></g><circle cx="13" cy="20" r="2.2" fill="#ff6a00"/><path d="M37 30h4M39 35h3" ' + accent + '/></svg>';
  if (kind === 'sensor') return '<svg viewBox="0 0 64 64"><g ' + stroke + '><rect x="9" y="20" width="46" height="24" rx="9"/><circle cx="23" cy="32" r="8"/><circle cx="42" cy="32" r="5"/><path d="M23 18v5M42 18v5"/></g><circle cx="23" cy="32" r="4" fill="#ff6a00"/><circle cx="42" cy="32" r="2.2" fill="#2f302c"/></svg>';
  if (kind === 'mouth') return '<svg viewBox="0 0 64 64"><g ' + stroke + '><path d="M18 14c9 8 10 18 4 26-4 6-6 10-3 14M46 14c-9 8-10 18-4 26 4 6 6 10 3 14"/><path d="M18 14c5-4 10-4 14 0M46 14c-5-4-10-4-14 0"/></g><path d="M23 26c3 5 3 10 0 15M41 26c-3 5-3 10 0 15" ' + accent + '/></svg>';
  if (kind === 'spinneret') return '<svg viewBox="0 0 64 64"><g ' + stroke + '><rect x="18" y="8" width="28" height="15" rx="5"/><path d="M25 23v15M32 23v22M39 23v15"/><path d="M20 45c4 6 8 8 12 8s8-2 12-8"/></g><circle cx="32" cy="53" r="2.5" fill="#ff6a00"/></svg>';
  if (kind === 'core') return '<svg viewBox="0 0 64 64"><g ' + stroke + '><rect x="16" y="12" width="32" height="40" rx="5"/><circle cx="32" cy="32" r="10"/><path d="M32 8v4M32 52v4M12 32h4M48 32h4"/></g><circle cx="32" cy="32" r="4" fill="#ff6a00"/><path d="M22 20h20M22 44h20" ' + accent + '/></svg>';
  if (kind === 'mech') return '<svg viewBox="0 0 64 64"><g ' + stroke + '><circle cx="18" cy="44" r="7"/><circle cx="46" cy="22" r="5"/><path d="M22 39 38 26l5-1M45 28l-4 14-10 9"/></g><path d="M29 39l4-4M42 26l3 5" ' + accent + '/></svg>';
  if (kind === 'spider') return '<svg viewBox="0 0 64 64"><g ' + stroke + '><ellipse cx="32" cy="38" rx="8" ry="11"/><circle cx="32" cy="22" r="6"/><path d="M26 20 14 13 7 18M27 23 11 24 5 31M27 26 13 34 9 43M28 29 19 45 14 51M38 20l12-7 7 5M37 23l16 1 6 7M37 26l14 8 4 9M36 29l9 16 5 6"/></g><circle cx="29" cy="22" r="1.4" fill="#ff6a00"/><circle cx="35" cy="22" r="1.4" fill="#ff6a00"/></svg>';
  return '<svg viewBox="0 0 64 64"><g ' + stroke + '><ellipse cx="32" cy="38" rx="9" ry="13"/><circle cx="32" cy="20" r="8"/><path d="M25 18 12 10M24 22 8 21M24 26 10 32M25 30 14 42M39 18l13-8M40 22l16-1M40 26l14 6M39 30l11 12"/></g><circle cx="32" cy="38" r="4" fill="#ff6a00"/><path d="M28 17h8" stroke="#ff6a00" stroke-width="1.4"/></svg>';
}

/* ============================================================
   HDR / MSAA / AO POST PIPELINE
   ============================================================ */
const POST = {
  enabled: false, samples: 0, hdr: false,
  sceneRT: null, normalRT: null, aoRT: null, blurRT: null,
  quadScene: null, quadCam: null, quad: null,
  normalMat: null, aoMat: null, blurMat: null, compMat: null,
  whiteTex: null, qualityLabel: 'DIRECT'
};

const POST_VERT = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

function buildPost() {
  const wantPost = !MOBILE;
  if (!wantPost) {
    POST.enabled = false;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    POST.qualityLabel = 'DIRECT / SDR';
    return;
  }
  const hdrExt = IS_WEBGL2 && (gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
  POST.hdr = !!hdrExt;
  POST.samples = IS_WEBGL2 ? Math.min(8, gl.getParameter(gl.MAX_SAMPLES) || 1) : 0;
  const w = Math.max(2, Math.floor(innerWidth * renderer.getPixelRatio()));
  const h = Math.max(2, Math.floor(innerHeight * renderer.getPixelRatio()));
  const type = POST.hdr ? T.HalfFloatType : T.UnsignedByteType;
  try {
    POST.sceneRT = new T.WebGLRenderTarget(w, h, {
      type, format: T.RGBAFormat,
      minFilter: T.LinearFilter, magFilter: T.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
      samples: POST.samples
    });
    POST.sceneRT.texture.colorSpace = T.LinearSRGBColorSpace;
    POST.normalRT = new T.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), {
      type: POST.hdr ? T.HalfFloatType : T.UnsignedByteType,
      format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter,
      depthBuffer: true, stencilBuffer: false
    });
    POST.normalRT.texture.colorSpace = T.NoColorSpace;
    POST.aoRT = new T.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), {
      type: T.UnsignedByteType, format: T.RGBAFormat,
      minFilter: T.LinearFilter, magFilter: T.LinearFilter,
      depthBuffer: false, stencilBuffer: false
    });
    POST.blurRT = POST.aoRT.clone();
    renderer.setRenderTarget(POST.sceneRT);
    const status = gl.checkFramebufferStatus ? gl.checkFramebufferStatus(gl.FRAMEBUFFER) : gl.FRAMEBUFFER_COMPLETE;
    renderer.setRenderTarget(null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
  } catch (err) {
    console.warn('AR-08 post pipeline unavailable:', err);
    POST.enabled = false;
    POST.samples = 0;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    POST.qualityLabel = 'DIRECT / FALLBACK';
    return;
  }

  POST.quadScene = new T.Scene();
  POST.quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  POST.quad = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial());
  POST.quad.frustumCulled = false;
  POST.quadScene.add(POST.quad);

  POST.normalMat = new T.ShaderMaterial({
    vertexShader: `
      varying vec3 vNormal;
      varying float vDepth;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vDepth = clamp(-mv.z / 40.0, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vNormal;
      varying float vDepth;
      void main(){
        gl_FragColor = vec4(normalize(vNormal) * 0.5 + 0.5, vDepth);
      }`,
    side: T.DoubleSide, toneMapped: false, depthTest: true, depthWrite: true
  });

  POST.aoMat = new T.ShaderMaterial({
    uniforms: {
      tNormalDepth: { value: POST.normalRT.texture },
      texel: { value: new T.Vector2(1 / (w >> 1), 1 / (h >> 1)) },
      tanHalfFov: { value: Math.tan(perspectiveCamera.fov * .5 * DEG) },
      aspect: { value: innerWidth / innerHeight },
      camProjection: { value: perspectiveCamera.projectionMatrix },
      radius: { value: .85 },
      bias: { value: .035 },
      intensity: { value: .82 }
    },
    vertexShader: POST_VERT,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tNormalDepth;
      uniform vec2 texel;
      uniform float tanHalfFov;
      uniform float aspect;
      uniform mat4 camProjection;
      uniform float radius;
      uniform float bias;
      uniform float intensity;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec4 nd = texture2D(tNormalDepth, vUv);
        float depth = nd.a * 40.0;
        if (depth <= 0.0) { gl_FragColor = vec4(1.0); return; }
        vec3 normal = normalize(nd.rgb * 2.0 - 1.0);
        vec2 ndc = vUv * 2.0 - 1.0;
        vec3 viewPos = vec3(ndc.x * depth * tanHalfFov * aspect, ndc.y * depth * tanHalfFov, -depth);
        float seed = hash(vUv * vec2(1367.0, 911.0));
        float angle = seed * 6.2831853;
        vec3 randomVec = normalize(vec3(cos(angle), sin(angle), 0.35));
        vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
        vec3 bitangent = cross(normal, tangent);
        mat3 tbn = mat3(tangent, bitangent, normal);
        float occlusion = 0.0;
        const int SAMPLES = 12;
        for (int i = 0; i < SAMPLES; i++){
          float fi = float(i);
          float a = fi * 2.399963 + seed * 6.2831853;
          float r = sqrt((fi + 1.0) / float(SAMPLES));
          vec3 dir = normalize(tbn * vec3(cos(a) * r, sin(a) * r, 0.35 + 0.55 * hash(vUv * 17.0 + fi)));
          vec3 samplePos = viewPos + dir * radius * (0.38 + 0.62 * hash(vUv * 3.1 + fi * 1.37));
          vec4 clip = camProjection * vec4(samplePos, 1.0);
          if (clip.w <= 0.0) continue;
          vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
          float sceneDepth = texture2D(tNormalDepth, suv).a * 40.0;
          if (sceneDepth <= 0.0) continue;
          float diff = (-samplePos.z) - sceneDepth;
          float rangeCheck = smoothstep(0.0, 1.0, radius / max(0.0001, abs(diff)));
          if (diff > bias) occlusion += rangeCheck;
        }
        occlusion /= float(SAMPLES);
        float ao = clamp(1.0 - occlusion * intensity, 0.0, 1.0);
        gl_FragColor = vec4(ao, ao, ao, 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false
  });

  POST.blurMat = new T.ShaderMaterial({
    uniforms: { tAO: { value: POST.aoRT.texture }, direction: { value: new T.Vector2(1 / (w >> 1), 0) } },
    vertexShader: POST_VERT,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tAO;
      uniform vec2 direction;
      void main(){
        float sum = 0.0;
        float weightSum = 0.0;
        for (int i = -4; i <= 4; i++){
          float w = exp(-float(i * i) / 8.0);
          sum += texture2D(tAO, vUv + direction * float(i)).r * w;
          weightSum += w;
        }
        gl_FragColor = vec4(vec3(sum / weightSum), 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false
  });

  POST.compMat = new T.ShaderMaterial({
    uniforms: {
      tColor: { value: POST.sceneRT.texture },
      tAO: { value: POST.aoRT.texture },
      resolution: { value: new T.Vector2(w, h) },
      exposure: { value: 1.08 },
      aoStrength: { value: .92 },
      time: { value: 0 },
      vignette: { value: .16 }
    },
    vertexShader: POST_VERT,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D tColor;
      uniform sampler2D tAO;
      uniform vec2 resolution;
      uniform float exposure;
      uniform float aoStrength;
      uniform float time;
      uniform float vignette;
      vec3 aces(vec3 x){
        x *= exposure;
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }
      vec3 srgb(vec3 c){
        c = max(c, vec3(0.0));
        return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
      }
      void main(){
        vec3 color = texture2D(tColor, vUv).rgb;
        float ao = mix(1.0, texture2D(tAO, vUv).r, aoStrength);
        color *= ao;
        color = aces(color);
        color = srgb(color);
        float v = smoothstep(1.3, 0.36, length(vUv - 0.5) * 1.16);
        color *= mix(1.0, v, vignette);
        float g = fract(sin(dot(vUv * resolution + time, vec2(12.9898, 78.233))) * 43758.5453);
        color += (g - 0.5) * 0.0022;
        gl_FragColor = vec4(color, 1.0);
      }`,
    depthTest: false, depthWrite: false, toneMapped: false
  });

  POST.whiteTex = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, T.RGBAFormat);
  POST.whiteTex.needsUpdate = true;
  POST.enabled = true;
  POST.qualityLabel = (POST.hdr ? 'HDR' : 'SDR') + (POST.samples ? ' / ' + POST.samples + '×MSAA' : '') + ' / HEMI-AO';
  renderer.toneMapping = T.NoToneMapping;
  const lbl = $('#renderQualityLabel');
  if (lbl) lbl.textContent = POST.qualityLabel;
}

function resizePost() {
  if (!POST.enabled) return;
  const w = Math.max(2, Math.floor(innerWidth * renderer.getPixelRatio()));
  const h = Math.max(2, Math.floor(innerHeight * renderer.getPixelRatio()));
  POST.sceneRT.setSize(w, h);
  POST.normalRT.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  POST.aoRT.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  POST.blurRT.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  POST.compMat.uniforms.resolution.value.set(w, h);
  POST.aoMat.uniforms.texel.value.set(1 / (w >> 1), 1 / (h >> 1));
  POST.aoMat.uniforms.aspect.value = innerWidth / innerHeight;
  POST.aoMat.uniforms.tanHalfFov.value = Math.tan(perspectiveCamera.fov * .5 * DEG);
}

function renderQuad(material, target) {
  POST.quad.material = material;
  renderer.setRenderTarget(target);
  renderer.render(POST.quadScene, POST.quadCam);
}

function renderFrame() {
  if (!POST.enabled) {
    renderer.setRenderTarget(null);
    renderer.render(scene, activeCamera);
    return;
  }
  renderer.setRenderTarget(POST.sceneRT);
  renderer.clear();
  renderer.render(scene, activeCamera);

  const useAO = SIM.ao && SIM.projection === 'persp' && SIM.tab !== 'blueprint';
  if (useAO) {
    const prevBg = scene.background;
    const prevClear = new T.Color();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    scene.overrideMaterial = POST.normalMat;
    const prevMask = activeCamera.layers.mask;
    activeCamera.layers.set(0);
    renderer.setRenderTarget(POST.normalRT);
    renderer.clear();
    renderer.render(scene, activeCamera);
    activeCamera.layers.mask = prevMask;
    scene.overrideMaterial = null;
    scene.background = prevBg;
    renderer.setClearColor(prevClear, prevAlpha);

    POST.aoMat.uniforms.tNormalDepth.value = POST.normalRT.texture;
    renderQuad(POST.aoMat, POST.aoRT);
    const hx = 1 / (POST.aoRT.width || 1);
    const hy = 1 / (POST.aoRT.height || 1);
    POST.blurMat.uniforms.tAO.value = POST.aoRT.texture;
    POST.blurMat.uniforms.direction.value.set(hx, 0);
    renderQuad(POST.blurMat, POST.blurRT);
    POST.blurMat.uniforms.tAO.value = POST.blurRT.texture;
    POST.blurMat.uniforms.direction.value.set(0, hy);
    renderQuad(POST.blurMat, POST.aoRT);
    POST.compMat.uniforms.tAO.value = POST.aoRT.texture;
    POST.compMat.uniforms.aoStrength.value = .92;
  } else {
    POST.compMat.uniforms.tAO.value = POST.whiteTex;
    POST.compMat.uniforms.aoStrength.value = 0;
  }
  POST.compMat.uniforms.time.value = SIM.time;
  renderQuad(POST.compMat, null);
}

/* ============================================================
   INTERFACE STATE / HELPERS
   ============================================================ */
let toastTimer = null;
function toast(message, ms = 1800) {
  const el = $('#toast'), txt = $('#toastText');
  if (!el || !txt) return;
  txt.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const TAB_META = {
  overview: { n: '01', title: 'OVERVIEW', caption: 'Complete assembly with live systems. Hover and click any component to inspect.' },
  structure: { n: '02', title: 'STRUCTURE', caption: 'Load path, armour stack and the eight independent actuator chains.' },
  systems: { n: '03', title: 'SYSTEMS', caption: 'Power, hydraulic, optical and render-pipeline telemetry.' },
  animation: { n: '04', title: 'ANIMATION', caption: 'Unified gait controller. Scrub the timeline or manually offset a leg.' },
  exploded: { n: '05', title: 'EXPLODED VIEW', caption: 'Spring-damped assembly extraction with labelled leader lines.' },
  blueprint: { n: '06', title: 'BLUEPRINT', caption: 'Orthographic drawing set, section cuts and dimensional targets.' }
};

function setTab(tab, fromUser = false) {
  if (!TAB_META[tab]) return;
  SIM.tab = tab;
  $$('.tab-btn').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === tab));
  const meta = TAB_META[tab];
  const num = $('#sectionNumber'), title = $('#sectionTitle'), cap = $('#sectionCaption');
  if (num) num.textContent = meta.n;
  if (title) title.textContent = meta.title;
  if (cap) cap.textContent = meta.caption;
  document.body.classList.toggle('blueprint-mode', tab === 'blueprint');
  const blue = tab === 'blueprint';
  if (scene.background?.isColor) scene.background.set(blue ? 0xeef3f7 : 0xf2f0ea);
  if (scene.fog?.color) scene.fog.color.set(blue ? 0xeef3f7 : 0xf2f0ea);
  if (floor?.material?.color) floor.material.color.set(blue ? 0xf2f6f8 : 0xf7f5f0);
  renderer.setClearColor(blue ? 0xeef3f7 : 0xf2f0ea, 1);
  updateProjectionMode();
  if (blue) {
    setView(SIM.blueprintView || 'iso', true);
    setProjectionMode('ortho');
  }
  applyDimensionsState();
  if (fromUser) {
    if (tab === 'exploded') toast('EXPLODED VIEW / USE ASSEMBLY EXTRACTION');
    else if (tab === 'blueprint') toast('ORTHOGRAPHIC DRAWING MODE');
    else toast(meta.title + ' / SECTION ' + meta.n);
  }
}

const GAIT_ICONS = {
  walk: '<path d="M13 8 7 4 3 7M13 11 4 11 1 15M13 14 4 17 2 21M14 17 7 21 4 24M23 8l6-4 4 3M23 11l9 0 3 4M23 14l9 3 2 4M22 17l7 4 3 3"/>',
  sideways: '<path d="M13 8 6 5 2 8M13 11 3 10 1 14M13 14 3 15 2 19M14 17 6 21 3 24M23 8l7-3 4 3M23 11l10-1 2 4M23 14l10 1 1 4M22 17l8 4 3 3"/><path d="M28 20h6M31 18l3 2-3 2" stroke-width="1.3"/>',
  crawl: '<path d="M12 11 5 8 1 11M12 14 3 14 1 18M13 16 5 20 3 24M15 18 10 22 8 25M24 11l7-3 4 3M24 14l9 0 2 4M23 16l8 4 2 4M21 18l5 4 2 3"/><ellipse cx="18" cy="17" rx="6" ry="4.6"/>',
  climb: '<path d="M13 9 6 2 2 3M13 11 3 8 1 12M13 14 4 15 2 19M14 17 6 22 4 25M23 9l7-7 4 1M23 11l10-3 2 4M23 14l9 1 1 4M22 17l8 5 3 3"/><path d="M24 4l5-2M25 7l5-2" stroke-width="1.1"/>',
  dash: '<path d="M12 8 3 3 0 6M12 11 1 10-2 14M12 14 1 16-1 20M13 17 4 24 2 26M24 8l9-5 3 3M24 11l11-1 3 4M24 14l11 2 2 4M23 17l9 7 2 2"/>',
  defense: '<path d="M13 8 8 2 4 1M13 11 4 7 0 9M13 14 3 14 0 18M14 17 6 21 3 25M23 8l5-6 4-1M23 11l9-4 4 2M23 14l10 0 3 4M22 17l8 4 3 4"/><path d="M27 23h7" stroke-width="1.3"/>',
  idle: '<path d="M13 9 8 6 5 8M13 12 6 12 4 15M13 15 6 17 5 20M14 17 9 21 7 24M23 9l5-3 3 2M23 12l7 0 2 3M23 15l7 2 1 3M22 17l5 4 2 3"/>'
};

function buildModeList() {
  const host = $('#modeList');
  if (!host) return;
  host.innerHTML = Object.values(MODE_DEFS).map(def => `
    <button class="mode-row" data-mode="${def.id}" aria-label="${def.label}">
      <span class="micon"><svg viewBox="0 0 36 26" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="18" cy="15" rx="4.4" ry="5.1" fill="rgba(255,106,0,.10)"/><circle cx="18" cy="8" r="3.4" fill="none"/>
        ${GAIT_ICONS[def.id] || GAIT_ICONS.walk}
      </svg></span>
      <span class="mname"><b>${def.short}</b><span>${def.hint}</span></span>
      <span class="state"></span>
    </button>`).join('');
  $$('.mode-row', host).forEach(row => {
    row.addEventListener('click', () => setMode(row.dataset.mode));
  });
  syncModeUI();
}

function syncModeUI() {
  $$('.mode-row').forEach(row => row.classList.toggle('active', row.dataset.mode === SIM.mode));
  const sel = $('#modeSelect');
  if (sel) sel.value = SIM.mode;
  const phase = $('#gaitPhaseLabel');
  if (phase) phase.textContent = 'GROUP ' + (SIM.gaitPhase < .5 ? 'A' : 'B');
  const dots = $('#gaitDots');
  if (dots) {
    const active = SIM.gaitPhase < .5 ? 'A' : 'B';
    dots.innerHTML = LEGS.map(l => {
      const isActive = l.gaitGroup === active;
      const color = l.gaitGroup === 'A' ? (isActive ? '#ff6a00' : '#f0b28b') : (isActive ? '#272825' : '#c8c2b8');
      return '<span title="' + l.id + ' / GROUP ' + l.gaitGroup + '" style="width:9px;height:9px;border-radius:50%;background:' + color + ';box-shadow:' + (isActive ? '0 0 0 3px rgba(255,106,0,.09)' : 'none') + '"></span>';
    }).join('');
  }
}

function setMode(id, announce = true) {
  if (!MODE_DEFS[id]) return;
  SIM.mode = id;
  LEGS.forEach(l => { l.swinging = false; });
  SIM.gaitPhase = 0;
  BODY_STATE.activeGroup = null;
  syncModeUI();
  const def = MODE_DEFS[id];
  if (announce) toast('MODE / ' + def.short + ' — ' + def.hint.toUpperCase());
  updateProjectionMode();
}

const switchSyncers = [];
function bindSwitch(id, getter, setter) {
  const el = $('#' + id);
  if (!el) return;
  const sync = () => {
    const on = !!getter();
    el.classList.toggle('on', on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
  };
  switchSyncers.push(sync);
  el.addEventListener('click', () => {
    setter(!getter());
    syncAllSwitches();
  });
  sync();
}
function syncAllSwitches() { switchSyncers.forEach(fn => fn()); }

function bindRange(id, outId, getter, setter, format = v => v.toFixed(2)) {
  const input = $('#' + id), out = $('#' + outId);
  if (!input) return;
  const alt = $('#' + id + 'Val');
  const write = v => {
    const label = format(v);
    if (out) out.textContent = label;
    if (alt && alt !== out) alt.textContent = label;
  };
  input.value = getter();
  write(Number(input.value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    setter(v);
    write(v);
  });
}

function applyXray() {
  const see = SIM.transparency || SIM.internalScan;
  armorMaterials.forEach(m => {
    m.transparent = see;
    m.opacity = see ? (SIM.internalScan ? .105 : .30) : (m.userData.originalOpacity ?? 1);
    m.depthWrite = !see;
    m.needsUpdate = true;
  });
  if (SIM.internalScan) {
    MATS.energy.emissiveIntensity = 3.0;
  } else {
    MATS.energy.emissiveIntensity = 2.1;
  }
  syncAllSwitches();
}

function applyWireframe() {
  const solids = Object.values(MATS).filter(m => m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial));
  solids.forEach(m => {
    if (m.wireframe !== !!SIM.wireframe) {
      m.wireframe = !!SIM.wireframe;
      m.needsUpdate = true;
    }
  });
  const edgesOn = SIM.wireframe || SIM.bpWireframe;
  cadEdgeObjects.forEach(l => { l.visible = edgesOn; });
  syncAllSwitches();
}

function applyJointAxes() {
  jointAxisGroups.forEach(g => { g.visible = SIM.jointAxes; });
  syncAllSwitches();
  const btn = $('#jointAxesBtn');
  if (btn) btn.style.background = SIM.jointAxes ? '#111214' : '';
  if (btn) btn.style.color = SIM.jointAxes ? '#fff' : '';
}

function applyDimensionsState() {
  const layer = $('#dimensionLayer');
  if (!layer) return;
  const show = SIM.tab === 'blueprint' && SIM.dimensions;
  layer.style.display = show ? 'block' : 'none';
  const state = $('#bpDimState');
  if (state) state.textContent = SIM.dimensions ? 'VISIBLE' : 'HIDDEN';
  syncAllSwitches();
}

function drawDimensionOverlay() {
  const svg = $('#dimensionLayer');
  if (!svg || SIM.tab !== 'blueprint' || !SIM.dimensions) return;
  svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  const NS = LEADER_NS;
  const corners = [];
  const bx = 2.55, bz = 1.80, by = 1.55;
  [-bx, bx].forEach(x => [-bz, bz].forEach(z => [0, by].forEach(y => {
    corners.push(screenOf(bodyGroup.localToWorld(new T.Vector3(x, y, z))));
  })));
  const visible = corners.filter(c => !c.behind);
  if (visible.length < 4) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  visible.forEach(c => {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  });
  minX = clamp(minX, 22, innerWidth - 24); maxX = clamp(maxX, 22, innerWidth - 24);
  minY = clamp(minY, 86, innerHeight - 152); maxY = clamp(maxY, 86, innerHeight - 152);

  const frag = document.createDocumentFragment();
  const line = (x1, y1, x2, y2, cls = 'dim-line') => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', x1.toFixed(1)); l.setAttribute('y1', y1.toFixed(1));
    l.setAttribute('x2', x2.toFixed(1)); l.setAttribute('y2', y2.toFixed(1));
    l.setAttribute('class', cls); frag.appendChild(l);
  };
  const text = (x, y, value, rotate = 0) => {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x.toFixed(1)); t.setAttribute('y', y.toFixed(1));
    t.setAttribute('fill', '#22455c');
    t.setAttribute('stroke', '#eef3f7');
    t.setAttribute('stroke-width', '2.4');
    t.setAttribute('paint-order', 'stroke');
    t.setAttribute('stroke-linejoin', 'round');
    t.setAttribute('font-family', 'Consolas, monospace');
    t.setAttribute('font-size', '8.5');
    t.setAttribute('font-weight', '600');
    t.setAttribute('letter-spacing', '.05em');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'middle');
    if (rotate) t.setAttribute('transform', `rotate(${rotate} ${x.toFixed(1)} ${y.toFixed(1)})`);
    t.textContent = value;
    frag.appendChild(t);
  };
  const bY = maxY + 26;
  line(minX, maxY + 9, minX, bY + 6);
  line(maxX, maxY + 9, maxX, bY + 6);
  line(minX, bY, maxX, bY);
  line(minX, bY - 4, minX, bY + 4);
  line(maxX, bY - 4, maxX, bY + 4);
  text((minX + maxX) / 2, bY - 7, (SIM.blueprintView === 'side' ? 'L 3.600 m' : 'W 5.100 m'));

  const rX = Math.min(maxX + 30, innerWidth - 292);
  line(maxX + 9, minY, rX + 6, minY);
  line(maxX + 9, maxY, rX + 6, maxY);
  line(rX, minY, rX, maxY);
  line(rX - 4, minY, rX + 4, minY);
  line(rX - 4, maxY, rX + 4, maxY);
  text(rX - 9, (minY + maxY) / 2, SIM.blueprintView === 'top' ? 'L 3.600 m' : 'H 1.550 m', -90);

  line(minX, minY, maxX, minY, 'dim-line thin');
  line(minX, minY, minX, maxY, 'dim-line thin');
  line(minX - 10, minY - 8, minX - 10, minY, 'dim-line thin');
  const note = document.createElementNS(NS, 'text');
  note.setAttribute('x', '34');
  note.setAttribute('y', String(innerHeight - 144));
  note.setAttribute('fill', '#53748c');
  note.setAttribute('font-family', 'Consolas, monospace');
  note.setAttribute('font-size', '6.5');
  note.setAttribute('letter-spacing', '.12em');
  note.textContent = 'DESIGN ENVELOPE / FICTIONAL TARGETS / DATUM A — CEPHALOTHORAX BASE';
  frag.appendChild(note);
  svg.replaceChildren(frag);
}

/* ============================================================
   UI CONSTRUCTION — HIERARCHY / EXPLODE / MANUAL / CHARTS
   ============================================================ */
function countMeshes(root) {
  let n = 0;
  root?.traverse(o => { if (o.isMesh || o.isInstancedMesh) n++; });
  return n;
}

function buildHierarchy() {
  const host = $('#hierarchy');
  if (!host) return;
  const rows = [
    { id: 'armor', label: 'AR-08 / FULL ASSEMBLY', level: 0, count: pickMeshes.length },
    { id: 'carapace', label: 'CEPHALOTHORAX SHELL', level: 1, count: countMeshes(carapaceGroup) },
    { id: 'eyes', label: 'OPTIC SENSOR ARRAY', level: 2, count: countMeshes(eyeGroup) },
    { id: 'fang_L', label: 'CHELICERA — LEFT', level: 2, count: countMeshes(fangLGroup) },
    { id: 'fang_R', label: 'CHELICERA — RIGHT', level: 2, count: countMeshes(fangRGroup) },
    { id: 'pedipalp_L', label: 'PEDIPALP — LEFT', level: 2, count: countMeshes(pedipalpL) },
    { id: 'pedipalp_R', label: 'PEDIPALP — RIGHT', level: 2, count: countMeshes(pedipalpR) },
    { id: 'abdomen', label: 'SEGMENTED ABDOMEN', level: 1, count: countMeshes(abdomenGroup) },
    { id: 'spinneret', label: 'SPINNERET CLUSTER', level: 2, count: countMeshes(spinneretGroup) },
    { id: 'antenna', label: 'DORSAL ANTENNA PAIR', level: 2, count: countMeshes(antennaGroup) },
    { id: 'core', label: 'POWER CORE & COMPUTE', level: 1, count: countMeshes(internalsGroup) },
    { id: null, label: 'LOCOMOTION BUS / 8 CHAINS', level: 1, count: 8 },
    ...LEGS.map(l => ({ id: 'leg_' + l.id, label: 'LEG ASSEMBLY — ' + l.id, level: 2, count: countMeshes(l.group) }))
  ];
  host.innerHTML = rows.map(r => {
    const tag = r.id ? 'button' : 'div';
    return `<${tag} class="tree-row ${r.level === 0 ? 'root' : 'child'}" ${r.id ? `data-tree-part="${r.id}"` : ''} style="padding-left:${4 + r.level * 10}px">
      <span class="twig">${r.level === 0 ? '◆' : r.level === 1 ? '├' : '└'}</span>
      <span>${r.label}</span><span class="tcount">${r.count}</span></${tag}>`;
  }).join('');
  $$('[data-tree-part]', host).forEach(row => row.addEventListener('click', () => {
    const id = row.dataset.treePart;
    setSelected(id, null, partObjects[id]);
    $$('.tree-row', host).forEach(r => r.classList.toggle('active', r === row));
    toast((PART_DEFS[id]?.name || id).toUpperCase() + ' / SELECTED');
  }));
}

function buildExplodeList() {
  const host = $('#explodeList');
  if (!host) return;
  host.innerHTML = EXPLODE.map(d => `
    <button class="explode-item" data-explode="${d.id}" aria-label="Extract ${d.label}">
      <span class="eicon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M12 3l9 9-9 9-9-9 9-9Z"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg></span>
      <span class="ename">${d.label}<small style="display:block;font-family:var(--mono);font-size:5.5px;color:#aaa396;letter-spacing:.05em">${d.sub}</small></span>
      <span class="explode-switch on"></span>
    </button>`).join('');
  $$('.explode-item', host).forEach(row => {
    row.addEventListener('click', () => toggleExplode(row.dataset.explode));
  });
  updateExplodeUI();
}

function toggleExplode(id) {
  const d = EXPLODE.find(e => e.id === id);
  if (!d) return;
  d.on = !d.on;
  if (d.on && SIM.explodedAmt < .05) {
    SIM.explodedAmt = .72;
    const slider = $('#explodeSlider');
    if (slider) slider.value = 72;
  }
  updateExplodeUI();
  toast((d.on ? 'EXTRACT / ' : 'REASSEMBLE / ') + d.label.toUpperCase());
}

function updateExplodeUI() {
  $$('.explode-item').forEach(row => {
    const d = EXPLODE.find(e => e.id === row.dataset.explode);
    if (!d) return;
    const sw = row.querySelector('.explode-switch');
    if (sw) sw.classList.toggle('on', d.on);
    row.classList.toggle('active', d.on && SIM.explodedAmt > .01);
  });
  const on = EXPLODE.filter(d => d.on).length;
  const extracted = EXPLODE.filter(d => d.p > .03).length;
  const count = $('#explodeCount');
  if (count) count.textContent = on + ' / ' + EXPLODE.length;
  const ex = $('#extractedCount');
  if (ex) ex.textContent = String(extracted);
  const amt = Math.round(SIM.explodedAmt * 100);
  const va = $('#explodeAmountVal'), vo = $('#explodeAmountOut');
  if (va) va.textContent = amt;
  if (vo) vo.textContent = amt + '%';
  const slider = $('#explodeSlider');
  if (slider && Math.abs(Number(slider.value) - amt) > .5) slider.value = amt;
}

function buildManualControls() {
  const host = $('#manualLegButtons');
  if (!host) return;
  host.innerHTML = LEG_IDS.map(id => `<button class="axis-btn" data-manual-leg="${id}">${id}</button>`).join('');
  $$('.axis-btn[data-manual-leg]', host).forEach(btn => {
    btn.addEventListener('click', () => {
      SIM.manualLeg = btn.dataset.manualLeg;
      syncManualUI();
      if (!SIM.manual) toast('MANUAL TARGET / ' + SIM.manualLeg + ' — ENABLE POSE OVERRIDE');
    });
  });
  syncManualUI();
}

function syncManualUI() {
  $$('.axis-btn[data-manual-leg]').forEach(b => b.classList.toggle('active', b.dataset.manualLeg === SIM.manualLeg));
  const yv = $('#manualYawVal'), yov = $('#manualYawOut');
  if (yv) yv.textContent = Math.round(SIM.manualYaw);
  if (yov) yov.textContent = Math.round(SIM.manualYaw) + '°';
  const rv = $('#manualReachVal'), ro = $('#manualReachOut');
  if (rv) rv.textContent = SIM.manualReach.toFixed(2);
  if (ro) ro.textContent = SIM.manualReach.toFixed(2);
  const lv = $('#manualLiftVal'), lo = $('#manualLiftOut');
  if (lv) lv.textContent = SIM.manualLift.toFixed(2) + ' m';
  if (lo) lo.textContent = SIM.manualLift.toFixed(2) + ' m';
}

let chartCtx = null;
function drawChart() {
  const canvas = $('#sysChart');
  if (!canvas) return;
  if (!chartCtx) chartCtx = canvas.getContext('2d');
  const ctx = chartCtx;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#f9f7f3');
  bg.addColorStop(1, '#f3f0e9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(92,86,74,.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 14 + i * (H - 32) / 4;
    ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(W - 12, y); ctx.stroke();
  }
  for (let i = 0; i <= 8; i++) {
    const x = 34 + i * (W - 46) / 8;
    ctx.strokeStyle = 'rgba(92,86,74,.055)';
    ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, H - 18); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(105,99,88,.62)';
  ctx.font = '600 10px Consolas, monospace';
  ctx.fillText('100', 6, 22);
  ctx.fillText('50', 12, H * .5 + 4);
  ctx.fillText('0', 18, H - 12);
  const hist = SIM.history;
  if (!hist.length) return;
  const x0 = 34, x1 = W - 12, y0 = 16, y1 = H - 22;
  const point = (i, value) => ({
    x: x0 + (i / Math.max(1, hist.length - 1)) * (x1 - x0),
    y: lerp(y1, y0, clamp(value / 100, 0, 1))
  });
  // load area
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  grad.addColorStop(0, 'rgba(255,106,0,.26)');
  grad.addColorStop(1, 'rgba(255,106,0,.015)');
  ctx.beginPath();
  ctx.moveTo(point(0, hist[0].load).x, y1);
  hist.forEach((h, i) => { const p = point(i, h.load); ctx.lineTo(p.x, p.y); });
  ctx.lineTo(point(hist.length - 1, hist[hist.length - 1].load).x, y1);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  hist.forEach((h, i) => { const p = point(i, h.load); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = '#f56a0b';
  ctx.lineWidth = 2;
  ctx.stroke();
  // hydraulic
  ctx.beginPath();
  hist.forEach((h, i) => { const p = point(i, h.hyd); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = '#2f4350';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // temp dashed
  ctx.beginPath();
  hist.forEach((h, i) => { const p = point(i, h.temp); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = 'rgba(66,96,120,.4)';
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#6c675d';
  ctx.font = '600 9px Consolas, monospace';
  ctx.fillText('MOTOR LOAD', 34, 11);
  ctx.fillStyle = '#ff6a00';
  ctx.fillRect(W - 146, 5, 7, 4);
  ctx.fillStyle = '#6c675d';
  ctx.fillText('LOAD', W - 134, 10);
  ctx.fillStyle = '#2f4350';
  ctx.fillRect(W - 92, 5, 7, 4);
  ctx.fillStyle = '#6c675d';
  ctx.fillText('HYD', W - 80, 10);
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
}

function updateTimelineUI() {
  const pct = clamp(SIM.time / SIM.duration, 0, 1) * 100;
  const fill = $('#timelineFill'), head = $('#playhead');
  if (fill) fill.style.width = pct + '%';
  if (head) head.style.left = pct + '%';
  const scrub = $('#timelineScrub');
  if (scrub && !SIM.scrubbing && document.activeElement !== scrub) scrub.value = SIM.time;
  const time = $('#timeNow');
  if (time) time.textContent = formatTime(SIM.time);
}

function syncPlaybackUI() {
  const icon = $('#playIcon');
  if (icon) icon.setAttribute('href', SIM.playing ? '#i-pause' : '#i-play');
  const btn = $('#playPause');
  if (btn) {
    btn.setAttribute('aria-label', SIM.playing ? 'Pause animation' : 'Play animation');
    btn.title = SIM.playing ? 'Pause' : 'Play';
  }
  $$('.speed-btn').forEach(b => b.classList.toggle('active', Math.abs(Number(b.dataset.speed) - SIM.speed) < .01));
}

function togglePlay() {
  SIM.playing = !SIM.playing;
  syncPlaybackUI();
  toast(SIM.playing ? 'SIMULATION RUNNING / ' + SIM.speed.toFixed(1) + '×' : 'SIMULATION PAUSED');
}

function stepFrame(dir) {
  SIM.playing = false;
  SIM.scrubbing = true;
  SIM.time = (SIM.time + dir / 30 + SIM.duration) % SIM.duration;
  clearTimeout(stepFrame._t);
  stepFrame._t = setTimeout(() => { SIM.scrubbing = false; }, 380);
  syncPlaybackUI();
  updateSimulation(.016);
  updateCamera(.016);
  updateTimelineUI();
}

function seekTimeline(value) {
  SIM.time = clamp(value, 0, SIM.duration);
  SIM.scrubbing = true;
  clearTimeout(seekTimeline._t);
  seekTimeline._t = setTimeout(() => { SIM.scrubbing = false; }, 520);
  updateTimelineUI();
}

function updatePerformance(dt) {
  if (!SIM._fpsAcc) { SIM._fpsAcc = 0; SIM._fpsFrames = 0; SIM.fps = 60; SIM._qualityStep = 0; SIM._lowTime = 0; }
  SIM._fpsAcc += dt;
  SIM._fpsFrames++;
  if (SIM._fpsAcc >= .8) {
    SIM.fps = SIM._fpsFrames / SIM._fpsAcc;
    SIM._fpsAcc = 0; SIM._fpsFrames = 0;
    const fpsEl = $('#fpsValue');
    if (fpsEl) fpsEl.textContent = Math.round(SIM.fps) + ' FPS';
    if (SIM.fps < 39 && performance.now() > 9000) {
      SIM._lowTime += .8;
      if (SIM._lowTime > 2.2 && SIM._qualityStep < 2) {
        SIM._qualityStep++;
        SIM._lowTime = 0;
        if (SIM._qualityStep === 1) {
          const target = Math.max(1, renderer.getPixelRatio() * .72);
          renderer.setPixelRatio(target);
          renderer.setSize(innerWidth, innerHeight, false);
          resizePost();
          toast('ADAPTIVE QUALITY / RENDER SCALE ' + target.toFixed(2) + '×');
        } else {
          SIM.ao = false;
          syncAllSwitches();
          toast('ADAPTIVE QUALITY / AO DISABLED');
        }
      }
    } else {
      SIM._lowTime = 0;
    }
  }
}

/* ============================================================
   LIVE INTERFACE UPDATE
   ============================================================ */
let interfaceAcc = 0, chartAcc = 0, dimensionAcc = 0;
function text(id, value) { const el = $('#' + id); if (el) el.textContent = value; }
function bar(id, pct) { const el = $('#' + id); if (el) el.style.width = clamp(pct, 0, 100).toFixed(1) + '%'; }

function updateInterface(dt) {
  updateTimelineUI();
  interfaceAcc += dt;
  chartAcc += dt;
  dimensionAcc += dt;
  if (interfaceAcc >= .11) {
    interfaceAcc = 0;
    const load = Math.round(SIM.motorLoad);
    text('powerVal', SIM.power.toFixed(1) + '%');
    bar('powerBar', SIM.power);
    text('loadVal', load + '%');
    bar('loadBar', load);
    text('tempVal', SIM.coreTemp.toFixed(1) + ' °C');
    bar('tempBar', clamp((SIM.coreTemp - 30) / 40 * 100, 0, 100));
    text('hydVal', Math.round(SIM.hydraulic) + '%');
    bar('hydBar', SIM.hydraulic);
    text('sysTemp', SIM.coreTemp.toFixed(1));
    bar('sysTempBar', clamp((SIM.coreTemp - 30) / 40 * 100, 0, 100));
    text('sysHyd', Math.round(SIM.hydraulic * 2.1));
    bar('sysHydBar', SIM.hydraulic);
    text('busHyd', SIM.hydraulic > 82 ? 'HIGH' : 'NOMINAL');
    text('partCount', (COUNTS.meshes + COUNTS.instances).toLocaleString());
    text('meshCount', pickMeshes.length.toLocaleString());
    const info = renderer.info.render;
    text('drawCalls', info.calls + ' CALLS');
    text('triCount', info.triangles.toLocaleString() + ' TRIS');
    text('renderInfo', info.calls + ' / ' + Math.round(info.triangles / 1000) + 'K');
    const rq = $('#renderQualityLabel');
    if (rq) rq.textContent = POST.enabled ? (POST.hdr ? 'HDR' : 'SDR') + ' / ' + (SIM.ao ? 'AO ACTIVE' : 'AO OFF') + (POST.samples ? ' / MSAA' : '') : 'DIRECT / FALLBACK';
    const planted = LEGS.filter(l => l.footContact).length;
    text('plantedCount', planted);
    text('extractedCount', EXPLODE.filter(d => d.p > .03).length);
    text('gaitPhaseLabel', 'GROUP ' + (SIM.gaitPhase < .5 ? 'A' : 'B'));
    const dots = $('#gaitDots');
    if (dots) {
      const active = SIM.gaitPhase < .5 ? 'A' : 'B';
      if (dots.dataset.active !== active) {
        dots.dataset.active = active;
        dots.innerHTML = LEGS.map(l => {
          const isActive = l.gaitGroup === active;
          const color = l.gaitGroup === 'A' ? (isActive ? '#ff6a00' : '#f1b995') : (isActive ? '#272825' : '#c8c2b8');
          return '<span title="' + l.id + ' / GROUP ' + l.gaitGroup + '" style="width:9px;height:9px;border-radius:50%;background:' + color + ';box-shadow:' + (isActive ? '0 0 0 3px rgba(255,106,0,.09)' : 'none') + '"></span>';
        }).join('');
      }
    }
    const leg = LEGS.find(l => l.id === SIM.manualLeg);
    if (leg) {
      text('angleHip', (leg.yawAngle / DEG).toFixed(1) + '°');
      text('angleFemur', (leg.femur.rotation.x / DEG).toFixed(1) + '°');
      text('angleTibia', (leg.tibia.rotation.x / DEG).toFixed(1) + '°');
      text('contactState', leg.footContact ? 'PLANTED' : 'AIRBORNE');
    }
    const secVal = $('#sectionVal');
    if (secVal) secVal.textContent = SIM.cutPos.toFixed(2);
    const exA = $('#explodeAmountVal'), exO = $('#explodeAmountOut');
    const amt = Math.round(SIM.explodedAmt * 100);
    if (exA) exA.textContent = amt;
    if (exO) exO.textContent = amt + '%';
    const servo = $('#servoCount');
    if (servo) servo.textContent = (SIM.playing ? 32 : 18) + ' / 32';
  }
  if (chartAcc >= .18) {
    chartAcc = 0;
    SIM.history.push({
      load: clamp(SIM.motorLoad, 0, 100),
      hyd: clamp(SIM.hydraulic, 0, 100),
      temp: clamp((SIM.coreTemp - 30) / 40 * 100, 0, 100)
    });
    if (SIM.history.length > 72) SIM.history.shift();
    drawChart();
    if (SIM.tab === 'blueprint') drawDimensionOverlay();
  }
  if (dimensionAcc >= .5) {
    dimensionAcc = 0;
    updateTimelineUI();
  }
}

/* ============================================================
   VIEW / EXPLOSION HELPERS
   ============================================================ */
function focusSelection() {
  if (!selectedObject) { toast('NO COMPONENT SELECTED'); return; }
  selectedObject.updateWorldMatrix(true, true);
  const box = new T.Box3().setFromObject(selectedObject);
  const sphere = box.getBoundingSphere(new T.Sphere());
  focusObjectInView(selectedObject, Math.max(.2, sphere.radius));
  ORBIT.targetGoal.copy(sphere.center);
  toast('FOCUS / ' + ($('#selectedName')?.textContent || 'COMPONENT').toUpperCase());
}

function inspectGearbox(legId = 'L1') {
  const leg = LEGS.find(l => l.id === legId) || LEGS[0];
  if (!leg) return;
  const obj = leg.kneeGear;
  obj.updateWorldMatrix(true, true);
  const box = new T.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new T.Sphere());
  setSelected('gearbox', 'Knee Planetary Gearbox — ' + leg.id, obj);
  focusObjectInView(obj, Math.max(.22, sphere.radius));
  ORBIT.targetGoal.copy(sphere.center);
  toast('GEARBOX INSPECTION / ' + leg.id + ' KNEE / 18:1 PLANETARY');
}

function extractAll() {
  EXPLODE.forEach(d => { d.on = true; });
  SIM.explodedAmt = 1;
  const slider = $('#explodeSlider');
  if (slider) slider.value = 100;
  updateExplodeUI();
  toast('ALL ASSEMBLIES EXTRACTING / SPRING DAMPED');
}

function assembleAll() {
  EXPLODE.forEach(d => { d.on = true; });
  SIM.explodedAmt = 0;
  const slider = $('#explodeSlider');
  if (slider) slider.value = 0;
  updateExplodeUI();
  toast('REASSEMBLY / CRITICAL SPRING RETURN');
}

function syncCutUI() {
  $$('.axis-btn[data-cut]').forEach(b => b.classList.toggle('active', b.dataset.cut === SIM.cut));
  updateSectionClip();
}

function onWindowResize() {
  const w = Math.max(320, innerWidth), h = Math.max(240, innerHeight);
  perspectiveCamera.aspect = w / h;
  perspectiveCamera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_CAP));
  renderer.setSize(w, h, false);
  updateOrthoFrustum();
  resizePost();
  if (typeof updateCamera === 'function') updateCamera(.016);
}

/* ============================================================
   UI BINDINGS
   ============================================================ */
function setupUI() {
  window.addEventListener('resize', onWindowResize);
  renderer.info.autoReset = false;

  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      setTab(tab, true);
      if (tab === 'exploded' && SIM.explodedAmt < .02) {
        SIM.explodedAmt = .86;
        const slider = $('#explodeSlider');
        if (slider) slider.value = 86;
        updateExplodeUI();
      }
    });
  });

  const modeSelect = $('#modeSelect');
  if (modeSelect) modeSelect.addEventListener('change', () => setMode(modeSelect.value));

  buildModeList();
  buildHierarchy();
  buildExplodeList();
  buildManualControls();

  bindSwitch('autoRotateSwitch', () => SIM.autoRotate, v => {
    SIM.autoRotate = v;
    ORBIT.lastInteraction = performance.now();
    if (v) toast('AUTO-ORBIT / ENGAGED');
  });
  bindSwitch('calloutsSwitch', () => SIM.callouts, v => {
    SIM.callouts = v;
    toast(v ? 'OVERVIEW CALLOUTS / ON' : 'OVERVIEW CALLOUTS / OFF');
  });
  bindSwitch('transparentSwitch', () => SIM.transparency, v => {
    SIM.transparency = v;
    applyXray();
    toast(v ? 'TRANSPARENT ARMOR / ON' : 'TRANSPARENT ARMOR / OFF');
  });
  bindSwitch('internalSwitch', () => SIM.internalScan, v => {
    SIM.internalScan = v;
    applyXray();
    toast(v ? 'INTERNAL SCAN / ACTIVE' : 'INTERNAL SCAN / OFF');
  });
  bindSwitch('wireframeSwitch', () => SIM.wireframe, v => {
    SIM.wireframe = v;
    applyWireframe();
    toast(v ? 'STRUCTURAL WIREFRAME / ON' : 'STRUCTURAL WIREFRAME / OFF');
  });
  bindSwitch('aoSwitch', () => SIM.ao, v => {
    SIM.ao = v;
    toast(v ? 'GTAO AMBIENT OCCLUSION / ON' : 'GTAO AMBIENT OCCLUSION / OFF');
  });
  bindSwitch('gaitGovernorSwitch', () => SIM.gaitGovernor, v => {
    SIM.gaitGovernor = v;
    BODY_STATE.activeGroup = null;
    SIM.gaitPhase = 0;
    toast(v ? 'GAIT GOVERNOR / ALTERNATING TETRAPOD' : 'GAIT GOVERNOR / OPPORTUNISTIC');
  });
  bindSwitch('manualSwitch', () => SIM.manual, v => {
    SIM.manual = v;
    if (v && selectedId && selectedId.startsWith('leg_')) {
      SIM.manualLeg = selectedId.slice(4);
      syncManualUI();
    }
    toast(v ? 'MANUAL POSE OVERRIDE / ' + SIM.manualLeg : 'MANUAL POSE OVERRIDE / OFF');
  });
  bindSwitch('explodeCalloutsSwitch', () => SIM.explodeCallouts, v => {
    SIM.explodeCallouts = v;
    toast(v ? 'EXPLODED LEADER LINES / ON' : 'EXPLODED LEADER LINES / OFF');
  });
  bindSwitch('dimensionsSwitch', () => SIM.dimensions, v => {
    SIM.dimensions = v;
    applyDimensionsState();
    if (SIM.tab === 'blueprint') drawDimensionOverlay();
  });
  bindSwitch('jointAxesBpSwitch', () => SIM.jointAxes, v => {
    SIM.jointAxes = v;
    applyJointAxes();
  });
  bindSwitch('wireframeBpSwitch', () => SIM.bpWireframe, v => {
    SIM.bpWireframe = v;
    applyWireframe();
    toast(v ? 'EDGE WIREFRAME / ON' : 'EDGE WIREFRAME / OFF');
  });

  $('#structureXrayBtn')?.addEventListener('click', () => {
    const any = SIM.transparency || SIM.internalScan;
    SIM.transparency = !any;
    SIM.internalScan = !any;
    applyXray();
    toast(any ? 'X-RAY / OFF' : 'X-RAY / ARMOR TRANSPARENT');
  });
  $('#jointAxesBtn')?.addEventListener('click', () => {
    SIM.jointAxes = !SIM.jointAxes;
    applyJointAxes();
    toast(SIM.jointAxes ? 'JOINT AXES / VISIBLE' : 'JOINT AXES / HIDDEN');
  });

  $$('.cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.camera);
      if (btn.dataset.camera === 'reset') toast('CAMERA / HOME');
    });
  });
  $$('.view-sketch').forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.camera));
  });
  $$('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.bpView;
      setView(v);
      toast('DRAWING VIEW / ' + String(v).toUpperCase());
    });
  });

  $('#resetCameraHelp')?.addEventListener('click', () => {
    setView('reset');
    toast('CAMERA / RESET');
  });

  $$('.axis-btn[data-cut]').forEach(btn => {
    btn.addEventListener('click', () => {
      SIM.cut = btn.dataset.cut;
      syncCutUI();
      toast(SIM.cut === 'off' ? 'SECTION CUT / OFF' : 'SECTION CUT / ' + SIM.cut.toUpperCase() + ' AXIS');
    });
  });
  bindRange('sectionSlider', 'sectionVal', () => SIM.cutPos, v => {
    SIM.cutPos = v;
    updateSectionClip();
  }, v => v.toFixed(2));

  bindRange('gaitFreq', 'gaitFreqOut', () => SIM.gaitFreq, v => { SIM.gaitFreq = v; }, v => v.toFixed(2));
  bindRange('gaitStride', 'gaitStrideOut', () => SIM.gaitStride, v => { SIM.gaitStride = v; }, v => v.toFixed(2));
  bindRange('gaitLift', 'gaitLiftOut', () => SIM.gaitLift, v => { SIM.gaitLift = v; }, v => v.toFixed(2));

  const explodeSlider = $('#explodeSlider');
  if (explodeSlider) {
    explodeSlider.addEventListener('input', () => {
      SIM.explodedAmt = Number(explodeSlider.value) / 100;
      const out = $('#explodeAmountOut');
      if (out) out.textContent = Math.round(SIM.explodedAmt * 100) + '%';
      if (SIM.explodedAmt > .01) {
        EXPLODE.forEach(d => { if (!d.on) d.on = true; });
      }
      updateExplodeUI();
    });
  }
  $('#explodeAllBtn')?.addEventListener('click', extractAll);
  $('#explodeNoneBtn')?.addEventListener('click', assembleAll);

  const manualYaw = $('#manualYaw');
  const manualReach = $('#manualReach');
  const manualLift = $('#manualLift');
  manualYaw?.addEventListener('input', () => { SIM.manualYaw = Number(manualYaw.value); syncManualUI(); });
  manualReach?.addEventListener('input', () => { SIM.manualReach = Number(manualReach.value); syncManualUI(); });
  manualLift?.addEventListener('input', () => { SIM.manualLift = Number(manualLift.value); syncManualUI(); });
  $('#manualResetBtn')?.addEventListener('click', () => {
    SIM.manualYaw = 0; SIM.manualReach = 1; SIM.manualLift = 0;
    if (manualYaw) manualYaw.value = 0;
    if (manualReach) manualReach.value = 1;
    if (manualLift) manualLift.value = 0;
    syncManualUI();
    toast('MANUAL OFFSET / RESET');
  });

  $$('.chip[data-part]').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.part;
      setSelected(id, null, partObjects[id]);
      toast((PART_DEFS[id]?.name || id).toUpperCase() + ' / SELECTED');
    });
  });
  $('#clearSelection')?.addEventListener('click', () => {
    clearSelection();
    toast('SELECTION / CLEARED');
  });
  $('#focusPartBtn')?.addEventListener('click', focusSelection);
  $('#inspectSystemBtn')?.addEventListener('click', () => {
    setTab('systems', true);
    toast('SYSTEMS / DIAGNOSTIC BUS');
  });
  $('#inspectGearBtn')?.addEventListener('click', () => inspectGearbox('L1'));
  $('#gearboxInspectBtn')?.addEventListener('click', () => inspectGearbox('L1'));
  $('#bpWireToggleBtn')?.addEventListener('click', () => {
    SIM.bpWireframe = !SIM.bpWireframe;
    applyWireframe();
    toast(SIM.bpWireframe ? 'EDGE WIREFRAME / ON' : 'EDGE WIREFRAME / OFF');
  });

  $('#playPause')?.addEventListener('click', togglePlay);
  $('#btnFirst')?.addEventListener('click', () => {
    SIM.playing = false;
    syncPlaybackUI();
    seekTimeline(0);
  });
  $('#btnPrev')?.addEventListener('click', () => stepFrame(-1));
  $('#btnNext')?.addEventListener('click', () => stepFrame(1));
  $('#btnRestart')?.addEventListener('click', () => {
    seekTimeline(0);
    SIM.playing = true;
    syncPlaybackUI();
    toast('TIMELINE / RESTART');
  });
  const scrub = $('#timelineScrub');
  if (scrub) {
    scrub.addEventListener('input', () => seekTimeline(Number(scrub.value)));
    scrub.addEventListener('pointerdown', () => { SIM.scrubbing = true; });
  }
  $$('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SIM.speed = Number(btn.dataset.speed);
      syncPlaybackUI();
      toast('PLAYBACK SPEED / ' + SIM.speed.toFixed(1) + '×');
    });
  });

  $('#fullscreenBtn')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => toast('FULLSCREEN / UNAVAILABLE'));
    } else {
      document.exitFullscreen?.();
    }
  });

  window.addEventListener('keydown', e => {
    const target = e.target;
    if (target && (target.matches?.('input, select, textarea') || target.isContentEditable)) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepFrame(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepFrame(-1);
    } else if (e.key === 'r' || e.key === 'R') {
      setView('reset');
      ORBIT.focusObject = null;
      toast('CAMERA / RESET');
    } else if (e.key === 'Escape') {
      ORBIT.focusObject = null;
      ORBIT.panOffset.set(0, 0, 0);
      clearSelection();
    }
  });

  syncCutUI();
  syncPlaybackUI();
  syncManualUI();
  syncAllSwitches();
  applyDimensionsState();
  if (scrub) scrub.value = SIM.time;
}

/* ============================================================
   BOOT SEQUENCE / RENDER LOOP
   ============================================================ */
function finishBoot() {
  setBoot(100, 'READY');
  setTab('overview', false);
  setView('iso', true);
  setProjectionMode('persp');
  syncModeUI();
  syncPlaybackUI();
  syncManualUI();
  syncAllSwitches();
  syncCutUI();
  applyXray();
  applyWireframe();
  applyJointAxes();
  applyDimensionsState();
  updateExplodeUI();
  setSelected('carapace', null, partObjects.carapace);
  if (SIM.history.length === 0) drawChart();
  ORBIT.lastInteraction = performance.now();

  updateSimulation(.016);
  updateExplosion(.016);
  updateCamera(.016);
  updateCallouts();
  updateSelectionHelper();
  updateSectionClip();
  updateTimelineUI();
  updateInterface(0);

  SIM.booted = true;
  rendererInfo.reset();
  renderFrame();

  requestAnimationFrame(() => {
    const loading = $('#loading');
    if (loading) {
      loading.classList.add('hide');
      setTimeout(() => { loading.style.display = 'none'; }, 720);
    }
    setTimeout(() => toast('AR-08 ONLINE / CLICK ANY COMPONENT TO INSPECT', 2600), 900);
    animate();
  });
}

let animationStarted = false;
function animate() {
  if (animationStarted) return;
  animationStarted = true;
  clock.getDelta();
  const frame = () => {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), .05);
    updateSimulation(dt);
    updateExplosion(dt);
    updateCamera(dt);
    updateSectionClip();
    updateCallouts();
    updateSelectionHelper();
    updatePerformance(dt);
    rendererInfo.reset();
    renderFrame();
    updateInterface(dt);
  };
  requestAnimationFrame(frame);
}

const bootPlan = [
  () => { defineMaterials(); buildStudioEnvironment(); },
  () => { LIGHTS = buildLights(); buildFloor(); },
  () => { initSharedGeometry(); buildBody(); },
  () => { buildLegs(); },
  () => { initSectionTools(); buildExplosionSystem(); buildCallouts(); setupPointerControls(); },
  () => { buildPost(); },
  () => { setupUI(); },
  () => { finishBoot(); }
];

let bootIndex = 0;
function bootNext() {
  if (bootIndex >= bootPlan.length) return;
  const task = bootTasks[bootIndex] || ['', 100];
  setBoot(task[1], task[0]);
  requestAnimationFrame(() => setTimeout(() => {
    try {
      bootPlan[bootIndex]();
      bootIndex++;
      bootNext();
    } catch (err) {
      fatal(err);
    }
  }, 18));
}

function fatal(err) {
  console.error('AR-08 boot failure:', err);
  const es = $('#errorScreen'), et = $('#errorText');
  if (et) et.textContent = 'Initialisation failed: ' + (err?.message || String(err));
  if (es) es.classList.add('show');
  const loading = $('#loading');
  if (loading) loading.classList.add('hide');
}

window.addEventListener('error', ev => {
  if (!SIM.booted) fatal(ev.error || new Error(ev.message || 'Unknown error'));
});
window.addEventListener('unhandledrejection', ev => {
  if (!SIM.booted) fatal(ev.reason || new Error('Unhandled promise rejection'));
});

/* Small, explicit debug surface for inspection and automated capture. */
window.AR08 = {
  SIM, ORBIT, LEGS, EXPLODE, PART_DEFS, scene, renderer,
  get POST() { return POST; },
  get LIGHTS() { return LIGHTS; },
  get floor() { return floor; },
  get contactShadow() { return contactShadow; },
  setTab, setMode, setView, setProjectionMode, setSelected, focusPart, focusSelection,
  inspectGearbox, extractAll, assembleAll, updateSimulation, updateExplosion,
  updateCamera, updateSectionClip, updateTimelineUI, updateInterface, renderFrame,
  renderAt(seconds) {
    SIM.time = ((seconds % SIM.duration) + SIM.duration) % SIM.duration;
    SIM.scrubbing = true;
    applyScrubPose();
    LEGS.forEach(leg => { solveLegIK(leg, leg.footWorld); updatePiston(leg); });
    updateBody(.016, 0);
    updateSecondary(.016);
    updateCamera(.016);
    updateSectionClip();
    rendererInfo.reset();
    renderFrame();
    SIM.scrubbing = false;
  }
};

bootNext();

})();







