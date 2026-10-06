# Visite Chantier – Pyrénées Énergies Solutions

PWA (application web installable) pour les visites de chantier : fiche chantier, adresse GPS,
notes (dictée iOS), photos annotées, envoi du dossier à Aide Chantier.

- `app/` : le site statique à publier tel quel (HTML/CSS/JS, aucune dépendance serveur).
  - `index.html`, `styles.css`, `app.js`, `sw.js` (hors ligne), `manifest.json`, `icons/`, `vendor/jszip.min.js`
- `test/e2e.js` : test Playwright (Chromium, émulation iPhone 13) ; `test/wk.js` : test rapide WebKit.
- `tools/make_icons.py` : génération des icônes.
- `deploy-github-pages.sh` : publication sur GitHub Pages (nécessite `gh auth login`).

Lancer en local : `cd app && python3 -m http.server 8765` puis http://127.0.0.1:8765/
Tests : `cd test && npm i && node e2e.js` (serveur local lancé).

Mise à jour : modifier les fichiers, puis incrémenter `CACHE` dans `app/sw.js` pour que les iPhones récupèrent la nouvelle version.

## v1.2.2 – Contraste logo sur bandeau bleu

- Pastille blanche plus large derrière le logo (~52px, padding 8–10px, ombre légère) pour mieux détacher le logo PES du bandeau bleu.
- Pas de teinte bleue sur le logo ; bandeau bleu conservé.
- CACHE `visite-chantier-v1.2.2`.

## v1.2.1 – Logo PES dans l'en-tête

- Logo Pyrénées Énergies Solutions dans le header (`icons/logo-header.png`, fond blanc arrondi sur le bandeau bleu).
- Titre court « Visite Chantier » + sous-titre dynamique.
- CACHE `visite-chantier-v1.2.1`.

## v1.2.0 – Envoi auto via dépôt GitHub (sans feuille de partage)

- Bouton principal **Envoyer à Aide Chantier** : si un jeton GitHub est configuré, construit le ZIP et le pousse dans le dépôt privé `laurentfrison24-hub/visite-chantier-inbox` (`dossiers/<date>/<slug>_<HHmmss>/chantier.json` + `dossier.zip`) via l’API Git (blobs/trees/commits), puis ping webhook optionnel.
- **Réglages** : champ « Jeton GitHub (envoi auto) » (stocké en localStorage), dépôt editable, URL + clé webhook.
- Sans jeton : écran de configuration (pas de share sheet). **Partager autrement** reste le repli iOS.
- CACHE `visite-chantier-v1.2.0`.

## v1.1.0 – Envoi à Aide Chantier

- Bouton principal **Envoyer à Aide Chantier** (feuille de partage iOS → Mail).
- **Partager autrement** pour un partage générique / téléchargement.
- Réglages (⚙️) : adresses de réception et de réponse.
- ZIP nommé `visite-chantier_<slug>_<AAAA-MM-JJ>.zip`, recompression si > ~20 Mo.
- Badge **Envoyé le …** après un envoi réussi.
