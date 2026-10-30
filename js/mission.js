// Uma missão em andamento: o caça do jogador, inimigos, aliados, tiros, mísseis, trava pelo olhar,
// objetivo, estrelas e eventos (para som, vibração e avisos). Sem navegador e sem Three.js.
//
// Entrada de cada passo (a mesma do jogador, do PC e do robô):
//   { pitch, roll, held, throttle, boost, gun, missile, look: [x, y, z] (direção da cabeça) }
import { Plane, PLANE, DT, dirOf, anglesOf, wrap } from './flight.js';
import { makeEnv, RIM, rng } from './env.js';

export { DT };
export const GUN = { rate: 12, speed: 720, life: 1.3, dmg: 5 };
export const MISSILE = { ammo: 6, reload: 6, cool: 0.7, speed: 330, turn: 3.4, life: 7, dmg: 70 };
export const LOCK = { cone: 6 * Math.PI / 180, keep: 16 * Math.PI / 180, time: 1.0, range: 1600 };
export const SHIELD = { max: 100, delay: 3, regen: 5 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const P = (e) => [e.x, e.y, e.z];
export const angleBetween = (a, b) => Math.acos(clamp(dot(norm(a), norm(b)), -1, 1));

// ponto do segmento a->b mais perto de c: distância
function segDist(a, b, c) {
  const ab = sub(b, a), L2 = dot(ab, ab) || 1;
  const t = clamp(dot(sub(c, a), ab) / L2, 0, 1);
  return len(sub([a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t], c));
}
// tempo de voo de um tiro até o alvo em movimento: ponto para mirar
export function leadPoint(from, fromVel, tgt, tgtVel, speed) {
  let t = len(sub(tgt, from)) / speed;
  for (let k = 0; k < 3; k++) {
    const p = [tgt[0] + (tgtVel[0] - fromVel[0]) * t, tgt[1] + (tgtVel[1] - fromVel[1]) * t, tgt[2] + (tgtVel[2] - fromVel[2]) * t];
    t = len(sub(p, from)) / speed;
  }
  return [tgt[0] + (tgtVel[0] - fromVel[0]) * t, tgt[1] + (tgtVel[1] - fromVel[1]) * t, tgt[2] + (tgtVel[2] - fromVel[2]) * t];
}
// local (x direita, y cima, z para trás) -> mundo, girado pelo rumo psi
export function rotY(off, psi) {
  const c = Math.cos(psi), s = Math.sin(psi);
  return [off[0] * c + off[2] * s, off[1], -off[0] * s + off[2] * c];
}
function toLocal(v, psi) { return rotY(v, -psi); }

// Tipos de entidade: raio de acerto, vida, se trava e se é inimigo
const KINDS = {
  fighter: { r: 7, hp: 25, team: 'enemy', speed: 105, turn: 0.85, lock: true },
  ace: { r: 7, hp: 320, team: 'enemy', speed: 132, turn: 1.15, lock: true },
  bomber: { r: 9, hp: 30, team: 'enemy', speed: 72, turn: 0.5, lock: true },
  turret: { r: 8, hp: 40, team: 'enemy', lock: true },
  target: { r: 9, hp: 30, team: 'enemy', lock: true },
  balloon: { r: 20, hp: 90, team: 'enemy', speed: 22, lock: true },
  weak: { r: 10, hp: 90, team: 'enemy', lock: true },
  core: { r: 14, hp: 320, team: 'enemy', lock: true },
  ship: { r: 0, hp: 1e9, team: 'enemy', lock: false },
  ally: { r: 11, hp: 100, team: 'ally', lock: false },
  allyShip: { r: 0, hp: 400, team: 'ally', lock: false },
  portal: { r: 26, hp: 1, team: 'none', lock: false },
};

let nextId = 1;

export class Mission {
  constructor(def, { seed = 1 } = {}) {
    this.def = def;
    this.env = makeEnv(def);
    this.rand = rng(seed * 7919 + (def.num || 1));
    const st = def.start || {};
    const sp = st.at || (this.env.type === 'canyon' ? this.env.point(0, 0, 70) : [0, 300, 0]);
    this.plane = new Plane(sp[0], sp[1], sp[2], st.psi ?? (this.env.type === 'canyon' ? anglesOf(this.env.tangent(0)).psi : 0));
    this.plane.v = 105; this.plane.throttle = 0.45;
    this.t = 0;
    this.state = 'playing';     // 'playing' | 'won' | 'lost'
    this.reason = '';
    this.events = [];
    this.ents = [];
    this.bullets = [];          // { x,y,z, vx,vy,vz, life, team, dmg, r }
    this.missiles = [];         // { x,y,z, vx,vy,vz, v, life, target, team }
    this.shield = SHIELD.max;
    this.dmg = 0;               // dano total levado
    this.sinceHit = 99;
    this.ammo = MISSILE.ammo; this.reloadT = 0; this.missileCool = 0;
    this.gunCool = 0; this.gunSide = 1; this.gunOn = false;
    this.lock = { cand: null, t: 0, target: null, lost: 0 };
    this.kills = 0;
    this.penalty = 0;           // corrida: segundos por portal perdido
    this.portalNext = 0;
    this.warn = '';             // aviso atual (antiaérea, fora da área...)
    this.waves = (def.waves || []).map(w => ({ ...w, done: false, count: 0, nextT: w.every ? (w.from ?? w.every) : 0 }));
    this.result = null;
    for (const s of def.spawn || []) this.spawn(s);
    this.checkWaves(true);
  }

  get pos() { return P(this.plane); }
  get time() { return this.t + this.penalty; }

  // ---------- criação ----------
  where(s) {
    if (s.at) return [...s.at];
    if (s.rim) return this.env.rimPoint(s.cs, s.rim);
    if (s.cs != null) return this.env.point(s.cs, s.u || 0, s.y ?? 60);
    if (s.basin) { const c = this.env.basinCenter(); return [c[0] + s.basin[0], s.basin[1], c[2] + s.basin[2]]; }
    if (s.polar) { const [a, d, y] = s.polar, c = this.env.center || [0, 0, 0]; return [c[0] + Math.cos(a) * d, y, c[2] + Math.sin(a) * d]; }
    if (s.ahead != null) { const ref = this.allies()[0] || this.plane; return this.env.point(-ref.z + s.ahead, s.u || 0, s.y ?? 80); }
    if (s.ring) { const [d, y] = s.ring, a = this.rand() * Math.PI * 2, c = this.env.center || [0, 0, 0]; return [c[0] + Math.cos(a) * d, y + (this.rand() - 0.5) * 120, c[2] + Math.sin(a) * d]; }
    if (s.rel) { const p = this.pos; return [p[0] + s.rel[0], p[1] + s.rel[1], p[2] + s.rel[2]]; }
    return [0, 200, -800];
  }
  spawn(s, parent = null) {
    const K = KINDS[s.k];
    const pos = parent ? [0, 0, 0] : this.where(s);
    const e = {
      id: nextId++, kind: s.k, x: pos[0], y: pos[1], z: pos[2], vx: 0, vy: 0, vz: 0,
      r: s.r ?? K.r, hp: s.hp ?? K.hp, maxHp: s.hp ?? K.hp, alive: true, team: K.team,
      lockable: K.lock, tag: s.tag || s.k, req: !!s.req, name: s.name || null,
      psi: s.psi ?? 0, theta: 0, phi: 0, v: s.speed ?? K.speed ?? 0, turn: s.turn ?? K.turn ?? 0,
      role: s.role || 'dogfight', state: 'attack', stateT: 0, fireCool: 1 + this.rand() * 2, burst: 0,
      parent, off: s.off || null, shieldBy: s.shieldBy || null, look: s.look || 'enemy',
      fire: s.fire ?? (s.k === 'turret' || s.k === 'fighter' || s.k === 'ace' || s.k === 'bomber'),
      dmgOut: s.dmgOut ?? null, range: s.range ?? 900, model: s.model || null, hull: s.hull || null,
      path: s.path || null, pathI: 0, done: false, circle: s.circle || null, ang: s.ang ?? 0,
      breakCool: 0, hitT: 0, wave: s.wave ?? 0,
    };
    if (s.k === 'portal') { e.n = s.n; e.normal = this.env.tangent ? this.env.tangent(-pos[2]) : [0, 0, -1]; }
    if (s.target === 'ally') e.look = 'ally';
    if (e.circle) this.placeCircle(e, 0);
    this.ents.push(e);
    if (parent) this.placeChild(e);
    for (const c of s.parts || []) this.spawn(c, e);
    // inimigos aparecem já voando para o jogador ou para o aliado
    if ((e.kind === 'fighter' || e.kind === 'ace' || e.kind === 'bomber') && s.psi == null) {
      const tgt = this.targetFor(e);
      if (tgt) e.psi = anglesOf(sub(P(tgt), P(e))).psi;
    }
    return e;
  }
  placeChild(e) {
    const p = e.parent;
    const o = rotY(e.off, p.psi);
    e.x = p.x + o[0]; e.y = p.y + o[1]; e.z = p.z + o[2];
    e.vx = p.vx; e.vy = p.vy; e.vz = p.vz;
  }
  placeCircle(e, dt) {
    const c = e.circle;     // { c: [x,y,z], r, w (rad/s) }
    e.ang += c.w * dt;
    const nx = c.c[0] + Math.cos(e.ang) * c.r, nz = c.c[2] + Math.sin(e.ang) * c.r;
    if (dt > 0) { e.vx = (nx - e.x) / dt; e.vz = (nz - e.z) / dt; }
    e.x = nx; e.y = c.c[1] + Math.sin(e.ang * 2) * 12; e.z = nz;
    e.psi = anglesOf([-Math.sin(e.ang) * Math.sign(c.w), 0, Math.cos(e.ang) * Math.sign(c.w)]).psi;
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }
  living(fn) { return this.ents.filter(e => e.alive && (!fn || fn(e))); }
  allies() { return this.living(e => e.team === 'ally'); }
  required() { return this.ents.filter(e => e.req); }
  // o que esse inimigo está atacando
  targetFor(e) {
    if (e.look === 'ally') { const a = this.allies()[0]; if (a) return a; }
    return this.plane;
  }

  // ---------- passo ----------
  step(input = {}) {
    this.events = [];
    // depois do fim o caça segue voando nivelado (só para a tela; nada mais conta)
    if (this.state !== 'playing') { this.plane.step(DT, { held: false }); return; }
    const dt = DT;
    this.t += dt;
    const pl = this.plane;
    const prev = this.pos;
    pl.step(dt, input);
    if (pl.boosted) this.emit('boost');
    this.collidePlayer(prev);
    this.updateEnts(dt);
    this.updateLock(dt, input.look || pl.fwd);
    this.updateWeapons(dt, input);
    this.updateBullets(dt);
    this.updateMissiles(dt);
    if (this.def.obj.type === 'race') this.updatePortals(prev);
    // escudo recarrega devagar
    this.sinceHit += dt;
    if (this.sinceHit > SHIELD.delay && this.shield < SHIELD.max) this.shield = Math.min(SHIELD.max, this.shield + SHIELD.regen * dt);
    this.checkWaves(false);
    this.checkObjective();
  }

  hurtPlayer(d, cause) {
    if (this.state !== 'playing') return;
    this.shield -= d; this.dmg += d; this.sinceHit = 0;
    this.emit('hurt', { d, cause });
    if (this.shield <= 0) { this.shield = 0; this.lose('Seu caça foi abatido.'); }
  }

  collidePlayer(prev) {
    const pl = this.plane, env = this.env;
    this.warn = '';
    if (env.type === 'canyon') {
      const s = -pl.z, cl = env.clearance(pl.x, pl.z, pl.y);
      if (pl.y < RIM + 2 && cl < PLANE.radius) {
        // bateu na parede: volta para dentro, alinhado com o cânion
        const dmg = 12 + pl.v * 0.12;
        const cx = env.cx(s), side = Math.sign(pl.x - cx) || 1;
        const inside = env.hw(s) > PLANE.radius * 3;
        if (inside && prev[1] < RIM) {
          pl.x = cx + side * (env.hw(s) - PLANE.radius * 2);
          const tpsi = anglesOf(env.tangent(s)).psi;
          const back = Math.abs(wrap(pl.psi - tpsi)) > Math.PI / 2;
          pl.psi = back ? wrap(tpsi + Math.PI) : tpsi;
          pl.phi *= 0.3;
        } else { pl.y = RIM + 6; pl.theta = Math.max(pl.theta, 0.35); }
        pl.v *= 0.7;
        this.hurtPlayer(dmg, 'wall');
        this.emit('crash', { v: pl.v });
      }
      if (pl.y > RIM + 45) { this.warn = 'Antiaérea! Desça para o cânion'; this.flakT = (this.flakT || 0) + DT; if (this.flakT > 0.5) { this.flakT = 0; this.hurtPlayer(1.5, 'aa'); this.emit('flak'); } }
    } else {
      const c = env.center, d = Math.hypot(pl.x - c[0], pl.z - c[2]);
      if (d > env.radius) { this.warn = 'Fora da área da missão: volte'; this.outT = (this.outT || 0) + DT; if (this.outT > 0.5) { this.outT = 0; this.hurtPlayer(2, 'out'); } }
      if (pl.y > 1400) { pl.y = 1400; pl.theta = Math.min(pl.theta, 0); this.warn = 'Teto máximo'; }
    }
    const g = env.ground(pl.x, pl.z) + (env.type === 'clouds' ? -12 : 0);
    if (pl.y < g + 3) {
      pl.y = g + 4; pl.theta = Math.max(pl.theta, 0.3); pl.v *= 0.75;
      this.hurtPlayer(14 + pl.v * 0.1, 'ground');
      this.emit('crash', { v: pl.v });
    }
    // casco das naves grandes
    for (const e of this.ents) {
      if (!e.hull || !e.alive) continue;
      const l = toLocal(sub(P(pl), P(e)), e.psi), [W, H, L] = e.hull;
      const q = Math.hypot(l[0] / (W + 4), l[1] / (H + 4), l[2] / (L + 4));
      if (q < 1) {
        const n = norm([l[0] / W / W, l[1] / H / H, l[2] / L / L]);
        const w = rotY(n, e.psi), k = 1.02 / q;
        const o = rotY([l[0] * k, l[1] * k, l[2] * k], e.psi);
        pl.x = e.x + o[0]; pl.y = e.y + o[1]; pl.z = e.z + o[2];
        const a = anglesOf(norm([pl.fwd[0] + w[0] * 1.5, pl.fwd[1] + w[1] * 1.5, pl.fwd[2] + w[2] * 1.5]));
        pl.psi = a.psi; pl.theta = clamp(a.theta, -1, 1); pl.v *= 0.7;
        this.hurtPlayer(16, 'hull');
        this.emit('crash', { v: pl.v });
      }
    }
  }

  // ---------- inimigos e aliados ----------
  updateEnts(dt) {
    for (const e of this.ents) {
      if (!e.alive) continue;
      e.hitT = Math.max(0, e.hitT - dt);
      if (e.parent) {
        this.placeChild(e);
        if (!e.parent.alive) this.kill(e, false);
      }
      if (e.kind === 'fighter' || e.kind === 'ace' || e.kind === 'bomber') this.flyEnemy(e, dt);
      else if (e.circle) this.placeCircle(e, dt);
      else if (e.kind === 'ally' || ((e.kind === 'ship' || e.kind === 'allyShip') && e.v)) this.moveAlong(e, dt);
      if (e.fire && (e.kind === 'turret' || (e.kind === 'weak' && e.dmgOut))) this.turretFire(e, dt);
    }
    // núcleo com escudo: só abre quando as peças que o protegem caírem
    for (const e of this.ents) if (e.alive && e.shieldBy) {
      const open = !this.ents.some(o => o.alive && o.tag === e.shieldBy);
      if (open && !e.open) { e.open = true; this.emit('shieldDown', { id: e.id }); }
      e.lockable = !!e.open;
    }
  }

  moveAlong(e, dt) {
    if (e.path) {
      const tgt = e.path[e.pathI];
      if (!tgt) { e.done = true; e.vx = e.vy = e.vz = 0; return; }
      const d = sub(tgt, P(e)), l = len(d);
      const step = e.v * dt;
      if (l <= step) { e.pathI++; if (e.pathI >= e.path.length) e.done = true; }
      const n = norm(d);
      e.vx = n[0] * e.v; e.vy = n[1] * e.v; e.vz = n[2] * e.v;
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
      const a = anglesOf(n);
      e.psi += wrap(a.psi - e.psi) * Math.min(1, dt * 3);
      e.theta = a.theta;
    } else {
      const f = dirOf(e.psi, 0);
      e.vx = f[0] * e.v; e.vz = f[2] * e.v;
      e.x += e.vx * dt; e.z += e.vz * dt;
    }
  }

  // voo dos caças inimigos: rumo e arfagem com giro limitado
  flyEnemy(e, dt) {
    const env = this.env, tgt = this.targetFor(e);
    e.stateT += dt; e.breakCool -= dt; e.flareCool = (e.flareCool || 0) - dt;
    const me = P(e), tp = P(tgt);
    const tv = tgt === this.plane ? this.plane.vel : [tgt.vx, tgt.vy, tgt.vz];
    const toT = sub(tp, me), dist = len(toT);
    const myF = dirOf(e.psi, e.theta);
    let want;
    if (e.role === 'canyon') want = this.canyonRaid(e, tgt);
    else {
      // quebra a curva quando o jogador está colado atrás e mirando nele
      const pf = this.plane.fwd, fromP = sub(me, P(this.plane)), dP = len(fromP);
      if (e.state === 'attack' && e.breakCool <= 0 && dP < 380 && angleBetween(pf, fromP) < 0.16 && e.kind !== 'bomber') {
        e.state = 'break'; e.stateT = 0; e.breakDir = this.rand() < 0.5 ? -1 : 1; e.breakCool = e.kind === 'ace' ? 4 : 6;
      }
      if (e.state === 'break') {
        const right = [Math.cos(e.psi), 0, -Math.sin(e.psi)];
        want = norm([myF[0] + right[0] * e.breakDir * 1.6, 0.35 * Math.sin(e.stateT * 2), myF[2] + right[2] * e.breakDir * 1.6]);
        if (e.stateT > (e.kind === 'ace' ? 2.0 : 2.6)) { e.state = 'attack'; e.stateT = 0; }
      } else if (e.state === 'extend') {
        want = myF;
        if (e.stateT > 2.2) { e.state = 'attack'; e.stateT = 0; }
      } else {
        if (e.kind === 'bomber') want = norm(sub([tp[0], tp[1] + 40, tp[2]], me));
        else want = norm(sub(leadPoint(me, [0, 0, 0], tp, tv, e.v + 250), me));
        // passou de frente muito perto: segue reto um pouco antes de voltar
        if (dist < 140 && e.kind !== 'bomber') { e.state = 'extend'; e.stateT = 0; }
      }
      // não entra no chão, nem nas paredes do cânion, nem fora da área
      const floor = env.type === 'canyon' ? 40 : 60;
      if (e.y < floor + 40) want = norm([want[0], Math.max(want[1], (floor + 40 - e.y) / 60), want[2]]);
      if (env.type === 'canyon') {
        const cl = env.clearance(e.x, e.z);
        if (e.y < RIM + 30 && cl < 60) {
          const cx = env.cx(-e.z);
          want = norm([want[0] + Math.sign(cx - e.x) * (60 - cl) / 30, want[1], want[2]]);
        }
        if (e.y > RIM - 20) want = norm([want[0], Math.min(want[1], -0.3), want[2]]);
      } else if (env.center) {
        const c = env.center, dc = Math.hypot(e.x - c[0], e.z - c[2]);
        if (dc > env.radius * 0.9) want = norm([want[0] + (c[0] - e.x) / dc * 1.5, want[1], want[2] + (c[2] - e.z) / dc * 1.5]);
        if (e.y > 1100) want = norm([want[0], -0.4, want[2]]);
      }
    }
    // gira para o rumo desejado
    const a = anglesOf(want);
    const dpsi = wrap(a.psi - e.psi), dth = a.theta - e.theta;
    const turn = e.turn * (e.state === 'break' ? 1.2 : 1);
    e.psi = wrap(e.psi + clamp(dpsi * 2, -turn, turn) * dt);
    e.theta = clamp(e.theta + clamp(dth * 2, -turn, turn) * dt, -0.9, 0.9);
    e.phi += (clamp(-dpsi * 1.5, -1.2, 1.2) - e.phi) * Math.min(1, dt * 4);
    const f = dirOf(e.psi, e.theta);
    e.vx = f[0] * e.v; e.vy = f[1] * e.v; e.vz = f[2] * e.v;
    e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    // trava de segurança: nunca dentro da rocha
    if (env.type === 'canyon' && e.y < RIM + 10) {
      const s = -e.z, cx = env.cx(s), hw = env.hw(s) - 12;
      if (hw > 5 && Math.abs(e.x - cx) > hw) e.x = cx + Math.sign(e.x - cx) * hw;
      else if (hw <= 5) e.y = RIM + 10;
    }
    if (e.y < (env.type === 'canyon' ? 15 : 30)) e.y = env.type === 'canyon' ? 15 : 30;

    // atira: rajada quando o alvo está na frente
    if (!e.fire) return;
    e.fireCool -= dt;
    if (e.kind === 'bomber') {
      // bombardeiro solta bomba quando passa por cima do alvo
      if (e.fireCool <= 0 && Math.hypot(tp[0] - e.x, tp[2] - e.z) < 60 && e.y > tp[1]) {
        e.fireCool = 3;
        this.bullets.push({ x: e.x, y: e.y - 4, z: e.z, vx: e.vx * 0.5, vy: -60, vz: e.vz * 0.5, life: 3, team: 'enemy', dmg: 22, r: 18, bomb: true });
        this.emit('bomb', { x: e.x, y: e.y, z: e.z });
      }
      return;
    }
    if (e.burst > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) { e.burstT = 0.1; e.burst--; this.enemyShot(e, tgt, e.kind === 'ace' ? 0.026 : 0.03, tgt === this.plane ? (e.kind === 'ace' ? 3 : 2.5) : 2); }
    } else if (e.fireCool <= 0 && dist < 700 && angleBetween(myF, toT) < 0.12) {
      e.burst = 5; e.burstT = 0; e.fireCool = e.kind === 'ace' ? 1.8 : 2 + this.rand();
    }
  }

  // caças do cânion: passam rasantes de frente, sobem para fora, voltam por cima e mergulham de novo
  canyonRaid(e, tgt) {
    const env = this.env, sT = -tgt.z, sE = -e.z;
    const me = P(e);
    if (e.state === 'attack' || e.state === 'extend' || e.state === 'break') e.state = 'run';
    if (e.state === 'run') {
      if (sE < sT - 120) { e.state = 'climb'; e.stateT = 0; }
      const aim = leadPoint(me, [0, 0, 0], P(tgt), tgt === this.plane ? this.plane.vel : [tgt.vx, tgt.vy, tgt.vz], e.v + 250);
      if (sE > sT + 500) {
        // longe: segue o meio do cânion na direção do alvo
        const p = env.point(sE - 150, 0, clamp(tgt.y, 40, 150));
        return norm(sub(p, me));
      }
      return norm(sub(aim, me));
    }
    if (e.state === 'climb') {
      const t = env.tangent(sE);
      if (e.y > RIM + 100) { e.state = 'over'; e.stateT = 0; }
      return norm([-t[0] * 0.6, 1, -t[2] * 0.6]);
    }
    if (e.state === 'over') {
      // por cima, volta para a frente do alvo (sobre o planalto, sem paredes)
      const p = env.point(sT + 1300, 0, RIM + 180);
      if (Math.hypot(p[0] - e.x, p[2] - e.z) < 250) { e.state = 'dive'; e.stateT = 0; }
      return norm(sub(p, me));
    }
    // mergulha de volta dentro do cânion, de frente para o alvo
    const p = env.point(sT + 650, 0, 70);
    if (e.y < RIM - 40 || e.stateT > 14) { e.state = 'run'; e.stateT = 0; }
    return norm(sub(p, me));
  }

  enemyShot(e, tgt, spread, dmg) {
    const tv = tgt === this.plane ? this.plane.vel : [tgt.vx, tgt.vy, tgt.vz];
    const sp = 520;
    const aim = leadPoint(P(e), [e.vx, e.vy, e.vz], P(tgt), tv, sp);
    let d = norm(sub(aim, P(e)));
    d = norm([d[0] + (this.rand() - 0.5) * spread * 2, d[1] + (this.rand() - 0.5) * spread * 2, d[2] + (this.rand() - 0.5) * spread * 2]);
    this.bullets.push({ x: e.x + d[0] * 8, y: e.y + d[1] * 8, z: e.z + d[2] * 8, vx: e.vx + d[0] * sp, vy: e.vy + d[1] * sp, vz: e.vz + d[2] * sp, life: 1.6, team: 'enemy', dmg, r: 0 });
    this.emit('enemyShot', { x: e.x, y: e.y, z: e.z });
  }

  turretFire(e, dt) {
    e.fireCool -= dt;
    const tgt = this.targetFor(e), dist = len(sub(P(tgt), P(e)));
    if (e.burst > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 0.16; e.burst--;
        const tv = tgt === this.plane ? this.plane.vel : [tgt.vx, tgt.vy, tgt.vz];
        const sp = 430, aim = leadPoint(P(e), [0, 0, 0], P(tgt), tv, sp);
        let d = norm(sub(aim, P(e)));
        const s = 0.13;
        d = norm([d[0] + (this.rand() - 0.5) * s, d[1] + (this.rand() - 0.5) * s, d[2] + (this.rand() - 0.5) * s]);
        // estilhaço: explode perto do alvo (raio maior que bala)
        this.bullets.push({ x: e.x + d[0] * 10, y: e.y + d[1] * 10, z: e.z + d[2] * 10, vx: d[0] * sp + e.vx, vy: d[1] * sp + e.vy, vz: d[2] * sp + e.vz, life: Math.min(2.4, dist / sp + 0.2), team: 'enemy', dmg: e.dmgOut || 2.5, r: 5, flak: true, src: e.kind });
        this.emit('flakShot', { x: e.x, y: e.y, z: e.z });
      }
      return;
    }
    if (e.fireCool > 0 || dist > e.range) return;
    // canhão montado numa nave só cobre o lado dele
    if (e.parent && e.off) {
      const out = rotY([e.off[0], 0, e.off[2]], e.parent.psi), to = sub(P(tgt), P(e));
      if (dot(out, to) < 0) return;
    }
    if (this.env.blocksSight(P(e), P(tgt))) return;
    if (this.env.type === 'canyon' && e.y < RIM - 20 && tgt.y < RIM && Math.abs(-e.z - -tgt.z) > 650) return;
    e.burst = e.kind === 'weak' ? 2 : 3; e.burstT = 0; e.fireCool = 3 + this.rand() * 1.5;
  }

  // ---------- trava pelo olhar ----------
  updateLock(dt, look) {
    const L = this.lock, me = this.pos;
    if (L.target && !L.target.alive) { L.target = null; }
    if (L.target) {
      const d = sub(P(L.target), me);
      if (len(d) > LOCK.range * 1.3 || angleBetween(look, d) > LOCK.keep || !L.target.lockable) L.lost += dt; else L.lost = 0;
      if (L.lost > 0.6) { L.target = null; L.lost = 0; this.emit('lockLost'); }
    }
    let best = null, bestA = LOCK.cone;
    for (const e of this.ents) {
      if (!e.alive || !e.lockable || e === L.target) continue;
      const d = sub(P(e), me), l = len(d);
      if (l > LOCK.range) continue;
      const a = angleBetween(look, d);
      if (a < bestA && !this.env.blocksSight(me, P(e))) { best = e; bestA = a; }
    }
    if (best && best === L.cand) {
      L.t += dt;
      if (L.t >= LOCK.time) { L.target = best; L.cand = null; L.t = 0; L.lost = 0; this.emit('locked', { id: best.id }); }
    } else {
      if (best) this.emit('lockStart', { id: best.id });
      L.cand = best; L.t = 0;
    }
  }

  // ---------- armas do jogador ----------
  updateWeapons(dt, input) {
    const pl = this.plane;
    this.gunCool -= dt; this.missileCool -= dt;
    if (this.ammo < MISSILE.ammo) { this.reloadT += dt; if (this.reloadT >= MISSILE.reload) { this.reloadT = 0; this.ammo++; } } else this.reloadT = 0;
    this.gunOn = !!input.gun;
    if (input.gun && this.gunCool <= 0) {
      this.gunCool += 1 / GUN.rate;
      if (this.gunCool < 0) this.gunCool = 0;
      const { f, right } = pl.axes(), v = pl.vel;
      this.gunSide = -this.gunSide;
      const o = [pl.x + f[0] * 6 + right[0] * 1.6 * this.gunSide, pl.y + f[1] * 6 + right[1] * 1.6 * this.gunSide - 0.6, pl.z + f[2] * 6 + right[2] * 1.6 * this.gunSide];
      // as duas metralhadoras convergem a 350 m na frente
      const aim = [pl.x + f[0] * 350, pl.y + f[1] * 350, pl.z + f[2] * 350];
      const d = norm(sub(aim, o));
      this.bullets.push({ x: o[0], y: o[1], z: o[2], vx: v[0] + d[0] * GUN.speed, vy: v[1] + d[1] * GUN.speed, vz: v[2] + d[2] * GUN.speed, life: GUN.life, team: 'player', dmg: GUN.dmg, r: 0 });
      this.emit('gun', { side: this.gunSide });
    }
    if (!input.gun && this.gunCool < 0) this.gunCool = 0;
    if (input.missile && !this.missileHeld && this.missileCool <= 0) {
      if (this.ammo > 0) {
        this.ammo--; this.missileCool = MISSILE.cool;
        const { f, up } = pl.axes(), v = pl.vel;
        this.missiles.push({ x: pl.x - up[0] * 2.5 + f[0] * 3, y: pl.y - up[1] * 2.5 + f[1] * 3, z: pl.z - up[2] * 2.5 + f[2] * 3, vx: v[0], vy: v[1], vz: v[2], v: pl.v, life: MISSILE.life, target: this.lock.target, team: 'player' });
        this.emit('missile', { locked: !!this.lock.target });
      } else this.emit('noAmmo');
    }
    this.missileHeld = !!input.missile;
  }

  updateBullets(dt) {
    const pl = this.plane, env = this.env;
    const keep = [];
    for (const b of this.bullets) {
      const a = [b.x, b.y, b.z];
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt;
      const c = [b.x, b.y, b.z];
      let hit = false;
      if (b.team === 'player') {
        for (const e of this.ents) {
          if (!e.alive || e.team !== 'enemy' || e.kind === 'ship' || e.r <= 0) continue;
          if (e.shieldBy && !e.open) { if (segDist(a, c, P(e)) < e.r + 2) { hit = true; this.emit('shieldHit', { x: b.x, y: b.y, z: b.z }); break; } continue; }
          if (segDist(a, c, P(e)) < e.r) { this.damage(e, b.dmg, 'gun'); hit = true; this.emit('hit', { x: b.x, y: b.y, z: b.z, id: e.id }); break; }
        }
      } else {
        if (segDist(a, c, P(pl)) < PLANE.radius + b.r) { this.hurtPlayer(b.dmg, b.flak ? 'flak-' + b.src : 'gun'); hit = true; this.emit('hitMe', { x: b.x, y: b.y, z: b.z }); }
        else for (const e of this.allies()) {
          const r = e.hull ? Math.max(e.hull[0], e.hull[1]) : e.r;
          const p = P(e);
          let d = segDist(a, c, p);
          if (e.hull) { const l = toLocal(sub(c, p), e.psi); d = Math.hypot(l[0] / e.hull[0], l[1] / e.hull[1], l[2] / e.hull[2]) < 1.2 ? 0 : 1e9; }
          if (d < r + b.r) { this.hurtAlly(e, b.dmg); hit = true; this.emit('allyHit', { x: b.x, y: b.y, z: b.z }); break; }
        }
      }
      // casco das naves grandes segura as balas
      if (!hit) for (const e of this.ents) {
        if (!e.hull || !e.alive) continue;
        const l = toLocal(sub(c, P(e)), e.psi);
        if (Math.hypot(l[0] / e.hull[0], l[1] / e.hull[1], l[2] / e.hull[2]) < 1) { hit = true; if (b.team === 'player') this.emit('hullHit', { x: b.x, y: b.y, z: b.z }); break; }
      }
      if (!hit && b.y < env.ground(b.x, b.z)) { hit = true; if (b.bomb) this.emit('splash', { x: b.x, y: env.ground(b.x, b.z), z: b.z }); }
      if (!hit && b.life > 0) keep.push(b);
    }
    this.bullets = keep;
  }

  updateMissiles(dt) {
    const keep = [];
    for (const m of this.missiles) {
      m.life -= dt;
      m.v = Math.min(MISSILE.speed, m.v + 220 * dt);
      let d = norm([m.vx, m.vy, m.vz]);
      const T = m.target;
      // o Ás solta chamariz quando um míssil travado chega perto: o míssil perde a trava
      if (T && T.alive && T.kind === 'ace' && (T.flareCool || 0) <= 0 && len(sub(P(T), [m.x, m.y, m.z])) < 320) {
        T.flareCool = 5;
        for (const o of this.missiles) if (o.target === T && len(sub(P(T), [o.x, o.y, o.z])) < 600) o.target = null;
        this.emit('flare', { x: T.x, y: T.y, z: T.z });
        T.state = 'break'; T.stateT = 0; T.breakDir = this.rand() < 0.5 ? -1 : 1;
      }
      if (m.target && T.alive && (!T.shieldBy || T.open)) {
        const want = norm(sub(leadPoint([m.x, m.y, m.z], [0, 0, 0], P(T), [T.vx, T.vy, T.vz], m.v), [m.x, m.y, m.z]));
        const ang = angleBetween(d, want), maxA = MISSILE.turn * dt;
        if (ang > 1e-4) {
          const k = Math.min(1, maxA / ang);
          d = norm([d[0] + (want[0] - d[0]) * k, d[1] + (want[1] - d[1]) * k, d[2] + (want[2] - d[2]) * k]);
        }
      }
      const a = [m.x, m.y, m.z];
      m.vx = d[0] * m.v; m.vy = d[1] * m.v; m.vz = d[2] * m.v;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      const c = [m.x, m.y, m.z];
      let boom = false;
      for (const e of this.ents) {
        if (!e.alive || e.team !== 'enemy' || e.r <= 0) continue;
        if (e.shieldBy && !e.open) continue;
        const near = e === T ? e.r + 7 : e.r + 2;
        if (segDist(a, c, P(e)) < near) { this.damage(e, e.kind === 'ace' ? 45 : MISSILE.dmg, 'missile'); boom = true; break; }
      }
      if (!boom) for (const e of this.ents) {
        if (!e.hull || !e.alive) continue;
        const l = toLocal(sub(c, P(e)), e.psi);
        if (Math.hypot(l[0] / e.hull[0], l[1] / e.hull[1], l[2] / e.hull[2]) < 1) { boom = true; break; }
      }
      if (!boom && m.y < this.env.ground(m.x, m.z)) boom = true;
      if (boom || m.life <= 0) this.emit('boom', { x: m.x, y: m.y, z: m.z, big: false });
      else keep.push(m);
    }
    this.missiles = keep;
  }

  damage(e, d, how) {
    if (!e.alive) return;
    e.hp -= d; e.hitT = 0.15;
    // caça atingido às vezes quebra a curva
    if ((e.kind === 'fighter' || e.kind === 'ace') && e.state === 'attack' && e.breakCool <= 0 && this.rand() < (e.kind === 'ace' ? 0.08 : 0.04)) {
      e.state = 'break'; e.stateT = 0; e.breakDir = this.rand() < 0.5 ? -1 : 1; e.breakCool = 5;
    }
    if (e.hp <= 0) this.kill(e, true, how);
  }
  kill(e, byPlayer, how) {
    if (!e.alive) return;
    e.alive = false;
    if (byPlayer) this.kills++;
    const big = e.kind === 'core' || e.kind === 'ace' || e.kind === 'balloon' || e.kind === 'weak';
    this.emit('kill', { id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, big, byPlayer, how });
    if (e.kind === 'core' && e.parent) { e.parent.alive = false; this.emit('boom', { x: e.parent.x, y: e.parent.y, z: e.parent.z, big: true, huge: true }); }
    if (this.lock.target === e) this.lock.target = null;
    // nave grande sem nenhum ponto fraco vivo: explode inteira
    const p = e.parent;
    if (p && p.alive && p.kind === 'ship' && e.req && !this.ents.some(o => o.parent === p && o.req && o.alive)) {
      p.alive = false;
      this.emit('boom', { x: p.x, y: p.y, z: p.z, big: true, huge: true });
    }
  }
  hurtAlly(e, d) {
    if (!e.alive || this.state !== 'playing') return;
    e.hp -= d; e.hitT = 0.2;
    if (e.hp <= 0) { e.hp = 0; e.alive = false; this.emit('kill', { id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z, big: true }); this.lose(this.def.allyLost || 'O aliado foi derrubado.'); }
  }

  // ---------- portais (corrida) ----------
  updatePortals(prev) {
    const portals = this.ents.filter(e => e.kind === 'portal');
    const p = portals[this.portalNext];
    if (!p) return;
    const now = this.pos;
    const da = dot(sub(prev, P(p)), p.normal), db = dot(sub(now, P(p)), p.normal);
    if (da < 0 && db >= 0) {
      const k = da / (da - db);
      const hit = [prev[0] + (now[0] - prev[0]) * k, prev[1] + (now[1] - prev[1]) * k, prev[2] + (now[2] - prev[2]) * k];
      const off = len(sub(hit, P(p)));
      p.alive = false;
      if (off < p.r) { p.passed = true; this.emit('portal', { n: this.portalNext }); }
      else { p.missed = true; this.penalty += this.def.obj.miss || 5; this.emit('portalMiss', { n: this.portalNext, pen: this.def.obj.miss || 5 }); }
      this.portalNext++;
    }
  }

  // ---------- ondas e objetivo ----------
  checkWaves(initial) {
    const killed = this.kills;
    const enemiesLeft = this.living(e => e.team === 'enemy' && (e.kind === 'fighter' || e.kind === 'ace' || e.kind === 'bomber')).length;
    for (const w of this.waves) {
      if (w.done) continue;
      if (w.every) {
        if (this.t >= w.nextT && (w.max == null || w.count < w.max)) {
          if (w.cap == null || enemiesLeft < w.cap) {
            w.count++; w.nextT = this.t + w.every;
            for (const s of w.spawn) this.spawn({ ...s, wave: w.count });
            if (!initial) this.emit('wave', { text: w.text || null });
          } else w.nextT = this.t + 2;
        }
        continue;
      }
      const c = w.when || {};
      let go = true;
      if (c.t != null && this.t < c.t) go = false;
      if (c.killed != null && killed < c.killed) go = false;
      if (c.cleared && enemiesLeft > 0) go = false;
      if (c.tagDead && this.ents.some(e => e.alive && e.tag === c.tagDead)) go = false;
      if (c.allyS != null) { const a = this.allies()[0]; if (!a || -a.z < c.allyS) go = false; }
      if (c.s != null && -this.plane.z < c.s) go = false;
      if (!go) continue;
      w.done = true;
      for (const s of w.spawn) this.spawn(s);
      if (!initial) this.emit('wave', { text: w.text || null });
    }
  }

  get objective() {
    const o = this.def.obj;
    const req = this.required(), left = req.filter(e => e.alive).length;
    if (o.type === 'race') {
      const n = this.ents.filter(e => e.kind === 'portal').length;
      return { text: `Portais: ${this.portalNext} de ${n}`, done: this.portalNext, total: n };
    }
    if (o.type === 'escort') { const a = this.allies()[0]; return { text: `Proteja o ${o.who || 'aliado'}`, ally: a ? a.hp / a.maxHp : 0 }; }
    if (o.type === 'defend') { const a = this.allies()[0]; return { text: `Proteja o ${o.who || 'aliado'}: ${Math.max(0, Math.ceil(o.time - this.t))} s`, ally: a ? a.hp / a.maxHp : 0 }; }
    if (o.type === 'boss') {
      const b = this.ents.find(e => e.tag === 'boss');
      const parts = this.ents.filter(e => e.tag === o.parts && e.alive).length;
      let text = o.label || 'Derrube o chefe';
      if (o.parts && parts) text = `${o.partsLabel || 'Pontos fracos'}: faltam ${parts}`;
      else if (b && b.shieldBy) text = 'Escudo caiu: acerte o núcleo!';
      return { text, boss: b ? Math.max(0, b.hp) / b.maxHp : 0 };
    }
    const n = o.count ?? req.length, done = req.length - left;
    return { text: `${o.label || 'Alvos'}: ${Math.min(done, n)} de ${n}`, done, total: n };
  }

  checkObjective() {
    if (this.state !== 'playing') return;
    const o = this.def.obj;
    if (o.limit && this.t > o.limit) { this.lose('O tempo acabou.'); return; }
    let won = false;
    if (o.type === 'race') won = this.portalNext >= this.ents.filter(e => e.kind === 'portal').length;
    else if (o.type === 'escort') { const a = this.allies()[0]; won = !!a && a.done; }
    else if (o.type === 'defend') won = this.t >= o.time && this.allies().length > 0;
    else if (o.type === 'boss') won = this.ents.some(e => e.tag === 'boss') && !this.ents.some(e => e.tag === 'boss' && e.alive);
    else {
      const req = this.required(), n = o.count ?? req.length;
      won = req.filter(e => !e.alive).length >= n;
    }
    if (won) this.win();
  }

  win() {
    this.state = 'won';
    const time = this.time;
    const a = this.ents.find(e => e.team === 'ally');
    const ally = a ? Math.max(0, a.hp) / a.maxHp : null;
    const stars = starsFor(this.def, time, this.dmg, ally);
    this.result = { won: true, time, dmg: this.dmg, ally, stars, kills: this.kills };
    this.emit('win', this.result);
  }
  lose(reason) {
    if (this.state !== 'playing') return;
    this.state = 'lost'; this.reason = reason;
    this.result = { won: false, time: this.time, dmg: this.dmg, stars: 0, reason };
    this.emit('lose', { reason });
  }
}

// 1 estrela por vencer; +1 pelo tempo (ou, nas missões de proteger, pela vida que sobrou no aliado);
// +1 por levar pouco dano
export function starsFor(def, time, dmg, ally = null) {
  const s = def.stars;
  const second = s.ally != null ? (ally ?? 0) >= s.ally : time <= s.time;
  return 1 + (second ? 1 : 0) + (dmg <= s.dmg ? 1 : 0);
}
