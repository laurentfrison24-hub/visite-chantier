#!/usr/bin/env bash
# Publie le dossier app/ sur GitHub Pages (dépôt public "visite-chantier").
# Prérequis : `gh auth login` déjà fait sur cette machine.
set -euo pipefail
cd "$(dirname "$0")"
gh auth status >/dev/null
OWNER=$(gh api user -q .login)
REPO=visite-chantier
[ -d .git ] || { git init -q -b main; }
git add -A && git commit -qm "Visite Chantier v1" || true
gh repo view "$OWNER/$REPO" >/dev/null 2>&1 || gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --push
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
git push -u origin main
# Branche gh-pages = contenu de app/ à la racine
git branch -D gh-pages >/dev/null 2>&1 || true
git subtree split --prefix app -b gh-pages
git push -f origin gh-pages
gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$OWNER/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null
echo "URL : https://$OWNER.github.io/$REPO/"
