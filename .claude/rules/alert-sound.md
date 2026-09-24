---
paths:
  - "src/app/core/services/alert-sound.service.ts"
  - "src/app/core/services/loot-alert.service.ts"
  - "src/app/features/loot-alert/**"
  - "src/app/core/data/*alert-sound*.data.ts"
---

# alert-sound

Portée : alertes sonores (butin surveillé, chat, compte à rebours) et leur lecture via `HTMLMediaElement`.

## Alerte sonore : `play()` rejeté par la politique autoplay (toast muet)

`LogFileAccessService.init()` reconnecte le fichier tout seul au chargement (handle mémorisé,
permission déjà accordée) — aucun clic n'est jamais nécessaire, donc Chrome peut refuser
`HTMLMediaElement.play()` (`NotAllowedError`) tant que l'utilisateur n'a pas interagi avec la page :
toast affiché, son muet, rejet autrefois avalé (`void audio.play()`). Remonté le 2026-09-13 (« Pierre
de vitesse » sans alerte) — le chemin applicatif (parser → `registerLoot` → `LootAlertService`) a été
vérifié correct en navigateur sur le fichier fourni ; hors ce blocage, la seule autre cause est le
gating `isInitialLoad` (ramassage déjà présent dans le fichier à la connexion, jamais alerté — voulu).
`AlertSoundService` capte maintenant le rejet, expose `blockedByBrowser` (indication dans le toast,
clé `profile.lootAlertSoundBlocked`) et rejoue le dernier son au premier `pointerdown`/`keydown`.
Non reproductible via Playwright (`navigator.userActivation.hasBeenActive` vaut déjà `true` sur une
page pilotée par CDP, même avec `--autoplay-policy=user-gesture-required`) : testé en stubbant
`HTMLMediaElement.prototype.play` pour rejeter `NotAllowedError` avant le premier clic.

## Haut-parleur d'un objet : coupe le son, jamais le message

Corrigé le 2026-09-24 (signalé par l'utilisateur) : `SoundItemEntry.enabled` faisait disparaître
toute l'alerte (`findEnabledSoundItem` ignorait l'objet). Il ne commande plus que le son :
`ProfileService.findSoundItem` renvoie l'entrée même coupée (l'entrée active en priorité entre
homonymes), `LootAlertEvent.muted` est transmis et `LootAlertComponent` affiche toast et confettis
sans appeler `playLoot()`. Libellés `profile.soundOn/Off`, aide `help.profileAlerts.body` et pas-à-pas
(`onboarding.alerts.b4`) alignés dans les 4 locales.
