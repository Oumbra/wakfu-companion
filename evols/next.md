# Features

- J'aimerais que tu gères la détection de l'images de l'historique des combats de la manière suivante :
    - si au moins un monstre du combat à sa propriété `isBoss` à `true`, croisé son id avec la propriété `bossMonsterId` du fichier `/referentiel/dungeons_wakfu.json` pour utiliser sa propriété `picture_url`.
    - sinon s'il y a plus de 4 monstres de famille différente utiliser l'image `wakassets/bossIllustrations/default.png`
    - sinon si au moins un monstre du combat à sa propriété `isArchi` à `true`, utiliser sa propriété `picture_url`
    - sinon si au moins un monstre du combat à sa propriété `isDominant` à `true`, utiliser sa propriété `picture_url`
    - sinon utiliser la propriété `picture_url` du monstre ayant infliger le plus de dégat du combat

- J'aimerais que tu mettes à jours les skill `wakfu-items-sync` et `wakfu-monsters-sync` en scannant les deux scrapper qu'on avait fait sur un autre environnement, ici : `C:\Users\Oumbra\Documents\Workspace\wakfu-scrape`.

- J'aimerais aussi que tu prennes en compte les objets référencés dans le fichier `/assets/haven-mood/*.png` et pour chaque nom d'objet extrait, tu fasse une recherche google [wakfu + "OBJECT_NAME"](https://www.google.com/search?q=wakfu+%22OBJECT_NAME%22) que tu sélectionnes les résultats où l'url commence par `https://www.wakfu.com/fr/mmorpg/encyclopedie/*` et qui fait bien référence à l'objet du même nom. En plus des objets extrait de l'image du répertoire `/assets/haven-mood`, voici plusieurs objets qui ne peuvent pas être visible dans le jeu avec des filtres :
    - https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/27951-havre-ambiance-etoiles
    - https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/27944-havre-ambiance-lumiere-etheree
    - https://www.wakfu.com/fr/mmorpg/encyclopedie/divers/27936-havre-ambiance-brume