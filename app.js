/* Visite Chantier – Pyrénées Énergies Solutions
   Application web autonome (PWA), sans serveur. Données dans IndexedDB. */
'use strict';
(function () {
const APP_VERSION = '1.0.0';
const COMPANY = 'Pyrénées Énergies Solutions';
const MAX_SIDE = 2000;          // côté long max des photos
const JPEG_Q = 0.85;
const THUMB_SIDE = 480;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const pad = (n, l = 2) => String(n).padStart(l, '0');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function localISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}
function slug(s, max = 40) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(b / 1024)) + ' Ko'; }

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */
const DB_NAME = 'visite-chantier', DB_VER = 1;
let _db = null;
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('chantiers')) db.createObjectStore('chantiers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('chantierId', 'chantierId', { unique: false });
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      _db = r.result;
      _db.onclose = () => { _db = null; };
      _db.onversionchange = () => { try { _db.close(); } catch (e) {} _db = null; };
      resolve(_db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Base de données bloquée'));
  });
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
/* Exécute fn(tx) dans une transaction; réouvre la base si iOS a coupé la connexion. */
async function run(stores, mode, fn) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const db = _db || await openDB();
      const t = db.transaction(stores, mode);
      const done = new Promise((res, rej) => {
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('Transaction annulée'));
      });
      const out = fn(t);
      const val = out && typeof out.then === 'function' ? await out : (out instanceof IDBRequest ? await reqP(out) : out);
      await done;
      return val;
    } catch (e) {
      const retry = attempt === 0 && (e && (e.name === 'InvalidStateError' || /connection|closing|closed/i.test(e.message || '')));
      if (retry) { _db = null; continue; }
      throw e;
    }
  }
}
const DB = {
  allChantiers: () => run('chantiers', 'readonly', t => t.objectStore('chantiers').getAll()),
  getChantier: (id) => run('chantiers', 'readonly', t => t.objectStore('chantiers').get(id)),
  putChantier: (c) => run('chantiers', 'readwrite', t => { t.objectStore('chantiers').put(c); }),
  photosOf: (cid) => run('photos', 'readonly', t => t.objectStore('photos').index('chantierId').getAll(cid))
    .then(a => a.sort((x, y) => (x.order - y.order) || (x.createdAt < y.createdAt ? -1 : 1))),
  getPhoto: (id) => run('photos', 'readonly', t => t.objectStore('photos').get(id)),
  putPhoto: (p) => run('photos', 'readwrite', t => { t.objectStore('photos').put(p); }),
  getFile: (key) => run('files', 'readonly', t => t.objectStore('files').get(key)).then(r => r ? new Blob([r.buf], { type: r.type || 'image/jpeg' }) : null),
  async savePhotoWithFiles(meta, files) { // files: {suffix: Blob|null}
    const bufs = {};
    for (const k of Object.keys(files)) bufs[k] = files[k] ? await blobToBuf(files[k]) : null;
    return run(['photos', 'files'], 'readwrite', t => {
      t.objectStore('photos').put(meta);
      const fs = t.objectStore('files');
      for (const k of Object.keys(bufs)) {
        const key = meta.id + ':' + k;
        if (bufs[k]) fs.put({ key, buf: bufs[k], type: 'image/jpeg' }); else fs.delete(key);
      }
    });
  },
  deletePhoto: (id) => run(['photos', 'files'], 'readwrite', t => {
    t.objectStore('photos').delete(id);
    t.objectStore('files').delete(id + ':orig');
    t.objectStore('files').delete(id + ':annot');
  }),
  async deleteChantier(id) {
    const photos = await DB.photosOf(id);
    return run(['chantiers', 'photos', 'files'], 'readwrite', t => {
      t.objectStore('chantiers').delete(id);
      for (const p of photos) {
        t.objectStore('photos').delete(p.id);
        t.objectStore('files').delete(p.id + ':orig');
        t.objectStore('files').delete(p.id + ':annot');
      }
    });
  },
};
function blobToBuf(b) {
  if (b.arrayBuffer) return b.arrayBuffer();
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(b); });
}

/* ------------------------------------------------------------------ */
/* UI utilitaires : toast, attente, modales                            */
/* ------------------------------------------------------------------ */
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function busy(on, text) { $('#busy').hidden = !on; if (text) $('#busy-text').textContent = text; }

/* buttons: [{label, value, cls}] ; renvoie une promesse avec la valeur choisie */
function modal({ title, html = '', buttons = [], onOpen }) {
  return new Promise(resolve => {
    const m = $('#modal');
    $('#modal-title').textContent = title || '';
    $('#modal-body').innerHTML = html;
    const acts = $('#modal-actions'); acts.innerHTML = '';
    const close = (v) => { m.hidden = true; m.onclick = null; resolve(v); };
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'btn ' + (b.cls || 'ghost'); el.textContent = b.label;
      el.addEventListener('click', () => {
        if (b.onClick) { const r = b.onClick(); if (r === false) return; }
        close(typeof b.value === 'function' ? b.value() : b.value);
      });
      acts.appendChild(el);
    });
    m.onclick = (e) => { if (e.target === m) close(null); };
    m.hidden = false;
    if (onOpen) onOpen(close);
  });
}
function confirmDialog(message, okLabel = 'Confirmer', danger = false) {
  return modal({
    title: 'Confirmation', html: `<p>${esc(message)}</p>`,
    buttons: [{ label: 'Annuler', value: false }, { label: okLabel, value: true, cls: danger ? 'danger' : 'primary' }],
  });
}
/* Saisie de texte (appelée de façon synchrone dans un geste pour que le clavier iOS s'ouvre) */
function promptText({ title, value = '', placeholder = '', okLabel = 'OK', extra }) {
  const buttons = [{ label: 'Annuler', value: null }];
  if (extra) buttons.push({ label: extra.label, value: extra.value, cls: extra.cls || 'danger' });
  buttons.push({ label: okLabel, value: () => $('#modal-input').value.trim(), cls: 'primary' });
  const p = modal({
    title, buttons,
    html: `<input id="modal-input" type="text" enterkeyhint="done" autocapitalize="sentences" placeholder="${esc(placeholder)}" value="${esc(value)}">`,
    onOpen: (close) => {
      const inp = $('#modal-input');
      inp.focus();
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {}
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(inp.value.trim()); } });
    },
  });
  return p;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image illisible'));
    img.src = src;
  });
}
function canvasToBlob(c, type = 'image/jpeg', q = JPEG_Q) {
  return new Promise((res, rej) => {
    if (c.toBlob) c.toBlob(b => b ? res(b) : rej(new Error('Échec de l\'encodage JPEG')), type, q);
    else { try { const d = c.toDataURL(type, q); fetch(d).then(r => r.blob()).then(res, rej); } catch (e) { rej(e); } }
  });
}
function freeCanvas(c) { if (c) { c.width = 1; c.height = 1; } } // libère la mémoire canvas (limite iOS)
function fitSize(w, h, max) { const k = Math.min(1, max / Math.max(w, h)); return { w: Math.round(w * k), h: Math.round(h * k) }; }
async function makeThumb(source, sw, sh) {
  const { w, h } = fitSize(sw, sh, THUMB_SIDE);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  const b = await canvasToBlob(c, 'image/jpeg', 0.8); freeCanvas(c); return b;
}
/* Réduit la photo (≤ 2000 px), encode en JPEG 0,85. L'orientation EXIF est appliquée par le navigateur. */
async function processFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, MAX_SIDE);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToBlob(c, 'image/jpeg', JPEG_Q);
    const thumb = await makeThumb(c, w, h);
    freeCanvas(c);
    return { blob, thumb, w, h };
  } finally { URL.revokeObjectURL(url); }
}

/* ------------------------------------------------------------------ */
/* Dessin des annotations (coordonnées en pixels de l'image)           */
/* ------------------------------------------------------------------ */
const COLORS = { '#e53935': 'rouge', '#1e88e5': 'bleu', '#fb8c00': 'orange', '#43a047': 'vert', '#ffffff': 'blanc', '#111111': 'noir' };
const WIDTH_F = [0.005, 0.009, 0.016];   // épaisseur trait / côté long
const TEXT_F = [0.035, 0.05, 0.07];      // taille texte / côté long
const FONT = '700 {s}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';
const haloOf = (c) => (c === '#ffffff' || c === '#fb8c00') ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)';

function drawShape(ctx, s) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width;
  if (s.type === 'pen') {
    const p = s.points;
    ctx.beginPath();
    if (p.length === 1) { ctx.arc(p[0][0], p[0][1], s.width / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
      ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
    }
    const l = p[p.length - 1]; ctx.lineTo(l[0], l[1]);
    ctx.stroke();
  } else if (s.type === 'rect') {
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    ctx.strokeRect(x, y, Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
  } else if (s.type === 'arrow') {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy) || 1;
    const head = Math.min(len * 0.6, Math.max(s.width * 4, 18));
    const a = Math.atan2(dy, dx), spread = Math.PI / 7;
    const bx = s.x2 - Math.cos(a) * head * 0.8, by = s.y2 - Math.sin(a) * head * 0.8;
    ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(bx, by); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - head * Math.cos(a - spread), s.y2 - head * Math.sin(a - spread));
    ctx.lineTo(s.x2 - head * Math.cos(a + spread), s.y2 - head * Math.sin(a + spread));
    ctx.closePath(); ctx.lineWidth = Math.max(1, s.width * 0.5); ctx.fill(); ctx.stroke();
  } else if (s.type === 'text') {
    ctx.font = FONT.replace('{s}', Math.round(s.size));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = s.size * 0.2; ctx.strokeStyle = haloOf(s.color);
    ctx.strokeText(s.text, s.x, s.y);
    ctx.fillText(s.text, s.x, s.y);
  }
  ctx.restore();
}
let _measureCtx = null;
function textBox(s) {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = FONT.replace('{s}', Math.round(s.size));
  const w = _measureCtx.measureText(s.text).width + s.size * 0.4, h = s.size * 1.35;
  return { x: s.x - w / 2, y: s.y - h / 2, w, h };
}

/* Image aplatie (photo + annotations), même résolution que l'original */
async function renderFlattened(img, shapes, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  shapes.forEach(s => drawShape(ctx, s));
  const blob = await canvasToBlob(c, 'image/jpeg', 0.88);
  const thumb = await makeThumb(c, w, h);
  freeCanvas(c);
  return { blob, thumb };
}

/* ------------------------------------------------------------------ */
/* État et navigation                                                  */
/* ------------------------------------------------------------------ */
let current = null;        // chantier ouvert
let objectURLs = [];       // à révoquer lors des changements de vue
let saveTimer = null;
function revokeAll() { objectURLs.forEach(u => URL.revokeObjectURL(u)); objectURLs = []; }
function objURL(blobOrBuf) {
  const b = blobOrBuf instanceof Blob ? blobOrBuf : new Blob([blobOrBuf], { type: 'image/jpeg' });
  const u = URL.createObjectURL(b); objectURLs.push(u); return u;
}

function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
async function route() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/c\/([^/]+)(?:\/p\/([^/]+))?$/);
  await flushSave();
  if (m) {
    if (!current || current.id !== m[1]) {
      const c = await DB.getChantier(m[1]);
      if (!c) { go('#/'); return; }
      current = c;
      await showChantier();
    } else if ($('#view-chantier').hidden) {
      await showChantier();
    }
    if (m[2]) await Editor.open(m[2]);
    else if (Editor.isOpen) { Editor.close(true); revokeAll(); await renderPhotos(); }
  } else {
    Editor.close(true);
    if (current) { await discardIfEmpty(current); current = null; }
    await showHome();
  }
}
window.addEventListener('hashchange', () => { route().catch(err); });
function err(e) { console.error(e); busy(false); toast('Erreur : ' + (e && e.message ? e.message : e), 4000); }

/* ------------------------------------------------------------------ */
/* Accueil : liste des visites                                         */
/* ------------------------------------------------------------------ */
async function showHome() {
  revokeAll();
  document.body.classList.remove('in-chantier');
  $('#view-chantier').hidden = true; $('#view-home').hidden = false;
  $('#btn-back').hidden = true; $('#topbar-sub').textContent = 'Visites de chantier';
  document.title = 'Visite Chantier – ' + COMPANY;
  const list = await DB.allChantiers();
  const key = (c) => (c.date || '') + '|' + (c.createdAt || '');
  list.sort((a, b) => key(b).localeCompare(key(a)));
  const box = $('#list'); box.innerHTML = '';
  $('#empty').hidden = list.length > 0;
  for (const c of list) {
    const photos = await DB.photosOf(c.id);
    const first = photos[0];
    const el = document.createElement('div');
    el.className = 'item'; el.dataset.id = c.id;
    const thumb = first && first.thumb ? `style="background-image:url('${objURL(first.thumb)}')"` : '';
    el.innerHTML = `
      <button type="button" class="item-main" data-action="open" data-id="${esc(c.id)}">
        <div class="item-thumb" ${thumb}>${first ? '' : '🏠'}</div>
        <div class="item-txt">
          <div class="item-title">${esc(c.nom || 'Visite sans nom')}</div>
          <div class="item-line">${esc(c.client || 'Client non renseigné')}</div>
          <div class="item-line">${esc(fmtDate(c.date))} · ${photos.length} photo${photos.length > 1 ? 's' : ''}</div>
          ${c.adresse ? `<div class="item-line">📍 ${esc(c.adresse)}</div>` : ''}
        </div>
      </button>
      <button type="button" class="item-del" data-action="delete" data-id="${esc(c.id)}" aria-label="Supprimer la visite">🗑️</button>`;
    box.appendChild(el);
  }
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('#install-hint').hidden = !(ios && !standalone && !localStorage.getItem('hint-closed'));
}
$('#list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]'); if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.action === 'open') go('#/c/' + id);
  if (b.dataset.action === 'delete') {
    const c = await DB.getChantier(id);
    const ok = await confirmDialog(`Supprimer définitivement la visite « ${c && c.nom || 'sans nom'} » et toutes ses photos ?`, 'Supprimer', true);
    if (ok) { await DB.deleteChantier(id); toast('Visite supprimée'); showHome(); }
  }
});
$('#view-home').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="close-hint"]')) { localStorage.setItem('hint-closed', '1'); $('#install-hint').hidden = true; }
});
$('#btn-new').addEventListener('click', async () => {
  const now = new Date();
  const c = {
    id: uid(), nom: '', client: '', tel: '', email: '', date: localISO(now), adresse: '',
    lat: null, lon: null, precision: null, adresseSource: '', notes: '',
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  await DB.putChantier(c);
  current = c;
  go('#/c/' + c.id);
  // Localisation automatique à la création
  setTimeout(() => locate({ auto: true }), 300);
});

/* Une visite créée par erreur (aucune saisie) est supprimée au retour */
async function discardIfEmpty(c) {
  if (c.nom || c.client || c.tel || c.email || (c.notes && c.notes.trim())) return;
  const photos = await DB.photosOf(c.id);
  if (!photos.length) await DB.deleteChantier(c.id);
}

/* ------------------------------------------------------------------ */
/* Fiche chantier                                                      */
/* ------------------------------------------------------------------ */
const FIELDS = ['nom', 'client', 'tel', 'email', 'date', 'adresse', 'notes'];
async function showChantier() {
  revokeAll();
  document.body.classList.add('in-chantier');
  $('#view-home').hidden = true; $('#view-chantier').hidden = false;
  $('#btn-back').hidden = false;
  const f = $('#form');
  FIELDS.forEach(k => { f.elements[k].value = current[k] || ''; });
  updateTitle(); renderGps(); $('#loc-status').textContent = ''; $('#save-state').textContent = '';
  window.scrollTo(0, 0);
  await renderPhotos();
}
function updateTitle() {
  $('#topbar-sub').textContent = current.nom || 'Nouvelle visite';
  document.title = (current.nom || 'Visite') + ' – Visite Chantier';
}
function renderGps() {
  const c = current, info = $('#gps-info'), lnk = $('#lnk-map');
  if (c.lat != null && c.lon != null) {
    info.textContent = `GPS : ${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}${c.precision ? ` (± ${c.precision} m)` : ''}`;
    lnk.href = `https://maps.apple.com/?ll=${c.lat},${c.lon}&q=${encodeURIComponent(c.nom || 'Chantier')}`;
    lnk.hidden = false;
  } else { info.textContent = ''; lnk.hidden = true; }
}
$('#form').addEventListener('input', (e) => {
  const k = e.target.name;
  if (!current || !FIELDS.includes(k)) return;
  current[k] = e.target.value;
  if (k === 'nom') updateTitle();
  scheduleSave();
});
function scheduleSave() {
  $('#save-state').textContent = '…';
  clearTimeout(saveTimer); saveTimer = setTimeout(() => flushSave().catch(err), 500);
}
async function flushSave() {
  if (!saveTimer || !current) { saveTimer = null; return; }
  clearTimeout(saveTimer); saveTimer = null;
  current.updatedAt = new Date().toISOString();
  await DB.putChantier(current);
  const s = $('#save-state'); if (s) s.textContent = '✓ Enregistré';
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave().catch(() => {}); });
window.addEventListener('pagehide', () => { flushSave().catch(() => {}); });
$('#btn-back').addEventListener('click', () => go('#/'));
$('#btn-delete').addEventListener('click', async () => {
  const ok = await confirmDialog(`Supprimer définitivement cette visite et toutes ses photos ?`, 'Supprimer', true);
  if (!ok) return;
  clearTimeout(saveTimer); saveTimer = null;
  await DB.deleteChantier(current.id); current = null;
  toast('Visite supprimée'); go('#/');
});

/* ---- Géolocalisation + adresse ---- */
$('#btn-locate').addEventListener('click', () => locate({ auto: false }));
function getPosition() {
  return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }));
}
async function fetchJSON(url, ms = 8000) {
  const ctl = window.AbortController ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
/* Adresse à partir des coordonnées : Géoplateforme IGN (ex-API Adresse), puis api-adresse.data.gouv.fr, puis Nominatim */
async function reverseGeocode(lat, lon) {
  const ban = [
    `https://data.geopf.fr/geocodage/reverse?lon=${lon}&lat=${lat}&index=address&limit=1`,
    `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1`,
  ];
  for (const u of ban) {
    try {
      const j = await fetchJSON(u);
      const p = j && j.features && j.features[0] && j.features[0].properties;
      if (p && p.label) return { label: p.label, source: 'BAN' };
    } catch (e) { /* suivant */ }
  }
  try {
    const j = await fetchJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=fr&addressdetails=1&zoom=18`);
    if (j && j.address) {
      const a = j.address;
      const l1 = [a.house_number, a.road || a.pedestrian || a.hamlet].filter(Boolean).join(' ');
      const city = a.city || a.town || a.village || a.municipality || '';
      const label = [l1, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      if (label) return { label, source: 'OSM' };
    }
    if (j && j.display_name) return { label: j.display_name, source: 'OSM' };
  } catch (e) { /* hors ligne */ }
  return null;
}
let locating = false;
async function locate({ auto }) {
  if (!current || locating) return;
  const st = $('#loc-status'), btn = $('#btn-locate');
  if (!('geolocation' in navigator)) { st.textContent = 'Géolocalisation non disponible sur cet appareil.'; return; }
  if (!window.isSecureContext) { st.textContent = 'La localisation nécessite une connexion sécurisée (https).'; return; }
  const c = current;
  locating = true; btn.disabled = true; st.textContent = 'Localisation en cours…';
  try {
    let pos;
    try { pos = await getPosition(); }
    catch (e) {
      st.textContent = e && e.code === 1
        ? 'Localisation refusée. Autorisez-la dans Réglages › Confidentialité › Service de localisation.'
        : e && e.code === 3 ? 'Délai dépassé. Réessayez à l\'extérieur ou saisissez l\'adresse.'
        : 'Position indisponible. Saisissez l\'adresse manuellement.';
      return;
    }
    if (current !== c) return;
    c.lat = +pos.coords.latitude.toFixed(7); c.lon = +pos.coords.longitude.toFixed(7);
    c.precision = Math.round(pos.coords.accuracy || 0) || null;
    c.gpsAt = new Date().toISOString();
    renderGps(); scheduleSave();
    st.textContent = 'Recherche de l\'adresse…';
    const r = await reverseGeocode(c.lat, c.lon);
    if (current !== c) return;
    if (!r) { st.textContent = 'Coordonnées GPS enregistrées. Adresse introuvable (hors ligne ?) : saisissez-la.'; return; }
    const ta = $('#form').elements.adresse;
    const existing = (c.adresse || '').trim();
    let apply = !existing || existing === (c.adresseAuto || '');
    if (!apply && !auto) apply = await confirmDialog(`Remplacer l'adresse actuelle par : « ${r.label} » ?`, 'Remplacer');
    if (apply) {
      c.adresse = r.label; c.adresseAuto = r.label; c.adresseSource = r.source; ta.value = r.label; scheduleSave();
      st.textContent = 'Adresse trouvée (vérifiez-la et corrigez si besoin).';
    } else st.textContent = 'Adresse proposée : ' + r.label;
  } finally { locating = false; btn.disabled = false; }
}

/* ---- Photos ---- */
async function renderPhotos() {
  const photos = await DB.photosOf(current.id);
  $('#photo-count').textContent = photos.length ? `(${photos.length})` : '';
  const box = $('#photos'); box.innerHTML = '';
  photos.forEach((p, i) => {
    const el = document.createElement('div'); el.className = 'photo'; el.dataset.id = p.id;
    el.innerHTML = `
      <button type="button" class="photo-img" data-action="annotate" style="background-image:url('${p.thumb ? objURL(p.thumb) : ''}')" aria-label="Annoter la photo ${i + 1}">
        ${p.hasAnnot ? '<span class="badge">✏️ Annotée</span>' : ''}<span class="num">${i + 1}</span>
      </button>
      <div class="photo-body">
        <input type="text" class="caption" placeholder="Légende (ex. unité extérieure, tableau électrique…)" value="${esc(p.caption || '')}" autocapitalize="sentences">
        <div class="photo-actions">
          <button type="button" class="btn secondary" data-action="annotate">✏️ Annoter</button>
          <button type="button" class="btn ghost" data-action="del-photo" style="color:var(--red)">🗑️ Supprimer</button>
        </div>
      </div>`;
    box.appendChild(el);
  });
}
const captionTimers = {};
$('#photos').addEventListener('input', (e) => {
  if (!e.target.classList.contains('caption')) return;
  e.stopPropagation();
  const id = e.target.closest('.photo').dataset.id, val = e.target.value;
  $('#save-state').textContent = '…';
  clearTimeout(captionTimers[id]);
  captionTimers[id] = setTimeout(async () => {
    const p = await DB.getPhoto(id); if (!p) return;
    p.caption = val; await DB.putPhoto(p); $('#save-state').textContent = '✓ Enregistré';
  }, 400);
});
$('#photos').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]'); if (!b) return;
  const id = b.closest('.photo').dataset.id;
  if (b.dataset.action === 'annotate') go(`#/c/${current.id}/p/${id}`);
  if (b.dataset.action === 'del-photo') {
    if (await confirmDialog('Supprimer cette photo (et ses annotations) ?', 'Supprimer', true)) {
      await DB.deletePhoto(id); await renderPhotos(); toast('Photo supprimée');
    }
  }
});
async function addFiles(files) {
  files = Array.from(files || []).filter(f => !f.type || f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
  if (!files.length || !current) return;
  const c = current;
  let order = (await DB.photosOf(c.id)).reduce((m, p) => Math.max(m, p.order || 0), 0);
  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    busy(true, files.length > 1 ? `Traitement des photos ${i + 1}/${files.length}…` : 'Traitement de la photo…');
    try {
      const r = await processFile(files[i]);
      const meta = {
        id: uid(), chantierId: c.id, createdAt: new Date().toISOString(), order: ++order,
        caption: '', width: r.w, height: r.h, annotations: [], hasAnnot: false,
        thumb: await blobToBuf(r.thumb), origThumb: null,
      };
      await DB.savePhotoWithFiles(meta, { orig: r.blob });
      ok++;
    } catch (e) { console.error(e); fail++; }
  }
  busy(false);
  if (current === c) await renderPhotos();
  if (fail) toast(`${fail} photo(s) n'ont pas pu être lues (format non pris en charge ?)`, 4000);
  else toast(ok > 1 ? `${ok} photos ajoutées` : 'Photo ajoutée');
}
['#in-camera', '#in-library'].forEach(sel => {
  $(sel).addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    try { await addFiles(files); } catch (x) { err(x); }
  });
});

/* ------------------------------------------------------------------ */
/* Éditeur d'annotations                                               */
/* ------------------------------------------------------------------ */
const Editor = (() => {
  const root = $('#editor'), stage = $('#ed-stage'), cBase = $('#ed-base'), cDraw = $('#ed-draw');
  let photo = null, img = null, imgURL = null;
  let shapes = [], history = [], initialJSON = '[]';
  let tool = 'pen', color = '#e53935', widthIdx = 1;
  let k = 1, dpr = 1, iw = 0, ih = 0;
  let activeId = null, drawing = null, drag = null, raf = 0, isOpen = false, savedScroll = 0;

  const longSide = () => Math.max(iw, ih);
  const snapshot = () => { history.push(JSON.stringify(shapes)); if (history.length > 100) history.shift(); updateButtons(); };
  function updateButtons() {
    $('#ed-undo').disabled = history.length === 0;
    $('#ed-clear').disabled = shapes.length === 0;
  }
  const hints = {
    pen: 'Dessinez avec le doigt.',
    arrow: 'Glissez du départ vers la pointe de la flèche.',
    rect: 'Glissez pour tracer un cadre.',
    text: 'Touchez l\'endroit du texte. Glissez un texte pour le déplacer, touchez-le pour le modifier.',
  };
  function setTool(t) {
    tool = t;
    $$('.tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    $('#ed-hint').textContent = hints[t];
  }

  function layout() {
    if (!img) return;
    const r = stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    k = Math.min(r.width / iw, r.height / ih);
    const cw = Math.max(1, Math.floor(iw * k)), ch = Math.max(1, Math.floor(ih * k));
    const left = Math.floor((r.width - cw) / 2), top = Math.floor((r.height - ch) / 2);
    [cBase, cDraw].forEach(c => {
      c.style.left = left + 'px'; c.style.top = top + 'px';
      c.style.width = cw + 'px'; c.style.height = ch + 'px';
      c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
    });
    const b = cBase.getContext('2d');
    b.imageSmoothingQuality = 'high';
    b.drawImage(img, 0, 0, cBase.width, cBase.height);
    render();
  }
  function render() {
    raf = 0;
    const ctx = cDraw.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cDraw.width, cDraw.height);
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    shapes.forEach(s => drawShape(ctx, s));
    if (drawing) drawShape(ctx, drawing);
    if (drag && drag.shape) { // cadre de sélection du texte déplacé
      const bx = textBox(drag.shape);
      ctx.save(); ctx.setLineDash([8 / k, 6 / k]); ctx.lineWidth = 2 / k; ctx.strokeStyle = '#64b5f6';
      ctx.strokeRect(bx.x, bx.y, bx.w, bx.h); ctx.restore();
    }
  }
  const requestRender = () => { if (!raf) raf = requestAnimationFrame(render); };

  function toImg(e) {
    const r = cDraw.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / k * 10) / 10, Math.round((e.clientY - r.top) / k * 10) / 10];
  }
  function hitText(x, y) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i]; if (s.type !== 'text') continue;
      const b = textBox(s), m = 12 / k;
      if (x >= b.x - m && x <= b.x + b.w + m && y >= b.y - m && y <= b.y + b.h + m) return s;
    }
    return null;
  }

  function onDown(e) {
    if (!isOpen) return;
    if (activeId !== null) return;          // un seul doigt à la fois (ignore la paume / 2e doigt)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    activeId = e.pointerId;
    try { stage.setPointerCapture(e.pointerId); } catch (x) {}
    const [x, y] = toImg(e);
    const w = Math.max(2, longSide() * WIDTH_F[widthIdx]);
    if (tool === 'pen') drawing = { type: 'pen', color, width: w, points: [[x, y]] };
    else if (tool === 'arrow' || tool === 'rect') drawing = { type: tool, color, width: w, x1: x, y1: y, x2: x, y2: y };
    else if (tool === 'text') {
      const hit = hitText(x, y);
      drag = { shape: hit, sx: x, sy: y, ox: hit ? hit.x : 0, oy: hit ? hit.y : 0, moved: false, startX: e.clientX, startY: e.clientY };
    }
    requestRender();
  }
  function onMove(e) {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    const evs = (e.getCoalescedEvents && tool === 'pen') ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const [x, y] = toImg(ev);
      if (drawing && drawing.type === 'pen') {
        const l = drawing.points[drawing.points.length - 1];
        if (Math.hypot(x - l[0], y - l[1]) * k >= 1.5) drawing.points.push([x, y]);
      } else if (drawing) { drawing.x2 = x; drawing.y2 = y; }
      else if (drag && drag.shape) {
        if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) > 6) { drag.moved = true; snapshot(); }
        if (drag.moved) { drag.shape.x = drag.ox + (x - drag.sx); drag.shape.y = drag.oy + (y - drag.sy); }
      } else if (drag && !drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) > 10) drag.moved = true;
    }
    requestRender();
  }
  function onUp(e) {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    activeId = null;
    try { stage.releasePointerCapture(e.pointerId); } catch (x) {}
    const cancelled = e.type === 'pointercancel';
    if (drawing) {
      const d = drawing; drawing = null;
      let keep = !cancelled || d.type === 'pen';
      if (d.type !== 'pen' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) * k < 8) keep = false;
      if (keep) { snapshot(); shapes.push(d); }
    } else if (drag) {
      const d = drag; drag = null;
      if (!cancelled && !d.moved) {
        if (d.shape) editText(d.shape);
        else addText(d.sx, d.sy);
      } else if (d.moved && d.shape) { // garde le texte dans l'image
        d.shape.x = Math.round(Math.min(Math.max(d.shape.x, 0), iw)); d.shape.y = Math.round(Math.min(Math.max(d.shape.y, 0), ih));
      }
    }
    updateButtons(); requestRender();
  }
  async function addText(x, y) {
    const t = await promptText({ title: 'Ajouter un texte', placeholder: 'ex. Unité extérieure ici', okLabel: 'Placer' });
    if (!t) return;
    snapshot();
    shapes.push({ type: 'text', color, size: Math.round(longSide() * TEXT_F[widthIdx]), x, y, text: t });
    updateButtons(); requestRender();
    $('#ed-hint').textContent = 'Glissez le texte pour le déplacer. Touchez-le pour le modifier.';
  }
  async function editText(s) {
    const t = await promptText({ title: 'Modifier le texte', value: s.text, okLabel: 'OK', extra: { label: 'Supprimer', value: '\u0000del' } });
    if (t === null || t === undefined) return;
    snapshot();
    if (t === '\u0000del' || t === '') shapes.splice(shapes.indexOf(s), 1);
    else { s.text = t; s.color = color; }
    updateButtons(); requestRender();
  }

  // Événements pointeur sur la zone de dessin
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('lostpointercapture', (e) => { if (e.pointerId === activeId) onUp(e); });
  // Empêche le défilement / zoom / loupe d'iOS pendant le dessin
  ['touchstart', 'touchmove', 'touchend'].forEach(t => stage.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false }));
  ['gesturestart', 'gesturechange'].forEach(t => root.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  root.addEventListener('touchmove', (e) => { if (!e.target.closest('.ed-bar') && e.cancelable) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  $$('.tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $$('.color').forEach(b => b.addEventListener('click', () => {
    color = b.dataset.color; $$('.color').forEach(x => x.classList.toggle('active', x === b));
  }));
  $$('.width').forEach(b => b.addEventListener('click', () => {
    widthIdx = +b.dataset.width; $$('.width').forEach(x => x.classList.toggle('active', x === b));
  }));
  $('#ed-undo').addEventListener('click', () => {
    if (!history.length) return;
    shapes = JSON.parse(history.pop()); updateButtons(); requestRender();
  });
  $('#ed-clear').addEventListener('click', async () => {
    if (!shapes.length) return;
    if (!await confirmDialog('Effacer toutes les annotations de cette photo ? (la photo d\'origine est conservée)', 'Tout effacer', true)) return;
    snapshot(); shapes = []; updateButtons(); requestRender();
  });
  $('#ed-close').addEventListener('click', async () => {
    if (JSON.stringify(shapes) !== initialJSON &&
        !await confirmDialog('Quitter sans enregistrer les annotations ?', 'Quitter', true)) return;
    leave();
  });
  $('#ed-save').addEventListener('click', () => save().catch(err));
  window.addEventListener('resize', () => { if (isOpen) setTimeout(layout, 50); });
  window.addEventListener('orientationchange', () => { if (isOpen) setTimeout(layout, 300); });

  function leave() { if (current) go('#/c/' + current.id); else go('#/'); }

  async function open(photoId) {
    const p = await DB.getPhoto(photoId);
    if (!p) { toast('Photo introuvable'); leave(); return; }
    busy(true, 'Ouverture de la photo…');
    try {
      const blob = await DB.getFile(p.id + ':orig');
      if (!blob) throw new Error('Fichier photo manquant');
      if (imgURL) URL.revokeObjectURL(imgURL);
      imgURL = URL.createObjectURL(blob);
      img = await loadImage(imgURL);
    } catch (e) { busy(false); err(e); leave(); return; }
    busy(false);
    photo = p; iw = img.naturalWidth; ih = img.naturalHeight;
    shapes = JSON.parse(JSON.stringify(p.annotations || [])); history = []; initialJSON = JSON.stringify(shapes);
    drawing = null; drag = null; activeId = null;
    savedScroll = window.scrollY;
    $('#toast').hidden = true;
    root.hidden = false; isOpen = true;
    document.body.classList.add('no-scroll');
    setTool(tool); updateButtons();
    requestAnimationFrame(layout);
  }
  function close(silent) {
    if (!isOpen) return;
    isOpen = false; root.hidden = true; document.body.classList.remove('no-scroll');
    requestAnimationFrame(() => window.scrollTo(0, savedScroll));
    freeCanvas(cBase); freeCanvas(cDraw);
    img = null; photo = null; shapes = []; history = [];
    if (imgURL) { URL.revokeObjectURL(imgURL); imgURL = null; }
  }
  async function save() {
    if (!photo || !img) return;
    busy(true, 'Enregistrement…');
    try {
      const p = await DB.getPhoto(photo.id) || photo;
      p.annotations = JSON.parse(JSON.stringify(shapes));
      p.hasAnnot = shapes.length > 0;
      let annot = null, thumb;
      if (p.hasAnnot) { const r = await renderFlattened(img, shapes, iw, ih); annot = r.blob; thumb = r.thumb; }
      else thumb = await makeThumb(img, iw, ih);
      p.thumb = await blobToBuf(thumb);
      p.updatedAt = new Date().toISOString();
      await DB.savePhotoWithFiles(p, { annot });
      initialJSON = JSON.stringify(shapes);
      busy(false);
      toast(p.hasAnnot ? 'Annotations enregistrées' : 'Annotations supprimées');
      leave();
    } catch (e) { busy(false); throw e; }
  }
  window.__edShapes = () => JSON.parse(JSON.stringify(shapes)); // inspection (tests automatiques)
  return { open, close, get isOpen() { return isOpen; } };
})();

/* ------------------------------------------------------------------ */
/* Export ZIP + partage                                                */
/* ------------------------------------------------------------------ */
function reportHTML(c, items) {
  const gps = c.lat != null ? `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}` : '';
  const row = (k, v) => v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '';
  const figs = items.map(it => `
    <figure>
      <a href="${esc(it.annotee || it.original)}"><img src="${esc(it.annotee || it.original)}" alt="Photo ${it.numero}"></a>
      <figcaption><b>Photo ${it.numero}</b>${it.legende ? ' – ' + esc(it.legende) : ''}
        ${it.annotee ? `<br><small>Annotée · <a href="${esc(it.original)}">voir l'original</a></small>` : ''}</figcaption>
    </figure>`).join('');
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compte-rendu de visite – ${esc(c.nom || 'Chantier')}</title>
<style>
body{font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2430;max-width:900px;margin:0 auto;padding:20px}
header{border-bottom:3px solid #1565c0;padding-bottom:10px;margin-bottom:16px}
header .co{color:#1565c0;font-weight:700;font-size:18px} h1{font-size:22px;margin:6px 0 0}
table{border-collapse:collapse;width:100%;margin-bottom:16px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e3e8ee;vertical-align:top}
th{width:150px;color:#5a6677;font-weight:600} h2{font-size:17px;color:#0d47a1;margin:22px 0 8px}
.notes{white-space:pre-wrap;background:#f6f8fa;border-radius:8px;padding:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
figure{margin:0;border:1px solid #e3e8ee;border-radius:8px;overflow:hidden;break-inside:avoid}
figure img{width:100%;display:block} figcaption{padding:8px 10px;font-size:14px}
footer{margin-top:30px;color:#8a94a3;font-size:12px;text-align:center}
@media print{body{padding:0}a{color:inherit;text-decoration:none}}
</style></head><body>
<header><div class="co">${esc(COMPANY)}</div><h1>Compte-rendu de visite${c.nom ? ' – ' + esc(c.nom) : ''}</h1></header>
<table>
${row('Chantier', esc(c.nom))}${row('Client', esc(c.client))}${row('Téléphone', c.tel ? `<a href="tel:${esc(c.tel.replace(/\s/g, ''))}">${esc(c.tel)}</a>` : '')}
${row('E-mail', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '')}${row('Date de visite', esc(fmtDate(c.date)))}
${row('Adresse', esc(c.adresse).replace(/\n/g, '<br>'))}
${row('Coordonnées GPS', gps ? `<a href="https://www.google.com/maps?q=${c.lat},${c.lon}">${gps}</a>${c.precision ? ` (± ${c.precision} m)` : ''}` : '')}
${row('Photos', String(items.length))}
</table>
<h2>Notes</h2><div class="notes">${c.notes ? esc(c.notes) : '<i>Aucune note.</i>'}</div>
<h2>Photos</h2>${items.length ? `<div class="grid">${figs}</div>` : '<p><i>Aucune photo.</i></p>'}
<footer>Généré le ${esc(fmtDate(new Date()))} avec l'application Visite Chantier – ${esc(COMPANY)}</footer>
</body></html>`;
}
async function buildZip(chantierId) {
  if (!window.JSZip) throw new Error('Module ZIP indisponible');
  await flushSave();
  const c = await DB.getChantier(chantierId);
  const photos = await DB.photosOf(chantierId);
  const zip = new JSZip();
  const items = [];
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    busy(true, `Préparation du dossier… (${i + 1}/${photos.length})`);
    const base = `photo-${pad(i + 1)}${p.caption ? '-' + slug(p.caption) : ''}.jpg`;
    const orig = await DB.getFile(p.id + ':orig');
    if (!orig) continue;
    zip.file('originals/' + base, await blobToBuf(orig), { binary: true });
    let annotee = null;
    if (p.hasAnnot) {
      const a = await DB.getFile(p.id + ':annot');
      if (a) { zip.file('annotees/' + base, await blobToBuf(a), { binary: true }); annotee = 'annotees/' + base; }
    }
    items.push({
      numero: i + 1, legende: p.caption || '', original: 'originals/' + base, annotee,
      largeur: p.width, hauteur: p.height, ajoutee_le: p.createdAt, annotations: p.annotations || [],
    });
  }
  zip.folder('originals'); zip.folder('annotees');
  const data = {
    application: 'Visite Chantier – ' + COMPANY, version: APP_VERSION, exporte_le: new Date().toISOString(),
    chantier: {
      id: c.id, nom: c.nom || '', client: c.client || '', telephone: c.tel || '', email: c.email || '',
      date: c.date || '', adresse: c.adresse || '',
      gps: c.lat != null ? { latitude: c.lat, longitude: c.lon, precision_m: c.precision, releve_le: c.gpsAt || null } : null,
      notes: c.notes || '', cree_le: c.createdAt, modifie_le: c.updatedAt,
    },
    photos: items.map(it => ({ ...it, annotations_format: 'coordonnées en pixels de l\'image originale' })),
  };
  zip.file('chantier.json', JSON.stringify(data, null, 2), { compression: 'DEFLATE' });
  zip.file('compte-rendu.html', reportHTML(c, items), { compression: 'DEFLATE' });
  busy(true, 'Compression du dossier…');
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'STORE' });
  const d = (c.date || '').slice(0, 10) || localISO().slice(0, 10);
  const name = `visite-${d}-${slug(c.nom || c.client || 'chantier', 30) || 'chantier'}.zip`;
  return { blob, name, chantier: c };
}
function canShareFile(file) {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { return false; }
}
function download(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
async function shareFile(file, c) {
  await navigator.share({ files: [file], title: `Visite chantier – ${c.nom || c.client || ''}`.trim() });
}
window.__lastExport = null; // utilisé par les tests automatiques
$('#btn-export').addEventListener('click', async () => {
  if (!current) return;
  const btn = $('#btn-export'); btn.disabled = true;
  let res;
  try { res = await buildZip(current.id); } catch (e) { btn.disabled = false; err(e); return; }
  busy(false); btn.disabled = false;
  window.__lastExport = res;
  const file = new File([res.blob], res.name, { type: 'application/zip' });
  const shareable = canShareFile(file);
  if (shareable) {
    try { await shareFile(file, res.chantier); toast('Dossier envoyé'); return; }
    catch (e) {
      if (e && e.name === 'AbortError') return;    // l'utilisateur a fermé la feuille de partage
      // NotAllowedError : le geste a expiré pendant la préparation → on propose un 2e bouton
    }
  }
  const choice = await modal({
    title: 'Dossier prêt',
    html: `<p><b>${esc(res.name)}</b><br><span class="muted">${fmtSize(res.blob.size)}</span></p>
           <p class="muted small">${shareable ? 'Touchez « Partager » pour l\'envoyer par Mail, Messages, AirDrop ou l\'enregistrer dans Fichiers.' : 'Le partage direct n\'est pas disponible sur ce navigateur : touchez « Télécharger ».'}</p>`,
    buttons: [
      { label: 'Fermer', value: null },
      { label: 'Télécharger', value: 'dl', cls: shareable ? 'ghost' : 'primary' },
      ...(shareable ? [{ label: 'Partager…', value: 'share', cls: 'primary', onClick: () => {
        shareFile(file, res.chantier).then(() => toast('Dossier envoyé')).catch(e => {
          if (!e || e.name !== 'AbortError') { toast('Partage impossible : téléchargement du fichier'); download(res.blob, res.name); }
        });
      } }] : []),
    ],
  });
  if (choice === 'dl') download(res.blob, res.name);
});

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)); });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
window.__app = { DB, version: APP_VERSION };
route().catch(err);
})();
