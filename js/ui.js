// Painel de menu flutuante (o mesmo no PC e no VR): desenhado num canvas e mostrado num
// plano 3D. No VR se aponta com o controle; no PC se clica com o mouse.
import * as THREE from '../vendor/three/three.module.js';

const W = 1024, H = 720;
// Estilo de pôster de aviação antigo: papel creme, tinta azul-marinho e vermelho-coral.
export const C = {
  bg: 'rgba(244,232,208,0.97)', edge: '#c8402a', text: '#1f2a44', dim: '#6a6f7e',
  btn: '#1f2a44', btnText: '#f4e8d0', btnHover: '#2f5d6c', btnOn: '#e2553a', btnOnText: '#fff6e6', lock: '#d9ccb2',
  star: '#e89a12', green: '#2f8a5a', red: '#c8402a', ink: '#1f2a44',
};

export class Panel {
  constructor(width = 1.0) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const height = width * H / W;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.mesh.renderOrder = 10;
    this.buttons = [];
    this.hover = -1;
    this.drawFn = null;
  }

  show(drawFn) { this.drawFn = drawFn; this.hover = -1; this.mesh.visible = true; this.redraw(); }
  hide() { this.mesh.visible = false; this.drawFn = null; }
  get visible() { return this.mesh.visible; }

  redraw() {
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg; roundRect(g, 4, 4, W - 8, H - 8, 10); g.fill();
    g.strokeStyle = C.ink; g.lineWidth = 6; g.stroke();
    g.strokeStyle = C.edge; g.lineWidth = 3; roundRect(g, 16, 16, W - 32, H - 32, 6); g.stroke();
    // faixas diagonais no canto, como num cartaz de aviação
    g.save(); g.beginPath(); g.rect(16, 16, W - 32, H - 32); g.clip();
    for (let k = 0; k < 3; k++) {
      const A = 150 - k * 34, w = 18;
      g.fillStyle = k % 2 ? C.ink : C.edge;
      g.beginPath(); g.moveTo(W - 16 - A, 16); g.lineTo(W - 16 - A + w, 16); g.lineTo(W - 16, 16 + A - w); g.lineTo(W - 16, 16 + A); g.closePath(); g.fill();
    }
    g.restore();
    this.buttons = [];
    this.drawFn?.(this);
    this.tex.needsUpdate = true;
  }

  title(text, y = 70) {
    const g = this.ctx;
    g.fillStyle = C.ink; g.font = 'italic 900 56px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text.toUpperCase(), W / 2, y);
    g.fillStyle = C.edge; g.fillRect(W / 2 - 60, y + 34, 120, 5);
  }
  text(text, x, y, { size = 32, color = C.text, align = 'center', bold = false } = {}) {
    const g = this.ctx;
    g.fillStyle = color; g.font = `${bold ? 'bold ' : ''}${size}px sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }
  stars(n, x, y, size = 40, of = 3) {
    const g = this.ctx;
    for (let i = 0; i < of; i++) {
      const cx = x + (i - (of - 1) / 2) * size * 1.15;
      starPath(g, cx, y, size / 2);
      g.fillStyle = i < n ? C.star : 'rgba(31,42,68,0.15)';
      g.fill();
    }
  }
  button(label, action, x, y, w, h, { on = false, locked = false, size = 34, sub = null } = {}) {
    const g = this.ctx;
    const i = this.buttons.length;
    this.buttons.push({ x, y, w, h, action: locked ? null : action });
    g.fillStyle = locked ? C.lock : on ? C.btnOn : (i === this.hover ? C.btnHover : C.btn);
    roundRect(g, x, y, w, h, 6); g.fill();
    if (i === this.hover && !locked) { g.strokeStyle = C.edge; g.lineWidth = 4; g.stroke(); }
    g.fillStyle = on ? C.btnOnText : locked ? C.dim : C.btnText;
    g.font = `bold ${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 - (sub ? 14 : 0));
    if (sub) { g.font = '22px sans-serif'; g.fillStyle = on ? C.btnOnText : '#c9bfa8'; g.fillText(sub, x + w / 2, y + h / 2 + 20); }
  }
  // Quadradinho de fase: número, nome, estrelas e se está liberada.
  tile(x, y, w, h, { num, name, stars = 0, done = false, locked = false, master = false, action }) {
    const g = this.ctx;
    const i = this.buttons.length;
    this.buttons.push({ x, y, w, h, action: locked ? null : action });
    g.fillStyle = locked ? C.lock : (i === this.hover ? C.btnHover : C.btn);
    roundRect(g, x, y, w, h, 6); g.fill();
    if (!locked && !done) { g.strokeStyle = C.edge; g.lineWidth = 4; g.stroke(); }
    if (master && !locked) { g.strokeStyle = C.star; g.lineWidth = 2; roundRect(g, x + 6, y + 6, w - 12, h - 12, 4); g.stroke(); }
    if (i === this.hover && !locked) { g.strokeStyle = C.edge; g.lineWidth = 4; roundRect(g, x, y, w, h, 6); g.stroke(); }
    if (locked) {
      lockIcon(g, x + w / 2, y + h / 2 - 6);
      this.text(String(num), x + w / 2, y + h - 18, { size: 20, color: C.dim });
      return;
    }
    this.text(String(num), x + w / 2, y + 34, { size: 40, bold: true, color: '#f2a38f' });
    this.text(fit(g, name, w - 12, '18px sans-serif'), x + w / 2, y + 72, { size: 18, color: C.btnText });
    if (done) this.stars(stars, x + w / 2, y + h - 22, 24);
  }

  pick(uv) {
    if (!uv) return -1;
    const x = uv.x * W, y = (1 - uv.y) * H;
    return this.buttons.findIndex(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }
  setHover(i) { if (i !== this.hover) { this.hover = i; this.redraw(); } }
  actionAt(i) { return i >= 0 ? this.buttons[i]?.action : null; }
}

function fit(g, text, maxW, font) {
  g.font = font;
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function starPath(g, cx, cy, r) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.45 : r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (k) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

function lockIcon(g, cx, cy) {
  g.strokeStyle = C.dim; g.lineWidth = 5;
  g.beginPath(); g.arc(cx, cy - 8, 12, Math.PI, 0); g.stroke();
  g.fillStyle = C.dim; roundRect(g, cx - 17, cy - 8, 34, 26, 5); g.fill();
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Placa de texto pequena (FPS, cronômetro, dicas). Várias linhas.
export class Label {
  constructor(width = 0.16, px = 256, py = 64) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px; this.canvas.height = py;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * py / px),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.mesh.renderOrder = 11;
    this.last = null;
  }
  // lines: texto ou [{ text, size (fração da altura), color, bold }]
  set(lines) {
    const key = JSON.stringify(lines);
    if (key === this.last) return;
    this.last = key;
    if (typeof lines === 'string') lines = [{ text: lines }];
    const g = this.ctx, w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    if (!lines.length) { this.tex.needsUpdate = true; return; }
    g.fillStyle = 'rgba(20,28,48,0.78)'; roundRect(g, 0, 0, w, h, Math.min(10, h / 4)); g.fill();
    const total = lines.reduce((s, l) => s + (l.size ?? 0.55 / lines.length), 0);
    let y = (h - total * h) / 2;
    for (const l of lines) {
      const sz = (l.size ?? 0.55 / lines.length) * h;
      g.fillStyle = l.color || '#f4e8d0';
      const font = `${l.bold === false ? '' : 'bold '}${Math.round(sz * 0.8)}px sans-serif`;
      const txt = fit(g, l.text, w - 20, font);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, w / 2, y + sz / 2);
      y += sz;
    }
    this.tex.needsUpdate = true;
  }
}
