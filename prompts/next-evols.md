# Features

J'aimerai que l'on intégre les objets de la page personnalisation​: https://www.wakfu.com/fr/mmorpg/encyclopedie/personnalisation​; qu'il faut scraper comme les autres pages et ajouté les objets extraits dans le fichier `referentiel/items_wakfu.json​`. Ces objets doivent avoir les mêmes champs que tous les autres (fr, en, es, pt rarity, gxfId, pcture_url, wakassets_available, wakfu_available).

De plus, je constates que l'objet de drop `Fragment de Havre-Gemme Jardin​` à été oublié sur le monstre : https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/3926-vilenya​.

De nombreux autres objets ne sont trouveable que via recherche sur un navigateur, tel que:
- https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/12528-craft-haven-gem-fragment
- https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/12530-fragment-havre-gemme-deco
- https://www.wakfu.com/fr/mmorpg/encyclopedie/consommables/12526-merchant-haven-gem-fragment
- https://www.wakfu.com/fr/mmorpg/encyclopedie/personnalisation/4264-havre-gemme-artisanat
- https://www.wakfu.com/fr/mmorpg/encyclopedie/armures/27573
- https://www.wakfu.com/fr/mmorpg/encyclopedie/ressources/27575
- https://www.wakfu.com/fr/mmorpg/encyclopedie/armures/27574?recipe_category=79
- https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/4266-havre-gemme-jardin
- https://www.wakfu.com/fr/mmorpg/encyclopedie/armures/27572?recipe_category=79
- https://www.wakfu.com/fr/mmorpg/encyclopedie/personnalisation/4263
- https://www.wakfu.com/fr/mmorpg/encyclopedie/personnalisation/4262

Idem pour les objets Jeton qui sont droppable sur les monstres de type boss, par exemple le `Jeton Grossier` qui est droppable sur le [Bouftou Royal](https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/44-bouftou-royal). Ajoute un champ `isBoss` à tous les éléments du fichier `referentiel/monsters_wakfu.json` à `false`. Parcours tous les monstres de l'encyclopédie et pour tout ceux qui peuvent drop des objets `Jeton`, passe le champ `isBoss` à `true` pour eux.
Idem pour les objets `Reliquâme` qui sont droppable sur les monstres de type archimonstre, par exemple le `Reliquâme Bouftou` qui est droppable sur le [Bouchtrou l'Esseulé](https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/4086-bouchtrou-esseule). Ajoute un champ `isArchi` à tous les éléments du fichier `referentiel/monsters_wakfu.json` à `false`. Parcours tous les monstres de l'encyclopédie et pour tout ceux qui peuvent drop des objets `Reliquâme`, passe le champ `isArchi` à `true` pour eux.

- Aujourd'hui les constantes de référentiel d'objet et de monstre sont orienté sur la langue FR mais ça ne fonctinnera pas sur des fichiers de logs où le jeu est en EN, ES ou encore PT. Il faut corriger ce point afin que cela fonctionne sur toutes les langues.

- Détection de double comptes (lorsque les messages du chat sont en double)
- Déclaration des personnages par compte (nom et classe)

- historique des achats par objet:
    - date via tooltip sur icon
    - icon de l'objet
    - nom de l'objet
    - quantité
    - prix

- historique des échanges :
    - date via tooltip sur icon
    - nom du personnage
    - deux sections (acquis / cédés)
        - icon de l'objet
        - nom de l'objet
        - quantité (acquis ou cédé)