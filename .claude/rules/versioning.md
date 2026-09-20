---
paths:
  - "package.json"
  - "tools/bump-version-from-commit.mjs"
  - "tools/generate-build-info.mjs"
  - ".husky/**"
  - "src/app/shared/app-footer/**"
---

# versioning

Portée : numéro de version affiché dans le pied de page et hook Git qui l'incrémente automatiquement.

## Numéro de version

- **Numéro de version** (`package.json` "version", semver) : affiché dans le pied de page (`app-footer`, clé i18n `footer.build`) via `src/app/core/data/build-info.data.ts`, généré à chaque build par `tools/generate-build-info.mjs` (fichier gitignored, comme les autres tables générées — ne pas l'éditer à la main). Départ à `1.0.0` (2026-08-07).
  - **Le bump est automatique, ne jamais l'éditer à la main.** Un hook Git `post-commit` (`.husky/post-commit` → `tools/bump-version-from-commit.mjs`, installé via `"prepare": "husky"` au premier `npm install`) lit le type Conventional Commits du commit qui vient d'être créé, incrémente `package.json`/`package-lock.json` via `npm version <niveau> --no-git-tag-version` (garde `package-lock.json` synchronisé — une dérive y casserait `npm ci` en CI, voir mémoire "npm-version-drift-lockfile"), puis amende ce même commit pour y inclure le bump (garde anti-récursion via la variable d'env `WAKFU_VERSION_BUMP_AMEND`). Un hook `commit-msg` semblait plus naturel mais ne fonctionne pas : Git construit l'arbre du commit à partir de l'index AVANT d'appeler `commit-msg`, donc un `git add` fait depuis ce hook ne rentre jamais dans le commit en cours (vérifié empiriquement).
  - Correspondance type → niveau : `feat:` → minor, `fix:` → patch, `feat!:`/`fix!:`/tout type suivi de `!` ou footer `BREAKING CHANGE:` → major (prioritaire). Tout autre type (`docs`, `chore`, `refactor`, `style`, `test`, `ci`, `build`...) ou message non conforme (merge, revert) → aucun bump.
  - Échappatoire ponctuelle : `SKIP_VERSION_BUMP=1 git commit ...` (fonctionne aussi devant `git rebase --continue`/`git commit --amend`). Cas non gérés automatiquement, à surveiller : un `git commit --amend` manuel répété re-bump à chaque fois (pas de détection d'amend), et un `git rebase` qui rejoue un commit déjà bumpé après résolution de conflit re-déclenche `post-commit` et re-bump une deuxième fois (vécu en session : 1.1.0 → 1.2.0 au lieu de rester 1.1.0, corrigé manuellement avec `SKIP_VERSION_BUMP=1` avant l'amend correctif) — utiliser l'échappatoire dans ces deux cas.
  - Comme tout hook Git, ne s'exécute que sur un commit créé en local avec les hooks installés (pas sur un commit fait via l'UI GitHub, un merge, ou un clone sans `npm install` préalable) — cas non rencontrés dans le flux de travail actuel (tout est committé localement sur `claude/dev`).
