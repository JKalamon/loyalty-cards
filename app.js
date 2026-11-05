'use strict';

/* ================= Shops ================= */
const SHOPS = [
  { id: 'biedronka', name: 'Biedronka',   bg: '#e30613', fg: '#ffffff' },
  { id: 'lidl',      name: 'Lidl Plus',   bg: '#0050aa', fg: '#ffffff', format: 'QR' },
  { id: 'zabka',     name: 'Żabka',       bg: '#0f9d48', fg: '#ffffff', totp: true },
  { id: 'rossmann',  name: 'Rossmann',    bg: '#ffffff', fg: '#c8102e' },
  { id: 'kaufland',  name: 'Kaufland',    bg: '#e10915', fg: '#ffffff' },
  { id: 'orlen',     name: 'Orlen Vitay', bg: '#1f1f22', fg: '#ff2b3b', format: 'QR',
    // Vitay QR carries a fixed template, not just the number.
    wrap: n => `TRANSID 0\nVITAY ${vitayNum(n)}` },
  { id: 'bp',        name: 'bp',          bg: '#007a3d', fg: '#ffffff' },
  { id: 'action',    name: 'Action',      bg: '#0058a3', fg: '#ffffff' },
  { id: 'amic',      name: 'Amic',        bg: '#0b2d5b', fg: '#a6d63a' },
  { id: 'decathlon', name: 'Decathlon',   bg: '#3643ba', fg: '#ffffff' },
];
const shopById = id => SHOPS.find(s => s.id === id);
// Pull the bare Vitay number out of either a raw number or a scanned "…VITAY <n>" payload.
const vitayNum = s => (/VITAY\s+(\S+)/i.exec(s)?.[1]) || String(s).trim();

/* ================= Storage ================= */
const KEY = 'wallet.cards.v1';
function loadCards() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function saveCards() {
  try { localStorage.setItem(KEY, JSON.stringify(cards)); }
  catch (e) { alert('Nie udało się zapisać: ' + e.message); }
}
let cards = loadCards();

/* ================= Helpers ================= */
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function contrastFg(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map(v => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

function cardStyle(c) {
  const s = shopById(c.shop);
  if (s) return { bg: s.bg, fg: s.fg, name: c.name || s.name };
  const bg = c.color || '#5b5f6b';
  return { bg, fg: contrastFg(bg), name: c.name || 'Karta' };
}

function eanValid(d) {
  const digits = d.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((a, v, i) => a + v * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
function detectFormat(v) {
  if (/^\d+$/.test(v)) {
    if (v.length === 13 && eanValid(v)) return 'EAN13';
    if (v.length === 8 && eanValid(v)) return 'EAN8';
    if (v.length === 12 && eanValid(v)) return 'UPC';
  }
  return 'CODE128';
}

/* ================= Żappka TOTP (port of Zappka3DS zappka_totp_qr.c) ================= */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
async function zabkaTotp(secretHex, nowSec = Date.now() / 1000) {
  if (!crypto.subtle) throw new Error('Wymagane HTTPS (WebCrypto niedostępne)');
  const step = Math.floor(nowSec / 30);
  const msg = new Uint8Array(8);
  let x = step;
  for (let i = 7; i >= 0; i--) { msg[i] = x & 0xff; x = Math.floor(x / 256); }
  const key = await crypto.subtle.importKey('raw', hexToBytes(secretHex), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1000000).padStart(6, '0');
}
const zabkaUrl = (ploy, code) => `https://srln.pl/view/dashboard?ploy=${encodeURIComponent(ploy)}&loyal=${code}`;

/* ================= Code rendering ================= */
function qrSvg(text, ecc = 'M') {
  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), m = 2, size = n + m * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList.add('qr');
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/>`;
  return svg;
}

function barcodeSvg(value, format) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const opts = { displayValue: false, margin: 8, height: 120, width: 2.4, background: '#ffffff', lineColor: '#000000' };
  try { JsBarcode(svg, value, { ...opts, format }); }
  catch { JsBarcode(svg, value, { ...opts, format: 'CODE128' }); }
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.style.width = '100%';
  return svg;
}

/* ================= Home grid ================= */
function tileFor({ bg, fg, name }, sub, shopId) {
  const t = el('button', 'tile' + (shopId ? ' b-' + shopId : ''));
  t.type = 'button';
  t.style.background = bg;
  t.style.color = fg;
  t.append(el('div', 'brand', name), el('div', 'sub', sub || ''));
  if (['biedronka', 'lidl', 'bp'].includes(shopId)) t.append(el('span', 'dot'));
  return t;
}

function subtitle(c) {
  if (c.note) return c.note;
  if (c.shop === 'zabka') return 'Żappka';
  if (c.number) return '•••• ' + c.number.slice(-4);
  return '';
}

function renderGrid() {
  const g = $('#grid');
  g.replaceChildren();
  for (const c of cards) {
    const t = tileFor(cardStyle(c), subtitle(c), c.shop);
    t.addEventListener('click', () => openViewer(c.id));
    g.append(t);
  }
  $('#empty').hidden = cards.length > 0;
}

/* ================= Navigation stack (Android back button / history) ================= */
const stack = [];
history.replaceState({ depth: 0 }, '');
function pushUI(name, close) {
  stack.push({ name, close });
  history.pushState({ depth: stack.length }, '');
}
window.addEventListener('popstate', e => {
  const target = (e.state && e.state.depth) || 0;
  while (stack.length > target) stack.pop().close();
});
const back = () => stack.length && history.back();
const backAll = () => stack.length && history.go(-stack.length);

/* ================= Add / edit panel ================= */
const panel = $('#panel');
let editing = null;      // card being edited, or null for new
let draftShop = null;    // shop id or 'other'

function buildShopGrid() {
  const g = $('#shopGrid');
  for (const s of SHOPS) {
    const t = tileFor(s, s.totp ? 'kod dynamiczny' : '', s.id);
    t.addEventListener('click', () => openForm(s.id));
    g.append(t);
  }
  const other = tileFor({ bg: '', fg: '', name: '+ Inna karta' }, 'dowolny sklep');
  other.classList.add('new-other');
  other.addEventListener('click', () => openForm('other'));
  g.append(other);
}

function setPanelOffset(px) {
  panel.style.transform = px == null ? '' : `translateX(${px}px)`;
}

function openPanel() {
  if (panel.classList.contains('open')) return;
  editing = null;
  showPickStep();
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  pushUI('panel', closePanelNow);
}
function closePanelNow() {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  setPanelOffset(null);
  $('#formStep').hidden = true;
  $('#pickStep').hidden = false;
}
function showPickStep() {
  $('#panelTitle').textContent = 'Dodaj kartę';
  $('#pickStep').hidden = false;
  $('#formStep').hidden = true;
}

function openForm(shopId, card = null) {
  editing = card;
  draftShop = shopId;
  const s = shopById(shopId);
  const isZ = shopId === 'zabka';
  $('#panelTitle').textContent = card ? 'Edytuj kartę' : (s ? s.name : 'Inna karta');
  $('#pickStep').hidden = true;
  $('#formStep').hidden = false;
  $('#nameRow').hidden = !!s;
  $('#colorRow').hidden = !!s;
  $('#stdFields').hidden = isZ;
  $('#zabkaFields').hidden = !isZ;
  $('#deleteBtn').hidden = !card;
  $('#formError').hidden = true;

  $('#fName').value = card?.name || '';
  $('#fColor').value = card?.color || '#5b5f6b';
  $('#fNumber').value = card?.number || '';
  $('#fFormat').value = card?.format || s?.format || 'auto';
  // Shops with a fixed QR payload (e.g. Orlen Vitay) don't expose the format picker.
  $('#fFormat').closest('label').hidden = !!s?.wrap;
  $('#fPloy').value = card?.ploy || '';
  $('#fSecret').value = card?.secret || '';
  $('#fZjson').value = '';
  $('#fNote').value = card?.note || '';
  updatePreview();
  $('#formStep').scrollTop = 0;

  if (!card) pushUI('form', showPickStep);
}

function updatePreview() {
  const draft = { shop: draftShop, name: $('#fName').value.trim(), color: $('#fColor').value, note: $('#fNote').value.trim(), number: $('#fNumber').value.trim() };
  const t = tileFor(cardStyle(draft), subtitle(draft), draftShop);
  t.classList.add('preview');
  t.tabIndex = -1;
  $('#formPreview').replaceWith(t);
  t.id = 'formPreview';
}
['#fName', '#fColor', '#fNote', '#fNumber'].forEach(s => $(s).addEventListener('input', updatePreview));

$('#fZjson').addEventListener('input', () => {
  try {
    const j = JSON.parse($('#fZjson').value);
    const ploy = j.user_id ?? j.ployId ?? j.ploy;
    const sec = j.hex_secret ?? j.loyalSecret ?? j.secret;
    if (ploy) $('#fPloy').value = String(ploy);
    if (sec) $('#fSecret').value = String(sec);
  } catch { /* still typing */ }
});

function formError(msg) {
  const e = $('#formError');
  e.textContent = msg;
  e.hidden = false;
}

$('#formStep').addEventListener('submit', async e => {
  e.preventDefault();
  const c = editing ? { ...editing } : { id: uid(), shop: draftShop, created: Date.now() };
  c.note = $('#fNote').value.trim();
  if (draftShop === 'other') {
    c.name = $('#fName').value.trim();
    c.color = $('#fColor').value;
    if (!c.name) return formError('Podaj nazwę karty.');
  }
  if (draftShop === 'zabka') {
    c.ploy = $('#fPloy').value.trim();
    c.secret = $('#fSecret').value.trim().replace(/\s+/g, '');
    if (!c.ploy) return formError('Podaj ployId.');
    if (!/^[0-9a-fA-F]+$/.test(c.secret) || c.secret.length % 2) return formError('loyalSecret musi być ciągiem hex o parzystej długości.');
    try { await zabkaTotp(c.secret); } catch (err) { return formError(err.message); }
  } else {
    const shop = shopById(draftShop);
    c.number = shop?.wrap ? vitayNum($('#fNumber').value) : $('#fNumber').value.trim();
    c.format = shop?.wrap ? 'QR' : $('#fFormat').value;
    if (!c.number) return formError('Podaj numer karty.');
  }
  if (editing) cards = cards.map(x => (x.id === c.id ? c : x));
  else cards.push(c);
  saveCards();
  renderGrid();
  backAll();
});

$('#deleteBtn').addEventListener('click', () => {
  if (!editing || !confirm('Usunąć tę kartę?')) return;
  cards = cards.filter(x => x.id !== editing.id);
  saveCards();
  renderGrid();
  backAll();
});

$('#panelBack').addEventListener('click', back);

/* ----- backup ----- */
$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'karty', v: 1, cards }, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `karty-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    const list = Array.isArray(j) ? j : j.cards;
    if (!Array.isArray(list)) throw new Error('zły format');
    const byId = new Map(cards.map(c => [c.id, c]));
    for (const c of list) if (c && c.id) byId.set(c.id, c);
    cards = [...byId.values()];
    saveCards();
    renderGrid();
    alert(`Zaimportowano ${list.length} kart.`);
    backAll();
  } catch (err) { alert('Nie udało się zaimportować: ' + err.message); }
});

/* ================= Viewer ================= */
const viewer = $('#viewer');
let viewerTimer = null;
let wakeLock = null;
let viewing = null;

async function openViewer(id) {
  const c = cards.find(x => x.id === id);
  if (!c) return;
  viewing = c;
  const st = cardStyle(c);
  const inner = viewer.querySelector('.viewer-inner');
  inner.style.setProperty('--card', st.bg);
  inner.style.setProperty('--card-fg', st.fg);
  $('#viewerTitle').textContent = st.name;
  $('#viewerNote').textContent = c.note || '';
  $('#codeArea').replaceChildren();
  $('#codeText').textContent = '';
  $('#totpBar').hidden = true;

  viewer.classList.add('open');
  viewer.setAttribute('aria-hidden', 'false');
  pushUI('viewer', closeViewerNow);

  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }

  if (c.shop === 'zabka') startZabka(c);
  else {
    const shop = shopById(c.shop);
    const payload = shop?.wrap ? shop.wrap(c.number) : c.number;
    const fmt = shop?.wrap ? 'QR' : (c.format === 'auto' || !c.format ? detectFormat(c.number) : c.format);
    $('#codeArea').append(fmt === 'QR' ? qrSvg(payload) : barcodeSvg(payload, fmt));
    $('#codeText').textContent = shop?.wrap ? vitayNum(c.number) : c.number;
  }
}

function startZabka(c) {
  let lastStep = -1;
  const bar = $('#totpBar');
  const fill = bar.querySelector('span');
  bar.hidden = false;
  const tick = async () => {
    const now = Date.now() / 1000;
    const step = Math.floor(now / 30);
    fill.style.transform = `scaleX(${1 - (now % 30) / 30})`;
    if (step === lastStep) return;
    lastStep = step;
    try {
      const code = await zabkaTotp(c.secret, now);
      if (viewing !== c) return;
      $('#codeArea').replaceChildren(qrSvg(zabkaUrl(c.ploy, code), 'H'));
      $('#codeText').textContent = code.slice(0, 3) + ' ' + code.slice(3);
    } catch (err) {
      $('#codeText').textContent = err.message;
    }
  };
  tick();
  viewerTimer = setInterval(tick, 250);
}

function closeViewerNow() {
  viewing = null;
  clearInterval(viewerTimer);
  viewerTimer = null;
  viewer.classList.remove('open');
  viewer.setAttribute('aria-hidden', 'true');
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

$('#viewerClose').addEventListener('click', back);
$('#viewerEdit').addEventListener('click', () => {
  if (!viewing) return;
  const c = viewing;
  // Close the viewer visually without changing history depth, then reuse the
  // top-of-stack entry for the panel so it isn't hidden under the viewer.
  clearInterval(viewerTimer);
  viewerTimer = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  viewing = null;
  viewer.classList.remove('open');
  viewer.setAttribute('aria-hidden', 'true');
  if (stack.length) stack[stack.length - 1] = { name: 'panel', close: closePanelNow };
  else pushUI('panel', closePanelNow);
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  openForm(c.shop, c);
});
viewer.addEventListener('click', e => { if (e.target === viewer) back(); });

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && viewing && !wakeLock) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  } else if (document.visibilityState === 'hidden') wakeLock = null;
});

/* ================= Scanner ================= */
let scanner = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = el('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Nie można wczytać skanera'));
    document.head.append(s);
  });
}
const FORMAT_MAP = { EAN_13: 'EAN13', EAN_8: 'EAN8', UPC_A: 'UPC', CODE_128: 'CODE128', CODE_39: 'CODE39', ITF: 'ITF', QR_CODE: 'QR' };

$('#scanBtn').addEventListener('click', async () => {
  try {
    if (!window.Html5Qrcode) await loadScript('vendor/html5-qrcode.min.js');
    $('#scanner').hidden = false;
    pushUI('scanner', stopScanner);
    scanner = new Html5Qrcode('scanRegion', { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.floor(w * 0.85), height: Math.floor(Math.min(h, w) * 0.6) }) },
      (text, result) => {
        $('#fNumber').value = text;
        const f = FORMAT_MAP[result?.result?.format?.formatName];
        if (f) $('#fFormat').value = f;
        updatePreview();
        navigator.vibrate?.(60);
        back();
      },
      () => {}
    );
  } catch (err) {
    alert('Skaner niedostępny: ' + (err.message || err));
    back();
  }
});
function stopScanner() {
  $('#scanner').hidden = true;
  const s = scanner; scanner = null;
  if (s) s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch {} });
}
$('#scanClose').addEventListener('click', back);

/* ================= Swipe gestures ================= */
// Swipe right anywhere on the home screen → drag the add panel in.
// Swipe left on the panel → drag it out.
function horizontalDrag(target, { onMove, onEnd, shouldStart }) {
  let sx = 0, sy = 0, active = false, decided = false, horiz = false, id = null;
  target.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('input, textarea, select')) return;
    sx = e.clientX; sy = e.clientY; id = e.pointerId;
    active = true; decided = false; horiz = false;
  });
  target.addEventListener('pointermove', e => {
    if (!active || e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      decided = true;
      horiz = Math.abs(dx) > Math.abs(dy) * 1.3 && shouldStart(dx);
      if (!horiz) { active = false; return; }
      try { target.setPointerCapture(id); } catch {}
    }
    onMove(dx);
  });
  const end = e => {
    if (!active || e.pointerId !== id) return;
    active = false;
    if (horiz) {
      suppressClick();
      onEnd(e.clientX - sx);
    }
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
function suppressClick() {
  const h = e => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener('click', h, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', h, { capture: true }), 50);
}

horizontalDrag($('#home'), {
  shouldStart: dx => dx > 0 && !stack.length,
  onMove: dx => {
    panel.classList.add('dragging');
    setPanelOffset(Math.min(0, -window.innerWidth + Math.max(0, dx)));
  },
  onEnd: dx => {
    panel.classList.remove('dragging');
    setPanelOffset(null);
    if (dx > Math.min(90, window.innerWidth * 0.25)) openPanel();
  },
});

horizontalDrag(panel, {
  shouldStart: dx => dx < 0,
  onMove: dx => {
    panel.classList.add('dragging');
    setPanelOffset(Math.min(0, dx));
  },
  onEnd: dx => {
    panel.classList.remove('dragging');
    setPanelOffset(null);
    if (dx < -Math.min(90, window.innerWidth * 0.25)) backAll();
  },
});

// Desktop convenience: "+" / "n" opens the add panel, Esc goes back.
document.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select')) return;
  if ((e.key === 'n' || e.key === '+') && !stack.length) openPanel();
  if (e.key === 'Escape') back();
});

/* ================= Boot ================= */
buildShopGrid();
renderGrid();
window.addEventListener('storage', e => { if (e.key === KEY) { cards = loadCards(); renderGrid(); } });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
