# Features

- J'aimerai pouvoir redéfinir une classe si celle-ci a été mal détecté (le jugement revient à l'utilisateur), que ce soit dans l'historique ou dans le recap de session.
- J'aimerai que la sélection de classe dans la modal de recap puisse être possible, il semble y avoir un souci car suivant la largeur

---

- J'aimerai que tu reprennes le favicon qui n'est pas une excellente qualité, pour se faire, tu peux partir du fichier `/public/logo.png`. Il me faut d'ailleurs une version de ce logo en violet également (toujours en png avec le fond transparent). Ensuite à partir de ce nouvel icone violet png en fond transparent, tu pourra le convertir en `.ico`.
- J'aimerai que tu utilises ce nouvel logo violet png afin de l'afficher à gauche du titre `Wakfu Companion`. 

- Parcourir tous les objets dropable (drops) des monstres et référencé tous ceux qui ne sont pas présent dans le json `/référentiel/items_wakfu.json`. Ces objets doivent avoir les mêmes champs que tous les autres (fr, en, es, pt rarity, gxfId, pcture_url, wakassets_available, wakfu_available)    

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