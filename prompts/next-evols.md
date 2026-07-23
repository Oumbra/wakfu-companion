# Features

- Permettre de redéfinir une classe si celle-ci a été mal détecté (le jugement revient à l'utilisateur), que ce soit dans l'historique ou dans le recap de session.

- Parcourir tous les objets dropable (drops) des monstres et référencé tous ceux qui ne sont présent dans aucun des jsons de `/référentiel`.    

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