---
name: release
description: Mettre en production Wakfu Companion — crée la branche `release-AAAA-MM-JJ` depuis `main`, y fusionne `claude/dev` en résolvant les conflits, vérifie, pousse ; le workflow `release.yml` ouvre alors la PR vers `main`, la fusionne quand la CI est verte et lance le déploiement. À utiliser quand l'utilisateur demande une mise en prod / release / déploiement de production. Fonctionne en local comme en session cloud (seul `git` est nécessaire, pas `gh`).
---

# Mise en production (branche de release)

`main` est protégée (PR obligatoire, check `test` requis, pas de push direct) : on ne pousse jamais sur `main`. Le skill prépare une branche de release **déjà fusionnable sans conflit** ; tout le reste (PR, fusion, déploiement, suppression de la branche) est fait par `.github/workflows/release.yml`. Seul `git` est nécessaire — pas de `gh`, pas de clé API.

Cette procédure est l'**exception explicite** à la règle « travailler uniquement sur `claude/dev` » de `CLAUDE.md` : la branche de release est créée, poussée, puis supprimée par le workflow.

## 1. Préconditions

```bash
git status --porcelain            # doit être vide : sinon s'arrêter et demander à l'utilisateur
git fetch origin main claude/dev
git rev-list --count origin/main..origin/claude/dev
```

- `0` ⇒ rien à livrer : le dire à l'utilisateur et s'arrêter.
- Prévisualiser les conflits sans rien toucher : `git merge-tree --write-tree --name-only origin/main origin/claude/dev` (1re ligne = arbre résultat ; les lignes suivantes, s'il y en a, = fichiers en conflit).

## 2. Créer la branche

Nom : `release-$(date +%F)` (ex. `release-2026-09-23`). Si elle existe déjà sur `origin` (`git ls-remote --heads origin <nom>`), suffixer `-2`, `-3`... Format imposé : `release.yml` ignore toute branche qui ne respecte pas `^release-[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$`.

```bash
git switch -c release-AAAA-MM-JJ origin/main
SKIP_VERSION_BUMP=1 git merge --no-ff --no-commit origin/claude/dev
```

`--no-ff` : toujours un vrai commit de merge (c'est son message qui porte le rapport). `SKIP_VERSION_BUMP=1` : aucun bump de version sur une release (voir `.claude/rules/versioning.md`) ; la version livrée est celle de `claude/dev`.

## 3. Résoudre les conflits (s'il y en a)

`claude/dev` est la source de vérité ; `main` ne reçoit normalement rien d'autre que des releases. Un conflit vient donc d'un hotfix ou d'une réécriture d'historique sur `main`.

- Lire chaque conflit (`git diff`, `git log --oneline origin/claude/dev..origin/main -- <fichier>` pour savoir ce que `main` a apporté) et **préserver l'intention des deux côtés**. Ne pas prendre `--theirs`/`--ours` en bloc sans avoir compris le conflit.
- Cas déjà vécu (2026-09-23) : `main` portait des copies de commits (autres SHA, mêmes sujets, issues de la réécriture d'historique) dont l'arbre était identique à un ancêtre de `claude/dev` ⇒ la bonne résolution était de prendre intégralement `claude/dev`. Vérifier avec `git rev-parse origin/main^{tree}` face aux arbres des ancêtres de `claude/dev`.
- `package.json` / `package-lock.json` : garder la version de `claude/dev`, sauf si `main` porte une version supérieure (hotfix) — dans ce cas la signaler à l'utilisateur.
- Choix ambigu (logique métier, deux correctifs concurrents) : **demander à l'utilisateur** plutôt que trancher seul.
- Ensuite, vérifier localement (obligatoire dès qu'il y a eu un conflit ; la CI rejouera de toute façon) :

```bash
npm ci
npm test -- --watch=false
npm run test:server
npm run build
npx prettier --check <fichiers résolus>
```

Sans conflit, ces vérifications locales sont facultatives : la CI de la branche les joue avant toute fusion.

## 4. Commit de merge = rapport

Le **corps** du message devient la description de la PR (job `open-pr`) : le rédiger pour l'utilisateur, en prose normale.

```bash
SKIP_VERSION_BUMP=1 git commit -F - <<'EOF'
Merge claude/dev into main (release AAAA-MM-JJ)

## Contenu livré
<git log --oneline --no-merges origin/main..origin/claude/dev, regroupé par type : feat / fix / autres>

## Conflits
Aucun.
<ou, par fichier : origine du conflit (commit côté main), résolution retenue et pourquoi>

## Vérifications locales
<commandes lancées et résultat, ou « aucune (pas de conflit), CI de la branche »>
EOF
```

Le commit de merge doit être le **dernier** commit de la branche (c'est le message du commit de tête du push qui est lu). Une correction nécessaire après coup : `SKIP_VERSION_BUMP=1 git commit --amend`, pas un commit de plus. Un bug trouvé dans le code livré se corrige sur `claude/dev`, puis on recommence la release.

## 5. Pousser

```bash
git push -u origin release-AAAA-MM-JJ
```

Si le push est refusé (proxy git d'une session cloud, classificateur auto-mode « Production Deploy »...), ne pas contourner ni renommer la branche : donner la commande de push exacte à l'utilisateur et signaler le refus.

## 6. Ramener la résolution dans `claude/dev` (seulement si nécessaire)

```bash
git diff --quiet origin/claude/dev HEAD && echo identique
```

- Arbre identique à `claude/dev` ⇒ rien à faire.
- Sinon (résolution de conflit ou hotfix de `main` absent de `claude/dev`) : fusionner la branche de release dans `claude/dev` pour que la prochaine release ne rejoue pas le même conflit :

```bash
git switch claude/dev && git pull --ff-only
SKIP_VERSION_BUMP=1 git merge --no-ff release-AAAA-MM-JJ -m "chore: report de la release AAAA-MM-JJ dans claude/dev"
git push origin claude/dev
```

## 7. Rapport à l'utilisateur

- Nom de la branche poussée et lien : `https://github.com/Oumbra/wakfu-companion/pulls?q=is%3Apr+head%3A<branche>`.
- Résumé du contenu livré, conflits et résolutions, vérifications.
- Suite automatique : CI sur la branche ⇒ fusion de la PR ⇒ `deploy-main.yml` ⇒ suppression de la branche. Suivi : `https://github.com/Oumbra/wakfu-companion/actions`.
- Revenir sur `claude/dev` en local (`git switch claude/dev`) et supprimer la branche locale de release (`git branch -D release-AAAA-MM-JJ`).

## Si le workflow ne fusionne pas

- CI rouge sur la branche : corriger sur `claude/dev` (ou amender le merge si l'erreur vient de la résolution), repousser.
- PR non créée : vérifier le réglage « Allow GitHub Actions to create and approve pull requests » (Settings → Actions → General).
- `main` a bougé entre-temps et la PR est en conflit : recommencer la release avec un suffixe `-2`.
- En dernier recours, la PR peut toujours être fusionnée à la main sur GitHub (« Create a merge commit ») : le push qui en résulte, fait au nom de l'utilisateur, déclenche `deploy-main.yml` normalement.
