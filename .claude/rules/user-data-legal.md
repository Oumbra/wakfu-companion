---
paths:
  - "src/app/core/data-access/**"
  - "src/app/core/sync/**"
  - "src/app/core/services/persistence.service.ts"
  - "server/settings/**"
  - "server/db/schema.ts"
  - "functions/api/**"
---

# user-data-legal

Portée : toute donnée rattachée au compte (synchronisation, schéma serveur, API) et son impact sur les textes légaux. Voir aussi `server/README.md` pour l'architecture des lots serveur.

## Stockage et synchronisation

- **Données utilisateur : passer par `UserDataService`** (`core/data-access/`), pas par `PersistenceService` directement, dès qu'il s'agit d'une des six données synchronisables avec le compte (profil, watchlist, réattributions de dégâts, roster, canaux et filtres de chat — voir `user-data.keys.ts`). C'est ce qui les fait remonter automatiquement sur le compte quand l'utilisateur est connecté (lot 6, voir `server/README.md`). `read`/`write` sont **synchrones** dans les deux modes, et doivent le rester : plusieurs consommateurs lisent dans leur constructeur ou en plein chemin chaud de parsing. Ajouter une donnée synchronisable = l'ajouter dans `user-data.keys.ts` **et** dans `server/settings/keys.ts` (liste blanche fermée côté serveur), sans oublier de se demander si elle doit être rechargeable à chaud (`onExternalChange`) quand un autre appareil la modifie.
- `PersistenceService` (localStorage `getJson`/`setJson` + IndexedDB pour le handle de fichier et le cache catalogue) reste la brique de stockage local sous-jacente, à utiliser directement uniquement pour ce qui n'est PAS synchronisé (locale, préférences d'affichage locales, classifications détectées, handle de fichier...).

## Conformité (RGPD / CGU)

- **Toute nouvelle donnée rattachée au compte ⇒ relecture des textes légaux, dans le même commit.** Déclencheurs : nouvelle table ou colonne référençant `users` (`server/db/schema.ts`), nouvelle clé dans `user-data.keys.ts`/`server/settings/keys.ts`, nouveau champ qu'un client (site ou overlay) envoie au serveur, nouvelle durée de conservation, nouvel appel sortant vers un service tiers. À faire alors, dans les 4 locales de `translations.ts` : la politique de confidentialité (`privacy.notice.body` — §1.2 ce qui est conservé, §1.3 base légale si des données de tiers sont concernées, §2 services tiers, §5 durée, §6 droits), les CGU (`terms.notice.body`) si l'objet du service change, et la date « Dernière mise à jour » de chaque texte touché ; vérifier que l'export RGPD couvre la nouvelle donnée (`functions/api/v1/auth/export.ts` + `AccountExportService`, qui enchaîne les `GET /api/v1/history/*`) ; mettre à jour le registre des traitements du responsable (hors dépôt, `C:\Users\Oumbra\Documents\wakfu-companion-rgpd\`). Cas vécu : les tables `pact_extractions` (5 septembre 2026) sont restées absentes de la politique jusqu'à l'audit du 19 septembre (`docs/analyse-rgpd.md`, 4.6) — même principe que le gating `isInitialLoad` : une question à se poser explicitement à chaque ajout, pas après coup.

## Demandes d'exercice des droits

- **Retrait du pseudonyme d'un joueur tiers** (promis par la politique §1.3, RGPD art. 21) :
  `npm run main:erase:third-party-name -- --name "Pseudo"` pour l'inventaire, `--apply` pour écrire
  (`server/import/erase-third-party-name.ts`). Il couvre les quatre emplacements où un pseudonyme de
  tiers peut se trouver — `fight_participants.name`, `trades.peer_name`, et les clés `chatFilters` /
  `damageReassignments` de `user_settings`. **Toute nouvelle donnée portant un nom de personnage doit
  y être ajoutée dans le même commit** : sans ça, la promesse du §1.3 redevient intenable en silence
  (`docs/analyse-rgpd.md` §9.1, point 8). Consigner chaque demande et son exécution dans le registre
  du responsable (hors dépôt).
- **Droit d'accès et portabilité** : bouton « Exporter » de « Mon compte »
  (`AccountExportService` + `GET /api/v1/auth/export` + les quatre `GET /api/v1/history/*`). Une
  nouvelle table rattachée à `users` doit y apparaître, sinon l'export ment.

## Durées de conservation

- Les délais font autorité dans `server/auth/flow.ts` (`DEAD_SESSION_RETENTION_MS`,
  `INACTIVE_ACCOUNT_RETENTION_MS`) et `server/auth/rate-limit.ts` (`MAX_RATE_LIMIT_WINDOW_MS`),
  jamais ailleurs — et jamais sans la phrase correspondante de la politique §5, dans les 4 locales.
- Deux déclencheurs, à garder tous les deux : les purges **opportunistes** des routes d'auth
  (`runRetentionPurges`) et la passe **planifiée** quotidienne (`runFullPurge` via
  `.github/workflows/rgpd-purges.yml`). La seconde existe parce que la première ne tourne pas sans
  trafic (§9.1, point 9) : une nouvelle purge doit entrer dans `runFullPurge`, sinon elle n'aura
  lieu que tant que le service est fréquenté.

## Données réelles dans le dépôt (public)

- `tools/check-fixtures.mjs` refuse jeton de session, chemin `C:\Users\<nom>`, IP privée et
  identifiant de compte Ankama, dans les fixtures **comme dans le code** (`src/`, `server/`,
  `functions/`, `tools/`, `tests/`) — hook `pre-commit` et CI. Il n'attrape que ce qui a une forme :
  un pseudonyme de joueur ou un message de chat recopié reste indétectable, donc à vérifier soi-même
  en écrivant une spec (`docs/analyse-rgpd.md` 4.11 et §9.1, point 11).
