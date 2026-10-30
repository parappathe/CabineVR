// Testes automáticos: node tests/run.js (ou npm test). Não tocam som nem usam navegador.
import { Plane, PLANE, DT, dirOf, anglesOf, steerTo } from '../js/flight.js';
import { Canyon, CloudSea, RIM } from '../js/env.js';
import { Mission, GUN, MISSILE, LOCK, SHIELD, starsFor } from '../js/mission.js';
import { MISSIONS, SECTORS } from '../js/missions.js';
import { makeRobot } from '../js/robot.js';

let fails = 0, count = 0;
function ok(cond, msg) {
  count++;
  if (!cond) { fails++; console.log('  FALHOU:', msg); }
}
const deg = (r) => r * 180 / Math.PI;
const fly = (pl, sec, ctl) => { for (let i = 0; i < sec / DT; i++) pl.step(DT, typeof ctl === 'function' ? ctl(i * DT) : ctl); };
// missão de teste vazia: céu aberto
const testDef = (extra = {}) => ({ name: 'teste', env: 'clouds', clouds: { count: 0 }, start: { at: [0, 400, 0], psi: 0 }, spawn: [], obj: { type: 'kill', count: 99 }, stars: { time: 60, dmg: 20 }, ...extra });

console.log('Voo');
{
  const pl = new Plane(0, 300, 0, 0);
  const f = pl.fwd;
  ok(Math.abs(f[2] + 1) < 1e-9, 'rumo 0 aponta para -z');
  const a = anglesOf(dirOf(0.7, 0.3));
  ok(Math.abs(a.psi - 0.7) < 1e-9 && Math.abs(a.theta - 0.3) < 1e-9, 'direção ida e volta (rumo e arfagem)');
  const { right, up } = pl.axes();
  ok(Math.abs(right[0] - 1) < 1e-9 && Math.abs(up[1] - 1) < 1e-9, 'eixos sem rolagem: direita +x, cima +y');

  fly(pl, 1, { held: true, pitch: 1 });
  ok(pl.theta > 0.8 && pl.y > 300, `puxar o manche sobe o nariz (${deg(pl.theta).toFixed(0)}°)`);
  const p2 = new Plane(0, 300, 0, 0);
  fly(p2, 0.6, { held: true, roll: 1 });
  ok(p2.phi > 0.9, `manche para a direita inclina a asa direita para baixo (${deg(p2.phi).toFixed(0)}°)`);
  ok(p2.axes().right[1] < -0.5, 'asa direita aponta para baixo');
  const psi0 = p2.psi;
  fly(p2, 2, { held: true, roll: 0, pitch: 0 });
  ok(p2.psi < psi0 - 0.4, `inclinado sem puxar já vira um pouco para o lado da asa (guinada automática: ${deg(psi0 - p2.psi).toFixed(0)}°)`);
  const p3 = new Plane(0, 300, 0, 0);
  fly(p3, 0.6, { held: true, roll: 1 });
  fly(p3, 1.5, { held: true, pitch: 1 });
  ok(p3.psi < -1.6, `inclinado e puxando faz curva fechada para a direita (${deg(-p3.psi).toFixed(0)}° em 1,5 s)`);
  ok(Math.abs(p3.theta) < 0.6, 'curva inclinada não vira subida');
  const p4 = new Plane(0, 300, 0, 0);
  fly(p4, 3, { held: true, roll: 1, pitch: 1 });
  ok(p4.phi <= PLANE.maxBank + 1e-9 && Math.abs(p4.theta) <= PLANE.maxPitch + 1e-9, 'inclinação e arfagem têm limite (nunca vira de ponta-cabeça)');
  // manche solto: nivela sozinho devagar
  const p5 = new Plane(0, 300, 0, 0);
  fly(p5, 0.5, { held: true, roll: 1, pitch: 0.6 });
  const phi5 = p5.phi;
  fly(p5, 0.3, { held: false });
  ok(p5.phi < phi5 && p5.phi > 0.3, `soltar o manche desinclina devagar (${deg(phi5).toFixed(0)}° → ${deg(p5.phi).toFixed(0)}°)`);
  fly(p5, 5, { held: false });
  ok(Math.abs(p5.phi) < 0.02 && Math.abs(p5.theta) < 0.05, `soltando por 5 s o avião fica nivelado (${deg(p5.phi).toFixed(1)}°, ${deg(p5.theta).toFixed(1)}°)`);

  const s1 = new Plane(0, 300, 0, 0);
  fly(s1, 10, { held: true, throttle: 1 });
  ok(Math.abs(s1.v - PLANE.vMax) < 4, `manete toda à frente chega na velocidade máxima (${s1.v.toFixed(0)} m/s)`);
  fly(s1, 10, { held: true, throttle: 0 });
  ok(s1.v < PLANE.vMin + 5, `manete puxada freia (${s1.v.toFixed(0)} m/s)`);
  fly(s1, 1.5, { held: true, boost: true });
  ok(s1.v > PLANE.vMax, `turbo passa da velocidade máxima (${s1.v.toFixed(0)} m/s)`);
  fly(s1, 3, { held: true });
  const vb = s1.v;
  s1.step(DT, { held: true, boost: true });
  ok(s1.boostT <= 0 && s1.boostCool > 0, 'turbo tem tempo de recarga');
  ok(vb < PLANE.vBoost, 'turbo acaba sozinho');
  const c1 = new Plane(0, 300, 0, 0), c2 = new Plane(0, 300, 0, 0);
  c1.v = c2.v = 120; c1.throttle = c2.throttle = (120 - PLANE.vMin) / (PLANE.vMax - PLANE.vMin);
  c1.theta = 0.6; c2.theta = -0.6;
  fly(c1, 2, { held: true }); fly(c2, 2, { held: true });
  ok(c1.v < c2.v, 'subindo perde velocidade, descendo ganha');
  // o comando do robô chega na direção pedida
  const r = new Plane(0, 300, 0, 0);
  const goal = dirOf(-1.4, 0.2);
  for (let i = 0; i < 4 / DT; i++) { const st = steerTo(r, goal); r.step(DT, { held: true, ...st }); }
  ok(Math.abs(anglesOf(r.fwd).psi + 1.4) < 0.08 && Math.abs(r.theta - 0.2) < 0.08, `manche automático aponta o nariz para onde pediu (${deg(r.psi).toFixed(0)}°, ${deg(r.theta).toFixed(0)}°)`);
}

console.log('Cenários');
{
  const c = new Canyon({ length: 4000, seed: 3 });
  ok(Math.abs(c.cx(0)) < 1e-9, 'cânion começa em x = 0');
  let minW = 1e9;
  for (let s = 0; s < 3800; s += 20) minW = Math.min(minW, c.hw(s));
  ok(minW > 55, `cânion nunca estreito demais (${(2 * minW).toFixed(0)} m)`);
  ok(c.hw(4000) < 1 && c.hw(-300) < 1, 'cânion fechado nas duas pontas');
  const p = c.point(1200, 0.5, 60);
  ok(c.inside(p[0], p[2]) && !c.inside(p[0] + c.hw(1200) * 0.6, p[2]), 'dentro e fora do cânion');
  ok(c.ground(p[0], p[2]) === 0 && c.ground(p[0] + 500, p[2]) === RIM, 'chão do cânion e planalto em cima');
  const b = new Canyon({ length: 3600, seed: 11, basin: 430 });
  const bc = b.basinCenter();
  ok(b.hw(-bc[2]) > 400, `bacia redonda do chefe (raio ${b.hw(-bc[2]).toFixed(0)} m)`);
  const t = c.tangent(800);
  ok(Math.abs(Math.hypot(t[0], t[2]) - 1) < 1e-9 && t[2] < 0, 'direção do cânion segue para -z');
  const sky = new CloudSea({ seed: 4 });
  const q = sky.puffs[0];
  ok(sky.blocksSight([q.x - 500, q.y, q.z], [q.x + 500, q.y, q.z]), 'nuvem tapa a linha de visão');
  ok(sky.inCloud(q.x, q.y, q.z) > 0.9 && sky.inCloud(q.x, q.y + 2000, q.z) === 0, 'dentro e fora da nuvem');
  ok(sky.puffs.every(p => Math.hypot(p.x, p.z) > 120), 'nenhuma nuvem em cima da largada');
}

console.log('Colisão');
{
  const m = new Mission({ name: 't', env: 'canyon', canyon: { length: 3000, seed: 2 }, spawn: [], obj: { type: 'kill', count: 9 }, stars: { time: 1, dmg: 1 } });
  const pl = m.plane;
  pl.psi += 1.2;            // aponta para a parede
  let crashed = false;
  for (let i = 0; i < 300; i++) { m.step({ held: true }); if (m.events.some(e => e.type === 'crash')) crashed = true; }
  ok(crashed && m.dmg > 0, `bater na parede do cânion machuca (${m.dmg.toFixed(0)} de dano)`);
  ok(m.env.inside(pl.x, pl.z) || pl.y > RIM, 'depois da batida o caça fica dentro do cânion, não na rocha');
  const m2 = new Mission(testDef());
  m2.plane.theta = -1; m2.plane.y = 60;
  for (let i = 0; i < 120; i++) m2.step({ held: true, pitch: -1 });
  ok(m2.dmg > 0 && m2.plane.y >= -12, 'chão machuca e não deixa atravessar');
  const m3 = new Mission(testDef({ env: 'ocean', start: { at: [0, 200, 0], psi: 0 }, spawn: [{ k: 'ship', at: [0, 200, -400], hull: [20, 15, 60] }] }));
  let inHull = false;
  for (let i = 0; i < 300; i++) {
    m3.step({ held: true });
    const s = m3.ents[0], d = [m3.plane.x - s.x, m3.plane.y - s.y, m3.plane.z - s.z];
    if (Math.hypot(d[0] / 20, d[1] / 15, d[2] / 60) < 0.95) inHull = true;
  }
  ok(!inHull && m3.dmg > 0, 'casco da nave grande é sólido');
  const m4 = new Mission(testDef({ start: { at: [0, 1500, 0], psi: 0 } }));
  m4.step({ held: true });
  ok(m4.plane.y <= 1400, 'teto máximo');
  const m5 = new Mission({ name: 't', env: 'canyon', canyon: { length: 3000, seed: 2 }, start: { at: [0, RIM + 120, 0], psi: 0 }, spawn: [], obj: { type: 'kill', count: 9 }, stars: { time: 1, dmg: 1 } });
  for (let i = 0; i < 120; i++) m5.step({ held: true });
  ok(m5.dmg > 0 && m5.warn.includes('Antiaérea'), 'acima da borda do cânion a antiaérea machuca');
}

console.log('Armas');
{
  // metralhadora acerta o alvo na frente e não o de lado
  const m = new Mission(testDef({ spawn: [{ k: 'target', at: [0, 400, -400], hp: 30 }, { k: 'target', at: [300, 400, -400], hp: 30 }] }));
  m.plane.v = 60;
  for (let i = 0; i < 70; i++) m.step({ held: true, gun: true, throttle: 0 });
  ok(!m.ents[0].alive, 'metralhadora derruba o alvo na frente');
  ok(m.ents[1].alive && m.ents[1].hp === 30, 'não acerta o alvo fora da mira');
  const shots = new Mission(testDef());
  let n = 0;
  for (let i = 0; i < 60; i++) { shots.step({ held: true, gun: true }); n += shots.events.filter(e => e.type === 'gun').length; }
  ok(Math.abs(n - GUN.rate) <= 1, `cadência da metralhadora (${n} tiros/s)`);
  // míssil travado persegue alvo que se mexe
  const mm = new Mission(testDef({ spawn: [{ k: 'balloon', circle: { c: [0, 400, -900], r: 200, w: 0.12 }, hp: 60 }] }));
  const tgt = mm.ents[0];
  let locked = false;
  for (let i = 0; i < 120; i++) {
    mm.step({ held: true, look: [tgt.x - mm.plane.x, tgt.y - mm.plane.y, tgt.z - mm.plane.z] });
    if (mm.lock.target === tgt) locked = true;
  }
  ok(locked, 'olhar para o alvo por 1 s trava o míssil');
  mm.step({ held: true, missile: true, look: [tgt.x - mm.plane.x, tgt.y - mm.plane.y, tgt.z - mm.plane.z] });
  ok(mm.missiles.length === 1 && mm.ammo === MISSILE.ammo - 1, 'gatilho esquerdo dispara um míssil');
  for (let i = 0; i < 6 / DT && tgt.alive; i++) mm.step({ held: true });
  ok(!tgt.alive, 'míssil travado persegue e acerta o alvo que se mexe');
  // trava demora ~1 s e não trava olhando para o lado
  const ml = new Mission(testDef({ spawn: [{ k: 'target', at: [0, 400, -800] }] }));
  let tLock = null;
  for (let i = 0; i < 200; i++) { ml.step({ held: true, look: [0.3, 0, -1], throttle: 0 }); }
  ok(!ml.lock.target, 'alvo fora do cone do olhar não trava');
  const ml2 = new Mission(testDef({ spawn: [{ k: 'target', at: [0, 400, -1200] }] }));
  for (let i = 0; i < 200 && !tLock; i++) { ml2.step({ held: true, look: [0, 0, -1], throttle: 0 }); if (ml2.lock.target) tLock = (i + 1) * DT; }
  ok(tLock && Math.abs(tLock - LOCK.time) < 0.05, `trava leva ${LOCK.time} s olhando (${tLock?.toFixed(2)} s)`);
  // nuvem no caminho não deixa travar
  const mc = new Mission(testDef({ spawn: [{ k: 'target', at: [0, 400, -1000] }] }));
  mc.env.puffs = [{ x: 0, y: 400, z: -500, r: 80 }];
  for (let i = 0; i < 120; i++) mc.step({ held: true, look: [0, 0, -1], throttle: 0 });
  ok(!mc.lock.target, 'alvo atrás de nuvem não trava');
  // munição de míssil recarrega
  const ma = new Mission(testDef());
  for (let i = 0; i < 6; i++) { ma.step({ held: true, missile: true }); for (let k = 0; k < 50; k++) ma.step({ held: true }); }
  ok(ma.ammo === 0, 'mísseis acabam');
  for (let i = 0; i < (MISSILE.reload + 0.2) / DT; i++) ma.step({ held: true });
  ok(ma.ammo === 1, 'um míssil volta depois de alguns segundos');
  // núcleo com escudo: tiro não passa até as peças caírem
  const mb = new Mission(testDef({ spawn: [{ k: 'ship', at: [0, 300, -2000], hull: [10, 10, 10], parts: [{ k: 'weak', tag: 'g', off: [60, 0, 0], hp: 10 }, { k: 'core', tag: 'boss', off: [0, 100, 0], hp: 10, shieldBy: 'g' }] }], obj: { type: 'boss', parts: 'g' } }));
  const core = mb.ents.find(e => e.kind === 'core'), gen = mb.ents.find(e => e.kind === 'weak');
  mb.bullets.push({ x: core.x, y: core.y, z: core.z + 30, vx: 0, vy: 0, vz: -700, life: 1, team: 'player', dmg: 50, r: 0 });
  for (let i = 0; i < 10; i++) mb.step({ held: true });
  ok(core.alive && core.hp === 10 && !core.lockable, 'núcleo com escudo não leva dano nem trava');
  mb.damage(gen, 99);
  mb.step({ held: true });
  ok(core.open && core.lockable, 'derrubando os geradores o escudo do núcleo abre');
  mb.damage(core, 99);
  mb.step({ held: true });
  ok(mb.state === 'won', 'derrubar o núcleo vence a missão do chefe');
}

console.log('Escudo e inimigos');
{
  const m = new Mission(testDef());
  m.hurtPlayer(30);
  ok(m.shield === SHIELD.max - 30, 'tiro tira escudo');
  for (let i = 0; i < 2 / DT; i++) m.step({ held: true });
  ok(m.shield === SHIELD.max - 30, 'escudo só recarrega depois de um tempo sem levar tiro');
  for (let i = 0; i < 5 / DT; i++) m.step({ held: true });
  ok(m.shield > SHIELD.max - 30 && m.shield < SHIELD.max, `escudo recarrega devagar (${m.shield.toFixed(0)})`);
  m.hurtPlayer(200);
  ok(m.state === 'lost', 'escudo zerado = abatido');
  // caça inimigo persegue e atira
  const mf = new Mission(testDef({ spawn: [{ k: 'fighter', at: [600, 450, 300] }] }));
  let shots = 0, minD = 1e9;
  for (let i = 0; i < 25 / DT && mf.state === 'playing'; i++) {
    mf.step({ held: true, pitch: 0.2, roll: 0.3 });
    shots += mf.events.filter(e => e.type === 'enemyShot').length;
    const e = mf.ents[0]; minD = Math.min(minD, Math.hypot(e.x - mf.plane.x, e.y - mf.plane.y, e.z - mf.plane.z));
  }
  ok(minD < 600, `caça inimigo vem atrás do jogador (chegou a ${minD.toFixed(0)} m)`);
  ok(shots > 0 && mf.dmg > 0, `caça inimigo atira e acerta às vezes (${shots} tiros, ${mf.dmg.toFixed(0)} de dano)`);
  // caça colado atrás de um inimigo faz ele quebrar a curva
  const mbk = new Mission(testDef({ spawn: [{ k: 'fighter', at: [0, 400, -200], psi: 0 }] }));
  mbk.ents[0].v = 90; mbk.plane.v = 100;
  let broke = false;
  for (let i = 0; i < 120; i++) { mbk.step({ held: true }); if (mbk.ents[0].state === 'break') broke = true; }
  ok(broke, 'inimigo com o jogador colado atrás quebra a curva');
  // torre só atira de perto
  const mt = new Mission(testDef({ spawn: [{ k: 'turret', at: [0, 400, -3000], range: 900 }] }));
  let tshots = 0;
  for (let i = 0; i < 60; i++) { mt.step({ held: true, throttle: 0 }); tshots += mt.events.filter(e => e.type === 'flakShot').length; }
  ok(tshots === 0, 'torre não atira de longe');
  // bombardeiro solta bomba no aliado
  const mbo = new Mission(testDef({ env: 'ocean', start: { at: [2000, 300, 2000], psi: 0 }, spawn: [{ k: 'allyShip', at: [0, 18, -600], hull: [26, 16, 110], hp: 400 }, { k: 'bomber', at: [0, 300, -1600], target: 'ally' }] }));
  for (let i = 0; i < 40 / DT; i++) mbo.step({ held: true, pitch: 0.4, roll: 0.5 });
  ok(mbo.ents[0].hp < 400, `bombardeiro acerta o porta-aviões (vida ${mbo.ents[0].hp.toFixed(0)})`);
  // caças do cânion passam e voltam por cima
  const mcy = new Mission(MISSIONS[2]);
  mcy.allies()[0].hp = 1e9;
  const states = new Set();
  for (let i = 0; i < 45 / DT && mcy.state === 'playing'; i++) {
    mcy.shield = 1e9;
    const pl = mcy.plane, ahead = mcy.env.point(-pl.z + 200, 0, 80);
    mcy.step({ held: true, throttle: 0, look: [0, -1, 0], ...steerTo(pl, [ahead[0] - pl.x, ahead[1] - pl.y, ahead[2] - pl.z]) });
    for (const e of mcy.ents) if (e.alive && e.role === 'canyon') states.add(e.state);
  }
  ok(states.has('run') && states.has('climb') && states.has('over'), `caças do cânion passam, sobem e voltam (${[...states].join(', ')})`);
}

console.log('Objetivos e estrelas');
{
  const d = { stars: { time: 60, dmg: 20 } };
  ok(starsFor(d, 50, 10) === 3 && starsFor(d, 70, 10) === 2 && starsFor(d, 50, 30) === 2 && starsFor(d, 70, 30) === 1, 'estrelas: vencer + tempo + pouco dano');
  const da = { stars: { ally: 0.5, dmg: 20 } };
  ok(starsFor(da, 999, 10, 0.8) === 3 && starsFor(da, 1, 10, 0.3) === 2, 'estrelas de proteger: vida que sobrou no aliado em vez do tempo');
  // corrida: portal perdido soma tempo
  const race = new Mission({ name: 'r', env: 'canyon', canyon: { length: 3000, seed: 2 }, spawn: [{ k: 'portal', n: 0, cs: 300, u: 0, y: 70 }, { k: 'portal', n: 1, cs: 700, u: 0.5, y: 140 }], obj: { type: 'race', miss: 5 }, stars: { time: 30, dmg: 5 } });
  for (let i = 0; i < 12 / DT && race.state === 'playing'; i++) {
    const p = race.ents[race.portalNext];
    const want = race.portalNext === 0 ? [p.x - race.plane.x, p.y - race.plane.y, p.z - race.plane.z] : race.env.tangent(-race.plane.z);
    race.step({ held: true, ...steerTo(race.plane, want) });
  }
  ok(race.ents[0].passed && race.ents[1].missed, 'portal atravessado conta, portal errado é perdido');
  ok(race.state === 'won' && Math.abs(race.penalty - 5) < 1e-9, `portal perdido = +5 s (${race.penalty} s)`);
  // missão com tempo: acaba perdendo
  const lim = new Mission(testDef({ spawn: [{ k: 'target', at: [0, 0, 9000], req: true }], obj: { type: 'kill', limit: 2 } }));
  for (let i = 0; i < 3 / DT; i++) lim.step({ held: true });
  ok(lim.state === 'lost' && lim.reason.includes('tempo'), 'tempo esgotado perde a missão');
  // aliado derrubado perde
  const al = new Mission(testDef({ spawn: [{ k: 'ally', at: [0, 300, -500], hp: 10 }], obj: { type: 'defend', time: 50 } }));
  al.hurtAlly(al.ents[0], 20);
  ok(al.state === 'lost', 'aliado derrubado perde a missão');
  // ondas aparecem
  const wv = new Mission(testDef({ spawn: [{ k: 'target', at: [0, 400, -900], req: true, hp: 1 }], waves: [{ when: { killed: 1 }, spawn: [{ k: 'target', at: [0, 400, -900], req: true }] }], obj: { type: 'kill', count: 2 } }));
  wv.damage(wv.ents[0], 5);
  wv.step({ held: true });
  ok(wv.ents.length === 2 && wv.state === 'playing', 'onda nova aparece quando a anterior cai');
}

console.log('Missões');
{
  ok(MISSIONS.length === 12 && SECTORS.length === 3, '12 missões em 3 setores');
  for (const [i, def] of MISSIONS.entries()) {
    ok(def.sector === Math.floor(i / 4), `missão ${i + 1} no setor certo`);
    ok(!!def.name && !!def.brief && !!def.hint, `missão ${i + 1}: nome, briefing e dica`);
    if (i % 4 === 3) ok(def.boss && def.obj.type === 'boss', `missão ${i + 1} é chefe`);
    const m = new Mission(def);
    if (def.env === 'canyon') {
      for (const e of m.ents) if (e.kind === 'target' || e.kind === 'portal' || (e.kind === 'turret' && e.y < RIM)) ok(m.env.clearance(e.x, e.z) > 15, `missão ${i + 1}: ${e.kind} dentro do cânion`);
      for (const e of m.ents) if (e.kind === 'portal') ok(e.y - e.r > 3 && e.y + e.r < RIM, `missão ${i + 1}: portal ${e.n + 1} cabe entre o chão e a borda`);
    } else {
      for (const e of m.ents) if (e.k !== 'ship') ok(Math.hypot(e.x - m.env.center[0], e.z - m.env.center[2]) < m.env.radius, `missão ${i + 1}: ${e.kind} dentro da área`);
    }
  }
  const types = new Set(MISSIONS.map(d => d.obj.type));
  ok(['kill', 'race', 'escort', 'defend', 'boss'].every(t => types.has(t)), 'objetivos variados (abater, corrida, escolta, proteger, chefe)');
  ok(MISSIONS.some(d => d.obj.limit && d.obj.type === 'kill'), 'tem missão de destruir em tempo');
}

console.log('Robô (toda missão tem solução com os comandos do jogador)');
{
  for (const [i, def] of MISSIONS.entries()) {
    const runs = [];
    for (const seed of [1, 2, 3]) {
      const m = new Mission(def, { seed }), robot = makeRobot();
      let maxCmd = 0;
      for (let k = 0; k < 400 / DT && m.state === 'playing'; k++) {
        const inp = robot.step(m);
        maxCmd = Math.max(maxCmd, Math.abs(inp.pitch), Math.abs(inp.roll));
        m.step(inp);
      }
      runs.push({ m, maxCmd });
    }
    for (const [k, { m, maxCmd }] of runs.entries()) {
      const r = m.result;
      ok(m.state === 'won', `robô, missão ${i + 1} (${def.name}) semente ${k + 1}: vence (${m.state}${m.reason ? ': ' + m.reason : ''}, ${m.objective.text}, t ${m.t.toFixed(0)} s, dano ${m.dmg.toFixed(0)})`);
      ok(maxCmd <= 1, `robô, missão ${i + 1}: manche dentro do curso`);
    }
    const txt = runs.map(({ m }) => m.result ? `${m.result.time.toFixed(0)} s/${m.result.dmg.toFixed(0)} dano${m.result.ally != null ? `/aliado ${Math.round(m.result.ally * 100)}%` : ''}/${m.result.stars}★` : m.state).join('  ');
    const lim = def.stars.ally != null ? `aliado com ${Math.round(def.stars.ally * 100)}%` : `até ${def.stars.time} s`;
    console.log(`  ${String(i + 1).padStart(2)}: ${def.name.padEnd(20)} ${txt}   (estrelas: ${lim}, até ${def.stars.dmg} de dano)`);
  }
}

console.log(fails ? `\n${fails} de ${count} verificações falharam` : `\nTudo certo (${count} verificações)`);
process.exit(fails ? 1 : 0);
