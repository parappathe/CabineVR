// Progresso e opções, salvos no navegador (localStorage 'cabinevr.v1').
const KEY = 'cabinevr.v1';
const DEFAULTS = {
  done: {},          // missões vencidas: { 0: { stars, time, dmg }, ... }
  sound: true,
  fps: false,
  vignette: true,    // escurece a borda da visão nas curvas fortes (conforto)
  horizon: 'full',   // 'full' = a visão inclina com o avião; 'firm' = inclina só metade (conforto)
  height: 0,         // ajuste fino da altura no VR (m)
  cam: 'first',      // PC: 'first' (cabine) ou 'chase' (atrás do avião)
  invert: false,     // PC: mouse para cima = nariz para cima (padrão: para baixo, como manche)
};

export function loadSave() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    if (typeof s.done !== 'object' || !s.done) s.done = {};
    return s;
  } catch { return { ...DEFAULTS, done: {} }; }
}

export function storeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sem armazenamento: segue sem salvar */ }
}
