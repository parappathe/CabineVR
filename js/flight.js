// Voo do caça (arcade). Sem navegador e sem Three.js: roda no Node para os testes.
//
// Atitude em três ângulos: rumo psi (positivo = vira para a esquerda), arfagem theta (positivo =
// nariz para cima, limitada para nunca virar de ponta-cabeça) e rolagem phi (positivo = asa direita
// para baixo). Frente = (-sen psi cos theta, sen theta, -cos psi cos theta).
// Manche: puxar (pitch > 0) gira o nariz em volta da asa; com o avião inclinado isso vira curva.
// Inclinar já dá uma guinada leve sozinha (curva coordenada). Manche solto: o avião se nivela devagar.

export const DT = 1 / 60;
export const PLANE = {
  pitchRate: 1.15,     // rad/s com o manche todo puxado
  rollRate: 2.3,       // rad/s com o manche todo de lado
  autoYaw: 0.5,        // guinada automática (rad/s) com a asa a 90°
  bankDrop: 0.42,       // inclinado, o nariz cai um pouco (tem que puxar para manter a altura)
  maxBank: 1.3,        // 75°
  maxPitch: 1.2,       // 69°
  levelRoll: 0.9,      // rad/s máximos do nivelamento sozinho
  levelPitch: 0.35,
  vMin: 55, vMax: 150, vBoost: 215,
  boostTime: 2.5, boostCool: 7,
  radius: 5,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const wrap =(a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function dirOf(psi, theta) {
  const c = Math.cos(theta);
  return [-Math.sin(psi) * c, Math.sin(theta), -Math.cos(psi) * c];
}
// rumo e arfagem de um vetor direção
export function anglesOf(d) {
  const h = Math.hypot(d[0], d[2]);
  return { psi: Math.atan2(-d[0], -d[2]), theta: Math.atan2(d[1], h) };
}

export class Plane {
  constructor(x = 0, y = 100, z = 0, psi = 0) {
    this.x = x; this.y = y; this.z = z;
    this.psi = psi; this.theta = 0; this.phi = 0;
    this.v = 100; this.throttle = 0.5;
    this.boostT = 0; this.boostCool = 0;
    this.w = 0;              // velocidade de giro total (rad/s), para a vinheta
    this.pitchCmd = 0; this.rollCmd = 0; this.held = false;
  }
  get fwd() { return dirOf(this.psi, this.theta); }
  get vel() { const f = this.fwd; return [f[0] * this.v, f[1] * this.v, f[2] * this.v]; }
  // vetor "direita" e "cima" do avião (com a rolagem)
  axes() {
    const f = this.fwd;
    const r0 = [Math.cos(this.psi), 0, -Math.sin(this.psi)];            // direita sem rolagem
    const up0 = cross(r0, f);                                             // cima sem rolagem
    const c = Math.cos(this.phi), sn = Math.sin(this.phi);
    const right = [r0[0] * c - up0[0] * sn, r0[1] * c - up0[1] * sn, r0[2] * c - up0[2] * sn];
    const up = [up0[0] * c + r0[0] * sn, up0[1] * c + r0[1] * sn, up0[2] * c + r0[2] * sn];
    return { f, right, up };
  }

  // ctl: { pitch -1..1 (puxar = +), roll -1..1 (direita = +), held, throttle 0..1 ou null, boost }
  step(dt, ctl) {
    const P = PLANE;
    const held = !!ctl.held;
    let pitch = clamp(ctl.pitch || 0, -1, 1), roll = clamp(ctl.roll || 0, -1, 1);
    if (ctl.throttle != null) this.throttle = clamp(ctl.throttle, 0, 1);
    this.held = held; this.pitchCmd = pitch; this.rollCmd = roll;

    let dphi, omega;
    if (held) {
      dphi = roll * P.rollRate;
      // perto do limite de inclinação a rolagem para
      if ((this.phi >= P.maxBank && dphi > 0) || (this.phi <= -P.maxBank && dphi < 0)) dphi = 0;
      omega = pitch * P.pitchRate;
    } else {
      dphi = clamp(-this.phi * 1.6, -P.levelRoll, P.levelRoll);
      omega = clamp(-this.theta * 1.2, -P.levelPitch, P.levelPitch) / Math.max(0.3, Math.cos(this.phi));
    }
    const cphi = Math.cos(this.phi), sphi = Math.sin(this.phi);
    const ct = Math.max(0.25, Math.cos(this.theta));
    const dtheta = omega * cphi - P.bankDrop * (1 - cphi);
    const dpsi = -(omega + P.autoYaw) * sphi / ct;
    this.phi = clamp(this.phi + dphi * dt, -P.maxBank, P.maxBank);
    this.theta = clamp(this.theta + dtheta * dt, -P.maxPitch, P.maxPitch);
    this.psi = wrap(this.psi + dpsi * dt);
    this.w = Math.hypot(dphi, dtheta, dpsi * ct);

    // velocidade: manete define o alvo; subir perde velocidade, descer ganha
    if (ctl.boost && this.boostT <= 0 && this.boostCool <= 0) { this.boostT = P.boostTime; this.boostCool = P.boostCool; this.boosted = true; }
    else this.boosted = false;
    if (this.boostT > 0) this.boostT -= dt; else if (this.boostCool > 0) this.boostCool -= dt;
    const target = this.boostT > 0 ? P.vBoost : P.vMin + this.throttle * (P.vMax - P.vMin);
    this.v += (target - this.v) * Math.min(1, (this.boostT > 0 ? 1.6 : 0.7) * dt) - 9.8 * Math.sin(this.theta) * 0.5 * dt;
    this.v = clamp(this.v, P.vMin - 10, P.vBoost + 5);

    const f = this.fwd;
    this.x += f[0] * this.v * dt; this.y += f[1] * this.v * dt; this.z += f[2] * this.v * dt;
  }
}

// Comandos de manche para apontar o nariz numa direção (usado pelo robô e pelos inimigos não;
// os inimigos têm voo próprio, mais simples). Devolve { pitch, roll } como o jogador mexeria.
export function steerTo(plane, dir, { gain = 1, maxBank = PLANE.maxBank } = {}) {
  const want = anglesOf(dir);
  const dpsi = wrap(want.psi - plane.psi);
  const dth = want.theta - plane.theta;
  // inclinação desejada: proporcional ao quanto falta virar (curva para a direita = psi diminui)
  const bankWant = clamp(-dpsi * 2.2 * gain, -maxBank, maxBank);
  const roll = clamp((bankWant - plane.phi) * 2.5, -1, 1);
  // taxas desejadas e o puxão de manche que chega mais perto das duas
  const rpsi = clamp(dpsi * 2.5, -2, 2), rth = clamp(dth * 2.5, -1.5, 1.5);
  const cphi = Math.cos(plane.phi), sphi = Math.sin(plane.phi), ct = Math.cos(plane.theta);
  // mínimos quadrados com peso 2 na arfagem (não deixa a curva virar subida)
  const omega = (4 * cphi * (rth + PLANE.bankDrop * (1 - cphi)) - PLANE.autoYaw * sphi * sphi - rpsi * ct * sphi) / (4 * cphi * cphi + sphi * sphi);
  const pitch = clamp(omega / PLANE.pitchRate, -1, 1);
  return { pitch, roll, dpsi, dth };
}
