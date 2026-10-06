// Test de bout en bout – Visite Chantier (Chromium, émulation iPhone 13)
const { chromium, devices } = require('playwright-core');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SHOTS = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const hideToast = (page) => page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; });
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris',
    geolocation: { latitude: 42.698656, longitude: 2.895392, accuracy: 12 }, permissions: ['geolocation'],
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);

  await page.goto(BASE);
  await page.waitForSelector('#view-home:not([hidden])');
  check('Accueil affiché, liste vide', await page.isVisible('#empty'));
  check('Nom de la société dans l\'en-tête', (await page.textContent('.brand-name')).includes('Pyrénées Énergies Solutions'));

  // --- Création d'une visite ---
  await page.click('#btn-new');
  await page.waitForSelector('#view-chantier:not([hidden])');
  const dateVal = await page.inputValue('input[name=date]');
  check('Date remplie automatiquement', /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(dateVal), dateVal);
  await page.waitForFunction(() => document.querySelector('textarea[name=adresse]').value.length > 0, null, { timeout: 25000 }).catch(() => {});
  const adr = await page.inputValue('textarea[name=adresse]');
  check('Adresse auto via géolocalisation + géocodage inverse', /Perpignan/i.test(adr), adr);
  check('Coordonnées GPS affichées', /42\.69/.test(await page.textContent('#gps-info')), await page.textContent('#gps-info'));
  await page.fill('input[name=nom]', 'PAC air/eau – Maison Dupont');
  await page.fill('input[name=client]', 'M. et Mme Dupont');
  await page.fill('input[name=tel]', '06 12 34 56 78');
  await page.fill('input[name=email]', 'dupont@example.fr');
  await page.fill('textarea[name=notes]', 'Chaudière fioul à remplacer.\nUnité extérieure côté jardin, prévoir support mural.\nTableau électrique : place disponible.');

  // --- Ajout de photos (appareil + photothèque) ---
  await page.setInputFiles('#in-camera', path.join(__dirname, 'test-photo.jpg'));
  await page.waitForFunction(() => document.querySelectorAll('#photos .photo').length === 1, null, { timeout: 20000 });
  await page.setInputFiles('#in-library', [path.join(__dirname, 'test-photo-portrait.jpg')]);
  await page.waitForFunction(() => document.querySelectorAll('#photos .photo').length === 2, null, { timeout: 20000 });
  check('2 photos ajoutées (appareil + photothèque)', true);
  await page.fill('#photos .photo:nth-child(1) .caption', 'Unité extérieure');
  await page.fill('#photos .photo:nth-child(2) .caption', 'Tableau électrique');
  await page.waitForTimeout(800);
  const dims = await page.evaluate(async () => {
    const c = location.hash.split('/')[2];
    const ps = await window.__app.DB.photosOf(c);
    return ps.map(p => ({ w: p.width, h: p.height, caption: p.caption }));
  });
  check('Photo réduite à 2000 px max (4032x3024 → 2000x1500)', dims[0].w === 2000 && dims[0].h === 1500, JSON.stringify(dims));
  check('Légendes enregistrées', dims[0].caption === 'Unité extérieure' && dims[1].caption === 'Tableau électrique');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await hideToast(page); await page.screenshot({ path: path.join(SHOTS, '02-fiche-chantier.png') });
  await page.screenshot({ path: path.join(SHOTS, '02b-fiche-chantier-complete.png'), fullPage: true });

  // --- Éditeur d'annotations ---
  await page.click('#photos .photo:nth-child(1) [data-action=annotate].btn');
  await page.waitForSelector('#editor:not([hidden])');
  await page.waitForTimeout(400);
  const box = await page.locator('#ed-draw').boundingBox();
  const P = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  async function touchDrag(pts, steps = 12) {
    const tp = (p) => [{ x: p.x, y: p.y, id: 1, radiusX: 5, radiusY: 5, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts[0]) });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (let s = 1; s <= steps; s++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp({ x: a.x + (b.x - a.x) * s / steps, y: a.y + (b.y - a.y) * s / steps }) });
      }
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(80);
  }
  const count = () => page.evaluate(() => window.__edCount ? window.__edCount() : null);
  // Stylo (rouge) : tracé au doigt
  await touchDrag([P(0.25, 0.30), P(0.35, 0.22), P(0.45, 0.35), P(0.55, 0.25)]);
  // Flèche (bleu, épais)
  await page.click('.tool[data-tool=arrow]');
  await page.click('.color[data-color="#1e88e5"]');
  await page.click('.width[data-width="2"]');
  await touchDrag([P(0.15, 0.85), P(0.38, 0.6)]);
  // Rectangle (orange)
  await page.click('.tool[data-tool=rect]');
  await page.click('.color[data-color="#fb8c00"]');
  await touchDrag([P(0.28, 0.42), P(0.58, 0.68)]);
  // Texte (blanc) : toucher, saisir, placer puis glisser
  await page.click('.tool[data-tool=text]');
  await page.click('.color[data-color="#ffffff"]');
  await page.click('.width[data-width="1"]');
  await page.touchscreen.tap(P(0.7, 0.2).x, P(0.7, 0.2).y);
  await page.waitForSelector('#modal:not([hidden]) #modal-input');
  await page.fill('#modal-input', 'Unité ext. à déplacer');
  await page.click('#modal-actions .btn.primary');
  await page.waitForTimeout(200);
  await touchDrag([P(0.7, 0.2), P(0.62, 0.12)]);
  // Trait supplémentaire puis annulation
  await page.click('.tool[data-tool=pen]');
  await touchDrag([P(0.8, 0.8), P(0.9, 0.9)]);
  const shapesBeforeUndo = await page.evaluate(() => window.__edShapes());
  await page.click('#ed-undo');
  const shapesAfterUndo = await page.evaluate(() => window.__edShapes());
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check('Dessin au doigt : stylo, flèche, cadre, texte créés', JSON.stringify(shapesAfterUndo.map(s => s.type)) === '["pen","arrow","rect","text"]', JSON.stringify(shapesAfterUndo.map(s => s.type)));
  check('Annuler retire la dernière forme', shapesBeforeUndo.length === 5 && shapesAfterUndo.length === 4);
  const txt = shapesAfterUndo.find(s => s.type === 'text');
  check('Texte déplacé par glisser', txt && txt.y < 1500 * 0.17 && txt.x < 2000 * 0.66, txt && `x=${Math.round(txt.x)} y=${Math.round(txt.y)}`);
  check('Pas de défilement de la page pendant le dessin', scrollBefore === scrollAfter, `${scrollBefore} → ${scrollAfter}`);
  check('Couleurs/épaisseurs appliquées', shapesAfterUndo[1].color === '#1e88e5' && shapesAfterUndo[1].width > shapesAfterUndo[0].width && shapesAfterUndo[2].color === '#fb8c00');
  await hideToast(page); await page.screenshot({ path: path.join(SHOTS, '03-editeur-annotation.png') });
  const wbtn = await page.locator('.width[data-width="2"]').boundingBox();
  check('Barre d\'outils entièrement visible (390 px)', wbtn && wbtn.x + wbtn.width <= 390, JSON.stringify(wbtn));
  await page.click('#ed-save');
  await page.waitForSelector('#editor', { state: 'hidden' });
  await page.waitForTimeout(300);
  const saved = await page.evaluate(async () => {
    const c = location.hash.split('/')[2];
    const ps = await window.__app.DB.photosOf(c);
    return ps.map(p => ({ hasAnnot: p.hasAnnot, n: p.annotations.length }));
  });
  check('Annotations enregistrées comme calque séparé', saved[0].hasAnnot && saved[0].n === 4 && !saved[1].hasAnnot, JSON.stringify(saved));
  check('Badge « Annotée » sur la vignette', await page.isVisible('#photos .photo:nth-child(1) .badge'));

  // Ré-édition : les annotations se rechargent et restent modifiables
  await page.click('#photos .photo:nth-child(1) .photo-img');
  await page.waitForSelector('#editor:not([hidden])');
  await page.waitForTimeout(300);
  const reloaded = await page.evaluate(() => window.__edShapes().length);
  check('Ré-édition : annotations rechargées', reloaded === 4, String(reloaded));
  await page.click('#ed-close'); // pas de modification → ferme directement
  await page.waitForSelector('#editor', { state: 'hidden' });

  // Annotation simple de la photo 2 puis effacement total (=> retour à l'original)
  await page.click('#photos .photo:nth-child(2) .photo-img');
  await page.waitForSelector('#editor:not([hidden])');
  await page.waitForTimeout(300);
  const box2 = await page.locator('#ed-draw').boundingBox();
  await page.mouse.move(box2.x + 50, box2.y + 50); await page.mouse.down(); await page.mouse.move(box2.x + 150, box2.y + 120, { steps: 8 }); await page.mouse.up();
  await page.click('#ed-clear');
  await page.click('#modal-actions .btn.danger');
  check('Effacer tout', (await page.evaluate(() => window.__edShapes().length)) === 0);
  await page.click('#ed-undo');
  check('Annuler après Effacer restaure', (await page.evaluate(() => window.__edShapes().length)) === 1);
  await page.click('#ed-save');
  await page.waitForSelector('#editor', { state: 'hidden' });

  // --- Export ZIP ---
  await page.click('#btn-export');
  await page.waitForSelector('#modal:not([hidden])', { timeout: 30000 });
  await page.screenshot({ path: path.join(SHOTS, '04-dossier-pret.png') });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#modal-actions .btn:has-text("Télécharger")')]);
  const zipPath = path.join(__dirname, 'export-test.zip');
  await dl.saveAs(zipPath);
  check('ZIP téléchargé (repli sans Web Share)', fs.existsSync(zipPath), dl.suggestedFilename());
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
  console.log('  Contenu du ZIP :', names.join(', '));
  const data = JSON.parse(await zip.file('chantier.json').async('string'));
  check('chantier.json complet', data.chantier.nom === 'PAC air/eau – Maison Dupont' && data.chantier.client === 'M. et Mme Dupont'
    && data.chantier.telephone && data.chantier.email && data.chantier.gps && data.chantier.gps.latitude > 42 && /Perpignan/.test(data.chantier.adresse)
    && /Chaudière/.test(data.chantier.notes) && data.photos.length === 2 && data.photos[0].legende === 'Unité extérieure', JSON.stringify(data.chantier).slice(0, 200));
  check('originals/ contient 2 JPEG', names.filter(n => n.startsWith('originals/') && n.endsWith('.jpg')).length === 2);
  check('annotees/ contient 2 JPEG', names.filter(n => n.startsWith('annotees/') && n.endsWith('.jpg')).length === 2);
  check('compte-rendu.html présent', names.includes('compte-rendu.html'));
  for (const n of names.filter(n => n.endsWith('.jpg'))) {
    const buf = await zip.file(n).async('nodebuffer');
    fs.mkdirSync(path.join(__dirname, 'zip-out', path.dirname(n)), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'zip-out', n), buf);
  }
  fs.writeFileSync(path.join(__dirname, 'zip-out', 'compte-rendu.html'), await zip.file('compte-rendu.html').async('string'));
  fs.writeFileSync(path.join(__dirname, 'zip-out', 'chantier.json'), JSON.stringify(data, null, 2));
  await page.click('#modal-actions .btn:has-text("Fermer")').catch(() => {});

  // Web Share : simule un navigateur qui supporte le partage de fichiers (comme Safari iOS)
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = (d) => !!(d && d.files);
    navigator.share = async (d) => { window.__shared = { n: d.files.length, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }; };
  });
  await page.click('#btn-export');
  await page.waitForFunction(() => window.__shared, null, { timeout: 30000 });
  const shared = await page.evaluate(() => window.__shared);
  check('navigator.share({files}) appelé avec le ZIP', shared.n === 1 && shared.type === 'application/zip' && shared.name.endsWith('.zip'), JSON.stringify(shared));

  // --- Retour à l'accueil, 2e visite, suppression ---
  await page.click('#btn-back');
  await page.waitForSelector('#view-home:not([hidden])');
  await page.click('#btn-new');
  await page.waitForSelector('#view-chantier:not([hidden])');
  await page.fill('input[name=nom]', 'Clim réversible – Bureau Carcassonne');
  await page.fill('input[name=client]', 'SARL Aude Conseil');
  await page.fill('textarea[name=adresse]', '12 rue de Verdun 11000 Carcassonne');
  await page.waitForTimeout(700);
  await page.click('#btn-back');
  await page.waitForSelector('#view-home:not([hidden])');
  await page.click('#btn-new');
  await page.waitForSelector('#view-chantier:not([hidden])');
  await page.fill('input[name=nom]', 'Chauffe-eau thermodynamique – Foix');
  await page.fill('input[name=client]', 'Mme Martin');
  await page.waitForTimeout(700);
  await page.click('#btn-back');
  await page.waitForSelector('#view-home:not([hidden])');
  await page.click('#btn-new'); await page.waitForSelector('#view-chantier:not([hidden])');
  await page.click('#btn-back'); await page.waitForSelector('#view-home:not([hidden])');
  await page.waitForTimeout(300);
  let n = await page.locator('.item').count();
  check('Visite vide supprimée automatiquement, 3 visites listées', n === 3, String(n));
  const firstTitle = await page.textContent('.item:first-child .item-title');
  check('Liste triée, la plus récente en premier', /Foix/.test(firstTitle), firstTitle);
  await page.waitForTimeout(2700); await hideToast(page); await page.screenshot({ path: path.join(SHOTS, '01-accueil.png') });
  await page.click('.item:nth-child(1) .item-del');
  await page.waitForSelector('#modal:not([hidden])');
  await page.click('#modal-actions .btn.danger');
  await page.waitForTimeout(400);
  n = await page.locator('.item').count();
  check('Suppression avec confirmation', n === 2, String(n));

  // Persistance après rechargement
  await page.reload(); await page.waitForSelector('#view-home:not([hidden])');
  check('Données conservées après rechargement', (await page.locator('.item').count()) === 2);

  // --- Hors ligne (service worker) ---
  const swOk = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  check('Service worker actif', swOk);
  await ctx.setOffline(true);
  await page.reload(); await page.waitForSelector('#view-home:not([hidden])', { timeout: 10000 });
  check('Application chargée hors ligne', (await page.locator('.item').count()) === 2);
  await page.click('.item:nth-child(2) .item-main');
  await page.waitForSelector('#view-chantier:not([hidden])');
  check('Fiche ouverte hors ligne, photos visibles', (await page.locator('#photos .photo').count()) === 2);
  await ctx.setOffline(false);

  // Manifest
  const man = await (await page.request.get(BASE + 'manifest.json')).json();
  check('manifest.json (name/short_name/icônes)', man.name === 'Visite Chantier' && man.short_name === 'Visites' && man.icons.length >= 3);

  const realErrors = errors.filter(e => !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
  check('Aucune erreur JavaScript', realErrors.length === 0, realErrors.join(' | '));
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests réussis`);
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
