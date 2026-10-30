// As 12 missões: 3 setores com 4 missões cada (a 4ª é o chefe). Sem navegador.
//
// Cada missão: env ('canyon' | 'clouds' | 'ocean') e as medidas do cenário, start (posição e rumo),
// spawn (o que já existe no começo), waves (o que aparece depois) e obj (objetivo):
//   kill:   destruir os marcados com req (count = quantos precisam; label = texto; limit = tempo máx.)
//   race:   passar pelos portais em ordem (miss = segundos por portal perdido; limit = tempo máx.)
//   escort: o aliado tem que chegar ao fim do caminho vivo
//   defend: o aliado tem que aguentar `time` segundos
//   boss:   derrubar o que tem tag 'boss' (parts = tag das peças que protegem o núcleo)
// stars: { time, dmg } ou { ally, dmg }: 1 estrela por vencer, +1 se o tempo for até `time` (ou, ao proteger,
// se sobrar pelo menos `ally` da vida do aliado), +1 se o dano levado for até `dmg`. Calibrado pelo robô.
// Posição de spawn: at [x,y,z] | cs (s no cânion) + u (-1..1 da largura) + y | basin [dx,y,dz] (bacia do
// chefe) | ahead (metros à frente do aliado/jogador no cânion) | ring [distância, y] (volta da área).
import { Canyon, RIM } from './env.js';

export const SECTORS = ['Cânion', 'Mar de Nuvens', 'Frota'];

const canyonPath = (c, s0, s1, y, step = 100) => {
  const pts = [];
  for (let s = s0; s <= s1; s += step) pts.push(c.point(s, 0, y));
  return pts;
};
const F = (o) => ({ k: 'fighter', ...o });

// cânions das missões (o mesmo objeto gera o caminho do aliado e o cenário)
const CANYON = {
  1: { length: 4400, seed: 3 },
  2: { length: 4700, seed: 5 },
  3: { length: 5200, seed: 9 },
  4: { length: 3600, seed: 11, basin: 430 },
};
const c3 = new Canyon(CANYON[3]);

export const MISSIONS = [
  // ---------------- Setor 1: Cânion ----------------
  {
    name: 'Primeiro voo', env: 'canyon', canyon: CANYON[1],
    brief: 'Voe baixo pelo cânion e destrua os alvos no chão: tanques e radares.',
    hint: 'Olhe para um alvo por 1 segundo para travar o míssil. Fique abaixo da borda do cânion.',
    spawn: [
      ...[700, 1150, 1600, 2050, 2500, 2950, 3400, 3850].map((s, i) => ({ k: 'target', cs: s, u: [0.35, -0.4, 0.1, -0.3, 0.4, -0.1, 0.3, -0.35][i], y: 6, req: true, model: i % 2 ? 'radar' : 'tank' })),
      { k: 'turret', cs: 1800, rim: 1, range: 800 },
      { k: 'turret', cs: 3100, rim: -1, range: 800 },
    ],
    obj: { type: 'kill', count: 6, label: 'Alvos no chão' },
    stars: { time: 35, dmg: 20 },
  },
  {
    name: 'Corrida do Cânion', env: 'canyon', canyon: CANYON[2],
    brief: 'Passe por dentro de todos os portais, em ordem, o mais rápido que puder.',
    hint: 'Portal perdido = +5 s. Turbo no botão do topo da manete (X) ou Espaço.',
    spawn: Array.from({ length: 16 }, (_, i) => ({ k: 'portal', n: i, cs: 350 + i * 255, u: 0.45 * Math.sin(i * 1.7), y: 70 + 40 * Math.sin(i * 0.9 + 1) + (i % 3) * 10 })),
    obj: { type: 'race', miss: 5, limit: 90 },
    stars: { time: 52, dmg: 15 },
  },
  {
    name: 'Comboio', env: 'canyon', canyon: CANYON[3],
    brief: 'Escolte o avião de carga até o fim do cânion. Caças inimigos vão atacar de frente.',
    hint: 'Voe na frente do cargueiro e derrube os caças antes que cheguem nele.',
    spawn: [
      { k: 'ally', cs: 150, y: 75, speed: 60, hp: 100, path: canyonPath(c3, 250, 4750, 75), model: 'cargo' },
      { k: 'turret', cs: 1500, rim: 1, range: 850 },
      { k: 'turret', cs: 2700, rim: -1, range: 850 },
      { k: 'turret', cs: 3900, rim: 1, range: 850 },
    ],
    waves: [
      { every: 13, from: 5, max: 5, cap: 4, text: 'Caças à frente!', spawn: [F({ ahead: 1500, u: 0.3, y: 95, role: 'canyon', target: 'ally' }), F({ ahead: 1580, u: -0.3, y: 110, role: 'canyon', target: 'ally' })] },
    ],
    obj: { type: 'escort', who: 'avião de carga' }, allyLost: 'O avião de carga foi derrubado.',
    stars: { ally: 0.7, dmg: 25 },
  },
  {
    name: 'Fortaleza do Cânion', env: 'canyon', canyon: CANYON[4], boss: true,
    brief: 'No fim do cânion há uma fortaleza. Destrua os 4 canhões para abrir o escudo do reator.',
    hint: 'A bacia do fim é larga: dá para fazer curvas em volta da fortaleza.',
    spawn: [
      { k: 'turret', cs: 900, u: 0.45, y: 8, range: 800 },
      { k: 'turret', cs: 1700, u: -0.45, y: 8, range: 800 },
      { k: 'turret', cs: 2300, u: 0.4, y: 8, range: 800 },
      {
        k: 'ship', basin: [0, 30, 0], hull: [40, 28, 70], model: 'fortress', parts: [
          ...[[-32, -45], [32, -45], [-32, 45], [32, 45]].map(([x, z]) => ({ k: 'weak', tag: 'canhao', off: [x, 30, z], hp: 90, fire: true, dmgOut: 2, range: 650, model: 'cannon' })),
          { k: 'core', tag: 'boss', off: [0, 36, 0], hp: 300, shieldBy: 'canhao', model: 'reactor' },
        ],
      },
    ],
    waves: [
      { when: { s: 2200 }, text: 'Caças de defesa!', spawn: [F({ basin: [-150, 160, -100] }), F({ basin: [150, 170, -100] })] },
      { when: { killed: 5 }, text: 'Mais caças!', spawn: [F({ basin: [-200, 150, 200] }), F({ basin: [200, 150, 200] })] },
    ],
    obj: { type: 'boss', parts: 'canhao', partsLabel: 'Canhões da fortaleza', label: 'Destrua o reator' },
    stars: { time: 135, dmg: 125 },
  },

  // ---------------- Setor 2: Mar de Nuvens ----------------
  {
    name: 'Caçada nas Nuvens', env: 'clouds', clouds: { seed: 21 }, start: { at: [0, 380, 0], psi: 0 },
    brief: 'Caças rápidos escondidos nas nuvens. Derrube 6.',
    hint: 'Dentro da nuvem não dá para travar: espere o inimigo sair dela.',
    spawn: [F({ at: [-350, 420, -1700], req: true }), F({ at: [0, 470, -1800], req: true }), F({ at: [350, 400, -1750], req: true })],
    waves: [{ when: { killed: 2 }, text: 'Mais três caças!', spawn: [F({ at: [-900, 500, -2600], req: true }), F({ at: [900, 350, -2400], req: true }), F({ at: [0, 600, -2900], req: true })] }],
    obj: { type: 'kill', count: 6, label: 'Caças abatidos' },
    stars: { time: 35, dmg: 40 },
  },
  {
    name: 'Dirigíveis', env: 'clouds', clouds: { seed: 22 }, start: { at: [0, 400, 0], psi: 0 },
    brief: 'Cinco dirigíveis de radar. Destrua todos em até 150 segundos.',
    hint: 'Dirigível aguenta um míssil e mais um pouco de metralhadora.',
    spawn: [
      ...[[-700, 380, -1300, 160, 0.05], [600, 450, -1500, 200, -0.04], [0, 560, -2300, 180, 0.045], [-900, 300, -2600, 220, -0.035], [1000, 520, -2700, 170, 0.05]]
        .map(([x, y, z, r, w], i) => ({ k: 'balloon', circle: { c: [x, y, z], r, w }, ang: i * 1.3, req: true, model: 'blimp' })),
      F({ at: [-200, 450, -1400] }), F({ at: [200, 470, -1450] }),
    ],
    waves: [{ when: { t: 45 }, text: 'Escolta inimiga!', spawn: [F({ ring: [2000, 450] }), F({ ring: [2000, 450] })] }],
    obj: { type: 'kill', label: 'Dirigíveis', limit: 150 },
    stars: { time: 55, dmg: 30 },
  },
  {
    name: 'Cargueiro', env: 'clouds', clouds: { seed: 23 }, start: { at: [0, 360, -300], psi: 0 },
    brief: 'O cargueiro aliado dá voltas acima das nuvens. Proteja ele por 110 segundos.',
    hint: 'Os caças vão direto no cargueiro: intercepte antes de chegarem.',
    spawn: [{ k: 'ally', circle: { c: [0, 320, -1200], r: 650, w: 0.045 }, ang: Math.PI / 2, hp: 230, r: 24, model: 'blimpAlly' }],
    waves: [{ every: 16, from: 4, max: 6, cap: 5, text: 'Caças atacando o cargueiro!', spawn: [F({ ring: [2100, 420], target: 'ally' }), F({ ring: [2100, 420], target: 'ally' }), F({ ring: [2000, 500] })] }],
    obj: { type: 'defend', time: 110, who: 'cargueiro' }, allyLost: 'O cargueiro caiu.',
    stars: { ally: 0.45, dmg: 65 },
  },
  {
    name: 'Ás Vermelho', env: 'clouds', clouds: { seed: 24, count: 55 }, boss: true, start: { at: [0, 420, 0], psi: 0 },
    brief: 'O Ás Vermelho, o melhor piloto deles. Ele foge, faz curvas fechadas e atira bem.',
    hint: 'Ele aguenta uns 5 mísseis. Use o turbo para não perder ele de vista.',
    spawn: [
      { k: 'ace', at: [0, 520, -1600], tag: 'boss', name: 'Ás Vermelho', model: 'ace' },
      F({ at: [-250, 480, -1500] }), F({ at: [250, 480, -1500] }),
    ],
    waves: [{ every: 28, from: 28, max: 4, cap: 3, text: 'Alas do Ás chegando!', spawn: [F({ ring: [2000, 500] }), F({ ring: [2000, 500] })] }],
    obj: { type: 'boss', label: 'Derrube o Ás Vermelho' },
    stars: { time: 125, dmg: 150 },
  },

  // ---------------- Setor 3: Frota ----------------
  {
    name: 'Fragata', env: 'ocean', start: { at: [0, 260, 0], psi: 0 },
    brief: 'Uma fragata voadora com escolta. Destrua os 4 pontos fracos (motores e antenas).',
    hint: 'O casco é blindado: mire nas luzes laranjas. Não bata no casco!',
    spawn: [
      {
        k: 'ship', at: [0, 220, -1500], psi: Math.PI / 2, speed: 9, hull: [16, 14, 80], model: 'frigate', parts: [
          { k: 'weak', off: [-9, 2, 84], req: true, model: 'engine' }, { k: 'weak', off: [9, 2, 84], req: true, model: 'engine' },
          { k: 'weak', off: [0, 20, -30], req: true, model: 'antenna' }, { k: 'weak', off: [0, 20, 28], req: true, model: 'antenna' },
          { k: 'turret', off: [-14, 12, -55], range: 900, model: 'deckgun' }, { k: 'turret', off: [14, 12, 50], range: 900, model: 'deckgun' },
        ],
      },
      F({ at: [-300, 300, -1200] }), F({ at: [300, 320, -1250] }), F({ at: [0, 360, -1900] }),
    ],
    obj: { type: 'kill', label: 'Pontos fracos' },
    stars: { time: 62, dmg: 45 },
  },
  {
    name: 'Ataque à Frota', env: 'ocean', start: { at: [0, 280, 0], psi: 0 },
    brief: 'Duas fragatas. Destrua os pontos fracos das duas em até 170 segundos.',
    hint: 'Derrube primeiro a mais perto; as torres do convés atiram estilhaços.',
    spawn: [
      ...[[[-600, 200, -1600], 0.4], [[700, 280, -2300], -0.5]].map(([at, psi]) => ({
        k: 'ship', at, psi, speed: 8, hull: [16, 14, 80], model: 'frigate', parts: [
          { k: 'weak', off: [-9, 2, 84], req: true, model: 'engine' }, { k: 'weak', off: [9, 2, 84], req: true, model: 'engine' },
          { k: 'weak', off: [0, 20, -30], req: true, model: 'antenna' },
          { k: 'turret', off: [0, 12, -60], range: 900, model: 'deckgun' }, { k: 'turret', off: [14, 12, 40], range: 900, model: 'deckgun' },
        ],
      })),
      F({ at: [-200, 320, -1300] }), F({ at: [200, 320, -1300] }),
    ],
    waves: [{ every: 30, from: 30, max: 4, cap: 4, text: 'Caças da frota!', spawn: [F({ ring: [2300, 400] }), F({ ring: [2300, 400] })] }],
    obj: { type: 'kill', label: 'Pontos fracos', limit: 170 },
    stars: { time: 95, dmg: 60 },
  },
  {
    name: 'Porta-aviões', env: 'ocean', start: { at: [0, 220, -300], psi: Math.PI },
    brief: 'Bombardeiros vão atacar o nosso porta-aviões. Proteja ele por 120 segundos.',
    hint: 'Bombardeiros são lentos: derrube antes de passarem por cima do navio.',
    spawn: [{ k: 'allyShip', at: [0, 18, -1300], psi: 0.2, speed: 6, hull: [26, 16, 110], hp: 400, model: 'carrier' }],
    waves: [{
      every: 15, from: 3, max: 8, cap: 8, text: 'Bombardeiros chegando!',
      spawn: [{ k: 'bomber', ring: [2000, 320], target: 'ally', model: 'bomber' }, { k: 'bomber', ring: [2000, 320], target: 'ally', model: 'bomber' }, F({ ring: [2100, 450] })],
    }],
    obj: { type: 'defend', time: 120, who: 'porta-aviões' }, allyLost: 'O porta-aviões afundou.',
    stars: { ally: 0.7, dmg: 75 },
  },
  {
    name: 'Encouraçado Celeste', env: 'ocean', boss: true, start: { at: [0, 300, 0], psi: 0 },
    brief: 'A nave-mãe deles. Destrua os 4 geradores do escudo e depois o núcleo.',
    hint: 'Os geradores ficam nas pontas, em cima do casco. O núcleo abre no meio.',
    spawn: [{
      k: 'ship', at: [0, 300, -1900], psi: 0.15, speed: 7, hull: [34, 30, 170], model: 'battleship', parts: [
        ...[[-18, -110], [18, -110], [-18, 110], [18, 110]].map(([x, z]) => ({ k: 'weak', tag: 'gerador', off: [x, 30, z], hp: 100, model: 'generator' })),
        ...[[-26, -50], [26, -50], [-26, 50], [26, 50], [0, -165], [0, 165]].map(([x, z]) => ({ k: 'turret', off: [x, z === 0 ? 30 : 24, z], range: 800, model: 'deckgun' })),
        { k: 'core', tag: 'boss', off: [0, 40, 0], hp: 360, shieldBy: 'gerador', model: 'reactor' },
      ],
    }, F({ at: [-300, 360, -1300] }), F({ at: [300, 360, -1300] })],
    waves: [{ every: 24, from: 24, max: 5, cap: 4, text: 'Caças do encouraçado!', spawn: [F({ ring: [2200, 450] }), F({ ring: [2200, 450] })] }],
    obj: { type: 'boss', parts: 'gerador', partsLabel: 'Geradores do escudo', label: 'Destrua o núcleo' },
    stars: { time: 170, dmg: 150 },
  },
];
MISSIONS.forEach((m, i) => { m.num = i + 1; m.sector = Math.floor(i / 4); });
