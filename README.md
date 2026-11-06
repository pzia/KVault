# Kobo Library Vault — V0.9.8

> **0.9.8 — revalidation explicite et mise à jour GitHub** : le contrat Provider passe à la révision 2.3.4 (acquisition 1.4 inchangée). Les lectures de bibliothèque sont passives, le refresh privé devient une action explicite scopée, le catalogue Provider sait revalider sa propre clé de cache, et `scripts/update_from_git` récupère une révision GitHub immuable puis la valide/déploie transactionnellement. Voir `docs/HANDOFF_0.9.8.md`.


Webapp responsive et installable permettant de synchroniser une bibliothèque Kobo, la rechercher, comparer les achats au catalogue Kobo, marquer des titres comme déjà lus/connus, afficher des statistiques et synchroniser le tout entre appareils dans un coffre chiffré côté navigateur.

> Le connecteur Kobo utilise des endpoints observés dans les clients Kobo et des implémentations open source. Ce n’est pas une API publique contractuelle : Kobo peut modifier ces endpoints.

## Fonctions incluses

### Bibliothèque

- synchronisation de la liste des acquisitions depuis le compte Kobo ;
- recherche titre/auteur ;
- filtres langue et type (eBook / audiobook) ;
- auteur cliquable vers **Rapprochement** en mode Auteur ;
- titre cliquable vers la fiche/recherche Kobo ;
- affichage compact de l’année de parution sous la forme `(AAAA)` lorsqu’elle est disponible ;
- tris : titre, auteur, acquisition récente, parution récente → ancienne et ancienne → récente ;
- export CSV/JSON.

### Rapprochement

- recherche paginée dans le catalogue Kobo ;
- trois modes : **Auteur**, **Série / collection** et **Recherche libre** ;
- le mode libre permet par exemple de rapprocher une requête comme « Prix du Quai des Orfèvres » même sans métadonnée de prix littéraire structurée ;
- une chaîne entre guillemets doubles impose une correspondance exacte dans un champ de métadonnées (`"quai des orfèvres"`) ; les termes placés hors guillemets restent eux aussi requis ;
- post-filtrage strict en mode Auteur pour éviter les faux positifs ;
- post-filtrage sur le champ série/collection lorsqu’il est disponible en mode Série ;
- tolérance d’une faute légère (`Ken Follet` ↔ `Ken Follett`) et de l’ordre (`Follett, Ken`) ;
- filtres cliquables **Tous / Possédés / Lus-déjà connus / Potentiellement manquants** ;
- marquage local **Lu / déjà connu**, synchronisé dans le coffre ;
- tri par date de parution, titre ou auteur ;
- titre cliquable vers Kobo ;
- cache catalogue local + Cloudflare avec bouton d’actualisation forcée ;
- panneaux de critères/filtres repliables, avec état conservé localement et résumé des filtres actifs.

### Stats

- Top 10 / Top 20 / Tous des auteurs achetés ;
- classement au choix par **nombre de livres** ou **score pondéré ★** (`Σ averageRating / 5`) ;
- récupération et conservation de la note moyenne communautaire Kobo et du nombre d’évaluations quand disponibles ;
- affichage de la moyenne par auteur, de la couverture de notation (`9/12 livres notés`) et du score pondéré ;
- les livres sans note ne sont pas traités comme des zéros : ils restent comptés dans le total mais ne participent ni à la moyenne ni au score ;
- filtres langue et média, dans un panneau repliable ;
- un ouvrage coécrit compte une fois pour chacun de ses auteurs ;
- regroupement de variantes simples comme `Ken Follett` / `Follett, Ken` ;
- clic sur un auteur → rapprochement immédiat avec le catalogue Kobo en mode Auteur.

### PWA / mobile

- manifest complet avec `scope`, `id`, `display: standalone` ;
- icônes 192×192 et 512×512 + icône maskable ;
- service worker et cache du shell applicatif ;
- fonctionnement responsive smartphone / tablette / desktop ;
- filtres repliables sur Bibliothèque, Rapprochement et Stats (repliés par défaut sur petits écrans si aucun choix n’a été mémorisé) ;
- bouton Verrouiller contrasté et compact sur mobile ;
- diagnostic PWA dans **Données** : mode standalone, manifest, service worker et stockage persistant ;
- bouton d’installation lorsqu’un navigateur expose `beforeinstallprompt` ;
- aide dédiée Firefox Android via le menu du navigateur lorsque ce mécanisme n’est pas exposé.


## Profils Vault — V0.9.8

La saisie d’un UID inconnu sur l’écran d’ouverture **ne crée plus de coffre**. La création est une action explicite : depuis un coffre ouvert, utilisez **Créer un nouveau compte Vault** ; sur une installation vierge sans aucun profil connu, un bootstrap de création explicite reste disponible. Les UIDs connus sur l’appareil sont proposés dans un sélecteur de profils. Ce registre local ne donne aucun droit croisé entre coffres : chaque profil conserve son authentification, son compte Kobo, sa projection et ses tokens Provider propres.

## API fournisseur Kobo — V0.9.8 / contrat v2.3.4

La V0.9.8 conserve **API 2.3** et le schéma acquisition **1.4**, avec la révision contractuelle **2.3.4**. Les lectures de bibliothèque (`manifest`, `search`, détail) sont désormais passives : elles ne déclenchent plus une synchronisation Kobo cachée. Le client peut demander explicitement `POST /api/v2/library/refresh` avec le scope opt-in `kobo.library.refresh`. Le catalogue global accepte `refresh=true` pour contourner et remplacer la clé de cache Provider de la requête. Le principe reste : **Paris décide, Vault expose Kobo, Adept exécute localement**.

Vault normalise désormais **`ContentUrls` et `DownloadUrls`**, ainsi que **`DownloadUrl` et `Url`**, conserve plusieurs candidats dédupliqués, et publie les headers nécessaires au transport. Une URL Amazon S3 déjà pré-signée n’est pas réécrite (notamment son paramètre `b`) afin de ne pas invalider sa signature. Les candidats issus de `content_access_book` incluent `x-amz-request-payer=requester`; en mode `delegated`, le Bearer Kobo n’est ajouté que lorsque le premier hop Kobo peut l’exiger. L’Authorization ne doit jamais être propagée vers un redirect cross-origin.

La résolution **best effort du lien ACSM** via `get_download_link`, introduite en V0.9.1, est conservée. Lorsqu’un export Adobe est disponible, le candidat `kind=acsm` est ajouté à la même réponse que les EPUB/KEPUB/PDF de `content_access_book`, sans supprimer ces autres choix.

Routes cibles :

```text
GET  /api/v2/status
GET  /api/v2/account
GET  /api/v2/catalog/search?q=...&field=...[&refresh=true]
POST /api/v2/library/refresh
GET  /api/v2/library/search?q=...&field=...
GET  /api/v2/library/manifest
GET  /api/v2/library/{product_id}
POST /api/v2/library/{product_id}/acquisition
```

`GET /api/v2/status` est public pour permettre la découverte avant authentification. Les autres routes utilisent un token `kvt_...`.

Scopes :

```text
kobo.catalog.read
kobo.library.read
kobo.library.refresh
kobo.acquisition.read
kobo.acquisition.delegate
```

Les scopes `kobo.library.refresh` et `kobo.acquisition.delegate` sont séparés volontairement des lectures. Le défaut serveur générique reste au moindre privilège : si un client omet `scopes`, aucun de ces scopes privilégiés n’est ajouté. Dans l’IHM 0.9.8, le preset **Paris Library** propose explicitement les deux. Un token existant n’est jamais modifié : il faut le réémettre pour lui ajouter un scope.

Dans **Données → API fournisseur Kobo** :

- **Publier le manifest** crée la projection serveur de métadonnées ;
- **Créer un token API** crée un token consommateur `kvt_...`, stocké uniquement sous forme de SHA-256 ;
- **Activer l’accès Provider Kobo** publie les credentials nécessaires à la résolution d’acquisition et au refresh explicite de bibliothèque.

### Probe `library_sync` 0.9.5

La route d’administration interne `POST /api/v2/vault/{uid}/diagnostics/library-sync` compare les objets reçus lors d’une sync Kobo initiale et, lorsque possible, d’une sync incrémentale. Elle recherche les champs URL/download/content/key/mime/format, expurge les secrets et peut faire un `HEAD` sur les URLs de contenu candidates pour observer le type réellement servi sans télécharger l’ebook. Cette route utilise `X-Vault-Auth` et les credentials d’acquisition déjà publiés ; elle ne fait pas partie du contrat Provider.

Le script `scripts/probe-library-sync.mjs` facilite la capture :

```bash
KOBO_VAULT_URL=https://vault.example \
KOBO_VAULT_UID_HASH=<sha256-uid> \
KOBO_VAULT_AUTH=<secret> \
node scripts/probe-library-sync.mjs
```

Aucun candidat `library_sync` n’est encore publié dans `/acquisition` : 0.9.5 doit d’abord établir la preuve sur le corpus réel.

### Recherche

Le catalogue et la bibliothèque ont des routes séparées. Les recherches acceptent :

```text
field=all|title|author|isbn|subject
```

La recherche `subject` est best-effort lorsque les métadonnées Kobo ne fournissent pas une taxonomie explicite.

### Acquisition sans proxy EPUB

Le flux cible reste :

```text
Paris Library → Kobo Vault /acquisition → descripteur
Paris Library → outil local (ex. Kobo-Adept) → téléchargement direct → ~/EBooks
```

Deux modes sont disponibles :

- `descriptor` — candidats, format normalisé, format Kobo brut, famille DRM, mécanisme de traitement, `DisplayProfile` et validité, sans credential ;
- `delegated` — exige `kobo.acquisition.delegate` et ajoute une requête Kobo `content_access_book` reproductible localement, avec l’Authorization courante et le contexte de session utile.

Le corps accepte `display_profile=Android|Desktop` (`Android` par défaut). Vault transmet ce profil à Kobo et décrit **la réponse réelle** ; il ne suppose pas qu’un profil implique toujours un DRM donné.

Chaque candidat expose notamment :

```text
media_format      epub|kepub|pdf|acsm|unknown
source_format     valeur UrlFormat Kobo brute
handling          http_plain|adobe_adept|kobo_kdrm|unknown
drm.family        none|adobe_adept|kobo_kdrm|unknown
drm.raw_type      valeur DRMType Kobo brute
kobo.source          content_access_book|library_download_link|library_sync
kobo.display_profile Android|Desktop|null
kobo.platform        Android|Generic|...|null
kobo.content_keys_present
kobo.requires_kobo_authorization
headers              recette HTTP à appliquer au téléchargement
```

Pour les candidats `content_access_book`, `headers` contient notamment `x-amz-request-payer=requester`. Si le candidat exige le Bearer Kobo, celui-ci n’apparaît que dans une réponse `delegated`. Il est limité au premier origin Kobo ; le consommateur doit le retirer lors d’une redirection vers un origin tiers, tout en préservant `x-amz-request-payer` si nécessaire.

Un consommateur ne doit donc plus déduire la chaîne locale à partir de l’extension ou de l’URL seule. En particulier, un candidat HTTP KDRM ne doit pas être envoyé automatiquement vers un traitement ADEPT Adobe.

Le lookup ACSM est activé par défaut. Il peut être désactivé pour une requête avec `include_acsm=false`. Son résultat est décrit dans `acquisition.sources.acsm_export`, et son échec reste non bloquant si `content_access_book` a fourni d’autres candidats.

Le refresh token Kobo n’est jamais exposé. Les informations temporaires se renouvellent en redemandant `/acquisition` (`refresh_strategy=resolve_again`). `expires_at` peut être `null` si Kobo ne publie pas d’expiration interprétable.

Kobo Vault ne transmet pas le binaire EPUB et ne stocke pas les backups. Les **valeurs** `ContentKeys` ne sont pas renvoyées par Vault ; leur présence et leur nombre sont indiqués. En mode `delegated`, l’outil local peut rejouer `content_access_book` directement auprès de Kobo et obtenir la réponse native si son propre moteur sait traiter KDRM.

Pour que l’acquisition et le rafraîchissement Provider fonctionnent sans navigateur ouvert, l’utilisateur doit activer explicitement l’**Accès Provider Kobo**. Une copie des tokens Kobo est alors chiffrée AES-GCM dans D1 à l’aide du secret Cloudflare `KOBO_API_CREDENTIAL_KEY`. Cette option est désactivée par défaut et n’est pas zero-knowledge vis-à-vis du Worker.

Configuration :

```bash
./scripts/configure-acquisition-secret.sh
```

### Compatibilité

Les routes Provider restent sous `/api/v2/`. La révision courante est **v2.3.3** : `api_version` reste `2.3` et le schéma d’acquisition est **1.4**. Cette révision autorise notamment `kobo.source=library_sync`. La 0.9.7 ne modifie ni l’OpenAPI 2.3.3 ni le schéma acquisition 1.4 ; elle améliore uniquement leur production et l’UX de provisioning. L’API `/api/v1/` jobs/agents reste obsolète et désactivée par défaut ; `LEGACY_API_V1_ENABLED=true` ne sert qu’à une compatibilité temporaire.

La source canonique du contrat publié se trouve sous `interfaces/`. Les fichiers `docs/API_V2.md` et `docs/PARIS_LIBRARY_0.5_COMPATIBILITY.md` ne sont que des vues documentaires de commodité ; il n’existe plus de miroir `docs/interfaces/`.

## Architecture

```text
Navigateur
  ├─ HTML / CSS / JavaScript natif
  ├─ Web Crypto : PBKDF2 + AES-256-GCM
  ├─ IndexedDB : copie locale chiffrée du coffre + cache catalogue public séparé
  └─ Service Worker : shell PWA
           │
           ▼ HTTPS
Cloudflare Worker
  ├─ proxy/connecteur Kobo
  ├─ Cache API pour les résultats publics du catalogue
  ├─ API du coffre
  └─ API v2 fournisseur Kobo (+ API v1 legacy)
           │
           ├─ Kobo store/auth APIs (requêtes interactives existantes)
           └─ Cloudflare D1
                ├─ UID hashé, sel, hash du secret d’authentification
                ├─ fragments AES-GCM du coffre
                └─ projection API + tokens hashés + credentials Provider Kobo chiffrés (optionnels)
```

Aucun framework frontend et aucune dépendance runtime. Wrangler est uniquement une dépendance de développement/déploiement.

## Sécurité du coffre

Le mot de passe du coffre n’est jamais envoyé à Cloudflare. Le navigateur dérive deux secrets distincts à partir de `UID + mot de passe + sel` :

- une clé AES-256-GCM pour chiffrer/déchiffrer les données ;
- un secret d’authentification distinct dont le Worker ne stocke qu’un hash.

Le coffre contient uniquement les acquisitions, les jetons Kobo, les états « lu/déjà connu » et les préférences synchronisées. **Le cache catalogue public n’est plus inclus dans le coffre depuis la V0.5.2.** Par défaut, D1 ne reçoit que le blob chiffré du coffre, découpé en fragments.

Depuis la V0.6.0, l’utilisateur peut **activer explicitement** une projection API de métadonnées. En V0.9.5, cette projection reste sans credentials ni binaire. Une seconde option, **Accès Provider Kobo**, peut publier séparément les tokens Kobo sous forme chiffrée côté serveur afin que l’API v2 puisse résoudre les recettes d’acquisition et rafraîchir la bibliothèque sans navigateur ouvert. Cette seconde option n’est pas zero-knowledge vis-à-vis du Worker et reste désactivée par défaut.

### Session persistante par appareil

Si **Rester connecté sur cet appareil** est activé, la V0.9.5 conserve le mécanisme introduit en V0.5.1 : une enveloppe de session chiffrée AES-GCM dans IndexedDB. Elle contient uniquement le matériel dérivé nécessaire à la réouverture du coffre ; le mot de passe lui-même n’est jamais stocké. Un secret aléatoire propre à ce navigateur, stocké séparément dans le stockage local, protège cette enveloppe. Cette solution évite de dépendre de la sérialisation directe d’une `CryptoKey`, qui peut être fragile selon les versions de Firefox. La session expire après 180 jours et est supprimée immédiatement par **Verrouiller** ou lors de la suppression du coffre. Comme toute fonction « rester connecté », elle doit être désactivée sur un appareil partagé.

## Cache catalogue

Deux niveaux sont utilisés :

1. **IndexedDB local**, dans un store séparé du coffre chiffré, TTL de 7 jours ; une entrée est plafonnée à 6 Mio et l’ensemble du cache à 24 Mio avec éviction des entrées les plus anciennes ;
2. **Cloudflare Cache API** côté Worker, TTL de 24 h par défaut (`CATALOG_CACHE_TTL_SECONDS=86400`).

Le cache IndexedDB contient uniquement des métadonnées catalogue publiques et n’est jamais synchronisé vers D1. Une recherche trop volumineuse reste utilisable en mémoire mais n’est simplement pas conservée dans ce cache local. La clé Cloudflare est synthétique et ne contient que la requête normalisée, la langue et la pagination. Les access/refresh tokens Kobo ne sont jamais inclus dans la clé ni dans la valeur publique mise en cache.

Le bouton **Actualiser Kobo** ignore les deux caches pour la recherche en cours et remplace les résultats. Les guillemets font partie de la sémantique de la clé : `quai des orfèvres` et `"quai des orfèvres"` ne partagent pas le même cache.


### Diagnostic des notes Kobo (V0.5.4)

La récupération des notes suit désormais la structure observée sur une réponse Kobo réelle : **`product_reviews` en priorité avec le `RevisionId` dans la route**, puis `book`/`audiobook` avec ce même `RevisionId`. Pour les reviews, la valeur de référence est `ReviewSummary[ProductId].AvgRating` et le nombre de notes est `OpinionCount` ; `NumberOfReviews` correspond seulement aux critiques textuelles et n’est pas utilisé comme compteur de notes. L’endpoint produit détaillé fournit en fallback `Rating` + `TotalRating`. Les pages publiques Kobo ne sont utilisées qu’en dernier recours. **Les absences de note ne sont pas mises en cache**.

Dans **Données → Diagnostic → Notes communautaires Kobo**, choisissez un livre puis **Tester la récupération**. Le rapport affiche les endpoints interrogés, codes HTTP, clés JSON de premier niveau et uniquement les champs dont le nom évoque `rating`, `review`, `star`, `average`, `count` ou `total`. Les jetons Kobo et le texte des avis ne sont jamais inclus dans ce rapport. Le bouton **Actualiser toutes les notes** force une nouvelle collecte sans attendre l'expiration du cache positif.

### Migration V0.5.2 / correction « Payload too large »

Les versions V0.3 à V0.5.1 pouvaient placer les résultats complets de rapprochement dans le coffre synchronisé. Plusieurs recherches volumineuses pouvaient alors faire dépasser la limite de payload du Worker. À l’ouverture, la V0.5.2 détecte automatiquement un coffre ancien (schéma < 4 ou présence de `catalogCache`), retire ce cache reconstructible et réécrit une version compacte. **Il ne faut pas supprimer le coffre ni les acquisitions pour effectuer cette migration.**

## Notes communautaires Kobo

La normalisation conserve `averageRating` (0–5) et `ratingCount` lorsqu’ils sont présents dans les métadonnées Kobo. Depuis la V0.5.4, l’enrichissement utilise d’abord `/v1/products/{RevisionId}/reviews` et lit `ReviewSummary[ProductId].AvgRating` + `OpinionCount`. Il utilise ensuite `/v1/products/books/{RevisionId}` (ou audiobook) avec `Rating` + `TotalRating`, puis seulement les pages publiques en dernier fallback. Les fiches publiques sont essayées sur plusieurs boutiques francophones afin de contourner les variantes HTML servies selon la région.

Seuls les résultats **positifs** sont mis en cache avec la Cloudflare Cache API pendant 7 jours par défaut (`RATING_CACHE_TTL_SECONDS=604800`). Une absence de note ou un parse raté n’est plus mise en cache. Les valeurs finales sont enregistrées dans le coffre chiffré afin de rester disponibles hors ligne et sur les autres appareils. Une panne de l’enrichissement ne bloque jamais la synchronisation de bibliothèque.

Pour un coffre existant, utilisez **Données → Actualiser toutes les notes**. Si un titre qui affiche des étoiles sur kobo.com reste sans note, lancez **Tester la récupération** sur ce titre puis copiez le diagnostic : il indique quelle ressource Kobo répond et quels champs liés aux notes sont réellement présents, sans inclure les tokens ni le texte des avis.

## Prérequis Linux

- Node.js 20 ou supérieur ;
- npm ;
- `unzip` et `tar` ;
- un compte Cloudflare avec Workers et D1 disponibles.

## Premier déploiement

```bash
unzip kobo-library-vault-v0.9.8.zip
cd kobo-library-vault
./scripts/setup-cloudflare.sh
```

Le script installe Wrangler, authentifie le poste, crée/retrouve la base D1, génère `wrangler.jsonc`, applique les migrations puis déploie Worker + assets.

Pour le développement local :

```bash
./scripts/dev.sh
```

Pour redéployer :

```bash
./scripts/deploy.sh
```

## Mise à jour depuis une version précédente

### Depuis GitHub

Depuis une installation KVault existante, la commande recommandée est :

```bash
bash scripts/update_from_git
```

Elle résout `pzia/KVault:main` en SHA GitHub immuable, télécharge exactement cette révision, puis réutilise l'updater transactionnel : staging, `npm ci`, tests, sauvegarde locale, migrations D1 et déploiement Wrangler. `wrangler.jsonc`, `.dev.vars`, `.wrangler/` et `.git/` restent préservés.

Prévalidation sans modification :

```bash
bash scripts/update_from_git --dry-run
```

Révision précise ou mise à jour locale sans déploiement :

```bash
bash scripts/update_from_git --ref <tag-branche-ou-sha>
bash scripts/update_from_git --no-deploy
```

`GITHUB_TOKEN` est optionnel et sert uniquement à l'accès/rate limiting GitHub ; il n'est pas transmis à Cloudflare ni inclus dans la distribution.

### Depuis un ZIP

Depuis le répertoire de votre installation actuelle :

```bash
./scripts/update-from-zip.sh ~/Téléchargements/kobo-library-vault-v0.9.8.zip --install --deploy
```

La V0.9.8 conserve le pipeline transactionnel : l’archive est validée et extraite en staging, la release candidate est testée avant toute bascule locale et, avec `--deploy`, elle est déployée depuis le staging validé.

Prévalidation sans effet de bord :

```bash
./scripts/update-from-zip.sh ~/Téléchargements/kobo-library-vault-v0.9.8.zip --dry-run
```

Sans déploiement immédiat :

```bash
./scripts/update-from-zip.sh ~/Téléchargements/kobo-library-vault-v0.9.8.zip --install
```

Rollback vers la dernière sauvegarde transactionnelle :

```bash
./scripts/update-from-zip.sh --rollback --install --deploy
```

Le script préserve :

- `wrangler.jsonc` ;
- `.dev.vars` ;
- `.wrangler/` ;
- `.git/` ;
- les données D1 distantes.

Avec `--install`, `node_modules/` n’est remplacé qu’après installation et tests réussis dans le staging. Les sauvegardes de distribution sont placées dans `../.kobo-library-vault-backups/` et n’embarquent ni configuration locale ni secret. Trois sauvegardes sont conservées par défaut (`KOBO_VAULT_KEEP_BACKUPS` permet de changer cette valeur).

La V0.9.8 ne nécessite **aucune nouvelle migration D1**. Le protocole reste en **v2.3**, avec la révision **v2.3.4** et le schéma acquisition **1.4** ; voir `interfaces/MIGRATION_V2.3.3_TO_V2.3.4.md`. Voir `docs/DISTRIBUTION_PROFILE.md` pour l’adaptation du blueprint commun à Kobo Vault.

## Configuration Cloudflare

Extrait de `wrangler.jsonc.example` :

```jsonc
"vars": {
  "APP_VERSION": "0.9.5",
  "KOBO_APP_VERSION": "4.44.23552",
  "CATALOG_CACHE_TTL_SECONDS": "86400",
  "RATING_CACHE_TTL_SECONDS": "604800"
}
```

Une ancienne installation dont `wrangler.jsonc` ne contient pas les variables de TTL fonctionne sans modification : le Worker utilise 86400 secondes pour le catalogue et 604800 secondes pour les notes publiques.

## Utilisation

1. Ouvrir l’application et créer/ouvrir le coffre avec un UID et un mot de passe d’au moins 10 caractères. Cocher **Rester connecté sur cet appareil** pour permettre la réouverture automatique ; le bouton **Verrouiller** efface cette session locale.
2. Dans **Compte Kobo**, lancer l’activation, saisir le code sur la page Kobo puis terminer l’activation.
3. Dans **Bibliothèque**, cliquer sur **Synchroniser Kobo**.
4. Rechercher/filtrer/trier la bibliothèque ou cliquer sur un auteur.
5. Dans **Rapprochement**, choisir Auteur, Série / collection ou Recherche libre, puis utiliser les cartes de synthèse pour ne voir que les titres potentiellement manquants ; marquer éventuellement certains titres comme déjà lus/connus.
6. Consulter **Stats** pour le classement des auteurs.
7. Dans **Données**, vérifier l’état PWA, synchroniser le coffre ou exporter les données.

## Navigation navigateur

Les changements d’onglet sont inscrits dans l’historique via la History API. Le bouton **Retour** du navigateur ou du téléphone revient donc à l’onglet précédent. Lorsqu’un auteur est ouvert depuis Bibliothèque ou Stats, revenir en arrière ramène à la vue précédente ; l’état principal du formulaire de Rapprochement est conservé dans l’entrée d’historique.

## Firefox Android / installation

La V0.3 fournit tous les éléments installables attendus par une PWA : manifest, icônes, `display: standalone`, scope et service worker. Certains navigateurs n’exposent pas l’événement `beforeinstallprompt`; l’application ne s’appuie donc pas exclusivement dessus.

Sur Firefox Android, ouvrez le menu du navigateur et utilisez **Installer** ou **Ajouter l’app à l’écran d’accueil** lorsque cette option est proposée. L’onglet **Données → Diagnostic Web App** permet de vérifier que le manifest et le service worker sont détectés.

## Tests

```bash
npm run check
```

La suite vérifie :

- syntaxe Worker/frontend ;
- chiffrement/déchiffrement ;
- normalisation des réponses Kobo ;
- matching auteur et non-régressions `Ken Follet` ;
- rapprochement Possédé/Lu/Manquant et modes Auteur/Série/Libre ;
- navigation par historique navigateur (`Back`/`Forward`) entre les onglets ;
- fusion multi-device ;
- tri et année de parution ;
- statistiques auteurs ;
- manifest et dimensions des icônes PWA.

Les scripts shell peuvent être validés avec :

```bash
bash -n scripts/*.sh
```

## Limites connues

- les endpoints Kobo sont non documentés et peuvent évoluer ;
- l’enrichissement des notes dépend aussi de la structure HTML/JSON-LD des fiches produit publiques Kobo ; plusieurs stratégies de parsing sont prévues, mais Kobo peut la modifier ;
- le catalogue Kobo peut être incomplet ou retourner des métadonnées différentes selon pays/langue ;
- une recherche catalogue est limitée à 10 pages par sécurité ;
- la Cache API Cloudflare est un cache opportuniste et peut être vide selon le datacenter ;
- le comportement exact d’installation PWA dépend du navigateur et de la plateforme ; l’application fournit les métadonnées nécessaires mais ne peut pas forcer Firefox à afficher une option d’installation.

## Fichiers principaux

```text
public/index.html                 UI
public/app.css                    responsive design
public/app.js                     contrôleur frontend
public/model.js                   filtres, matching, stats, tris, fusion
public/crypto.js                  cryptographie
public/storage.js                 IndexedDB
public/manifest.webmanifest       PWA
public/sw.js                      service worker
public/icons/                     icônes PWA
src/worker.js                     API Cloudflare + connecteur Kobo + cache
migrations/0001_init.sql          D1
scripts/setup-cloudflare.sh       premier déploiement
scripts/update-from-zip.sh        mise à jour transactionnelle depuis ZIP
scripts/update_from_git            récupération GitHub + validation + déploiement
scripts/deploy.sh                 déploiement courant
tests/                            non-régressions
```

## Licence

MIT. Voir `LICENSE`.
