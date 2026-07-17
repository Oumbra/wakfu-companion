@"C:\Users\Oumbra\AppData\Roaming\zaap\gamesLogs\wakfu\logs\wakfu_chat.log" Voici un fichier qui montre plusieurs problème pour la partie tracker de combat.

* Premièrement, lorsqu'un combat démarre il est suivi dans l'onglet "combat en cours" mais lorsqu'il est terminé, toutes ses informations sont retirés de l'onglet "combat en cours" pour ajouter une nouvelle entrée d'historique dans l'onglet historique.
* Deuxièmement, les dégâts de l'état "enflammé" ne sont pas correctement attribué au personnage mais à l'ennemi qui les subit. C'est incorrecte, il faut ajouter une ligne (Enflammé). Pareil pour les poisons ou passif tel que "Hachure" ou encore "Force sage"
Peux tu faire les changements afin de corriger ces erreurs d'interpretation ?

--

Je remarque encore que les dégats indirect ne sont pas correctement interprété.
Il existe un pattern simple pour les identifier facilement, le voici:
([^:\]]+): -((\d+\s)?\d+) PV \([^\)]+\) \([^\)]+\)? \([^\)]+\)? \([^\)]+\)?

Ce pattern peu surement être amélioré mais l'objectif c'est qu'il match avec les cas suivant :

- "[Information (combat)] The Undertroolker: -712 PV (Lumière) (Eau) (Parade !) (Contre-attaque)", ici le sort ou capacité "Contre-attaque" à infligé 712 dommages de type lumière (axé Eau)
- "[Information (combat)] El Pochito: -2 228 PV (Lumière) (Eau) (Contre-attaque)", ici le sort ou capacité "Contre-attaque" à infligé 2 228 dommages de type lumière (axé Eau)
- "[Information (combat)] The Undertroolker: -2 548 PV (Lumière) (Eau) (Parade !) (Enflammé)", ici le sort ou capacité "Enflammé" à infligé 2 548 dommages de type lumière (axé Eau)
- "[Information (combat)] El Pochito: -3 596 PV (Lumière) (Eau) (Enflammé)", ici le sort ou capacité "Enflammé" à infligé 3 596 dommages de type lumière (axé Eau)
- "[Information (combat)] Rey Mystroolrio: -789 PV (Lumière) (Eau) (Canine)", ici le sort ou capacité "Canine" à infligé 789 dommages de type lumière (axé Eau)
- "[Information (combat)] Sac à patates: -275 PV (Terre) (Hachure)", ici le sort ou capacité "Hachure" à infligé 275 dommages de type Terre

Dans ce pattern le "Parade !" est à ignoré