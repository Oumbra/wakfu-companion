# Features

- J'aimerais que tu trouves comment récupérer toutes les objets et objets résultant de recette des métiers, disponible ici : https://www.wakfu.com/fr/mmorpg/encyclopedie/metiers. Tous les objets doivent être ajouté au referentiel `/referentiel/items_wakfu.json` et doivent avoir toutes les propriétées déjà existante :
    - id: identifiant unique de l'objet
    - fr: nom de l'objet en français
    - en: nom de l'objet en anglais
    - es: nom de l'objet en espagnol
    - pt: nom de l'objet en portugais
    - rarity: rareté de l'objet (common, rare, mythical, legendary, souvenir, epic ou relic)
    - gfxId: identifiant de l'image de l'objet
    - picture_url: URL de l'image de l'objet
    - wakassets_available: L'image est disponible sur le repo wakassets (github.com/Vertylo/wakassets/tree/main)
    - wakfu_available: L'image est disponible sur le CDN wakfu (wakfu.cdn.ankama.com)

    Profites en pour créer un skill pour les prochaines récupération ou mise à jour d'objet.

- J'aimerais que tu créais un skill qui a pour but de scrap les informations suivantes des monstres, sur l'encyclopédie officielle (www.wakfu.com/fr/mmorpg/encyclopedie/monstres) :
    - id: identifiant unique du monstre
    - fr: nom du monstre en français
    - en: nom du monstre en anglais
    - es: nom du monstre en espagnol
    - pt: nom du monstre en portugais
    - family: identifier de la famille du monstre, à recouper avec le fichier `/referentiel/monster-families_wakfu.json` (peut être null)
    - gfxId: identifiant de l'image du monstre
    - picture_url: URL de l'image du monstre
    - wakassets_available: L'image est disponible sur le repo wakassets (github.com/Vertylo/wakassets/tree/main)
    - wakfu_available: L'image est disponible sur le CDN wakfu (wakfu.cdn.ankama.com)
    - isBoss: le monstre est un boss, s'il drop au moins : un jeton, une Pierre d'équilibre, une Pierre de vitesse, une Pierre d'aventure, une Pierre d'entourage ou une Pierre ultime
    - isArchi: le monstre est un archi, s'il drop au moins : un reliquâme ou un archiemblème
    - isDominant: le monstre est un archi, s'il drop au moins : un Masque Grossier, un Masque Rudimentaire, un Masque Imparfait, un Masque Fragile, un Masque Rustique, un Masque Brut, un Masque Solide, un Masque Durable, un Masque Raffiné, un Masque Précieux, un Masque Exquis, un Masque Mystique, un Masque Eternel, un Masque Divin, un Masque Infernal

- J'aimerais que tu gères la détection de l'images de l'historique des combats de la manière suivante :
    - si au moins un monstre du combat à sa propriété `isBoss` à `true`, croisé son id avec la propriété `bossMonsterId` du fichier `/referentiel/dungeons_wakfu.json` pour utiliser sa propriété `picture_url`.
    - sinon s'il y a plus de 4 monstres de famille différente utiliser l'image `wakassets/bossIllustrations/default.png`
    - sinon si au moins un monstre du combat à sa propriété `isArchi` à `true`, utiliser sa propriété `picture_url`
    - sinon si au moins un monstre du combat à sa propriété `isDominant` à `true`, utiliser sa propriété `picture_url`
    - sinon utiliser la propriété `picture_url` du monstre ayant infliger le plus de dégat du combat