# Features

- Parcourir tous les objets dropable (drops) des monstres, par exemple https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/1, et référencer tous ceux qui ne sont pas présent dans le json `/référentiel/items_wakfu.json`. Ces objets doivent avoir les mêmes champs que tous les autres (fr, en, es, pt rarity, gxfId, pcture_url, wakassets_available, wakfu_available)    

- https://www.wakfu.com/fr/mmorpg/encyclopedie/consommables/12527-fragment-havre-gemme-jardin
- https://www.wakfu.com/fr/mmorpg/encyclopedie/monstres/3926-vilenya
- https://www.wakfu.com/fr/mmorpg/encyclopedie/consommables/12526-merchant-haven-gem-fragment
- https://www.wakfu.com/fr/mmorpg/encyclopedie/armures/27574?recipe_category=79
- https://www.wakfu.com/fr/mmorpg/encyclopedie/armures/27572?recipe_category=79
- https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/4266-havre-gemme-jardin
- https://www.wakfu.com/fr/mmorpg/encyclopedie/personnalisation/4264-havre-gemme-artisanat
- https://www.wakfu.com/fr/mmorpg/encyclopedie/personnalisation/4263
- https://www.wakfu.com/fr/mmorpg/encyclopedie/personnalisation/4262
- https://www.wakfu.com/fr/mmorpg/encyclopedie/ressources/27575

- Aujourd'hui les constantes de référentiel d'objet et de monstre sont orienté sur la langue FR mais ça ne fonctinnera pas sur des fichiers de logs où le jeu est en EN, ES ou encore PT. Il faut corriger ce point afin que cela fonctionne sur toutes les langues.

- Nettoyage des sources qui doivent être devenue inutile, comme par exemple `wakfu-item-image-overrides.data.ts`, `wakfu-enemy-families.data.ts`, etc...

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