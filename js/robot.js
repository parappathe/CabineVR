// Robô piloto: joga as missões usando só os comandos do jogador (manche, manete, turbo, gatilhos e a
// direção do olhar, limitada ao que uma cabeça vira). Usado pelos testes e pelo dev.autoplay.
// Sem navegador.
import { steerTo, PLANE } from './flight.js';
import { leadPoint, angleBetween, rotY, GUN, MISSILE } from './mission.js';
import { RIM } from './env.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const P = (e) => [e.x, e.y, e.z];
const mix = (a, b, k) => norm([a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k]);
const toLocal = (v, psi) => rotY(v, -psi);
const MOVERS = new Set(['fighter', 'ace', 'bomber']);

export function makeRobot() { return new Robot(); }

class Robot {
  constructor() { this.reset(); }
  reset() { this.mode = 'attack'; this.modeT = 0; this.target = null; this.retarget = 0; this.away = null; }

  pickTarget(m) {
    const me = m.pos, o = m.def.obj;
    const enemies = m.living(e => e.team === 'enemy' && e.lockable);
    const dist = (e) => len(sub(P(e), me));
    const nearest = (list, ref = me) => list.reduce((b, e) => (!b || len(sub(P(e), ref)) < len(sub(P(b), ref)) ? e : b), null);
    const fighters = enemies.filter(e => MOVERS.has(e.kind));
    const close = fighters.filter(e => dist(e) < 480 && e.kind !== 'bomber');
    if (o.type === 'escort' || o.type === 'defend') {
      const ally = m.allies()[0];
      if (!ally) return nearest(enemies);
      const raiders = fighters.filter(e => e.look === 'ally' || e.kind === 'bomber');
      if (m.env.type === 'canyon') {
        // no cânion: só o que está à frente do cargueiro (os que passaram voltam por cima)
        const ahead = fighters.filter(e => -e.z > -ally.z - 100 && e.y < RIM + 20);
        const tur = enemies.filter(e => e.kind === 'turret' && -e.z > -m.plane.z + 200 && -e.z < -m.plane.z + 1300);
        return nearest(ahead, P(ally)) || nearest(tur);
      }
      if (close.length && !raiders.some(e => len(sub(P(e), P(ally))) < 700)) return nearest(close);
      return nearest(raiders, P(ally)) || nearest(fighters);
    }
    // torre perto e na frente: derruba de passagem
    const fwd = m.plane.fwd;
    const turret = enemies.find(e => e.kind === 'turret' && dist(e) < 650 && angleBetween(fwd, sub(P(e), me)) < 0.5);
    if (o.type === 'boss') {
      const core = enemies.find(e => e.tag === 'boss');
      if (close.length) return nearest(close);
      if (turret && m.env.type !== 'canyon') return turret;
      if (core) return core;
      const parts = enemies.filter(e => e.tag === o.parts);
      if (parts.length) return nearest(parts);
      return nearest(fighters) || nearest(enemies);
    }
    if (close.length) return nearest(close);
    if (turret && m.env.type !== 'canyon') return turret;
    const req = enemies.filter(e => e.req);
    if (m.env.type === 'canyon') {
      // no cânion só dá para pegar o que está à frente
      const s = -m.plane.z;
      const ahead = req.filter(e => -e.z > s + 120);
      return ahead.reduce((b, e) => (!b || -e.z < -b.z ? e : b), null);
    }
    return nearest(req) || nearest(fighters);
  }

  step(m) {
    const pl = m.plane, me = m.pos, env = m.env, f = pl.fwd;
    this.modeT += 1 / 60; this.retarget -= 1 / 60;
    if (this.retarget <= 0 || !this.target || !this.target.alive || !this.target.lockable && this.target.shieldBy) {
      // caça que já está sendo perseguido de perto continua sendo o alvo (não fica trocando)
      const cur = this.target;
      const keep = cur && cur.alive && MOVERS.has(cur.kind) && len(sub(P(cur), me)) < 700 && this.chaseT < 10;
      const nt = keep ? cur : this.pickTarget(m);
      if (nt !== cur) this.chaseT = 0;
      this.target = nt; this.retarget = 0.5;
    }
    this.chaseT = (this.chaseT || 0) + 1 / 60;
    const T = this.target;
    let want = f, throttle = 0.75, boost = false, gun = false, missile = false, look = f;
    let aim = null, dist = 1e9;
    const race = m.def.obj.type === 'race';

    if (race) {
      const portals = m.ents.filter(e => e.kind === 'portal');
      const p = portals[m.portalNext];
      if (p) {
        // mira no centro do portal, já puxando para o próximo quando está perto
        const n = portals[m.portalNext + 1];
        let tp = P(p);
        const d = len(sub(tp, me));
        if (n && d < 90) { const k = (90 - d) / 90 * 0.3; tp = [tp[0] + (n.x - tp[0]) * k, tp[1] + (n.y - tp[1]) * k, tp[2] + (n.z - tp[2]) * k]; }
        aim = tp; dist = d;
        want = norm(sub(tp, me));
        // portal em curva fechada: menos velocidade
        const turnA = angleBetween(f, want);
        throttle = turnA > 0.5 ? 0.55 : 1;
        boost = turnA < 0.15 && d > 500;
      }
    } else if (T) {
      const tv = [T.vx, T.vy, T.vz];
      dist = len(sub(P(T), me));
      aim = dist < 1000 ? leadPoint(me, pl.vel, P(T), tv, GUN.speed) : P(T);
      const toAim = norm(sub(aim, me));
      const moving = MOVERS.has(T.kind);
      const big = T.kind === 'weak' || T.kind === 'core' || T.kind === 'turret' || T.kind === 'target' || T.kind === 'balloon';
      const breakD = T.kind === 'balloon' ? 160 : T.parent?.hull ? 200 : 150;
      // escudo baixo: foge da briga até recarregar um pouco (não vale na escolta/defesa)
      const guard = m.def.obj.type === 'escort' || m.def.obj.type === 'defend';
      if (this.mode !== 'evade' && m.shield < 28 && !guard && env.type !== 'canyon') { this.mode = 'evade'; this.modeT = 0; }
      if (this.mode === 'evade') {
        const threats = m.living(e => e.team === 'enemy' && e.fire);
        let th = null, bd = 1e9;
        for (const e of threats) { const d = len(sub(P(e), me)); if (d < bd) { bd = d; th = e; } }
        const away = th ? norm(sub(me, P(th))) : f;
        want = norm([away[0], 0.05, away[2]]);
        throttle = 1; boost = true;
        if (m.shield > 65 || this.modeT > 12) { this.mode = 'attack'; this.modeT = 0; }
      } else if (this.mode === 'extend') {
        // passou do alvo parado: afasta e volta
        want = this.away;
        throttle = 0.9;
        if (this.modeT > (env.type === 'canyon' ? 3 : 3.6)) { this.mode = 'attack'; this.modeT = 0; }
      } else {
        want = toAim;
        if (moving) {
          throttle = dist > 700 ? 1 : dist < 250 ? 0.55 : 0.8;
          boost = dist > 1100 && angleBetween(f, toAim) < 0.3;
        } else {
          throttle = dist < 700 ? 0.5 : 0.85;
        }
        if (big && !moving && dist < breakD && angleBetween(f, sub(P(T), me)) < 0.7 && (env.type !== 'canyon' || env.hw(-pl.z) > 230)) {
          this.mode = 'extend'; this.modeT = 0;
          const away = norm(sub(me, P(T)));
          const side = [-f[2], 0, f[0]];
          const climb = env.type === 'canyon' ? 0.1 : pl.y < T.y + 60 ? 0.3 : 0;
          this.away = norm([f[0] + away[0] * 0.3 + side[0] * 0.5, climb, f[2] + away[2] * 0.3 + side[2] * 0.5]);
        }
      }
      // tiros: metralhadora quando a mira está em cima, míssil quando travou
      const angA = angleBetween(f, toAim);
      if (dist < 820 && angA < 0.03 + T.r / Math.max(dist, 1) && !(T.shieldBy && !T.open)) gun = true;
      // olhar: vira a cabeça para o alvo (até 55° do nariz, como uma pessoa)
      const toT = norm(sub(P(T), me));
      if (angleBetween(f, toT) < 0.95) look = toT;
      const L = m.lock.target;
      if (L && m.ammo > 0 && len(sub(P(L), me)) < 1500 && (L === T || (MOVERS.has(L.kind) && len(sub(P(L), me)) < 900))) missile = (m.t * 10 | 0) % 2 === 0;
    } else {
      // nada para atacar: acompanha o aliado ou segue o cânion
      const ally = m.allies()[0];
      if (ally && env.type !== 'canyon') {
        const d = len(sub(P(ally), me));
        const side = [ally.x + 260, ally.y + 120, ally.z];
        want = norm(sub(d > 400 ? P(ally) : side, me));
        throttle = 0.6;
      }
    }

    // escolta no cânion: fica uns 350 m à frente do cargueiro (não dá para voltar dentro do cânion)
    const ally = m.allies()[0];
    if (env.type === 'canyon' && ally && m.def.obj.type === 'escort') {
      const s = -pl.z, sA = -ally.z;
      const attacking = T && -T.z > s + 100;
      if (!attacking) { aim = null; want = norm(sub(env.point(s + 250, 0, 80), me)); }
      throttle = clamp(0.4 + (sA + 350 - s) / 300, 0, attacking ? 0.8 : 1);
      if (s > sA + 900) throttle = 0;
      boost = false;
    }

    // ---- segurança: chão, cânion, área e cascos ----
    if (env.type === 'canyon') want = this.canyonSafe(m, want, T, aim, race, (v) => { throttle = v; });
    else {
      const minY = env.type === 'clouds' ? 110 : 90;
      if (pl.y < minY + 60) want = norm([want[0], Math.max(want[1], (minY + 60 - pl.y) / 80), want[2]]);
      if (pl.y + f[1] * pl.v * 2 < minY) want = norm([want[0] * 0.5, 0.6, want[2] * 0.5]);
      const c = env.center, dc = Math.hypot(pl.x - c[0], pl.z - c[2]);
      if (dc > env.radius * 0.85) want = mix(want, norm([c[0] - pl.x, 0, c[2] - pl.z]), clamp((dc - env.radius * 0.85) / (env.radius * 0.1), 0, 0.8));
      if (pl.y > 1200) want = norm([want[0], -0.3, want[2]]);
    }
    for (const e of m.ents) {
      if (!e.hull || !e.alive) continue;
      // ponto do voo nos próximos 2 s dentro da "bolha" do casco: desvia
      for (const t of [0.5, 1.0, 1.6]) {
        const p = [pl.x + f[0] * pl.v * t, pl.y + f[1] * pl.v * t, pl.z + f[2] * pl.v * t];
        const l = toLocal(sub(p, P(e)), e.psi), [W, H, L] = e.hull;
        const q = Math.hypot(l[0] / (W + 35), l[1] / (H + 25), l[2] / (L + 35));
        if (q < 1) {
          const out = rotY(norm([l[0] / (W + 35), l[1] / (H + 25) + 0.3, l[2] / (L + 35)]), e.psi);
          want = mix(want, norm([out[0] + f[0] * 0.5, out[1] * 1.3, out[2] + f[2] * 0.5]), t < 0.8 ? 0.9 : 0.6);
          gun = gun && t > 1; break;
        }
      }
    }

    const st = steerTo(pl, want);
    return { pitch: st.pitch, roll: st.roll, held: true, throttle, boost, gun, missile, look };
  }

  // Cânion: só voa para onde a parede deixa. Olha o caminho dos próximos 2 s; se for bater, segue
  // o meio do cânion; nunca sobe acima da borda; não desce demais.
  canyonSafe(m, want, T, aim, race, setThrottle) {
    const env = m.env, pl = m.plane, s = -pl.z;
    const v = pl.v;
    const hwHere = env.hw(s);
    const open = hwHere > 230;         // bacia do chefe
    // ponto à frente no meio do cânion, na altura e no lado do alvo
    const look = Math.max(160, v * 1.7);
    let u = 0, y = 75;
    if (aim && -aim[2] > s) {
      const sa = -aim[2];
      u = clamp((aim[0] - env.cx(sa)) / Math.max(30, env.hw(sa)), -0.6, 0.6);
      y = clamp(aim[1], 25, 150);
    }
    const ahead = env.point(s + look, u * 0.9, y);
    const follow = norm(sub(ahead, m.pos));
    let w = want;
    if (open) {
      // na bacia: voa livre, mas longe da borda
      const c = env.basinCenter();
      for (const t of [0.8, 1.6, 2.4]) {
        const p = [pl.x + w[0] * v * t, pl.z + w[2] * v * t];
        if (env.clearance(p[0], p[1]) < 90) { w = mix(w, norm([c[0] - pl.x, 0, c[2] - pl.z]), 0.75); setThrottle(0.6); break; }
      }
    } else {
      // atacar só se o caminho reto até o alvo for seguro; senão segue o cânion
      let safe = !!aim && !race && T && -T.z > s + 60;
      if (race) safe = true;
      for (const t of [0.5, 1.0, 1.5, 2.0]) {
        const p = [pl.x + w[0] * v * t, pl.y + w[1] * v * t, pl.z + w[2] * v * t];
        if (env.clearance(p[0], p[2]) < 22 || p[1] < 14 || p[1] > RIM - 15) { safe = false; break; }
      }
      if (!safe) w = follow;
      // está chegando perto da parede: corrige
      const cl = env.clearance(pl.x, pl.z);
      if (cl < 30) w = mix(w, follow, 0.7);
    }
    if (pl.y < 30) w = norm([w[0], Math.max(w[1], 0.25), w[2]]);
    if (pl.y + pl.fwd[1] * v * 1.5 < 12) w = norm([w[0], 0.5, w[2]]);
    if (pl.y > RIM - 30) w = norm([w[0], Math.min(w[1], -0.2), w[2]]);
    if (pl.y > RIM - 5) w = norm([w[0], -0.5, w[2]]);
    return w;
  }
}
