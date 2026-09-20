---
paths:
  - "src/app/core/services/seo.service.ts"
  - "src/app/core/services/route-sync.service.ts"
  - "src/app/core/services/navigation.service.ts"
  - "src/app/core/routes/**"
  - "src/app/app.routes.ts"
  - "src/index.html"
  - "public/{robots.txt,sitemap.xml,llms.txt,_redirects}"
---

# seo-routing

Portée : référencement (moteurs classiques et assistants IA), URLs préfixées par langue, `SeoService`, `<head>` statique de `index.html` et fichiers `public/` lus par les crawlers.

## Référencement (SEO / recherche IA)

Objectif explicite : être trouvé aussi bien par les moteurs de recherche classiques (Google, Bing)
que par les assistants/agents IA (ChatGPT, Claude, Perplexity...), sur des requêtes type « wakfu
tracker », « wakfu companion », « wakfu historique » et toute variante plausible dans les 4 langues
de l'app (fr/en/es/pt).

- **Domaine canonique en dur, à plusieurs endroits.** L'app n'a pas de rendu serveur (SPA pure, voir
  plus haut) : `src/index.html`, `public/robots.txt`, `public/sitemap.xml`, `public/llms.txt` et
  `core/services/seo.service.ts` (constante `SITE_ORIGIN`) contiennent chacun l'URL canonique de prod
  (`https://wakfu-companion.com`) codée en dur, faute de templating au build sur `public/` (et pour
  `seo.service.ts`, par cohérence avec les fichiers statiques plutôt que déduite de
  `location.origin` — voir raison juste après). **Le jour où le domaine change, mettre à jour les 5
  endroits ensemble** — un grep sur `wakfu-companion.com` les retrouve tous. Ce même domaine figure
  aussi en canonical/`og:url`/`hreflang` sur les déploiements de preview (`claude-dev.`,
  `*.pages.dev`) : volontaire, ça dit aux moteurs de ne pas indexer la preview séparément (doublon de
  la prod) sans avoir besoin de config par environnement.
  - **Une seule cible de déploiement : Cloudflare Pages.** Prod = branche `main`
    (`deploy-main.yml`), preview = branche `claude/dev` (`deploy-preview.yml`), les deux servies à la
    racine de leur domaine (aucun `--base-href` custom, `<base href="/">` de `src/index.html`
    inchangé au build) avec `public/_redirects` (`/* /index.html 200`) : toutes les URLs de page
    répondent 200 en lien direct, y compris `/fr/profile`. L'ancien déploiement GitHub Pages (branche
    `master`, `deploy-master.yml`, `https://oumbra.github.io/wakfu-companion`) a été **décommissionné
    le 2026-09-19** — il ne servait plus que de portail vers cette version, n'avait pas de fallback
    SPA (404 sur tout lien direct autre que `/`) et imposait le sous-dossier `--base-href
    /wakfu-companion/`. Ne pas le réintroduire : le workflow, les branches `master` et `gh-pages` ont
    été supprimés.
- **Deux couches de meta/title distinctes, à ne pas confondre.** (1) Le `<head>` statique de
  `src/index.html` (meta description, Open Graph, Twitter Card, JSON-LD `WebApplication` +
  `FAQPage`, bloc `<noscript>` multilingue, alternates `hreflang` statiques — voir point suivant) est
  ce que voient les crawlers qui **n'exécutent pas de JavaScript** (GPTBot, ClaudeBot,
  PerplexityBot, CCBot...) — la seule chose qu'ils indexent. (2) `SeoService`
  (`core/services/seo.service.ts`, injecté une fois dans `app.ts` comme `RouteSyncService`) met à
  jour `<title>`/meta description/`<html lang>`/canonical/alternates `hreflang`
  **dynamiquement** une fois l'app démarrée, par page (`NavigationService.view()`) et par langue
  (`I18nService.locale()`), via les clés `seo.title.*`/`seo.description.*` de `translations.ts` (4
  locales, à mettre à jour ensemble comme toute clé i18n — voir `.claude/rules/i18n.md`). Ne sert qu'aux
  utilisateurs réels, à Google/Bing (qui rendent le JS) et aux aperçus de partage générés après
  exécution — **jamais** vu par un crawler non-JS, d'où l'importance que (1) reste correct et
  suffisant à lui seul.
- **URLs préfixées par langue (`/fr`, `/en`, `/es`, `/pt`) et balises `hreflang`.** L'app propose
  désormais une URL distincte par langue (`app.routes.ts` : route `:lang`, validée par
  `localeGuard`) plutôt qu'un simple changement de langue côté client sur une URL unique — ce qui
  rend `hreflang` pertinent (Google ne le documente que pour des URLs distinctes par langue).
  Mécanique complète :
  - `LocaleRouteComponent` (`core/routes/`) traduit le segment `:lang` de l'URL en
    `I18nService.setLocale()` (sens URL → état, pendant de `RouteBridgeComponent` pour la page) ;
    contrairement à `RouteBridgeComponent`, il doit rester réactif au changement de paramètre après
    coup (`/fr/profile` → `/en/profile` réutilise la même instance de composant, Angular ne la
    détruit/recrée pas puisque seul `:lang` change).
  - `RouteSyncService` fait le sens inverse (état → URL) : préfixe désormais chaque chemin de page
    par `i18n.locale()` — `LanguageSwitcherComponent` n'a donc rien de spécial à faire, il continue
    d'appeler `i18n.setLocale()` comme avant, la navigation suit automatiquement.
  - `pagePathFor()` (`navigation.service.ts`) centralise le chemin par vue (sans préfixe de langue),
    partagé entre `RouteSyncService` et `SeoService` pour ne pas dupliquer ce mapping.
  - Les anciennes URLs sans préfixe (`/`, `/profile`...) restent résolues mais redirigent (`redirectTo`
    en fonction, pas une chaîne — la cible dépend de la détection ci-dessous) vers leur équivalent
    préfixé, via `detectPreferredLocale()` (`i18n.service.ts` : préférence mémorisée, sinon
    `navigator.language`, sinon français) — ce qui sert aussi de valeur initiale à `I18nService` au
    tout premier rendu, avant que le Router n'ait résolu l'URL.
  - `SeoService` pose canonical + alternates `hreflang` (+ `x-default` → français) vers l'**accueil**
    de chaque langue uniquement (`SITE_ORIGIN/{locale}`), jamais vers la sous-page courante — même
    logique que `public/sitemap.xml`, qui ne liste lui aussi que les 4 accueils (les sous-pages
    n'ont toujours aucune valeur de recherche propre, voir plus bas). `SITE_ORIGIN` y est dupliqué en
    dur (même valeur, même raison qu'ailleurs — voir le point suivant), à garder synchronisé.
  - Un `:lang` hors des 4 locales supportées (lien mort, faute de frappe) est intercepté par
    `localeGuard` (redirige vers `/`, qui redétecte) plutôt que d'être silencieusement ignoré par
    `LocaleRouteComponent`.
- **`public/llms.txt`** : convention émergente (pas encore un standard formel) pour donner aux
  agents/LLM un résumé structuré du site en Markdown, séparé du HTML. Même règle de mise à jour que
  le reste (contenu/fonctionnalités à synchroniser si l'app évolue significativement).
- Si une nouvelle page/route est ajoutée à `app.routes.ts`, se demander explicitement si elle a une
  valeur de référencement propre (sinon, ne pas l'ajouter au sitemap) et lui donner des clés
  `seo.title.*`/`seo.description.*` dans les 4 locales pour que `SeoService` la couvre.
