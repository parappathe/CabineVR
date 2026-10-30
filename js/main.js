// Liga o núcleo (voo, missões, robô) à tela, ao Quest (manche e manete na cabine) e ao mouse/teclado.
import * as THREE from '../vendor/three/three.module.js';
import { MISSIONS, SECTORS } from './missions.js';
import { Mission, DT, LOCK, SHIELD, MISSILE, angleBetween } from './mission.js';
import { PLANE } from './flight.js';
import { makeRobot } from './robot.js';
import { RIM } from './env.js';
import {
  buildWorld, buildEnv, buildCockpit, jetGeometry, entityMesh, portalMesh, Tracers, Particles, Markers,
  missileMesh, flameMesh,
} from './scene.js';
import { Panel, Label, C as UI } from './ui.js';
import { Sfx } from './audio.js';
import { loadSave, storeSave } from './save.js';

const save = loadSave();
const sfx = new Sfx();
sfx.on = save.sound;
const IS_QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtT = (t) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const MOVERS = new Set(['fighter', 'ace', 'bomber']);

// ---------- render e cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_QUEST ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.getElementById('app').appendChild(renderer.domElement);

const world = buildWorld();
const { scene, mats } = world;
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 12000);

// avião do jogador: o grupo segue a posição e a atitude do caça; a cabine fica no olho do piloto
const planeGroup = new THREE.Group();
scene.add(planeGroup);
const jet = new THREE.Mesh(jetGeometry(), mats.flat);
planeGroup.add(jet);
const jetFlame = flameMesh(0.55, 2.6);
jetFlame.position.set(0, 0, 6.6);
jet.add(jetFlame);
const EYE = new THREE.Vector3(0, 0.95, -2.4);       // olho do piloto no avião
const cockpit = buildCockpit(mats);
cockpit.group.position.copy(EYE);
planeGroup.add(cockpit.group);
const rig = new THREE.Group();                        // VR: referência do óculos; PC: cabeça
rig.position.copy(EYE);
planeGroup.add(rig);
rig.add(camera);

// anel do olhar (cone da trava) preso na cabeça
const GAZE_D = 3;
const gazeRing = new THREE.Mesh(new THREE.RingGeometry(GAZE_D * Math.tan(LOCK.cone) * 0.92, GAZE_D * Math.tan(LOCK.cone), 32),
  new THREE.MeshBasicMaterial({ color: '#ffd678', transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, fog: false }));
gazeRing.position.z = -GAZE_D;
gazeRing.renderOrder = 9;
camera.add(gazeRing);
const lockArc = new THREE.Mesh(new THREE.RingGeometry(GAZE_D * Math.tan(LOCK.cone) * 0.75, GAZE_D * Math.tan(LOCK.cone) * 0.86, 32, 1, 0, Math.PI * 2),
  new THREE.MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false }));
lockArc.position.z = -GAZE_D + 0.01;
lockArc.renderOrder = 9;
camera.add(lockArc);

// vinheta de conforto e clarão vermelho de dano
const vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.ShaderMaterial({
  uniforms: { uA: { value: 0 }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform float uA; uniform float uHurt; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float v = uA * smoothstep(0.4, 0.95, r); float h = uHurt * smoothstep(0.25, 1.0, r); gl_FragColor = vec4(mix(vec3(0.0), vec3(0.75, 0.08, 0.04), h / max(0.001, v + h)), max(v, h)); }',
  transparent: true, depthTest: false, depthWrite: false,
}));
vignette.position.z = -0.1;
vignette.renderOrder = 20;
vignette.visible = false;
camera.add(vignette);

// menu e placas
const panel = new Panel(0.9);
const fpsLabel = new Label(0.12);
fpsLabel.mesh.position.set(0.16, -0.14, -0.6);
fpsLabel.mesh.visible = false;
camera.add(fpsLabel.mesh);
const msgLabel = new Label(0.62, 1024, 110);          // avisos no VR, acima do painel
msgLabel.mesh.position.set(0, 0.2, -1.1);
cockpit.group.add(msgLabel.mesh);

const tracersMe = new Tracers(scene, '#ffd36a', 260, 9, 0.3);
const tracersFoe = new Tracers(scene, '#ff4ad2', 260, 7, 0.4);
const particles = new Particles(scene, 800);
const markers = new Markers(scene, 60);
const missilePool = [];
for (let i = 0; i < 16; i++) { const mm = missileMesh(mats); mm.visible = false; scene.add(mm); missilePool.push(mm); }

// ---------- estado ----------
let app = 'menu';            // 'menu' | 'brief' | 'playing' | 'paused' | 'done'
let levelIndex = 0;
let mission = null;
let envView = null, envKey = null;
const entMeshes = new Map();
let robot = null;
let msg = null;
let doneTimer = 0;
let lastResult = null, newRecord = false;
let hurtFlash = 0;
const robotMenu = makeRobot();

const unlockedUpTo = () => {
  let n = 0;
  while (n < MISSIONS.length && save.done[n]) n++;
  return Math.min(n, MISSIONS.length - 1);
};

function loadMission(i, seed = 1 + Math.floor(Math.random() * 1000)) {
  levelIndex = clamp(i, 0, MISSIONS.length - 1);
  const def = MISSIONS[levelIndex];
  mission = new Mission(def, { seed });
  world.setTheme(mission.env.type);
  const key = levelIndex;
  if (envKey !== key) {
    if (envView) { scene.remove(envView.group); envView.dispose(); }
    envView = buildEnv(mission.env, mats);
    scene.add(envView.group);
    envKey = key;
  }
  for (const m of entMeshes.values()) scene.remove(m);
  entMeshes.clear();
  robot?.reset(); robotMenu.reset();
  pc.stick.x = pc.stick.y = 0;
  pc.throttle = mission.plane.throttle;
  holds.right = holds.left = null;
  acc = 0; msg = null; chase.init = false;
  syncPlane();
  syncEntities(0);
}

function startLevel(i, brief = true) {
  loadMission(i);
  doneTimer = 0;
  if (brief) { app = 'brief'; showScreen('brief'); }
  else { app = 'playing'; panel.hide(); showMsg(MISSIONS[levelIndex].hint, 6, '#ffe7b0'); }
  updateHint();
}
function takeOff() {
  app = 'playing';
  panel.hide();
  showMsg(MISSIONS[levelIndex].hint, 6, '#ffe7b0');
  updateHint();
}
function togglePause() {
  if (app === 'playing') { app = 'paused'; showScreen('pause'); }
  else if (app === 'paused') { app = 'playing'; panel.hide(); }
  updateHint();
}
function goMenu() {
  app = 'menu';
  loadMission(unlockedUpTo());
  mission.shield = 1e9;
  showScreen('main');
  updateHint();
}
function showMsg(text, t = 2, color = '#ffd678') { msg = { text, t, color }; }

// ---------- menus ----------
const objLine = (def) => {
  const o = def.obj;
  if (o.type === 'race') return `Passe pelos ${def.spawn.filter(s => s.k === 'portal').length} portais em ordem`;
  if (o.type === 'escort') return `Escolte o ${o.who} até o fim`;
  if (o.type === 'defend') return `Proteja o ${o.who} por ${o.time} s`;
  if (o.type === 'boss') return o.label;
  return `${o.label}${o.count ? `: ${o.count}` : ''}${o.limit ? ` em até ${o.limit} s` : ''}`;
};
const starLine = (def) => {
  const s = def.stars;
  const second = s.ally != null ? `aliado com ${Math.round(s.ally * 100)}% da vida` : `até ${fmtT(s.time)}`;
  return `★ vencer   ★ ${second}   ★ dano até ${s.dmg}`;
};
function showScreen(name) {
  const vr = renderer.xr.isPresenting;
  if (document.pointerLockElement) { ignoreUnlock = true; document.exitPointerLock(); }
  placePanel();
  panel.show((p) => {
    if (name === 'main') {
      p.title('Esquadrilha', 78);
      p.text('Combate aéreo de dentro da cabine: manche, manete e mísseis no olhar.', 512, 140, { size: 26, color: UI.dim });
      const next = unlockedUpTo();
      p.button(save.done[0] ? `Continuar: missão ${next + 1}` : 'Começar', () => startLevel(next), 262, 180, 500, 92, { size: 38 });
      p.button('Escolher missão', () => showScreen('levels'), 262, 288, 500, 76);
      p.button('Como jogar', () => showScreen('help'), 262, 380, 500, 76);
      const opt = (label, val, act, x) => p.button(`${label}: ${val}`, () => { act(); storeSave(save); showScreen('main'); }, x, 476, 176, 64, { size: 22 });
      opt('Som', save.sound ? 'sim' : 'não', () => { save.sound = !save.sound; sfx.setOn(save.sound); }, 152);
      opt('Vinheta', save.vignette ? 'sim' : 'não', () => { save.vignette = !save.vignette; }, 336);
      opt('Horizonte', save.horizon === 'firm' ? 'firme' : 'livre', () => { save.horizon = save.horizon === 'firm' ? 'full' : 'firm'; }, 520);
      opt('FPS', save.fps ? 'sim' : 'não', () => { save.fps = !save.fps; }, 704);
      const total = Object.values(save.done).reduce((s, d) => s + (d.stars || 0), 0);
      p.text(`Estrelas: ${total} de ${MISSIONS.length * 3}`, 512, 584, { size: 26, color: UI.star, bold: true });
      p.text(vr ? 'Segure o botão lateral (aperto) da direita no manche e da esquerda na manete'
        : 'No Quest: abra esta página no navegador do óculos e aperte "Entrar em VR"', 512, 630, { size: 21, color: UI.dim });
      p.text('Horizonte firme: a visão inclina só metade nas curvas (mais confortável)', 512, 664, { size: 19, color: UI.dim });
    } else if (name === 'levels') {
      p.title('Missões', 60);
      const up = unlockedUpTo();
      SECTORS.forEach((sname, gi) => {
        const y = 104 + gi * 180;
        p.text(`Setor ${gi + 1}: ${sname}`, 60, y, { size: 24, align: 'left', bold: true, color: UI.edge });
        for (let c = 0; c < 4; c++) {
          const i = gi * 4 + c, l = MISSIONS[i], d = save.done[i];
          p.tile(60 + c * 230, y + 18, 214, 140, { num: i + 1, name: l.name, stars: d?.stars || 0, done: !!d, locked: i > up, master: c === 3, action: () => startLevel(i) });
        }
      });
      p.button('Voltar', () => showScreen(app === 'paused' ? 'pause' : 'main'), 362, 640, 300, 58, { size: 28 });
    } else if (name === 'help') {
      p.title('Como jogar', 64);
      const rows = vr ? [
        'Aperto direito: segura o manche. Para a frente desce o nariz,',
        'para trás sobe; para os lados inclina (e o avião faz a curva).',
        'Aperto esquerdo: segura a manete. Empurre = acelera, puxe = freia.',
        'Gatilho direito: metralhadora.  X ou A: turbo curto.',
        'Míssil: olhe para um inimigo ~1 s (o anel fica vermelho) e',
        'aperte o gatilho esquerdo. Soltar o manche nivela o avião.',
        'Escudo recarrega sozinho depois de uns segundos.  B ou Y: pausa.',
      ] : [
        'Mouse: manche (para cima desce o nariz, para baixo sobe).',
        'Mouse de volta ao meio = manche solto: o avião se nivela.',
        'Setas ou A/D também mexem o manche.  W/S ou roda: manete.',
        'Clique esquerdo: metralhadora.  Espaço: turbo curto.',
        'Míssil: deixe o inimigo no anel do meio da tela ~1 s até',
        'travar (anel vermelho) e dê clique direito.',
        'C: câmera de cabine / de trás.  Esc: pausa.  R: recomeça.',
      ];
      rows.forEach((t, i) => p.text(t, 64, 140 + i * 56, { size: 25, align: 'left' }));
      p.button('Voltar', () => showScreen(app === 'paused' ? 'pause' : app === 'brief' ? 'brief' : 'main'), 362, 562, 300, 80);
    } else if (name === 'brief') {
      const def = MISSIONS[levelIndex], d = save.done[levelIndex];
      p.text(`Setor ${def.sector + 1}: ${SECTORS[def.sector]}  ·  Missão ${levelIndex + 1}${def.boss ? '  ·  CHEFE' : ''}`, 512, 62, { size: 24, color: UI.edge, bold: true });
      p.title(def.name, 122);
      wrapText(p, def.brief, 512, 206, 860, 30);
      p.text(`Objetivo: ${objLine(def)}`, 512, 300, { size: 27, bold: true });
      p.text(starLine(def), 512, 346, { size: 24, color: UI.star, bold: true });
      if (d) p.text(`Melhor: ${d.stars} estrela${d.stars === 1 ? '' : 's'} · ${fmtT(d.time)} · dano ${Math.round(d.dmg)}`, 512, 386, { size: 22, color: UI.dim });
      p.button('Decolar', () => takeOff(), 262, 420, 500, 100, { size: 44, on: true });
      p.button('Como jogar', () => showScreen('help'), 262, 540, 245, 70, { size: 26 });
      p.button('Missões', () => showScreen('levels'), 517, 540, 245, 70, { size: 26 });
      p.text(vr ? 'Segure o manche (aperto direito) para pilotar' : 'Clique na tela para o mouse virar o manche', 512, 650, { size: 21, color: UI.dim });
    } else if (name === 'pause') {
      p.title('Pausa', 66);
      p.text(`Missão ${levelIndex + 1}: ${MISSIONS[levelIndex].name}`, 512, 126, { size: 26, color: UI.dim });
      p.button('Continuar', () => togglePause(), 262, 160, 500, 78);
      p.button('Recomeçar a missão', () => startLevel(levelIndex, false), 262, 250, 500, 78);
      p.button('Escolher missão', () => showScreen('levels'), 262, 340, 500, 78);
      p.button('Recentralizar', () => { recenter(); togglePause(); }, 262, 430, 245, 78, { size: 28, locked: !vr });
      p.button('Como jogar', () => showScreen('help'), 517, 430, 245, 78, { size: 28 });
      p.button('Mais baixo', () => { save.height -= 0.05; storeSave(save); recenter(); showScreen('pause'); }, 262, 520, 160, 62, { size: 24, locked: !vr });
      p.text(vr ? `altura ${save.height >= 0 ? '+' : ''}${Math.round(save.height * 100)} cm` : '', 512, 551, { size: 22, color: UI.dim });
      p.button('Mais alto', () => { save.height += 0.05; storeSave(save); recenter(); showScreen('pause'); }, 602, 520, 160, 62, { size: 24, locked: !vr });
      p.button('Menu principal', () => goMenu(), 262, 600, 500, 72);
    } else if (name === 'done') {
      const r = lastResult, def = MISSIONS[levelIndex], d = save.done[levelIndex];
      if (r.won) {
        p.title(newRecord ? 'Novo recorde!' : 'Missão cumprida!', 70);
        p.stars(r.stars, 512, 150, 78);
        const second = def.stars.ally != null ? `aliado com ${Math.round((r.ally ?? 0) * 100)}%` : `tempo ${fmtT(r.time)}`;
        p.text(`${second}  ·  dano levado ${Math.round(r.dmg)}  ·  abates ${r.kills}`, 512, 226, { size: 28, bold: true });
        p.text(starLine(def), 512, 270, { size: 22, color: UI.dim });
        if (d) p.text(`Melhor: ${d.stars} estrela${d.stars === 1 ? '' : 's'} · ${fmtT(d.time)} · dano ${Math.round(d.dmg)}`, 512, 306, { size: 22, color: UI.dim });
        if (levelIndex < MISSIONS.length - 1) p.button('Próxima missão', () => startLevel(levelIndex + 1), 262, 344, 500, 92, { size: 36, on: true });
        else p.text('Você venceu a guerra aérea!', 512, 390, { size: 36, bold: true, color: UI.edge });
      } else {
        p.title('Missão falhou', 76);
        p.text(r.reason, 512, 160, { size: 32, bold: true, color: UI.red });
        p.text(MISSIONS[levelIndex].hint, 512, 220, { size: 22, color: UI.dim });
        p.button('Tentar de novo', () => startLevel(levelIndex, false), 262, 344, 500, 92, { size: 36, on: true });
      }
      p.button('Repetir', () => startLevel(levelIndex, false), 262, 456, 245, 76);
      p.button('Missões', () => showScreen('levels'), 517, 456, 245, 76);
      p.button('Menu principal', () => goMenu(), 262, 552, 500, 76);
    }
  });
}
function wrapText(p, text, x, y, maxW, size) {
  const g = p.ctx;
  g.font = `${size}px sans-serif`;
  const words = text.split(' ');
  let line = '', lines = [];
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  lines.forEach((l, i) => p.text(l, x, y + i * size * 1.3, { size }));
}

function placePanel() {
  if (renderer.xr.isPresenting) {
    if (panel.mesh.parent !== cockpit.group) cockpit.group.add(panel.mesh);
    panel.mesh.scale.setScalar(1);
    panel.mesh.position.set(0, 0.02 + save.height, -1.05);
    panel.mesh.rotation.set(-0.05, 0, 0);
    return;
  }
  if (panel.mesh.parent !== camera) camera.add(panel.mesh);
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const visH = 2 * 0.8 * Math.tan(half), visW = visH * camera.aspect;
  panel.mesh.position.set(0, 0, -0.8);
  panel.mesh.rotation.set(0, 0, 0);
  panel.mesh.scale.setScalar(Math.min(1, visW * 0.94 / 0.9, visH * 0.92 / (0.9 * 720 / 1024)));
}

function finishMission() {
  const r = mission.result;
  lastResult = r;
  if (r.won) {
    const prev = save.done[levelIndex];
    newRecord = !prev || r.stars > prev.stars || (r.stars === prev.stars && r.time < prev.time);
    if (newRecord) save.done[levelIndex] = { stars: Math.max(r.stars, prev?.stars || 0), time: r.time, dmg: r.dmg };
    storeSave(save);
    for (let k = 0; k < r.stars; k++) setTimeout(() => sfx.star(k), 300 + k * 220);
  } else newRecord = false;
  app = 'done';
  showScreen('done');
  updateHint();
}

// ---------- controles do VR ----------
const ctrls = [];
const gloveGeo = new THREE.BoxGeometry(0.07, 0.04, 0.11);
const gloveMat = new THREE.MeshLambertMaterial({ color: '#3a3a40', flatShading: true });
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(ctrl, grip);
  const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xe2553a }));
  laser.visible = false;
  ctrl.add(laser);
  const glove = new THREE.Mesh(gloveGeo, gloveMat);
  glove.visible = false;
  grip.add(glove);
  const entry = { ctrl, grip, laser, glove, source: null, side: null, prevButtons: [], hoverIndex: -1 };
  ctrls.push(entry);
  ctrl.addEventListener('connected', (e) => { entry.source = e.data; entry.side = e.data.handedness; });
  ctrl.addEventListener('disconnected', () => { if (entry.side) holds[entry.side] = null; entry.source = null; entry.side = null; });
  ctrl.addEventListener('selectstart', () => onSelect(entry));
  ctrl.addEventListener('selectend', () => { if (entry.source?.hand && entry.side) holds[entry.side] = null; });
  ctrl.addEventListener('squeezestart', () => { sfx.unlock(); if (entry.side && !entry.source?.hand) grab(entry.side); });
  ctrl.addEventListener('squeezeend', () => { if (entry.side && !entry.source?.hand) holds[entry.side] = null; });
}
const entryFor = (side) => ctrls.find(e => e.side === side && e.source);
function pulse(side, v, ms) {
  try { entryFor(side)?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(clamp(v, 0, 1), ms); } catch { /* sem vibração */ }
}
const both = (v, ms) => { pulse('left', v, ms); pulse('right', v, ms); };

// posição da mão no espaço da cabine (o mesmo do manche e da manete)
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function handLocal(side) {
  const e = entryFor(side);
  if (!e) return null;
  _v.copy(e.grip.position).applyMatrix4(rig.matrix).sub(EYE);
  if (!Number.isFinite(_v.x)) return null;
  return [_v.x, _v.y, _v.z];
}
// direita = manche (neutro onde a mão pegou), esquerda = manete (parte do valor atual)
const holds = { left: null, right: null };
function grab(side) {
  if (app !== 'playing') return;
  rig.updateMatrix();
  const h = handLocal(side);
  if (!h) return;
  holds[side] = side === 'right' ? { p0: h } : { p0: h, t0: mission.plane.throttle };
  pulse(side, 0.35, 30);
  sfx.click();
}
const vrIn = { pitch: 0, roll: 0, held: false, throttle: null, gun: false, missile: false, boost: false };
function readVR() {
  rig.updateMatrix();
  vrIn.held = false; vrIn.pitch = 0; vrIn.roll = 0; vrIn.throttle = null; vrIn.gun = false; vrIn.missile = false;
  if (holds.right) {
    const h = handLocal('right');
    if (h) {
      vrIn.held = true;
      vrIn.pitch = clamp((h[2] - holds.right.p0[2]) / 0.09, -1, 1);
      vrIn.roll = clamp((h[0] - holds.right.p0[0]) / 0.09, -1, 1);
    }
  }
  if (holds.left) {
    const h = handLocal('left');
    if (h) vrIn.throttle = clamp(holds.left.t0 - (h[2] - holds.left.p0[2]) / 0.2, 0, 1);
  }
  for (const e of ctrls) {
    const gp = e.source?.gamepad;
    if (!gp || e.source.hand) continue;
    const trig = gp.buttons[0]?.pressed;
    if (e.side === 'right' && trig) vrIn.gun = true;
    if (e.side === 'left' && trig) vrIn.missile = true;
    // alavancas como reserva: direita = manche, esquerda (para a frente/trás) = manete
    const ax = gp.axes || [];
    if (e.side === 'right' && !holds.right && Math.hypot(ax[2] || 0, ax[3] || 0) > 0.15) { vrIn.held = true; vrIn.roll = ax[2]; vrIn.pitch = ax[3]; }
    if (e.side === 'left' && !holds.left && Math.abs(ax[3] || 0) > 0.2) vrIn.throttle = clamp(mission.plane.throttle - ax[3] * 0.5 * (1 / 72), 0, 1);
  }
  // só com as mãos (sem controle): pinça segura; a metralhadora atira sozinha com a mira em cima
  // e o míssil sai sozinho quando trava
  const hands = ctrls.some(e => e.source?.hand);
  if (hands) {
    if (holds.right && aimOnTarget()) vrIn.gun = true;
    if (holds.left && mission.lock.target && mission.lock.target !== handMissileFor) { vrIn.missile = true; handMissileFor = mission.lock.target; }
  }
  return vrIn;
}
let handMissileFor = null;
function aimOnTarget() {
  const pl = mission.plane, f = pl.fwd;
  for (const e of mission.ents) {
    if (!e.alive || e.team !== 'enemy' || e.r <= 0) continue;
    const d = [e.x - pl.x, e.y - pl.y, e.z - pl.z], l = Math.hypot(...d);
    if (l < 800 && angleBetween(f, d) < 0.03 + e.r / l) return true;
  }
  return false;
}

function onSelect(entry) {
  sfx.unlock();
  if (panel.visible) {
    if (entry.hoverIndex >= 0) { const a = panel.actionAt(entry.hoverIndex); if (a) { sfx.click(); a(); } }
    return;
  }
  if (entry.source?.hand && entry.side) grab(entry.side);
}
function pollButtons() {
  for (const e of ctrls) {
    const gp = e.source?.gamepad;
    if (!gp || e.source.hand) continue;
    const b = gp.buttons.map(x => x.pressed);
    if (b[5] && !e.prevButtons[5]) { if (app === 'playing' || app === 'paused') togglePause(); }   // B ou Y
    vrIn.boost = !!(b[4] || b[3]) && app === 'playing';                                             // X ou A, ou apertar a alavanca
    e.prevButtons = b;
  }
}

// ---------- VR: sessão e recentralizar ----------
let recenterIn = 0;
function recenter() {
  if (!renderer.xr.isPresenting) return;
  // põe os olhos no assento, olhando para o nariz, na altura certa (sentado ou em pé)
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const head = camera.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -e.y);
  rigBase.yaw = -e.y;
  rigBase.pos.set(-head.x, save.height - head.y, -head.z);
  if (panel.visible) placePanel();
}
const rigBase = { yaw: 0, pos: new THREE.Vector3() };
renderer.xr.addEventListener('sessionstart', () => {
  recenterIn = 6;
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  if (panel.visible) placePanel();
  updateHint();
});
renderer.xr.addEventListener('sessionend', () => {
  holds.left = holds.right = null;
  rigBase.yaw = 0; rigBase.pos.set(0, 0, 0);
  if (panel.visible) placePanel();
  onResize();
  updateHint();
});

// ---------- mouse e teclado (PC) ----------
const pc = { stick: { x: 0, y: 0 }, throttle: 0.5, gun: false, missile: false, boost: false };
const keys = new Set();
const mouse = { ndc: new THREE.Vector2(0, 0), moved: false };
const raycaster = new THREE.Raycaster();
let ignoreUnlock = false, lockPauseAt = 0;
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  mouse.ndc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (panel.visible) {
    raycaster.setFromCamera(mouse.ndc, camera);
    const a = panel.actionAt(panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv));
    if (a) { sfx.click(); a(); }
    return;
  }
  if (app !== 'playing') return;
  if (!document.pointerLockElement && canvas.requestPointerLock) {
    try { const r = canvas.requestPointerLock(); r?.catch?.(() => {}); } catch { /* sem trava */ }
    // ao travar, o manche começa onde o mouse estava
    pc.stick.x = clamp(mouse.ndc.x * 1.6, -1, 1); pc.stick.y = clamp(-mouse.ndc.y * 1.6, -1, 1);
  }
  if (e.button === 0) pc.gun = true;
  if (e.button === 2) pc.missile = true;
});
window.addEventListener('pointerup', (e) => { if (e.button === 0) pc.gun = false; if (e.button === 2) pc.missile = false; });
canvas.addEventListener('pointermove', (e) => {
  mouse.ndc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (document.pointerLockElement === canvas) {
    pc.stick.x = clamp(pc.stick.x + e.movementX * 0.0035, -1, 1);
    pc.stick.y = clamp(pc.stick.y + e.movementY * 0.0035 * (save.invert ? -1 : 1), -1, 1);
    const l = Math.hypot(pc.stick.x, pc.stick.y);
    if (l > 1) { pc.stick.x /= l; pc.stick.y /= l; }
  } else if (app === 'playing') {
    pc.stick.x = clamp(mouse.ndc.x * 1.6, -1, 1);
    pc.stick.y = clamp(-mouse.ndc.y * 1.6 * (save.invert ? -1 : 1), -1, 1);
  }
});
canvas.addEventListener('wheel', (e) => { if (app === 'playing') pc.throttle = clamp(pc.throttle - Math.sign(e.deltaY) * 0.08, 0, 1); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && app === 'playing' && !ignoreUnlock) { togglePause(); lockPauseAt = performance.now(); }
  ignoreUnlock = false;
});
window.addEventListener('blur', () => { keys.clear(); pc.gun = pc.missile = false; });
window.addEventListener('keydown', (e) => {
  sfx.unlock();
  const k = e.key.toLowerCase();
  if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  if (e.repeat) return;
  if (k === 'escape' || k === 'p') {
    if (k === 'escape' && performance.now() - lockPauseAt < 400) return;
    if (app === 'playing' || app === 'paused') togglePause();
    return;
  }
  if (k === 'f') { save.fps = !save.fps; storeSave(save); return; }
  if (k === 'c') { save.cam = save.cam === 'first' ? 'chase' : 'first'; storeSave(save); return; }
  if (app === 'brief' && (k === 'enter' || k === ' ')) { takeOff(); return; }
  if (app !== 'playing') return;
  if (k === 'r') { startLevel(levelIndex, false); return; }
  keys.add(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function readPC(dt) {
  const kx = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
  const ky = (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0);
  if (keys.has('w')) pc.throttle = clamp(pc.throttle + dt * 0.6, 0, 1);
  if (keys.has('s')) pc.throttle = clamp(pc.throttle - dt * 0.6, 0, 1);
  const sx = kx || pc.stick.x, sy = ky || pc.stick.y;
  const dead = 0.07, mag = Math.hypot(sx, sy);
  const held = !!(kx || ky) || mag > dead;
  const k = mag > dead ? (mag - dead) / (1 - dead) / mag : 0;
  return {
    pitch: kx || ky ? ky : sy * k, roll: kx || ky ? kx : sx * k, held, throttle: pc.throttle,
    gun: pc.gun, missile: pc.missile, boost: keys.has(' '),
  };
}
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (panel.visible) placePanel();
}
window.addEventListener('resize', onResize);

// ---------- câmera ----------
const chase = { pos: new THREE.Vector3(), init: false };
const _f = new THREE.Vector3(), _up = new THREE.Vector3();
function updateCamera(dt) {
  const vr = renderer.xr.isPresenting;
  const pl = mission.plane;
  const chaseCam = !vr && (save.cam === 'chase' || app === 'menu');
  // horizonte firme: a cabeça inclina só metade da rolagem
  const firm = save.horizon === 'firm' && !chaseCam;
  rig.rotation.set(0, 0, 0);
  if (vr) {
    rig.position.copy(EYE).add(rigBase.pos);
    rig.rotation.set(0, rigBase.yaw, firm ? pl.phi * 0.5 : 0);
    if (rig.parent !== planeGroup) planeGroup.add(rig);
    jet.visible = false; cockpit.group.visible = true;
    return;
  }
  if (!chaseCam) {
    if (camera.parent !== rig) rig.add(camera);
    if (rig.parent !== planeGroup) planeGroup.add(rig);
    rig.position.copy(EYE);
    rig.rotation.set(0, 0, firm ? pl.phi * 0.5 : 0);
    camera.position.set(0, 0, 0);
    camera.rotation.set(-0.04, 0, 0);
    jet.visible = false; cockpit.group.visible = true;
    chase.init = false;
    return;
  }
  jet.visible = true; cockpit.group.visible = false;
  if (camera.parent !== scene) scene.add(camera);
  const f = pl.fwd;
  _f.set(f[0], f[1], f[2]);
  let target;
  if (app === 'menu') {
    const a = performance.now() / 9000;
    const side = new THREE.Vector3(Math.cos(pl.psi), 0, -Math.sin(pl.psi));
    target = new THREE.Vector3(pl.x, pl.y, pl.z).addScaledVector(_f, 10 + Math.sin(a) * 14).addScaledVector(side, Math.cos(a * 1.3) * 22).add(new THREE.Vector3(0, 6, 0));
  } else target = new THREE.Vector3(pl.x, pl.y, pl.z).addScaledVector(_f, -26).add(new THREE.Vector3(0, 7, 0));
  if (!chase.init) { chase.pos.copy(target); chase.init = true; }
  chase.pos.lerp(target, Math.min(1, dt * (app === 'menu' ? 2 : 6)));
  camera.position.copy(chase.pos);
  _up.set(0, 1, 0);
  camera.up.copy(_up);
  camera.lookAt(pl.x + f[0] * 40, pl.y + f[1] * 40, pl.z + f[2] * 40);
}

// ---------- raios do menu ----------
const rayOrigin = new THREE.Vector3(), rayDir = new THREE.Vector3();
function updateMenuRays() {
  const vr = renderer.xr.isPresenting;
  let hover = -1;
  for (const e of ctrls) {
    e.hoverIndex = -1;
    e.laser.visible = false;
    e.glove.visible = vr && !!e.source && !e.source.hand;
    if (!vr || !e.source || !panel.visible) continue;
    e.ctrl.getWorldPosition(rayOrigin);
    e.ctrl.getWorldQuaternion(_q);
    rayDir.set(0, 0, -1).applyQuaternion(_q);
    raycaster.set(rayOrigin, rayDir);
    const hit = raycaster.intersectObject(panel.mesh)[0];
    e.laser.visible = true;
    e.laser.scale.z = hit ? hit.distance : 1.5;
    e.hoverIndex = panel.pick(hit?.uv);
    if (e.hoverIndex >= 0) hover = e.hoverIndex;
  }
  if (!vr && panel.visible) {
    raycaster.setFromCamera(mouse.ndc, camera);
    hover = panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv);
    canvas.style.cursor = hover >= 0 && panel.actionAt(hover) ? 'pointer' : 'default';
  } else if (!vr) canvas.style.cursor = 'none';
  if (panel.visible) panel.setHover(hover);
}

// ---------- sincronizar o desenho com a lógica ----------
function syncPlane() {
  const pl = mission.plane;
  planeGroup.position.set(pl.x, pl.y, pl.z);
  planeGroup.rotation.set(pl.theta, pl.psi, -pl.phi, 'YXZ');
}
const lastInput = { pitch: 0, roll: 0, throttle: 0.5 };
function syncEntities(dt) {
  const seen = new Set();
  for (const e of mission.ents) {
    if (!e.alive) continue;
    let m = entMeshes.get(e.id);
    if (!m) {
      m = e.kind === 'portal' ? portalMesh(e.r) : entityMesh(e, mats);
      if (MOVERS.has(e.kind)) { const fl = flameMesh(e.kind === 'bomber' ? 0.9 : 0.5, 2.4); fl.position.z = e.kind === 'bomber' ? 9 : 6.2; m.add(fl); }
      scene.add(m);
      entMeshes.set(e.id, m);
    }
    seen.add(e.id);
    m.position.set(e.x, e.y, e.z);
    if (e.kind === 'portal') {
      const n = e.normal;
      m.rotation.set(0, Math.atan2(-n[0], -n[2]), 0);
      const next = mission.ents.filter(o => o.kind === 'portal')[mission.portalNext] === e;
      m.material.color.set(next ? '#ffd23a' : '#f3a36a');
      m.material.opacity = 1;
      continue;
    }
    if (e.kind === 'turret' || e.kind === 'weak') {
      // gira a torre para o jogador
      const pl = mission.plane;
      m.rotation.set(0, Math.atan2(-(pl.x - e.x), -(pl.z - e.z)), 0);
    } else m.rotation.set(e.theta || 0, e.psi || 0, -(e.phi || 0), 'YXZ');
    if (e.kind === 'core' && m.userData.shield) m.userData.shield.visible = !e.open;
    if (e.kind === 'core') m.rotation.y = performance.now() / 900;
  }
  for (const [id, m] of entMeshes) if (!seen.has(id)) { scene.remove(m); entMeshes.delete(id); }
  // tiros e mísseis
  tracersMe.set(mission.bullets.filter(b => b.team === 'player'));
  tracersFoe.set(mission.bullets.filter(b => b.team !== 'player'));
  missilePool.forEach((mm, i) => {
    const ms = mission.missiles[i];
    mm.visible = !!ms;
    if (!ms) return;
    mm.position.set(ms.x, ms.y, ms.z);
    mm.lookAt(ms.x - ms.vx, ms.y - ms.vy, ms.z - ms.vz);
    // fumaça (só depois de o míssil se afastar, para não tapar a cabine)
    if (app !== 'paused' && ms.life < MISSILE.life - 0.35 && Math.random() < dt * 40) particles.spawn(ms.x, ms.y, ms.z, 0, 1, 0, 0.9, 0.35, 1.4, '#e8ded0', '#9a9090', 0.3);
  });
  // cabine: manche e manete se mexem como o comando
  cockpit.stick.rotation.set(lastInput.pitch * 0.32, 0, -lastInput.roll * 0.32);
  cockpit.throttle.position.z = -0.02 - mission.plane.throttle * 0.2;
  jetFlame.scale.set(1, 1, 0.6 + mission.plane.throttle * 0.6 + (mission.plane.boostT > 0 ? 1 : 0));
}

function updateMarkers() {
  const vr = renderer.xr.isPresenting;
  const L = mission.lock, items = [];
  const t = performance.now() / 1000;
  if (app === 'playing' || app === 'done') {
    for (const e of mission.ents) {
      if (!e.alive || e.kind === 'portal' || e.kind === 'ship') continue;
      let color = null, size = 0.012;
      if (e.team === 'ally') color = '#7dffb0';
      else if (e.lockable) color = e.req || e.tag === 'boss' || e.tag === mission.def.obj.parts ? '#ffd23a' : '#ff8a6a';
      else if (e.shieldBy) color = '#7fe0ff';
      if (!color) continue;
      if (e === L.target) { items.push({ x: e.x, y: e.y, z: e.z, size: 0.03, color: '#ff3a2a', spin: t * 2 }); continue; }
      if (e === L.cand) items.push({ x: e.x, y: e.y, z: e.z, size: 0.05 - 0.03 * (L.t / LOCK.time), color: '#ffe27a', spin: -t * 4 });
      items.push({ x: e.x, y: e.y, z: e.z, size, color });
    }
  }
  markers.set(items, camera);
  // anel do olhar
  const show = (app === 'playing') && (vr || save.cam !== 'chase');
  gazeRing.visible = lockArc.visible = show;
  gazeRing.material.color.set(L.target ? '#ff5a3a' : L.cand ? '#ffe27a' : '#ffd678');
  gazeRing.material.opacity = L.target ? 0.8 : 0.4;
  lockArc.visible = show && !!L.cand && !L.target;
  if (lockArc.visible) lockArc.scale.setScalar(1 + 0.6 * (1 - L.t / LOCK.time));
}

// ---------- telas da cabine (HUD e instrumentos) ----------
let hudT = 0;
const HUD_C = '#ffc35a';
function drawHud() {
  const g = cockpit.hud.ctx, W = 512, pl = mission.plane;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = HUD_C; g.fillStyle = HUD_C; g.lineWidth = 3;
  g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  // horizonte e escada de arfagem (20 px por grau)
  g.save();
  g.beginPath(); g.rect(40, 40, W - 80, W - 80); g.clip();
  g.translate(W / 2, W / 2);
  g.rotate(-pl.phi);
  const ppd = 14;
  for (let a = -40; a <= 40; a += 10) {
    const y = (pl.theta * 180 / Math.PI - a) * ppd;
    if (Math.abs(y) > 300) continue;
    const w = a === 0 ? 200 : 70;
    g.setLineDash(a < 0 ? [10, 8] : []);
    g.beginPath(); g.moveTo(-w, y); g.lineTo(-30, y); g.moveTo(30, y); g.lineTo(w, y); g.stroke();
    if (a) { g.font = '18px monospace'; g.fillText(String(Math.abs(a)), -w - 18, y); }
  }
  g.setLineDash([]);
  g.restore();
  // mira fixa
  g.beginPath(); g.arc(W / 2, W / 2, 10, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(W / 2 - 40, W / 2); g.lineTo(W / 2 - 18, W / 2); g.moveTo(W / 2 + 18, W / 2); g.lineTo(W / 2 + 40, W / 2); g.stroke();
  // velocidade e altitude
  g.font = 'bold 30px monospace';
  g.textAlign = 'left'; g.fillText(`${Math.round(pl.v * 3.6)}`, 18, W / 2);
  g.font = '16px monospace'; g.fillText('km/h', 18, W / 2 + 26);
  g.textAlign = 'right'; g.font = 'bold 30px monospace'; g.fillText(`${Math.round(pl.y)}`, W - 18, W / 2);
  g.font = '16px monospace'; g.fillText('m', W - 18, W / 2 + 26);
  // rumo
  g.textAlign = 'center'; g.font = 'bold 22px monospace';
  const hdg = ((-pl.psi * 180 / Math.PI) % 360 + 360) % 360;
  g.fillText(String(Math.round(hdg)).padStart(3, '0'), W / 2, 28);
  // escudo e mísseis
  g.strokeRect(120, W - 44, 272, 16);
  g.fillRect(122, W - 42, 268 * clamp(mission.shield / SHIELD.max, 0, 1), 12);
  g.font = 'bold 20px monospace';
  g.fillText(`MSL ${mission.ammo}  ${pl.boostT > 0 ? 'TURBO' : pl.boostCool > 0 ? '' : 'TURBO OK'}`, W / 2, W - 70);
  if (mission.lock.target) { g.font = 'bold 28px monospace'; g.fillText('TRAVADO', W / 2, W / 2 + 70); }
  cockpit.hud.commit();
}
function drawInstruments() {
  const g = cockpit.inst.ctx, W = 1024, H = 384, pl = mission.plane;
  g.fillStyle = '#20283a'; g.fillRect(0, 0, W, H);
  // radar (topo = nariz)
  const rx = 170, ry = 190, R = 150;
  g.fillStyle = '#0d1a20'; g.beginPath(); g.arc(rx, ry, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2f7d8c'; g.lineWidth = 2;
  for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(rx, ry, R * k, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(rx, ry - R); g.lineTo(rx, ry + R); g.moveTo(rx - R, ry); g.lineTo(rx + R, ry); g.stroke();
  const range = 2500, c = Math.cos(pl.psi), s = Math.sin(pl.psi);
  for (const e of mission.ents) {
    if (!e.alive || e.kind === 'portal' && mission.ents.filter(o => o.kind === 'portal').indexOf(e) !== mission.portalNext) continue;
    if (e.kind === 'ship' || (e.parent && e.kind === 'turret')) continue;
    const dx = e.x - pl.x, dz = e.z - pl.z;
    // gira para o referencial do avião: frente = para cima no radar
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const d = Math.hypot(lx, lz);
    const k = Math.min(1, d / range) * R / Math.max(d, 1e-6);
    const px = rx + lx * k, py = ry + lz * k;
    g.fillStyle = e.team === 'ally' ? '#7dffb0' : e.kind === 'portal' ? '#ffd23a' : e.req || e.tag === 'boss' ? '#ffd23a' : '#ff5a3a';
    const sz = e.kind === 'core' || e.kind === 'ace' ? 9 : 6;
    g.beginPath(); g.arc(px, py, d > range ? sz * 0.6 : sz, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(rx, ry - 10); g.lineTo(rx - 7, ry + 8); g.lineTo(rx + 7, ry + 8); g.fill();
  g.fillStyle = '#9fb0c0'; g.font = '20px sans-serif'; g.textAlign = 'center'; g.fillText('RADAR 2,5 km', rx, ry + R + 24 > H ? H - 10 : ry + R + 22);
  // horizonte artificial
  const ax = 512, ay = 190, AR = 150;
  g.save(); g.beginPath(); g.arc(ax, ay, AR, 0, Math.PI * 2); g.clip();
  g.translate(ax, ay); g.rotate(-pl.phi);
  const off = pl.theta * 180 / Math.PI * 4;
  g.fillStyle = '#4f8fc0'; g.fillRect(-AR * 2, -AR * 2 + off, AR * 4, AR * 2);
  g.fillStyle = '#9a5a34'; g.fillRect(-AR * 2, off, AR * 4, AR * 2);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-AR, off); g.lineTo(AR, off); g.stroke();
  g.lineWidth = 2;
  for (const a of [-20, -10, 10, 20]) { const y = off - a * 4; g.beginPath(); g.moveTo(-30, y); g.lineTo(30, y); g.stroke(); }
  g.restore();
  g.strokeStyle = '#ffc35a'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(ax - 70, ay); g.lineTo(ax - 20, ay); g.lineTo(ax - 10, ay + 12); g.moveTo(ax + 70, ay); g.lineTo(ax + 20, ay); g.lineTo(ax + 10, ay + 12); g.stroke();
  g.strokeStyle = '#3a4258'; g.lineWidth = 8; g.beginPath(); g.arc(ax, ay, AR, 0, Math.PI * 2); g.stroke();
  // barras: escudo, velocidade, manete; mísseis
  const bx = 720;
  const bar = (label, v, y, col) => {
    g.fillStyle = '#9fb0c0'; g.font = 'bold 22px sans-serif'; g.textAlign = 'left'; g.fillText(label, bx, y);
    g.fillStyle = '#0d1a20'; g.fillRect(bx, y + 10, 270, 22);
    g.fillStyle = col; g.fillRect(bx + 2, y + 12, 266 * clamp(v, 0, 1), 18);
  };
  const sh = mission.shield / SHIELD.max;
  bar('ESCUDO', sh, 50, sh < 0.3 ? '#e2553a' : '#6fd0c4');
  bar(`VELOCIDADE ${Math.round(pl.v * 3.6)} km/h`, pl.v / PLANE.vBoost, 120, '#ffc35a');
  bar(pl.boostT > 0 ? 'TURBO!' : pl.boostCool > 0 ? 'TURBO recarregando' : 'TURBO pronto', pl.boostT > 0 ? pl.boostT / PLANE.boostTime : 1 - pl.boostCool / PLANE.boostCool, 190, '#e2553a');
  g.fillStyle = '#9fb0c0'; g.font = 'bold 22px sans-serif'; g.fillText('MÍSSEIS', bx, 268);
  for (let i = 0; i < MISSILE.ammo; i++) { g.fillStyle = i < mission.ammo ? '#efe4cc' : '#3a4258'; g.fillRect(bx + i * 44, 282, 30, 14); g.fillStyle = i < mission.ammo ? '#e2553a' : '#3a4258'; g.fillRect(bx + i * 44 + 30, 282, 8, 14); }
  const ob = mission.objective;
  g.fillStyle = '#ffd678'; g.font = 'bold 24px sans-serif'; g.textAlign = 'left';
  g.fillText(ob.text.length > 24 ? ob.text.slice(0, 24) + '…' : ob.text, bx, 340);
  if (ob.ally != null || ob.boss != null) { g.fillStyle = '#0d1a20'; g.fillRect(bx, 354, 270, 14); g.fillStyle = ob.ally != null ? '#7dffb0' : '#ff5a3a'; g.fillRect(bx + 2, 356, 266 * (ob.ally ?? ob.boss), 10); }
  cockpit.inst.commit();
}

// ---------- HUD do PC ----------
const hintEl = document.getElementById('hint');
const hudEl = document.getElementById('hud');
const barEl = document.getElementById('bar');
const msgEl = document.getElementById('msg');
const fpsEl = document.getElementById('fps');
const crossEl = document.getElementById('cross');
function updateHint() {
  if (renderer.xr.isPresenting) { hintEl.textContent = ''; return; }
  hintEl.innerHTML = app === 'playing'
    ? '<span>Mouse: manche (clique para travar o mouse) · W/S ou roda: manete · clique esq.: metralhadora · clique dir.: míssil · Espaço: turbo · C: câmera · Esc: pausa</span>'
    : app === 'brief' ? '<span>Clique em Decolar (ou Enter)</span>' : '<span>Clique nas opções do painel</span>';
}
function updateHud(dt) {
  const vr = renderer.xr.isPresenting;
  const playing = app === 'playing' || app === 'done';
  if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }
  const warn = playing && mission.warn ? mission.warn : '';
  const show = warn || (msg && playing ? msg.text : '');
  const color = warn ? '#ff8a6a' : msg?.color || '#fff';
  if (!vr) {
    msgLabel.mesh.visible = false;
    hudEl.style.display = barEl.style.display = playing ? 'block' : 'none';
    const ob = mission.objective;
    const extra = ob.ally != null ? ` · aliado ${Math.round(ob.ally * 100)}%` : ob.boss != null && ob.boss > 0 && !mission.def.obj.parts ? ` · chefe ${Math.round(ob.boss * 100)}%` : '';
    const html = `<b>${levelIndex + 1}. ${MISSIONS[levelIndex].name}</b> · ${fmtT(mission.time)}${mission.def.obj.limit ? ` / ${fmtT(mission.def.obj.limit)}` : ''}<br><em>${ob.text}${extra}</em>`;
    if (hudEl.dataset.last !== html) { hudEl.innerHTML = html; hudEl.dataset.last = html; }
    const sh = clamp(mission.shield / SHIELD.max, 0, 1), pl = mission.plane;
    const bar = `Escudo<i class="${sh < 0.3 ? 'lo' : ''}"><b style="width:${Math.round(sh * 100)}%"></b></i> ${Math.round(pl.v * 3.6)} km/h · ${Math.round(pl.y)} m · mísseis ${mission.ammo} · manete ${Math.round(pl.throttle * 100)}%${pl.boostCool <= 0 ? ' · turbo pronto' : ''}${mission.lock.target ? ' · <span style="color:#ff8a6a">TRAVADO</span>' : ''}`;
    if (barEl.dataset.last !== bar) { barEl.innerHTML = bar; barEl.dataset.last = bar; }
    if (msgEl.dataset.last !== show) { msgEl.textContent = show; msgEl.dataset.last = show; }
    msgEl.style.color = color;
    msgEl.style.display = show ? 'block' : 'none';
    // marcador do manche do mouse
    const stickShow = app === 'playing' && save.cam !== 'chase';
    crossEl.style.display = stickShow ? 'block' : 'none';
    if (stickShow) { crossEl.style.left = `${50 + pc.stick.x * 12}%`; crossEl.style.top = `${50 + pc.stick.y * 16}%`; }
    return;
  }
  hudEl.style.display = barEl.style.display = msgEl.style.display = crossEl.style.display = 'none';
  msgLabel.mesh.visible = playing && !!show;
  if (show) msgLabel.set([{ text: show, size: 0.62, color, bold: true }]);
}

// ---------- eventos do jogo -> som, vibração, efeitos ----------
const _cam = new THREE.Vector3();
function nearFactor(x, y, z) { camera.getWorldPosition(_cam); return clamp(1.2 - Math.hypot(x - _cam.x, y - _cam.y, z - _cam.z) / 1800, 0.05, 1); }
let warnBeepT = 0;
function handleEvents(evs) {
  for (const ev of evs) {
    switch (ev.type) {
      case 'gun': sfx.gun(); if (renderer.xr.isPresenting) pulse('right', 0.15, 15); break;
      case 'hit': particles.spark(ev.x, ev.y, ev.z); sfx.hit(); break;
      case 'shieldHit': particles.spark(ev.x, ev.y, ev.z, '#7fe0ff'); break;
      case 'hullHit': particles.spark(ev.x, ev.y, ev.z, '#c0c8d0'); break;
      case 'kill': {
        const size = ev.kind === 'core' ? 5 : ev.big ? 2.6 : ev.kind === 'target' || ev.kind === 'turret' ? 1.6 : 1.3;
        particles.explode(ev.x, ev.y, ev.z, size);
        sfx.boom(ev.big, nearFactor(ev.x, ev.y, ev.z));
        if (ev.byPlayer && (MOVERS.has(ev.kind) || ev.kind === 'turret')) showMsg(ev.kind === 'ace' ? 'O Ás Vermelho caiu!' : ev.kind === 'turret' ? 'Torre destruída' : 'Abatido!', 1.2, '#ffd678');
        if (ev.kind === 'weak') showMsg('Ponto fraco destruído!', 1.6, '#ffd678');
        if (ev.byPlayer) both(0.25, 40);
        break;
      }
      case 'boom': particles.explode(ev.x, ev.y, ev.z, ev.huge ? 9 : ev.big ? 3 : 1); sfx.boom(ev.big || ev.huge, nearFactor(ev.x, ev.y, ev.z)); break;
      case 'splash': particles.explode(ev.x, ev.y + 2, ev.z, 1.4); break;
      case 'hurt': hurtFlash = Math.min(0.8, hurtFlash + ev.d / 18); if (ev.cause !== 'aa' && ev.cause !== 'out') sfx.hurt(); both(Math.min(1, ev.d / 10), 50); break;
      case 'crash': sfx.crash(); both(1, 160); showMsg(mission.env.type === 'canyon' ? 'Cuidado com o paredão!' : 'Cuidado!', 1.5, '#ff8a6a'); break;
      case 'missile': sfx.missile(); if (!ev.locked) showMsg('Míssil sem trava: olhe para o alvo antes', 1.6, '#ffd678'); break;
      case 'noAmmo': sfx.noAmmo(); showMsg('Sem mísseis: recarregando', 1.2, '#ffd678'); break;
      case 'locked': pulse('left', 0.4, 50); break;
      case 'portal': sfx.portal(ev.n); break;
      case 'portalMiss': sfx.portalMiss(); showMsg(`Portal perdido: +${ev.pen} s`, 1.5, '#ff8a6a'); break;
      case 'wave': sfx.wave(); if (ev.text) showMsg(ev.text, 2.2, '#ffd678'); break;
      case 'shieldDown': sfx.shieldDown(); showMsg('O escudo do núcleo caiu! Acerte o núcleo.', 2.5, '#7fe0ff'); break;
      case 'flare': sfx.flare(); for (let i = 0; i < 8; i++) particles.spawn(ev.x, ev.y, ev.z, (Math.random() - 0.5) * 50, -10 - Math.random() * 20, (Math.random() - 0.5) * 50, 2, 1.6, 0.4, '#fff4c0', '#ff9a3a', 0.6); showMsg('O Ás soltou chamarizes!', 1.4, '#ffd678'); break;
      case 'boost': sfx.boost(); break;
      case 'win': sfx.win(); doneTimer = 2.2; showMsg('Missão cumprida!', 2.2, '#7dffb0'); break;
      case 'lose': sfx.lose(); doneTimer = 2.2; showMsg(ev.reason, 2.2, '#ff8a6a'); if (mission.shield <= 0) particles.explode(mission.plane.x, mission.plane.y, mission.plane.z, 2); break;
    }
  }
}

// ---------- botão de VR ----------
const vrBtn = document.getElementById('vr');
async function setupVR() {
  const okXR = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!okXR) {
    vrBtn.textContent = window.isSecureContext ? 'VR não disponível neste navegador' : 'VR precisa de HTTPS';
    vrBtn.disabled = true;
    return;
  }
  vrBtn.textContent = 'Entrar em VR';
  vrBtn.disabled = false;
  vrBtn.onclick = async () => {
    sfx.unlock();
    if (renderer.xr.isPresenting) { renderer.xr.getSession()?.end(); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      await renderer.xr.setSession(session);
      vrBtn.textContent = 'Sair do VR';
      session.addEventListener('end', () => { vrBtn.textContent = 'Entrar em VR'; });
    } catch (err) {
      vrBtn.textContent = 'Erro ao entrar em VR';
      console.error(err);
    }
  };
}
setupVR();

// ---------- laço principal ----------
let acc = 0, lastT = performance.now(), time = 0;
let fpsFrames = 0, fpsTime = 0, vigA = 0, instT = 0;

function tick(dt) {
  time += dt;
  const vr = renderer.xr.isPresenting;
  if (recenterIn > 0 && --recenterIn === 0) recenter();
  pollButtons();

  // lógica em passos fixos de 1/60 s
  const auto = dev.autoplay && app === 'playing';
  const attract = app === 'menu' && !vr;
  const running = app === 'playing' || app === 'done' || attract;
  const evs = [];
  let input = null;
  if (running) {
    acc += dt;
    const n = Math.min(10, Math.floor(acc / DT));
    if (app === 'playing' && !auto) input = vr ? readVR() : readPC(dt);
    for (let i = 0; i < n; i++) {
      let inp;
      if (attract) { mission.shield = 1e9; inp = robotMenu.step(mission); inp.gun = inp.missile = false; }
      else if (auto) inp = robot.step(mission);
      else if (app === 'done') inp = { held: false };
      else {
        inp = { ...input };
        // olhar: no VR a cabeça; no PC o centro da tela (na câmera de trás, o nariz)
        if (vr || save.cam !== 'chase') { camera.getWorldDirection(_v); inp.look = [_v.x, _v.y, _v.z]; }
      }
      mission.step(inp);
      if (!attract) evs.push(...mission.events);
      if (inp) { lastInput.pitch = inp.held ? inp.pitch || 0 : 0; lastInput.roll = inp.held ? inp.roll || 0 : 0; }
      if (attract && mission.state !== 'playing') { loadMission(levelIndex); mission.shield = 1e9; break; }
    }
    acc -= n * DT;
    if (app === 'playing' && !vr && !auto) pc.throttle = mission.plane.throttle;
  } else acc = 0;
  handleEvents(evs);
  if (app === 'playing' && doneTimer > 0) { doneTimer -= dt; if (doneTimer <= 0) finishMission(); }

  syncPlane();
  syncEntities(dt);
  updateCamera(dt);
  planeGroup.updateMatrixWorld(true);
  updateMarkers();
  if (app !== 'paused') particles.update(dt);
  world.followCamera(camera);
  // névoa dentro das nuvens
  if (mission.env.type === 'clouds') { camera.getWorldPosition(_cam); world.setCloudFog(Math.min(1, mission.env.inCloud(_cam.x, _cam.y, _cam.z) * 2.5)); }

  // telas da cabine: HUD 20 vezes por segundo, instrumentos 10
  hudT -= dt; instT -= dt;
  if (cockpit.group.visible && hudT <= 0) { drawHud(); hudT = 0.05; }
  if (cockpit.group.visible && instT <= 0) { drawInstruments(); instT = 0.1; }
  updateHud(dt);
  updateMenuRays();

  // som
  const pl = mission.plane;
  sfx.setEngine(pl.v, pl.throttle, pl.boostT > 0, app === 'playing', pl.w);
  sfx.setLock(app === 'playing' ? (mission.lock.target ? 2 : mission.lock.cand ? 1 : 0) : 0, dt);
  warnBeepT -= dt;
  if (app === 'playing' && (mission.shield < 25 || mission.warn) && warnBeepT <= 0) { sfx.warn(); warnBeepT = 1.2; }

  // vinheta de conforto e clarão de dano
  const want = save.vignette && vr && app === 'playing' ? clamp((pl.w - 0.9) * 0.6, 0, 0.75) : 0;
  vigA += (want - vigA) * Math.min(1, dt * 6);
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);
  vignette.visible = vigA > 0.01 || hurtFlash > 0.01;
  vignette.material.uniforms.uA.value = vigA;
  vignette.material.uniforms.uHurt.value = hurtFlash * 0.7;

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    const f = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
    fpsEl.style.display = save.fps && !vr ? 'block' : 'none';
    fpsEl.textContent = `${f} FPS`;
    fpsLabel.mesh.visible = save.fps && vr;
    fpsLabel.set(`${f} FPS`);
  }
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  tick(dt);
  renderer.render(scene, camera);
}

// ---------- depuração (console do navegador) ----------
// dev.loadLevel(3)        abre a missão 3 (1 a 12) já voando
// dev.autoplay = true     o robô pilota (com os mesmos comandos do jogador)
// dev.advance(20)         avança 20 s de jogo na hora, sem esperar a animação
// dev.state()             resumo: tela, missão, objetivo, escudo, posição
// dev.snapshot()          imagem da tela (JPEG em data URL)
// dev.resetSave()         apaga o progresso
const dev = {
  _auto: false,
  get autoplay() { return this._auto; },
  set autoplay(v) { this._auto = !!v; robot = v ? makeRobot() : null; },
  loadLevel(n) { startLevel(n - 1, false); return this.state(); },
  advance(sec, step = 1 / 60) {
    const frames = Math.round(sec / step);
    for (let i = 0; i < frames; i++) tick(step);
    lastT = performance.now();
    renderer.render(scene, camera);
    return this.state();
  },
  state() {
    const pl = mission.plane;
    return {
      tela: app, missao: levelIndex + 1, nome: MISSIONS[levelIndex].name, estado: mission.state, motivo: mission.reason || null,
      tempo: +mission.t.toFixed(2), objetivo: mission.objective.text, escudo: Math.round(mission.shield), dano: Math.round(mission.dmg),
      misseis: mission.ammo, travado: mission.lock.target?.kind || null, abates: mission.kills,
      aviao: { x: Math.round(pl.x), y: Math.round(pl.y), z: Math.round(pl.z), velocidade: Math.round(pl.v) },
      resultado: mission.result, salvo: save.done[levelIndex] || null,
    };
  },
  snapshot(w = 960) {
    renderer.render(scene, camera);
    const src = renderer.domElement, c = document.createElement('canvas');
    c.width = w; c.height = Math.round(w * src.height / src.width);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  },
  resetSave() { save.done = {}; storeSave(save); },
  // para fotos: mostra uma tela do menu ('main', 'levels', 'help', 'brief', 'pause', 'done')
  screen(name) { if (name === 'brief') app = 'brief'; showScreen(name); return app; },
  camera(mode) { save.cam = mode; return mode; },
};
window.dev = dev;
window.esquadrilha = { dev, get mission() { return mission; }, save, sfx, startLevel, goMenu, camera, scene, renderer };

goMenu();
renderer.setAnimationLoop(frame);
