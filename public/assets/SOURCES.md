# Provenance des assets servis par le site

Inventaire de ce que `public/assets/` distribue depuis nos serveurs, avec l'origine de chaque
fichier et la transformation appliquée — tenu à jour à chaque ajout ou remplacement d'asset
(`docs/analyse-cgu-2026-09-21.md`, recommandation 7). Les dates sont celles du premier commit qui a ajouté le
fichier (`git log --diff-filter=A`) ; un nom hashé change quand le contenu change, la ligne reste.

Tout ce qui vient du jeu (illustrations, icônes, interface) reste la propriété d'Ankama et est
retiré sur simple demande de sa part (mentions légales, § 3). Rien ici n'est monétisé.

## Images du jeu (Ankama)

| Fichiers                                                                                                                                                                          | Origine                                                                                                                                                                                    | Transformation                                                                                                                                      | Ajouté le  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `classes/{classe}-{m,f}-*.png` (36 icônes de classe)                                                                                                                              | dépôt communautaire [wakassets](https://github.com/Vertylo/wakassets) (GitHub), qui redistribue les icônes officielles                                                                     | copiées telles quelles, renommées `{classe}-{m,f}`                                                                                                  | 2026-08-06 |
| `avatars/class-avatars-sheet-*.png` (planche 4 colonnes × 18 lignes)                                                                                                              | portraits « Galerie MMO » du compte Ankama, `static.ankama.com/web-test/{id}.png`                                                                                                          | assemblés en une planche (colonnes : mâle coloré, mâle mat, femelle coloré, femelle mat), variante mate pré-rendue — voir `class-portraits.data.ts` | 2026-08-15 |
| `ui/breach-*.png`, `ui/ultimate-breach-*.png` (pierres de brèche)                                                                                                                 | captures d'écran du jeu                                                                                                                                                                    | détourage                                                                                                                                           | 2026-08-24 |
| `ui/header-*.png` (7 en-têtes : alliés, ennemis, combat, défis, kamas, butin, XP), `ui/rarity-base-*.png`, `ui/recipe-*.png`, `ui/session-recap-*.png`, `ui/unknown-entity-*.png` | wakassets et le site de référence [Nexus-Hub](https://wakfu-companion.nexuswow.workers.dev/) (`public/assets/img/headers/`, `classes/`), qui redistribuent des éléments d'interface du jeu | copiées telles quelles                                                                                                                              | 2026-08-06 |
| `ui/logo-purple-*.png` (logo de l'application)                                                                                                                                    | pictogramme de l'encyclopédie du site officiel, `static.ankama.com/wakfu/ng/modules/icons/sprite_encyclopedia.png`                                                                         | détouré du sprite, recoloré (violet)                                                                                                                | 2026-08-06 |

Les icônes d'objets, de monstres, de raretés, de types et les illustrations de donjons ne sont pas
dans ce dossier : elles sont servies par le relais `/api/v1/icons` depuis wakassets (voir
`src/app/core/utils/wakassets-url.util.ts` et `server/icons/proxy.ts`). Les galeries d'avatars
fan-art de la page profil restent hotlinkées depuis `static.ankama.com/web-test/` (voir
`avatar-fanart-galleries.data.ts`).

## Production propre

| Fichiers                                                                              | Origine                                                                                                                                                                                                                                                    | Ajouté le  |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `icons-*.svg` (sprite d'icônes génériques, voir `shared/icon`)                        | généré par IA pour ce projet                                                                                                                                                                                                                               | 2026-09-17 |
| `onboarding/*.jpg` (captures annotées du pas-à-pas, voir `onboarding-slides.data.ts`) | captures d'écran de l'application générées par script Playwright sur `tests/wakfu.log` (pseudonymisé) + lignes synthétiques aux noms inventés ; catalogue simulé depuis les données publiques du jeu (`wakfu.cdn.ankama.com/gamedata`) et icônes wakassets | 2026-09-24 |
| `setup-hint-dark.png`, `setup-hint-light.png`                                         | captures d'écran de l'Explorateur Windows (emplacement de `wakfu.log`)                                                                                                                                                                                     | 2026-08-23 |

## Sons

| Fichiers                                                                                 | Origine                                                                               | Licence                                                                                           | Ajouté le  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| `sounds/alert-*.mp3` (alerte de butin)                                                   | [AlertSound6](https://www.filterblade.xyz/assets/sounds/AlertSound6.mp3), FilterBlade | son de filtre de butin distribué par FilterBlade, réutilisé tel quel — voir `alert-sound.data.ts` | 2026-08-06 |
| `sounds/chat-filter-*.mp3` (alerte de chat), `sounds/countdown-*.mp3` (compte à rebours) | [Pixabay](https://pixabay.com/fr/)                                                    | licence de contenu Pixabay, libre de droits, sans attribution requise                             | 2026-08-06 |
