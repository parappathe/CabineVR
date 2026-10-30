// Tudo o que se desenha: céu, cânion, mar de nuvens, mar aberto, aviões, naves, cabine, tiros,
// explosões, marcadores de alvo e portais. Estilo de pôster de aviação antigo: tudo facetado (low
// poly), cores chapadas quentes, poucas malhas (geometria mesclada e instanciada), sem sombra
// dinâmica e sem pós-processamento (Quest 3).
import * as THREE from '../vendor/three/three.module.js';
import { RIM, WALL_SLOPE } from './env.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- paletas dos setores ----------
export const THEMES = {
  canyon: {
    zenith: '#2c5d8f', horizon: '#f3c690', sun: '#fff0c8', fog: '#e8b987', fogNear: 900, fogFar: 4200,
    hemiSky: '#ffe2b8', hemiGround: '#8a4a2c', sunCol: '#fff1d6',
  },
  clouds: {
    zenith: '#34397a', horizon: '#f8a98c', sun: '#ffe4b4', fog: '#f1b6a2', fogNear: 1200, fogFar: 5200,
    hemiSky: '#ffe0d4', hemiGround: '#8a6a9a', sunCol: '#ffe6cc',
  },
  ocean: {
    zenith: '#141f3d', horizon: '#e27a4c', sun: '#ffd09a', fog: '#8a5d62', fogNear: 1100, fogFar: 5200,
    hemiSky: '#ffd0b0', hemiGround: '#6a7a8c', sunCol: '#ffd8b0',
  },
};

// ---------- montador de geometria (mescla peças com cor por vértice) ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export class Builder {
  constructor() { this.parts = []; }
  add(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    _m.compose(_p.set(...pos), _q, _s.set(...scale));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(_m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    this.parts.push(g);
    return this;
  }
  box(w, h, d, color, pos, rot, scale) { return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot, scale); }
  cyl(rt, rb, h, color, pos, rot, seg = 8, scale) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, pos, rot, scale); }
  cone(r, h, color, pos, rot, seg = 8, scale) { return this.add(new THREE.ConeGeometry(r, h, seg), color, pos, rot, scale); }
  ball(r, color, pos, scale, detail = 1) { return this.add(new THREE.IcosahedronGeometry(r, detail), color, pos, [0, 0, 0], scale); }
  // asa: triângulo/trapézio com espessura. pts = [[x,z], ...] (4 pontos no plano), t = espessura
  slab(pts, t, color, y = 0) {
    const g = new THREE.BufferGeometry(), v = [];
    const top = pts.map(([x, z]) => [x, y + t / 2, z]), bot = pts.map(([x, z]) => [x, y - t / 2, z]);
    const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
    quad(top[0], top[3], top[2], top[1]); quad(bot[0], bot[1], bot[2], bot[3]);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(bot[i], bot[j], top[j], top[i]); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return this.add(g, color);
  }
  geometry() {
    let n = 0;
    for (const g of this.parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const g of this.parts) {
      pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

// ---------- mundo: céu, luz, névoa ----------
export function buildWorld() {
  const scene = new THREE.Scene();
  const mats = {
    flat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
    glowNoFog: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uZ: { value: new THREE.Color() }, uH: { value: new THREE.Color() }, uS: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0.3, 0.25, -1).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 uZ; uniform vec3 uH; uniform vec3 uS; uniform vec3 uSunDir; varying vec3 vD;
      void main(){
        float h = clamp(vD.y, -0.2, 1.0);
        float k = pow(max(h, 0.0), 0.55);
        vec3 c = mix(uH, uZ, k);
        // faixas de cartaz: o degradê vira listras suaves perto do horizonte
        float band = floor(k * 9.0) / 9.0;
        c = mix(c, mix(uH, uZ, band), 0.35);
        if (h < 0.0) c = mix(uH, uH * 0.8, clamp(-h * 5.0, 0.0, 1.0));
        float s = max(dot(normalize(vD), uSunDir), 0.0);
        c += uS * (pow(s, 600.0) * 1.6 + pow(s, 12.0) * 0.28);
        c = mix(c, uS, smoothstep(0.9993, 0.9996, s));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(300, 250, -1000);
  scene.add(sun);
  scene.fog = new THREE.Fog(0xffffff, 1000, 5000);
  const world = {
    scene, mats, sky, hemi, sun, theme: null,
    setTheme(name) {
      const t = THEMES[name];
      this.theme = t; this.themeName = name;
      sky.material.uniforms.uZ.value.set(t.zenith);
      sky.material.uniforms.uH.value.set(t.horizon);
      sky.material.uniforms.uS.value.set(t.sun);
      scene.fog.color.set(t.fog); scene.fog.near = t.fogNear; scene.fog.far = t.fogFar;
      hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround);
      sun.color.set(t.sunCol);
    },
    // dentro da nuvem a névoa fecha
    setCloudFog(k) {
      const t = this.theme;
      scene.fog.near = t.fogNear * (1 - k) + 2 * k;
      scene.fog.far = t.fogFar * (1 - k) + 70 * k;
    },
    followCamera(cam) { cam.getWorldPosition(sky.position); },
  };
  return world;
}

// ---------- ruído suave determinístico ----------
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; }

// ---------- cânion ----------
const ROCK = ['#c45f3a', '#de8650', '#a9472e', '#eda96a', '#b8553a', '#d77a48'];
// perfil do paredão: [deslocamento para fora da borda do chão, altura] — degraus de rocha
const WALL = [[0, 0], [3, 18], [8, 26], [10, 58], [16, 70], [18, 100], [25, 114], [27, 148], [33, 160], [35, 190], [WALL_SLOPE * RIM, RIM]];
export function buildCanyon(env, mats) {
  const group = new THREE.Group();
  const S0 = env.start - 500, S1 = env.length + 500, step = 14;
  const rows = [];
  for (let s = S0; s <= S1; s += step) {
    const cx = env.cx(Math.max(env.start, Math.min(env.length, s))), hw = env.hw(s);
    const pts = [];
    // chão (com o rio no meio)
    const floorN = 8;
    for (let k = 0; k <= floorN; k++) {
      const u = -1 + 2 * k / floorN;
      const river = Math.abs(u) < 0.2;
      pts.push({ x: cx + u * hw, y: river ? -0.6 : 0.2 * noise1(s * 0.05 + k), z: -s, c: river ? '#3f8ea0' : (Math.abs(u) > 0.7 ? '#d29a63' : '#e2b27a') });
    }
    const wall = (side) => {
      const out = [];
      WALL.forEach(([dx, y], k) => {
        const jitter = k > 0 && k < WALL.length - 1 ? (noise1(s * 0.03 + k * 7 + side * 3) - 0.5) * 6 : 0;
        const band = Math.floor(y / 36 + noise1(s * 0.004 + side) * 1.5);
        out.push({ x: cx + side * (hw + dx + jitter), y, z: -s, c: ROCK[(band + 6) % ROCK.length] });
      });
      // planalto com morrinhos
      for (const [dx, f] of [[30, 0.2], [140, 0.5], [420, 1], [1300, 0.6]]) {
        const y = RIM + f * 18 * noise1(s * 0.01 + dx * 0.1 + side * 5);
        out.push({ x: cx + side * (hw + WALL_SLOPE * RIM + dx), y, z: -s, c: f > 0.8 ? '#b7744a' : '#c9875a' });
      }
      return out;
    };
    const L = wall(-1).reverse(), R = wall(1);
    rows.push({ s, pts: [...L, ...pts, ...R] });
  }
  const pos = [], col = [];
  const C = new THREE.Color();
  for (let r = 0; r < rows.length - 1; r++) {
    const a = rows[r], b = rows[r + 1];
    for (let k = 0; k < a.pts.length - 1; k++) {
      const p00 = a.pts[k], p01 = a.pts[k + 1], p10 = b.pts[k], p11 = b.pts[k + 1];
      const tri = (p, q, w) => {
        pos.push(p.x, p.y, p.z, q.x, q.y, q.z, w.x, w.y, w.z);
        C.set(p.c);
        for (let i = 0; i < 3; i++) col.push(C.r, C.g, C.b);
      };
      tri(p00, p10, p11); tri(p00, p11, p01);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mats.flat);
  group.add(mesh);

  // mesas de pedra e arbustos no planalto (instanciados)
  const rnd = mulberry(env.length);
  const mesaGeo = new THREE.CylinderGeometry(1, 1.25, 1, 6);
  const mesas = new THREE.InstancedMesh(mesaGeo, new THREE.MeshLambertMaterial({ flatShading: true }), 90);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < 90; i++) {
    const s = env.start + rnd() * (env.length - env.start), side = rnd() < 0.5 ? -1 : 1;
    const x = env.cx(s) + side * (env.hw(s) + 120 + rnd() * 900), h = 20 + rnd() * 90, r = 30 + rnd() * 70;
    m4.compose(new THREE.Vector3(x, RIM + h / 2 - 2, -s), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 3), new THREE.Vector3(r, h, r));
    mesas.setMatrixAt(i, m4);
    mesas.setColorAt(i, c.set(ROCK[Math.floor(rnd() * ROCK.length)]));
  }
  group.add(mesas);
  const bushGeo = new THREE.IcosahedronGeometry(1, 0);
  const bushes = new THREE.InstancedMesh(bushGeo, new THREE.MeshLambertMaterial({ flatShading: true }), 260);
  for (let i = 0; i < 260; i++) {
    const s = env.start + rnd() * (env.length - env.start);
    const inside = rnd() < 0.45;
    const side = rnd() < 0.5 ? -1 : 1;
    const x = inside ? env.cx(s) + (rnd() * 1.6 - 0.8) * env.hw(s) : env.cx(s) + side * (env.hw(s) + 60 + rnd() * 600);
    const y = inside ? 1 : RIM + 2;
    if (inside && Math.abs(x - env.cx(s)) < env.hw(s) * 0.25) continue;
    const r = inside ? 2 + rnd() * 3 : 4 + rnd() * 6;
    m4.compose(new THREE.Vector3(x, y, -s), new THREE.Quaternion(), new THREE.Vector3(r, r * 0.7, r));
    bushes.setMatrixAt(i, m4);
    bushes.setColorAt(i, c.set(rnd() < 0.5 ? '#7d8a4e' : '#99a05c'));
  }
  group.add(bushes);
  return { group, update() {}, dispose() { geo.dispose(); mesaGeo.dispose(); bushGeo.dispose(); mesas.material.dispose(); bushes.material.dispose(); } };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- mar de nuvens ----------
export function buildClouds(env, mats) {
  const group = new THREE.Group();
  // tapete de nuvens lá embaixo: plano ondulado facetado
  const R = 7000, seg = 70;
  const g = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), C = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + env.center[0], z = p.getZ(i) + env.center[2];
    const h = 22 * (Math.sin(x * 0.004) * Math.cos(z * 0.0035) + 0.6 * Math.sin(x * 0.011 + z * 0.007));
    p.setXYZ(i, x, h - 15, z);
  }
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    C.set(y > 5 ? '#fde9de' : y > -12 ? '#f3c9c0' : '#d99aa6');
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = C.r; col[(i + k) * 3 + 1] = C.g; col[(i + k) * 3 + 2] = C.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv'); g.computeVertexNormals();
  const sea = new THREE.Mesh(g, mats.flat);
  group.add(sea);
  // nuvens soltas: bolas facetadas instanciadas
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const puffs = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true, emissive: new THREE.Color('#5a3a4a') }), env.puffs.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  env.puffs.forEach((pf, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7);
    m4.compose(new THREE.Vector3(pf.x, pf.y, pf.z), q, new THREE.Vector3(pf.r, pf.r * 0.72, pf.r));
    puffs.setMatrixAt(i, m4);
    puffs.setColorAt(i, C.set(i % 5 === 0 ? '#ffd9cf' : i % 3 === 0 ? '#ffeee6' : '#fff6f0'));
  });
  group.add(puffs);
  return { group, update() {}, dispose() { g.dispose(); geo.dispose(); puffs.material.dispose(); } };
}

// ---------- mar aberto ----------
export function buildOcean(env, mats) {
  const group = new THREE.Group();
  const R = 7000, seg = 60;
  const g = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), C = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + env.center[0], z = p.getZ(i) + env.center[2];
    p.setXYZ(i, x, 3 * Math.sin(x * 0.02 + z * 0.013) + 2 * Math.cos(z * 0.031), z);
  }
  for (let i = 0; i < p.count; i += 3) {
    const k = hash(i * 0.37);
    C.set(k < 0.33 ? '#2a6475' : k < 0.66 ? '#327282' : '#3c808e');
    for (let j = 0; j < 3; j++) { col[(i + j) * 3] = C.r; col[(i + j) * 3 + 1] = C.g; col[(i + j) * 3 + 2] = C.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv'); g.computeVertexNormals();
  group.add(new THREE.Mesh(g, mats.flat));
  // rochedos espalhados no mar, para dar noção de altura e velocidade
  const rg = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rg, new THREE.MeshLambertMaterial({ flatShading: true, color: '#6a5458' }), 40);
  const rnd = mulberry(99), m4 = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = 400 + rnd() * 3200, s = 20 + rnd() * 70;
    m4.compose(new THREE.Vector3(env.center[0] + Math.cos(a) * d, 0, env.center[2] + Math.sin(a) * d), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(s, s * (0.8 + rnd()), s));
    rocks.setMatrixAt(i, m4);
  }
  group.add(rocks);
  return { group, update() {}, dispose() { g.dispose(); rg.dispose(); rocks.material.dispose(); } };
}

export function buildEnv(env, mats) {
  if (env.type === 'canyon') return buildCanyon(env, mats);
  if (env.type === 'clouds') return buildClouds(env, mats);
  return buildOcean(env, mats);
}

// ---------- aviões ----------
// nariz para -z, asa direita +x. Escala real (~13 m).
export function jetGeometry({ body = '#efe4cc', trim = '#2f7d8c', stripe = '#e2553a', glass = '#203048', size = 1 } = {}) {
  const b = new Builder();
  b.cyl(0.95, 0.75, 9, body, [0, 0, 0.6], [Math.PI / 2, 0, 0], 8);
  b.cone(0.95, 3.4, body, [0, 0, -5.6], [-Math.PI / 2, 0, 0], 8);
  b.cyl(0.97, 0.97, 0.7, stripe, [0, 0, -3.2], [Math.PI / 2, 0, 0], 8);
  b.ball(0.75, glass, [0, 0.72, -2.6], [0.85, 0.7, 2.1]);
  b.slab([[0.6, -2.4], [6.2, 2.6], [6.2, 3.6], [0.6, 3.6]], 0.22, trim, -0.2);
  b.slab([[-0.6, -2.4], [-0.6, 3.6], [-6.2, 3.6], [-6.2, 2.6]], 0.22, trim, -0.2);
  b.slab([[5.2, 2.0], [6.25, 2.8], [6.25, 3.6], [5.2, 3.6]], 0.26, stripe, -0.2);
  b.slab([[-5.2, 2.0], [-5.2, 3.6], [-6.25, 3.6], [-6.25, 2.8]], 0.26, stripe, -0.2);
  b.slab([[0.5, 3.6], [2.6, 5.0], [2.6, 5.7], [0.5, 5.7]], 0.14, trim, 0.1);
  b.slab([[-0.5, 3.6], [-0.5, 5.7], [-2.6, 5.7], [-2.6, 5.0]], 0.14, trim, 0.1);
  // deriva
  b.add(finGeo(), trim, [0, 0.6, 4.4]);
  b.cyl(0.62, 0.7, 0.6, '#3a3a40', [0, 0, 5.3], [Math.PI / 2, 0, 0], 8);
  const g = b.geometry();
  if (size !== 1) g.scale(size, size, size);
  return g;
}
function finGeo() {
  const g = new THREE.BufferGeometry();
  const t = 0.1, pts = [[0, -1.6], [2.4, 0.4], [2.4, 1.3], [0, 1.3]]; // [y, z]
  const v = [];
  const P = (y, z, x) => [x, y, z];
  const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
  const L = pts.map(([y, z]) => P(y, z, -t)), R = pts.map(([y, z]) => P(y, z, t));
  quad(L[0], L[1], L[2], L[3]); quad(R[0], R[3], R[2], R[1]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(L[i], R[i], R[j], L[j]); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

function enemyJet(color = '#b8341f', dark = '#1c1c26', accent = '#f0c040') {
  const b = new Builder();
  // caça inimigo: fuselagem escura, asas em flecha para a frente, nariz vermelho
  b.cyl(0.8, 0.6, 8, dark, [0, 0, 0.5], [Math.PI / 2, 0, 0], 6);
  b.cone(0.8, 3, color, [0, 0, -5], [-Math.PI / 2, 0, 0], 6);
  b.ball(0.55, '#f2c060', [0, 0.6, -2.2], [0.8, 0.6, 1.8], 0);
  b.slab([[0.5, 1.6], [6, -0.8], [6, 0.4], [0.5, 3.6]], 0.2, color, 0);
  b.slab([[-0.5, 1.6], [-0.5, 3.6], [-6, 0.4], [-6, -0.8]], 0.2, color, 0);
  b.slab([[5.4, -0.6], [6.1, -0.9], [6.1, 0.4], [5.4, 0.5]], 0.24, accent, 0);
  b.slab([[-5.4, -0.6], [-5.4, 0.5], [-6.1, 0.4], [-6.1, -0.9]], 0.24, accent, 0);
  b.add(finGeo(), dark, [1.0, 0.5, 3.6], [0, 0, -0.4], [0.85, 0.85, 0.85]);
  b.add(finGeo(), dark, [-1.0, 0.5, 3.6], [0, 0, 0.4], [0.85, 0.85, 0.85]);
  b.cyl(0.5, 0.6, 0.5, '#ff8a3a', [0, 0, 4.8], [Math.PI / 2, 0, 0], 6);
  return b.geometry();
}

function bomberGeo() {
  const b = new Builder();
  b.cyl(1.6, 1.4, 16, '#4a4a58', [0, 0, 0], [Math.PI / 2, 0, 0], 8);
  b.cone(1.6, 3.5, '#b8341f', [0, 0, -9.7], [-Math.PI / 2, 0, 0], 8);
  b.slab([[1, -2], [12, 1], [12, 3], [1, 2]], 0.4, '#5a5a6a', 0.4);
  b.slab([[-1, -2], [-1, 2], [-12, 3], [-12, 1]], 0.4, '#5a5a6a', 0.4);
  for (const x of [-6, -3.2, 3.2, 6]) b.cyl(0.55, 0.55, 2.6, '#2a2a33', [x, 0, -0.8], [Math.PI / 2, 0, 0], 6);
  b.add(finGeo(), '#4a4a58', [0, 1, 6.5], [0, 0, 0], [1.5, 1.5, 1.5]);
  b.slab([[0.8, 6], [4.4, 7.4], [4.4, 8.4], [0.8, 8.4]], 0.2, '#b8341f', 0.3);
  b.slab([[-0.8, 6], [-0.8, 8.4], [-4.4, 8.4], [-4.4, 7.4]], 0.2, '#b8341f', 0.3);
  return b.geometry();
}

function cargoGeo() {
  const b = new Builder();
  // avião de carga aliado: gordo, asa alta, cor creme e verde-oliva
  b.cyl(2.2, 2.0, 18, '#e9dcbc', [0, 0, 0], [Math.PI / 2, 0, 0], 10);
  b.ball(2.2, '#e9dcbc', [0, 0, -9], [1, 1, 1.4]);
  b.ball(1.2, '#2a3a50', [0, 1.1, -11], [1.2, 0.6, 0.8], 0);
  b.slab([[1.5, -3], [15, -1.6], [15, 0.6], [1.5, 1]], 0.5, '#6f7d4f', 1.8);
  b.slab([[-1.5, -3], [-1.5, 1], [-15, 0.6], [-15, -1.6]], 0.5, '#6f7d4f', 1.8);
  for (const x of [-9, -4.5, 4.5, 9]) b.cyl(0.7, 0.7, 3, '#4a5038', [x, 1.2, -2.6], [Math.PI / 2, 0, 0], 6);
  b.add(finGeo(), '#6f7d4f', [0, 1.6, 8], [0, 0, 0], [2, 2, 2]);
  b.slab([[0.6, 8], [6, 9.6], [6, 11], [0.6, 11]], 0.3, '#6f7d4f', 1);
  b.slab([[-0.6, 8], [-0.6, 11], [-6, 11], [-6, 9.6]], 0.3, '#6f7d4f', 1);
  b.box(4.6, 0.2, 2.2, '#e2553a', [0, -2.15, -1]);
  return b.geometry();
}

function blimpGeo(ally) {
  const b = new Builder();
  const env = ally ? '#e9dcbc' : '#4c4658', stripe = ally ? '#2f7d8c' : '#b8341f';
  b.ball(1, env, [0, 0, 0], [12, 12, 34], 2);
  b.cyl(12.3, 12.3, 3, stripe, [0, 0, -4], [Math.PI / 2, 0, 0], 16);
  b.box(5, 4, 12, '#2a2a33', [0, -13, 0]);
  b.add(finGeo(), stripe, [0, 7, 28], [0, 0, 0], [4, 4, 4]);
  b.add(finGeo(), stripe, [7, 0, 28], [0, 0, -Math.PI / 2], [4, 4, 4]);
  b.add(finGeo(), stripe, [-7, 0, 28], [0, 0, Math.PI / 2], [4, 4, 4]);
  if (!ally) b.cyl(4, 4, 0.6, '#f0c040', [0, 12.5, -6], [0, 0, 0], 12);
  return b.geometry();
}

function turretGeo(deck = false) {
  const b = new Builder();
  if (!deck) b.cyl(5, 6.5, 4, '#6a5a4a', [0, 1, 0], [0, 0, 0], 8);
  b.cyl(3.2, 3.6, 3, '#3a3a44', [0, deck ? 1 : 4.5, 0], [0, 0, 0], 8);
  b.box(0.7, 0.7, 7, '#2a2a30', [-1, deck ? 2.4 : 6, -3.4], [0.35, 0, 0]);
  b.box(0.7, 0.7, 7, '#2a2a30', [1, deck ? 2.4 : 6, -3.4], [0.35, 0, 0]);
  b.box(1.4, 0.5, 0.5, '#e2553a', [0, deck ? 3.4 : 7, 0]);
  return b.geometry();
}
function tankGeo() {
  const b = new Builder();
  b.box(6, 2, 9, '#5e6a3c', [0, 1.4, 0]);
  b.box(1.4, 1.4, 9.6, '#2a2a28', [-3.3, 0.8, 0]); b.box(1.4, 1.4, 9.6, '#2a2a28', [3.3, 0.8, 0]);
  b.cyl(2.2, 2.6, 1.6, '#6e7a48', [0, 3.2, 0.6], [0, 0, 0], 7);
  b.box(0.6, 0.6, 6, '#2a2a28', [0, 3.3, -3.4]);
  b.box(6.2, 0.3, 1.2, '#e2553a', [0, 2.5, 2.6]);
  return b.geometry();
}
function radarGeo() {
  const b = new Builder();
  b.box(5, 4, 5, '#7a6a58', [0, 2, 0]);
  b.cyl(0.5, 0.6, 7, '#3a3a40', [0, 7, 0]);
  b.cyl(5, 1.2, 1.4, '#d9d2c0', [0, 11, 0], [1.1, 0, 0], 10);
  b.ball(0.6, '#e2553a', [0, 11.4, -2.2], [1, 1, 1], 0);
  return b.geometry();
}

// naves grandes: casco escuro com faixas
function fortressGeo([W, H, L]) {
  const b = new Builder();
  // fortaleza de pedra e metal: base larga, domo, torres nos cantos
  b.box(W * 1.7, H * 0.7, L * 1.45, '#8a6a4e', [0, -H * 0.5, 0]);
  b.ball(1, '#6c5a4c', [0, 0, 0], [W, H, L], 1);
  b.cyl(W * 0.45, W * 0.55, H * 0.6, '#4a4048', [0, H * 0.85, 0], [0, 0, 0], 8);
  for (const z of [-0.55, 0, 0.55]) b.box(W * 1.72, 3, 4, '#e2553a', [0, -H * 0.2, z * L]);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.cyl(7, 9, H * 1.2, '#7a5e48', [x * W * 0.8, -H * 0.1, z * L * 0.64], [0, 0, 0], 6);
  return b.geometry();
}
function frigateGeo([W, H, L], ally) {
  const b = new Builder();
  const hull = ally ? '#7d8c64' : '#5c6884', deck = ally ? '#9aa880' : '#76829c', trim = ally ? '#f0e2c0' : '#c8402a';
  b.ball(1, hull, [0, 0, 0], [W, H, L], 1);
  b.box(W * 1.3, H * 0.25, L * 1.5, deck, [0, H * 0.55, 0]);
  b.box(W * 0.7, H * 0.8, L * 0.3, hull, [0, H * 0.95, L * 0.15]);
  b.box(W * 1.32, 1.2, 4, trim, [0, H * 0.3, -L * 0.6]);
  b.box(W * 1.32, 1.2, 4, trim, [0, H * 0.3, L * 0.4]);
  b.cone(W * 0.6, L * 0.35, hull, [0, -H * 0.1, -L * 0.95], [-Math.PI / 2, 0, 0], 8);
  if (ally) { b.box(W * 1.8, 1.2, L * 1.7, '#5a6448', [0, H * 0.75, 0]); b.box(2.2, 0.3, L * 1.6, '#f0e2c0', [0, H * 0.75 + 0.7, 0]); }
  return b.geometry();
}
function battleshipGeo([W, H, L]) {
  const b = new Builder();
  b.ball(1, '#5e6a86', [0, 0, 0], [W, H, L], 1);
  b.box(W * 1.25, H * 0.3, L * 1.45, '#7a86a0', [0, H * 0.55, 0]);
  b.box(W * 0.8, H * 0.7, L * 0.25, '#4e5874', [0, H * 0.95, 0]);
  b.cone(W * 0.7, L * 0.4, '#5e6a86', [0, 0, -L * 1.02], [-Math.PI / 2, 0, 0], 8);
  for (const z of [-0.75, -0.25, 0.25, 0.75]) b.box(W * 1.27, 2.5, 6, '#c8402a', [0, H * 0.35, z * L]);
  for (const x of [-1, 1]) for (const z of [-0.4, 0.4]) b.slab([[x * W * 0.6, z * L - 20], [x * W * 2.4, z * L - 6], [x * W * 2.4, z * L + 6], [x * W * 0.6, z * L + 20]], 2, '#3e4660', 0);
  for (const x of [-W * 0.5, 0, W * 0.5]) b.cyl(4, 5.5, 10, '#ff8a3a', [x, 0, L * 1.0], [Math.PI / 2, 0, 0], 8);
  return b.geometry();
}
function weakGeo(model) {
  const b = new Builder();
  if (model === 'engine') { b.cyl(4, 5, 8, '#ff8a3a', [0, 0, 0], [Math.PI / 2, 0, 0], 8); b.cyl(2.8, 2.8, 8.4, '#ffd27a', [0, 0, 0], [Math.PI / 2, 0, 0], 8); }
  else if (model === 'antenna') { b.cyl(0.8, 1.2, 12, '#ffb04a', [0, 2, 0]); b.ball(3.4, '#ff8a3a', [0, 8, 0], [1, 1, 1], 0); }
  else if (model === 'cannon') { b.cyl(4, 5, 5, '#ff8a3a', [0, -1, 0], [0, 0, 0], 8); b.box(1.2, 1.2, 10, '#3a2a20', [0, 1, -5], [0.4, 0, 0]); }
  else if (model === 'generator') { b.cyl(5, 6.5, 9, '#ffb04a', [0, 0, 0], [0, 0, 0], 6); b.ball(3.6, '#fff0b0', [0, 6, 0], [1, 1, 1], 0); }
  else if (model === 'reactor') { b.ball(9, '#ff6a3a', [0, 0, 0], [1, 1, 1], 1); b.cyl(10, 10, 2, '#ffe27a', [0, 0, 0], [0, 0, 0], 12); }
  else b.ball(6, '#ff8a3a', [0, 0, 0], [1, 1, 1], 0);
  return b.geometry();
}

// escudo do núcleo: bolha translúcida
export function shieldMesh(r) {
  return new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.28, depthWrite: false, wireframe: false }));
}

const GEO_CACHE = {};
export function modelGeometry(e) {
  const key = e.kind + ':' + (e.model || '') + (e.hull ? e.hull.join('x') : '');
  if (GEO_CACHE[key]) return GEO_CACHE[key];
  let g;
  switch (e.kind) {
    case 'fighter': g = enemyJet(); break;
    case 'ace': g = enemyJet('#d42a1a', '#7a1010', '#ffd23a'); g.scale(1.1, 1.1, 1.1); break;
    case 'bomber': g = bomberGeo(); break;
    case 'turret': g = turretGeo(e.model === 'deckgun' || !!e.parent); break;
    case 'target': g = e.model === 'radar' ? radarGeo() : tankGeo(); break;
    case 'balloon': g = blimpGeo(false); break;
    case 'ally': g = e.model === 'blimpAlly' ? blimpGeo(true) : cargoGeo(); break;
    case 'allyShip': g = frigateGeo(e.hull, true); break;
    case 'ship': g = e.model === 'fortress' ? fortressGeo(e.hull) : e.model === 'battleship' ? battleshipGeo(e.hull) : frigateGeo(e.hull, false); break;
    case 'weak': case 'core': g = weakGeo(e.model); break;
    default: g = new THREE.BoxGeometry(4, 4, 4);
  }
  GEO_CACHE[key] = g;
  return g;
}
export function entityMesh(e, mats) {
  const glow = e.kind === 'weak' || e.kind === 'core';
  const mesh = new THREE.Mesh(modelGeometry(e), glow ? mats.glow : mats.flat);
  if (e.kind === 'weak') mesh.scale.setScalar(1.5);
  if (e.kind === 'core') { mesh.userData.shield = shieldMesh(e.r + 6); mesh.add(mesh.userData.shield); }
  return mesh;
}

// portal da corrida: anel
const portalGeo = new THREE.TorusGeometry(1, 0.07, 6, 28);
export function portalMesh(r) {
  const m = new THREE.Mesh(portalGeo, new THREE.MeshBasicMaterial({ color: '#ffd23a', fog: false }));
  m.scale.setScalar(r);
  return m;
}

// ---------- cabine ----------
// Origem no olho do piloto, olhando para -z. Devolve partes móveis (manche, manete) e as telas.
export function buildCockpit(mats) {
  const group = new THREE.Group();
  const b = new Builder();
  const panel = '#2b3346', frame = '#1f2a44', cream = '#efe4cc', coral = '#e2553a', teal = '#2f7d8c';
  // nariz e asas vistos de dentro (abaixo da linha dos olhos)
  b.cyl(0.8, 0.72, 4.4, cream, [0, -1.25, -3.2], [Math.PI / 2, 0, 0], 10);
  b.cone(0.8, 3.6, cream, [0, -1.25, -7.2], [-Math.PI / 2, 0, 0], 10);
  b.slab([[0.7, -1.4], [6.4, 3.4], [6.4, 4.4], [0.7, 4.4]], 0.2, teal, -1.6);
  b.slab([[-0.7, -1.4], [-0.7, 4.4], [-6.4, 4.4], [-6.4, 3.4]], 0.2, teal, -1.6);
  b.slab([[5.4, 2.6], [6.45, 3.5], [6.45, 4.4], [5.4, 4.4]], 0.24, coral, -1.6);
  b.slab([[-5.4, 2.6], [-5.4, 4.4], [-6.45, 4.4], [-6.45, 3.5]], 0.24, coral, -1.6);
  // laterais da fuselagem em volta do piloto
  b.box(0.12, 0.55, 2.4, cream, [0.62, -0.5, -0.1]);
  b.box(0.12, 0.55, 2.4, cream, [-0.62, -0.5, -0.1]);
  b.box(1.36, 0.1, 2.4, frame, [0, -1.05, -0.1]);
  // painel e capô
  b.box(1.1, 0.42, 0.12, panel, [0, -0.47, -0.78], [-0.25, 0, 0]);
  b.box(1.16, 0.05, 0.3, frame, [0, -0.255, -0.88]);
  b.slab([[-0.58, -1.03], [0.58, -1.03], [0.5, -0.74], [-0.5, -0.74]], 0.03, panel, -0.235);
  // consoles laterais
  b.box(0.2, 0.08, 0.9, panel, [0.48, -0.5, -0.12]);
  b.box(0.2, 0.08, 0.9, panel, [-0.48, -0.5, -0.12]);
  for (let i = 0; i < 4; i++) { b.box(0.03, 0.02, 0.05, i % 2 ? coral : '#f0c040', [0.43 + (i % 2) * 0.08, -0.455, -0.4 + i * 0.12]); b.box(0.03, 0.02, 0.05, i % 2 ? teal : '#f0c040', [-0.43 - (i % 2) * 0.08, -0.455, -0.4 + i * 0.12]); }
  // assento
  b.box(0.6, 0.12, 0.55, '#3a3a40', [0, -1.0, 0.15]);
  b.box(0.6, 1.0, 0.14, '#3a3a40', [0, -0.55, 0.48]);
  b.box(0.3, 0.2, 0.1, coral, [0, 0.0, 0.47]);
  // armação do canopi: arco da frente, trilhos dos lados e arco de trás
  // arco: segmentos finos ao longo de uma meia elipse (largura r, altura r * k)
  const arch = (z, r, k, t) => {
    const N = 10;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI * i / N, a1 = Math.PI * (i + 1) / N;
      const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r * k, x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r * k;
      const len = Math.hypot(x1 - x0, y1 - y0);
      b.box(len + 0.01, t, t, frame, [(x0 + x1) / 2, -0.24 + (y0 + y1) / 2, z], [0, 0, Math.atan2(y1 - y0, x1 - x0)]);
    }
  };
  arch(-1.02, 0.6, 0.75, 0.035);
  arch(0.7, 0.62, 0.85, 0.05);
  b.box(0.04, 0.04, 1.72, frame, [0.6, -0.235, -0.16]);
  b.box(0.04, 0.04, 1.72, frame, [-0.6, -0.235, -0.16]);
  // pernas do piloto (para dar escala)
  b.box(0.16, 0.14, 0.6, '#556070', [0.12, -0.86, -0.25]);
  b.box(0.16, 0.14, 0.6, '#556070', [-0.12, -0.86, -0.25]);
  const body = new THREE.Mesh(b.geometry(), mats.flat);
  group.add(body);

  // manche lateral à direita (gira no pino da base)
  const stick = new THREE.Group();
  stick.position.set(0.42, -0.46, -0.24);
  const sb = new Builder();
  sb.cyl(0.018, 0.022, 0.16, '#2a2a30', [0, 0.08, 0]);
  sb.cyl(0.03, 0.028, 0.11, '#3a3a40', [0, 0.2, 0]);
  sb.box(0.022, 0.02, 0.03, coral, [0, 0.235, -0.03]);
  sb.ball(0.012, '#f0c040', [0, 0.262, 0], [1, 1, 1], 0);
  const stickMesh = new THREE.Mesh(sb.geometry(), mats.flat);
  stick.add(stickMesh);
  group.add(stick);
  const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 8), new THREE.MeshLambertMaterial({ color: '#111', flatShading: true }));
  boot.position.copy(stick.position);
  group.add(boot);
  // manete à esquerda (desliza para a frente e para trás)
  const throttle = new THREE.Group();
  throttle.position.set(-0.42, -0.44, -0.12);
  const tb = new Builder();
  tb.box(0.022, 0.12, 0.022, '#2a2a30', [0, 0.04, 0]);
  tb.box(0.05, 0.05, 0.08, '#3a3a40', [-0.01, 0.12, 0]);
  tb.box(0.016, 0.012, 0.016, coral, [-0.01, 0.15, -0.02]);
  throttle.add(new THREE.Mesh(tb.geometry(), mats.flat));
  group.add(throttle);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.26), new THREE.MeshBasicMaterial({ color: '#111' }));
  slot.position.set(-0.42, -0.455, -0.12);
  group.add(slot);

  // instrumentos (canvas): radar, horizonte artificial, barras
  const inst = new CanvasScreen(1024, 384, 0.98, 0.367);
  inst.mesh.position.set(0, -0.46, -0.715);
  inst.mesh.rotation.x = -0.25;
  group.add(inst.mesh);
  // vidro do HUD
  const hud = new CanvasScreen(512, 512, 0.26, 0.26, true);
  hud.mesh.position.set(0, -0.04, -0.82);
  hud.mesh.rotation.x = 0.12;
  group.add(hud.mesh);
  const hudFrame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.012, 0.03), new THREE.MeshLambertMaterial({ color: frame }));
  hudFrame.position.set(0, -0.18, -0.84);
  group.add(hudFrame);
  return { group, stick, throttle, inst, hud };
}

// tela feita de canvas num plano
export class CanvasScreen {
  constructor(pw, ph, w, h, additive = false) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pw; this.canvas.height = ph;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: !additive, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    if (additive) this.mesh.renderOrder = 5;
  }
  commit() { this.tex.needsUpdate = true; }
}

// ---------- efeitos ----------
// tiros: traçantes instanciados (caixas finas esticadas na direção do voo)
export class Tracers {
  constructor(scene, color, max = 240, len = 10, w = 0.35) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(w, w, len), new THREE.MeshBasicMaterial({ color, fog: false }), max);
    this.mesh.frustumCulled = false;
    this.max = max;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(1, 1, 1);
    this.fwd = new THREE.Vector3(0, 0, -1);
  }
  set(list) {
    let n = 0;
    for (const b of list) {
      if (n >= this.max) break;
      this.v.set(b.vx, b.vy, b.vz).normalize();
      this.q.setFromUnitVectors(this.fwd, this.v);
      const sc = b.flak ? 0.35 : b.bomb ? 0.4 : 1;
      this.s.set(b.flak ? 2.4 : b.bomb ? 5 : 1, b.flak ? 2.4 : b.bomb ? 5 : 1, sc);
      this.m.compose(this.p.set(b.x, b.y, b.z), this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// partículas: fogo, fumaça, faíscas (icosaedros instanciados com cor própria)
export class Particles {
  constructor(scene, max = 700) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.max = max; this.list = [];
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.c0 = new THREE.Color(); this.c1 = new THREE.Color(); this.c = new THREE.Color();
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 0.5) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ x, y, z, vx, vy, vz, t: 0, life, s0, s1, c0: new THREE.Color(c0), c1: new THREE.Color(c1), drag, rot: Math.random() * 6 });
  }
  explode(x, y, z, size = 1) {
    const n = Math.round(10 + 14 * size);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), sp = (8 + Math.random() * 30) * size;
      const d = [Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)];
      this.spawn(x, y, z, d[0] * sp, d[1] * sp, d[2] * sp, 0.6 + Math.random() * 0.6, 2 * size, 7 * size, i % 3 ? '#ffd06a' : '#ff6a2a', '#5a3a30', 1.8);
    }
    for (let i = 0; i < n / 2; i++) this.spawn(x + (Math.random() - 0.5) * 6 * size, y + (Math.random() - 0.5) * 6 * size, z + (Math.random() - 0.5) * 6 * size, 0, 4 + Math.random() * 6, 0, 1.6 + Math.random(), 4 * size, 11 * size, '#6a5a58', '#3a3436', 0.5);
  }
  spark(x, y, z, color = '#ffe08a') {
    for (let i = 0; i < 3; i++) this.spawn(x, y, z, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 0.25, 0.6, 0.1, color, '#ff7a2a', 3);
  }
  update(dt) {
    let n = 0;
    const keep = [];
    for (const p of this.list) {
      p.t += dt;
      if (p.t >= p.life) continue;
      keep.push(p);
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = p.t / p.life;
      const sc = p.s0 + (p.s1 - p.s0) * f;
      this.q.setFromAxisAngle(this.p.set(0.3, 1, 0.2).normalize(), p.rot + f * 2);
      this.m.compose(this.p.set(p.x, p.y, p.z), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(n, this.m);
      this.c.copy(p.c0).lerp(p.c1, Math.min(1, f * 1.4));
      this.mesh.setColorAt(n, this.c);
      n++;
    }
    this.list = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// marcadores de alvo: losangos virados para a câmera, de tamanho constante na tela
export class Markers {
  constructor(scene, max = 48) {
    const g = new THREE.RingGeometry(0.86, 1, 4, 1);
    g.rotateZ(Math.PI / 4);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide }), max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.max = max;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.p = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color(); this.cam = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.qr = new THREE.Quaternion();
  }
  // items: [{ x,y,z, size (rad na tela), color, spin }]
  set(items, camera) {
    camera.getWorldPosition(this.cam);
    camera.getWorldQuaternion(this.q);
    let n = 0;
    for (const it of items) {
      if (n >= this.max) break;
      const d = this.cam.distanceTo(this.p.set(it.x, it.y, it.z));
      const sc = Math.max(0.5, d * it.size);
      this.qr.copy(this.q);
      if (it.spin) this.qr.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.spin));
      this.m.compose(this.p, this.qr, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.set(it.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// míssil: corpo + chama
export function missileMesh(mats) {
  const b = new Builder();
  b.cyl(0.18, 0.18, 2.6, '#e8e2d2', [0, 0, 0], [Math.PI / 2, 0, 0], 6);
  b.cone(0.18, 0.6, '#e2553a', [0, 0, -1.6], [-Math.PI / 2, 0, 0], 6);
  b.slab([[0, 0.9], [0.45, 1.3], [0.45, 1.3], [0, 1.3]], 0.05, '#e2553a');
  const g = new THREE.Group();
  g.add(new THREE.Mesh(b.geometry(), mats.flat));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 6), new THREE.MeshBasicMaterial({ color: '#ffb84a', fog: false }));
  flame.rotation.x = Math.PI / 2; flame.position.z = 2.1;
  g.add(flame);
  return g;
}

export function flameMesh(r = 0.6, l = 2.4) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, l, 8), new THREE.MeshBasicMaterial({ color: '#ffb84a', transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
  m.rotation.x = Math.PI / 2;
  return m;
}
