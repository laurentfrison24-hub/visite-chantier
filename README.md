# Visite Chantier – Pyrénées Énergies Solutions

PWA (application web installable) pour les visites de chantier : fiche chantier, adresse GPS,
notes (dictée iOS), photos annotées, export ZIP partagé via la feuille de partage iOS.

- `app/` : le site statique à publier tel quel (HTML/CSS/JS, aucune dépendance serveur).
  - `index.html`, `styles.css`, `app.js`, `sw.js` (hors ligne), `manifest.json`, `icons/`, `vendor/jszip.min.js`
- `test/e2e.js` : test Playwright (Chromium, émulation iPhone 13) ; `test/wk.js` : test rapide WebKit.
- `tools/make_icons.py` : génération des icônes.
- `deploy-github-pages.sh` : publication sur GitHub Pages (nécessite `gh auth login`).

Lancer en local : `cd app && python3 -m http.server 8765` puis http://127.0.0.1:8765/
Tests : `cd test && npm i && node e2e.js` (serveur local lancé).

Mise à jour : modifier les fichiers, puis incrémenter `CACHE` dans `app/sw.js` pour que les iPhones récupèrent la nouvelle version.
