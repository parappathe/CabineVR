// Cenários dos 3 setores: o que é chão, parede e limite para a física. Sem navegador.
//   canyon: cânion sinuoso (chão em y = 0, borda em y = RIM), com bacia redonda no fim (chefe)
//   clouds: mar de nuvens (topo em y = 0) com nuvens soltas que tapam a visão e a trava
//   ocean:  mar aberto (água em y = 0); as naves grandes da frota são entidades da missão
// O cânion desce para -z: s = -z é a distância desde a entrada; a parede fica em x = cx(s) ± hw(s).

export const RIM = 210;
export const WALL_SLOPE = 0.19;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Canyon {
  // length: s do fim; basin: raio da bacia redonda do fim (0 = sem bacia)
  constructor({ length = 4200, basin = 0, seed = 1, start = -300 } = {}) {
    this.type = 'canyon';
    this.length = length; this.basin = basin; this.start = start;
    const r = rng(seed);
    this.ph = [r() * 6, r() * 6, r() * 6];
    this.sBasin = basin ? length - basin * 2.2 : length + 1;   // onde a bacia começa a abrir
    this.rim = RIM;
    this.floorY = 0;
  }
  wiggle(s) { return 150 * Math.sin(s / 540 + this.ph[0]) + 55 * Math.sin(s / 220 + this.ph[1]) - 150 * Math.sin(this.ph[0]) - 55 * Math.sin(this.ph[1]); }
  cx(s) {
    if (!this.basin) return this.wiggle(s);
    const k = smooth(this.sBasin - 500, this.sBasin, s);
    return this.wiggle(s) * (1 - k) + this.wiggle(this.sBasin) * k;
  }
  // meia largura (m)
  hw(s) {
    let h = 88 + 22 * Math.sin(s / 360 + this.ph[2]);
    if (this.basin) h += (this.basin - h) * smooth(this.sBasin, this.sBasin + this.basin * 0.6, s);
    const R = h, endC = this.length - R;
    if (s > endC) h = R * Math.sqrt(Math.max(0, 1 - ((s - endC) / R) ** 2));
    const R0 = 90, st = this.start + R0;
    if (s < st) h = Math.min(h, R0 * Math.sqrt(Math.max(0, 1 - ((st - s) / R0) ** 2)));
    return h;
  }
  // direção do cânion (para onde ele segue) em s: vetor horizontal unitário
  tangent(s) {
    const e = 2, dx = (this.cx(s + e) - this.cx(s - e)) / (2 * e);
    const l = Math.hypot(dx, 1);
    return [dx / l, 0, -1 / l];
  }
  point(s, u = 0, y = 60) { return [this.cx(s) + u * this.hw(s), y, -s]; }
  // em cima do planalto, logo depois da borda (side = -1 esquerda, +1 direita)
  rimPoint(s, side) { return [this.cx(s) + side * (this.hw(s) + WALL_SLOPE * RIM + 18), RIM + 4, -s]; }
  // distância lateral até a parede (negativo = dentro da rocha). A parede abre um pouco para cima
  // (WALL_SLOPE m por m de altura), como no desenho dos paredões em degraus.
  clearance(x, z, y = 0) { const s = -z; return this.hw(s) + WALL_SLOPE * Math.max(0, Math.min(RIM, y)) - Math.abs(x - this.cx(s)); }
  inside(x, z) { return this.clearance(x, z) > 0; }
  ground(x, z) { return this.inside(x, z) ? 0 : RIM; }
  blocksSight() { return false; }
  // centro da bacia (onde fica o chefe)
  basinCenter() { const s = this.length - this.basin; return [this.cx(s), 0, -s]; }
}

export class CloudSea {
  constructor({ seed = 7, count = 70, radius = 2400, center = [0, 0, -1200] } = {}) {
    this.type = 'clouds';
    this.radius = radius; this.center = center;
    this.floorY = 0;
    const r = rng(seed);
    this.puffs = [];
    // nuvens em cachos: cada cacho tem 3 a 6 bolas
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius * 0.95;
      const cx = center[0] + Math.cos(a) * d, cz = center[2] + Math.sin(a) * d;
      if (Math.hypot(cx, cz) < 260) continue;                  // largada livre
      const cy = 140 + r() * 520, n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        const rr = 40 + r() * 70;
        this.puffs.push({ x: cx + (r() - 0.5) * 220, y: cy + (r() - 0.5) * 60, z: cz + (r() - 0.5) * 220, r: rr });
      }
    }
  }
  ground() { return 0; }
  // a linha de a até b passa por dentro de alguma nuvem?
  blocksSight(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    for (const p of this.puffs) {
      let t = ((p.x - a[0]) * dx + (p.y - a[1]) * dy + (p.z - a[2]) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const qx = a[0] + dx * t - p.x, qy = a[1] + dy * t - p.y, qz = a[2] + dz * t - p.z;
      if (qx * qx + qy * qy + qz * qz < (p.r * 0.8) ** 2) return true;
    }
    return false;
  }
  // quanto o ponto está dentro de uma nuvem (0 = fora, 1 = no miolo)
  inCloud(x, y, z) {
    let m = 0;
    for (const p of this.puffs) {
      const d = Math.hypot(x - p.x, y - p.y, z - p.z);
      if (d < p.r) m = Math.max(m, 1 - d / p.r);
    }
    return m;
  }
}

export class Ocean {
  constructor({ radius = 2800, center = [0, 0, -1400] } = {}) {
    this.type = 'ocean';
    this.radius = radius; this.center = center;
    this.floorY = 0;
  }
  ground() { return 0; }
  blocksSight() { return false; }
}

export function makeEnv(def) {
  if (def.env === 'canyon') return new Canyon(def.canyon || {});
  if (def.env === 'clouds') return new CloudSea(def.clouds || {});
  return new Ocean(def.ocean || {});
}
