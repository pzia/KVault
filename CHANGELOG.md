# Changelog

## 0.9.8 — 2026-11-06

- passe le contrat Provider à **2.3.4** sans modifier le schéma acquisition **1.4** ;
- rend passives les lectures `/api/v2/library/manifest`, `/library/search` et `/library/{product_id}` : elles ne déclenchent plus de synchronisation Kobo implicite ;
- ajoute `POST /api/v2/library/refresh`, protégé par le nouveau scope opt-in `kobo.library.refresh`, avec états typés, verrou/singleflight, délai minimal 5 min et backoff 15 min ;
- conserve les anciens tokens sans élévation automatique ; le preset Paris Library permet explicitement d'accorder le scope de refresh ;
- ajoute `refresh=true` à `GET /api/v2/catalog/search` pour contourner et remplacer la clé de cache Provider courante, avec `cache_status` et `origin_fetched_at` ;
- invalide la fraîcheur de bibliothèque lorsque les credentials Provider Kobo sont republiés ;
- ajoute `scripts/update_from_git` : résolution d'une ref GitHub vers un SHA immuable, téléchargement de l'archive exacte, validation transactionnelle via `update-from-zip.sh`, puis déploiement Cloudflare par défaut ;
- ajoute `--dry-run`, `--no-deploy`, `--ref` et support optionnel de `GITHUB_TOKEN` à l'updater GitHub ;
- conserve `wrangler.jsonc`, `.dev.vars`, `.wrangler/`, `.git/`, les données D1 et le mécanisme de rollback existant ;
- ajoute les tests de contrat/intégration 0.9.8 et incrémente le cache PWA à `kobo-vault-v098` ;
- aucune migration D1.

## 0.9.7 — 2026-09-30

- supprime la création implicite d’un coffre lorsqu’un UID inconnu est saisi sur l’écran d’ouverture ; un UID inconnu renvoie désormais une erreur explicite ;
- ajoute un parcours explicite de création de compte Vault depuis un compte déjà ouvert, ainsi qu’un bootstrap explicite lorsqu’aucun profil n’est encore connu sur l’appareil ;
- ajoute un sélecteur de profils/coffres connus localement pour basculer entre identités sans exposer ni fusionner leurs données ;
- renomme l’option visible « accès acquisition » en **Accès Provider Kobo**, car les credentials publiés servent à l’acquisition et au rafraîchissement autonome de bibliothèque ;
- rend le scope sensible `kobo.acquisition.delegate` nettement visible dans le preset **Paris Library** et le coche par défaut, avec un avertissement indiquant qu’il est requis pour les acquisitions KDRM déléguées ; le défaut serveur générique reste au moindre privilège et n’accorde pas ce scope implicitement ;
- les tokens existants ne sont jamais élevés automatiquement : un token Paris ancien sans `kobo.acquisition.delegate` doit être réémis puis remplacé côté Paris ;
- normalise explicitement Kobo `FLEPUB` en `media_format=epub` tout en conservant `source_format=FLEPUB` ;
- sépare les axes Kobo : les candidats issus de `library_sync` exposent `kobo.display_profile=null` et `kobo.platform=Android|Generic|...` selon la recette réelle ;
- renforce la déduplication sémantique des recettes `library_sync`, y compris lorsque plusieurs entitlements portent des URLs tokenisées différentes pour la même recette ; les variantes `*SAMPLE` restent exclues ;
- ajoute un test d’intégration du cas Paris : token sans délégation → `403`, token Paris avec délégation → recette KDRM delegated exploitable, sans exposition de `ContentKeys` ni refresh token ;
- aucune migration D1 ; Provider API **2.3 / révision 2.3.3** et acquisition **1.4** inchangés ;
- cache PWA `kobo-vault-v097`.

## 0.9.6.4 — 2026-09-29

- ajoute une fraîcheur automatique de la projection bibliothèque Provider : première page de `/api/v2/library/manifest`, première page de `/api/v2/library/search` et `GET /api/v2/library/{product_id}` déclenchent une synchro Kobo si la dernière synchro réussie date de plus de 24 h ;
- ne déclenche aucun refresh sur `/api/v2/catalog/search`, qui reste le catalogue Kobo global ;
- réutilise côté Worker les credentials Kobo déjà publiés/chiffrés pour l'accès Provider et le moteur `/v1/library/sync` existant ;
- republie automatiquement la projection D1 après une synchro réussie et persiste les credentials si Kobo renouvelle le token ;
- ajoute un verrou de refresh de 5 minutes par `uid_hash`, afin que plusieurs installations Paris partageant la même identité Vault ne lancent pas la même sync en parallèle ;
- en cas d'échec Kobo, sert la dernière projection disponible et applique un backoff de 15 minutes avant une nouvelle tentative automatique ;
- évite tout refresh au milieu d'une pagination de manifest/recherche ;
- la publication depuis l'IHM transmet désormais `purchasesFetchedAt` comme `source_sync_at`, afin que Vault connaisse la date de la vraie synchro Kobo et non seulement la date de publication de la projection ;
- ajoute la migration D1 `0004_library_sync_state.sql` (`last_success_at`, `last_attempt_at`, `last_error`, verrou de refresh) ;
- Provider API 2.3 / révision 2.3.3 et acquisition 1.4 inchangés ;
- cache PWA `kobo-vault-v0964` ;
- ajoute un test d'intégration couvrant fraîcheur 24 h, pagination, verrou multi-Paris, snapshot navigateur ancien, fallback stale et backoff après panne Kobo.

## 0.9.6.3 — 2026-09-29

- corrige le chemin catalogue Kobo lorsque les résultats `/v1|v2/products` exposent `ImageId` plutôt que `CoverImageId`/`CoverImageUrl` ;
- accepte aussi `ImageUrl` comme URL directe de couverture ;
- conserve les correctifs 0.9.6.2 pour `library_sync`, Bibliothèque et Rapprochement ;
- invalide à nouveau les caches catalogue Vault (`v3`) pour purger les résultats `cover_url:null` déjà mémorisés ;
- cache PWA `kobo-vault-v0963` ;
- aucun changement D1 ni contrat : Provider 2.3.3 / acquisition 1.4 inchangés ;
- les évolutions 0.9.6.1 restent reportées.

## 0.9.6.2 — 2026-09-29

- corrige les couvertures lorsque Kobo fournit `CoverImageUrl` sans `CoverImageId` ;
- normalise les URLs protocol-relative `//cdn.kobo.com/...` en HTTPS ;
- utilise l'URL Kobo directe en priorité et conserve `CoverImageId` comme fallback CDN ;
- applique la correction à Bibliothèque, Rapprochement, projection D1 et API Provider catalogue/bibliothèque ;
- invalide les caches catalogue Vault afin de ne pas resservir les anciennes notices sans cover ;
- cache PWA `kobo-vault-v0962` ;
- aucun changement D1 ni contrat : Provider 2.3.3 / acquisition 1.4 inchangés ;
- basée sur la 0.9.6 validée ; les évolutions 0.9.6.1 restent reportées.

## 0.9.6 — 2026-09-28

- Provider contract 2.3.3 / acquisition schema 1.4.
- fallback d’acquisition `library_sync` lorsque `content_access_book` ne fournit aucune URL ;
- normalisation de `BookMetadata.DownloadUrls` en candidats standards, avec `kobo.source=library_sync` ;
- conservation du `handling=kobo_kdrm` pour `FLEPUB/KDRM`, sans exposition des ContentKeys ;
- exclusion des variantes `*SAMPLE` des candidats de livre complet ;
- diagnostic transport passé de HEAD à GET borné par `Range: bytes=0-0` ;
- aucun changement D1 ; cache PWA `kobo-vault-v096`.

## 0.9.5.1 — 2026-09-28

- ajoute dans l’IHM du coffre un bouton **Lancer le diagnostic library_sync** ;
- réutilise directement `session.uidHash` et `session.authSecret` : aucune extraction manuelle depuis les DevTools ;
- si l’accès acquisition API n’est pas publié, publie temporairement les jetons Kobo chiffrés le temps du probe puis les supprime dans un `finally` ;
- permet de copier ou télécharger le rapport JSON expurgé ;
- ne modifie ni le Provider API, ni `/acquisition`, ni le contrat OpenAPI 2.3.2 ;
- cache PWA incrémenté à `kobo-vault-v0951`.


## 0.9.5 — 2026-09-28

- ajoute un probe d’administration `POST /api/v2/vault/{uid}/diagnostics/library-sync` pour déterminer si `/v1/library/sync` transporte une recette d’acquisition absente de `content_access_book` / `get_download_link` ;
- corpus par défaut : Livre test KDRM A, Livre test KDRM B et Livre test sans recette (ProductId fournis pour l’investigation) ;
- capture séparément sync initiale et sync incrémentale lorsque Kobo fournit un `x-kobo-synctoken`, avec type des événements et signaux URL/download/content/key/mime/format ;
- expurge tokens, secrets, valeurs `ContentKeys` et valeurs des paramètres signés/tokenisés ; conserve les hosts et noms de paramètres ;
- identifie les noms de headers nécessaires sans exposer les credentials et teste les URLs candidates uniquement par `HEAD` (aucun téléchargement/stream de livre par Vault) ;
- rapporte le `Content-Type`, la disposition et un format observé/inféré sans supposer PDF/EPUB/KEPUB ;
- ajoute `scripts/probe-library-sync.mjs` pour produire un rapport JSON local à partir d’un Vault déployé ;
- ne transforme pas encore les URLs de sync en `acquisition.candidates` : cette décision est conditionnée par les captures réelles du corpus ;
- aucune migration D1 et aucun changement du contrat Provider 2.3.2 / acquisition 1.3 ;
- ajoute le handoff `docs/HANDOFF_0.9.5.md` et les tests `tests/api-v095.test.mjs`.

## 0.9.4 — 2026-09-28

- consolide tous les appels HTTP Kobo derrière une politique réseau commune (`koboFetch`) sans modifier le contrat Provider 2.3.2 ;
- ajoute un timeout par tentative de 10 s et un maximum de 2 retries (3 tentatives au total) ;
- retente uniquement les erreurs transitoires `408`, `429`, `500`, `502`, `503` et `504`, ainsi que les erreurs réseau/timeout ;
- applique un backoff exponentiel borné et respecte `Retry-After` lorsqu’il est fourni par Kobo, avec attente locale plafonnée à 2 s ;
- conserve les réponses finales amont après épuisement des retries afin que les couches métier puissent les classifier ;
- homogénéise les erreurs Kobo : `429` reste `429` au lieu d’être aplati en `502`, avec propagation de `Retry-After` ; les indisponibilités réseau et timeouts deviennent des erreurs Kobo explicites `502` ;
- couvre la politique de retry, le parsing `Retry-After`, le bornage des tentatives, le timeout et la propagation `429` par `tests/api-v094.test.mjs` ;
- aucune migration D1, aucune modification du schéma acquisition 1.3 et aucune révision du contrat OpenAPI 2.3.2 ;
- ajoute le handoff `docs/HANDOFF_0.9.4.md`.

## 0.9.3 — 2026-09-28

- Provider API 2.3 gelée ; révision de contrat 2.3.2 et acquisition 1.3.
- `/status` expose `api_version`, `contract_revision` et `acquisition_schema_version`.
- `kobo.acquisition.delegate` n’est plus accordé par défaut ; activation explicite uniquement.
- API v1 jobs/agents obsolète et désactivée par défaut (`LEGACY_API_V1_ENABLED=true` pour compatibilité temporaire).
- routes `/api/v2/vault/{uid}/...` documentées comme administration interne, hors contrat Provider.
- distribution reproductible : Wrangler 4.30.0 verrouillé, lockfile distribué, `npm ci` dans les scripts.
- bootstrap de lockfile sous `scripts/` pour la transition depuis les updaters <= 0.9.2, qui ne copiaient pas encore `package-lock.json`.
- `interfaces/` devient la source canonique ; suppression du miroir `docs/interfaces/`.
- ACSM explicitement best effort/expérimental.
- ajout du handoff `docs/HANDOFF_0.9.3.md`.
- aucune migration D1.

## 0.9.2 — 2026-09-27

- durcit la normalisation `content_access_book` : accepte `ContentUrls` **et** `DownloadUrls` ;
- accepte `DownloadUrl` **et** `Url` dans chaque entrée Kobo ;
- ne supprime plus le paramètre `b` des URLs S3 déjà pré-signées afin de ne pas invalider leur signature ;
- conserve plusieurs candidats dédupliqués jusqu’à la limite de sécurité au lieu de dépendre d’une seule variante ;
- ajoute `x-amz-request-payer=requester` aux headers des candidats `content_access_book` afin de supporter les redirects Kobo vers S3 requester-pays ;
- détecte les premiers hops `kobo.com` / `kobobooks.com` nécessitant potentiellement le Bearer et n’expose celui-ci qu’en mode `delegated` ;
- documente que l’Authorization Kobo ne doit jamais être propagée vers un origin tiers lors d’un redirect ;
- retourne `409 archived_book` pour un livre projeté comme archivé, avant tout appel de contenu amont ;
- publie la révision de contrat compatible **v2.3.1** (`api_version=2.3`, acquisition `schema_version=1.3`) ;
- ajoute `DOWNLOAD_TRANSPORT_SEMANTICS.md` et `MIGRATION_V2.3_TO_V2.3.1.md` ;
- aucune migration D1 ; cache PWA incrémenté en V0.9.2.

## 0.9.1 — 2026-09-27

- fait évoluer le contrat fournisseur vers **Kobo Vault Provider API v2.3** et le schéma acquisition vers **1.3** ;
- tente désormais la ressource Kobo `get_download_link` afin de récupérer l’URL d’export ACSM en complément de `content_access_book` ;
- ajoute le candidat ACSM (`kind=acsm`, `handling=adobe_adept`) dans la même liste que les candidats EPUB/KEPUB/PDF ;
- ajoute `kobo.source` et `kobo.requires_kobo_authorization` à chaque candidat ;
- ajoute `acquisition.sources` pour distinguer disponibilité des sources `content_access_book` et `acsm_export` ;
- ajoute `include_acsm=false` pour désactiver ponctuellement le lookup alternatif ;
- conserve les autres candidats si la résolution ACSM échoue ou n’est pas disponible ;
- ne stocke ni ACSM ni EPUB/PDF côté Cloudflare ;
- cache PWA incrémenté en V0.9.1.

## 0.9.0 — 2026-09-27

- fait évoluer le contrat fournisseur vers **Kobo Vault Provider API v2.2** et le schéma acquisition vers **1.2** ;
- cesse d’aplatir un candidat Kobo en simple « URL + format » : ajoute `media_format`, `source_format`, `handling`, `drm.family`, `drm.raw_type` et le contexte `kobo` ;
- distingue explicitement `http_plain`, `adobe_adept`, `kobo_kdrm` et `unknown` ;
- conserve les champs v2.1 `format`, `drm_type`, `protected` pour transition, mais les marque dépréciés dans le schéma ;
- ajoute `display_profile=Android|Desktop` à `/api/v2/library/{product_id}/acquisition` et rapporte le profil réellement utilisé ;
- expose uniquement la présence et le nombre de `ContentKeys`, jamais leurs valeurs ;
- en mode `delegated`, décrit explicitement que le consommateur local peut rejouer `content_access_book` pour obtenir la réponse native Kobo ;
- ajoute les capabilities `acquisition_drm_metadata` et `acquisition_display_profiles` ;
- publie `DRM_ACQUISITION_SEMANTICS.md` et `MIGRATION_V2.1_TO_V2.2.md` ;
- ajoute des tests de classification SignedNoDrm / AdobeDrm / KDRM et de variation `DisplayProfile` ;
- aucune nouvelle migration D1 ; le mécanisme d’update transactionnel de V0.8.1 est conservé ;
- cache PWA incrémenté en V0.9.0.

## 0.8.1 — 2026-09-27

- applique à Kobo Vault les invariants transposables du blueprint commun de distribution : staging, validation avant bascule, séparation stricte code/configuration/données et rollback ;
- refond `scripts/update-from-zip.sh` pour valider l’archive avant extraction utile, refuser path traversal et symlinks, vérifier l’identité projet et tester la release candidate avant de modifier l’installation active ;
- ajoute `--dry-run` sans effet de bord ;
- avec `--install`, installe les dépendances et exécute les tests dans le staging avant la bascule locale ;
- avec `--deploy`, déploie la release candidate validée après la bascule locale contrôlée ; un échec de déploiement restaure automatiquement la distribution locale précédente ;
- crée des sauvegardes transactionnelles de la distribution sans inclure `wrangler.jsonc`, `.dev.vars` ni secrets, avec rétention configurable ;
- ajoute `--rollback` vers la dernière sauvegarde transactionnelle ;
- publie `docs/DISTRIBUTION_PROFILE.md` ;
- aucun changement de l’API fournisseur : contrat v2.1 ; aucune migration D1.

## 0.8.0 — 2026-09-27

- vérifie l’API fournisseur par rapport à l’expression de besoins **Paris Library 0.5.0** ;
- fait évoluer le contrat public vers **API v2.1** ;
- rend `GET /api/v2/status` utilisable sans token et ajoute `capability_details` ;
- ajoute `GET /api/v2/library/search` et `field=all|title|author|isbn|subject` ;
- complète les résultats catalogue avec métadonnées et état de possession ;
- ajoute le scope sensible `kobo.acquisition.delegate` ;
- ajoute les modes `descriptor` et `delegated` à `/acquisition` ;
- n’expose jamais le refresh token Kobo ni les valeurs `ContentKeys` ;
- ajoute le bloc `validity` et conserve le principe sans proxy EPUB ;
- publie le bundle d’interfaces v2.1 ; aucune nouvelle migration D1.

## 0.7.0 — 2026-09-27

- réaligne Kobo Vault sur le blueprint global : **Paris décide, Vault expose Kobo, Adept exécute localement** ;
- introduit l’API provider `/api/v2/` avec scopes génériques `kobo.catalog.read`, `kobo.library.read`, `kobo.acquisition.read` ;
- ajoute `GET /api/v2/catalog/search`, indépendant d’un agent local, via une session Kobo anonyme côté Worker et cache des métadonnées publiques ;
- conserve la projection opt-in de bibliothèque et ajoute `GET /api/v2/library/{product_id}` ;
- remplace, dans l’architecture cible, les jobs/agents Vault par `POST /api/v2/library/{product_id}/acquisition`, qui retourne des URL et métadonnées d’artefacts à un consommateur ;
- l’endpoint d’acquisition ne streame jamais l’EPUB, n’expose jamais les `ContentKeys` Kobo et n’effectue aucun retrait de DRM ;
- ajoute un bridge d’acquisition **optionnel** : copie des tokens Kobo chiffrée AES-GCM dans D1 avec le secret Cloudflare `KOBO_API_CREDENTIAL_KEY` ;
- ajoute `scripts/configure-acquisition-secret.sh` pour initialiser ce secret sans l’inscrire dans le dépôt ;
- ajoute la migration `0003_provider_api_v2.sql` ;
- supprime de l’interface utilisateur l’appairage Adept et le pilotage des jobs ;
- conserve `/api/v1/` comme couche legacy transitoire afin de ne pas imposer de montée de version simultanée ;
- publie les interfaces sous `interfaces/` (miroir `docs/interfaces/`) : OpenAPI 3.1 + JSON Schema ;
- intègre le blueprint global validé dans `docs/GLOBAL_ROLES_REFERENCE.md` ;
- cache PWA incrémenté en V0.7.0 et tests API v2 ajoutés.

## 0.6.0 — 2026-09-17

- ajoute l’API privée versionnée `/api/v1/` issue du blueprint Paris Library / kobo-adept ;
- conserve les credentials Kobo dans le coffre chiffré : le nouveau contrat externe ne reçoit ni access token ni refresh token Kobo ;
- ajoute une **projection de métadonnées opt-in** pour le manifest Paris Library, supprimable indépendamment du coffre ;
- ajoute les bearer tokens Paris Library à scopes (`paris.read`, `paris.jobs.create`), affichés une seule fois et stockés uniquement sous forme de hash SHA-256 ;
- ajoute `GET /status`, `/account`, `/search?scope=library`, `/library/manifest`, création et suivi des `download-jobs` ;
- remplace le streaming EPUB via Cloudflare par une orchestration : Paris Library crée un job, `kobo-adept` le récupère puis télécharge directement depuis Kobo vers le stockage local ;
- ajoute l’appairage `kobo-adept` par code temporaire, tokens agent séparés, heartbeat, claim avec lease, progress, complete et failed ;
- ajoute un écran **Données → Paris Library & kobo-adept** pour publier/retirer la projection, créer/révoquer des tokens, approuver/révoquer des agents et consulter les derniers jobs ;
- les résultats d’agent ne remontent que des métadonnées (`filename`, taille, SHA-256, résultat du hook), jamais le contenu EPUB ;
- ajoute la migration D1 `0002_api_jobs.sql` pour projections, tokens, appairages, agents et jobs ;
- la recherche catalogue externe n’est volontairement **pas** annoncée en V0.6.0 : `scope=catalog|all` renvoie `catalog_search_requires_agent` tant qu’aucun protocole de recherche via agent n’est défini ;
- cache PWA incrémenté en V0.6.0 et nouveaux tests de sécurité/normalisation API.

## 0.5.4 — 2026-08-21

- corrige la récupération de masse des notes Kobo à partir du diagnostic réel V0.5.3 : les endpoints produit/reviews utilisent le `RevisionId` dans la route ;
- donne la priorité à `product_reviews` via `/v1/products/{RevisionId}/reviews` et lit explicitement `ReviewSummary[ProductId].AvgRating` + `OpinionCount` ;
- utilise `/v1/products/books/{RevisionId}` en fallback avec les champs `Rating` + `TotalRating` ;
- n’utilise jamais `NumberOfReviews` comme nombre de notes : ce champ compte uniquement les critiques textuelles ;
- conserve les anciens identifiants (ProductId/ISBN) uniquement comme fallback de compatibilité si le RevisionId échoue ;
- incrémente la clé de cache des notes afin d’ignorer d’éventuels résultats positifs issus de l’ancienne stratégie ;
- conserve le scraping public comme dernier recours seulement ; aucune migration D1 n’est nécessaire.

## 0.5.3 — 2026-08-21

- récupération des notes Kobo refondue : endpoint produit détaillé (`book`/`audiobook`) puis `product_reviews`, page publique seulement en fallback ;
- parsing des résumés de note, distributions 1–5 étoiles et listes d'avis complètes ;
- fallback public multi-boutiques (`fr/fr`, `lu/fr`, `be/fr`) ;
- suppression du cache négatif des notes : un échec n'est plus mémorisé 24 h ;
- nouvel outil **Données → Diagnostic → Notes communautaires Kobo** avec codes HTTP et signaux JSON sûrs à copier ;
- bouton **Actualiser toutes les notes** pour forcer un nouvel enrichissement ;
- enrichissement normal limité à 6 livres par requête Worker et réservé aux livres sans note, afin de limiter les sous-requêtes ;
- cache PWA incrémenté en V0.5.3.

## 0.5.2 — 2026-08-21

- corrige l’erreur **Payload too large** lors des rapprochements volumineux ;
- retire définitivement `catalogCache` du coffre chiffré synchronisé et de D1 ;
- passe le coffre au schéma 4 avec une normalisation en liste blanche qui élimine automatiquement le cache historique V0.3–V0.5.1 ;
- compacte automatiquement un ancien coffre à la première ouverture, en ligne ou localement hors ligne, sans supprimer les acquisitions, tokens Kobo ni états « lu/déjà connu » ;
- déplace le cache catalogue public dans un store IndexedDB séparé (`catalog-cache`) ;
- limite une entrée de cache local à 6 Mio et l’ensemble du cache à 24 Mio avec éviction par ancienneté ; une recherche dépassant cette limite reste utilisable mais n’est pas stockée localement ;
- une recherche Rapprochement ne déclenche plus de synchronisation du coffre, sauf si Kobo a effectivement rafraîchi les tokens d’authentification ;
- la suppression du coffre efface également son cache catalogue local ;
- IndexedDB passe en version 3 ; aucune migration D1 n’est nécessaire ;
- cache PWA incrémenté en V0.5.2 et tests de non-régression ajoutés.

## 0.5.1

- affiche clairement la version de Kobo Library Vault, la version Worker et la version du cache dans l’onglet Données ;
- remplace l’emoji cadenas par une icône CSS monochrome fiable sur Firefox/Android ;
- remplace la persistance de `CryptoKey` IndexedDB par une enveloppe de session AES-GCM v2, portable entre Firefox et Chromium ;
- ne stocke toujours jamais le mot de passe du coffre ;
- affiche les erreurs de persistance au lieu de les ignorer silencieusement ;
- force la vérification du service worker sans cache et recharge une fois l’interface lors de la prise de contrôle d’une nouvelle version ;
- passe les assets applicatifs critiques en stratégie network-first afin de réduire les interfaces restant sur une ancienne version après déploiement.

## 0.5.0 — 2026-08-20

- filtres/critères repliables dans Bibliothèque, Rapprochement et Stats ; état ouvert/fermé mémorisé localement, repli par défaut sur mobile, résumé des filtres actifs et action Réinitialiser toujours accessible ;
- correction du contraste du bouton **Verrouiller** dans le bandeau sombre ; sur mobile le bouton devient un cadenas compact tout en gardant son libellé accessible ;
- session persistante optionnelle **Rester connecté sur cet appareil** : stockage local IndexedDB de la clé AES non extractible et du secret de session, réouverture automatique du coffre, expiration glissante 180 jours ; le mot de passe n’est jamais stocké ;
- **Verrouiller** supprime la session persistante locale ;
- abandon de l’enrichissement `product_reviews` de la V0.4 pour les notes manquantes ;
- nouvel endpoint Worker `/api/kobo/ratings`, sans token Kobo, qui récupère les notes communautaires depuis les fiches produit publiques de kobo.com ;
- résolution de fiche par URL produit ou recherche publique (ISBN en priorité), parsing JSON-LD / JSON embarqué / bloc HTML « Avis et critiques de livres » ;
- cache Cloudflare des notes publiques 7 jours par défaut (`RATING_CACHE_TTL_SECONDS`), avec cache négatif 24 h ;
- synchronisation Kobo enrichit les acquisitions par lots de 16 sans bloquer la bibliothèque en cas d’échec des notes ;
- affichage `★ note (nombre)` directement sur les cartes lorsque disponible ;
- Stats affiche la couverture de notation et désactive automatiquement le classement pondéré si aucun livre du périmètre n’a de note ;
- IndexedDB passe en version 2 pour le store de sessions ; aucune migration D1 ni changement de schéma du coffre ;
- cache PWA incrémenté en V5 et nouveaux tests parser ratings/session/filtres.

## 0.4.0 — 2026-08-19

- affichage compact de l’année de parution sur les cartes : `(AAAA)` à la place de `Parution AAAA` ;
- Recherche libre : prise en charge des expressions exactes entre guillemets doubles, avec post-filtrage local insensible à la casse et aux accents ; les termes hors guillemets restent requis lorsqu’une expression exacte est utilisée ;
- clés de cache catalogue distinctes entre recherche libre et recherche avec guillemets, côté coffre et Cloudflare ;
- récupération des notes communautaires Kobo (`averageRating`, `ratingCount`) lorsqu’elles sont présentes dans les métadonnées de bibliothèque ou de catalogue ;
- enrichissement best-effort des notes manquantes à la synchronisation via la ressource non documentée `product_reviews`, par lots et avec cache Cloudflare public 24 h ; une panne de cet enrichissement ne bloque jamais la synchronisation de bibliothèque ;
- Stats : nouveau choix **Nombre de livres / Score pondéré ★** ; score pondéré = somme de `note moyenne / 5` pour les livres notés ;
- Stats : affichage de la note moyenne de l’auteur, du nombre de livres notés et du score pondéré ; les titres sans note restent dans le nombre brut mais sont exclus de la moyenne et du score ;
- fusion multi-device renforcée pour ne pas perdre `averageRating` / `ratingCount` lorsqu’un appareil possède des métadonnées plus anciennes ;
- export CSV enrichi avec `averageRating` et `ratingCount` ;
- cache PWA incrémenté en V4 ; aucune migration D1 ni changement de schéma du coffre n’est requis.

## 0.3.0 — 2026-08-18

- PWA renforcée pour mobile : manifest complet, `id`/`scope`/`display: standalone`, icônes PNG 192×192 et 512×512 dont une maskable, cache applicatif V3 et diagnostic d’installation dans l’onglet Données ;
- aide d’installation spécifique Firefox Android sans dépendre exclusivement de l’événement non standard `beforeinstallprompt` ;
- cache catalogue à deux niveaux : cache chiffré côté application (TTL 7 jours) et Cloudflare Cache API côté Worker (TTL 24 h par défaut), sans inclure de jeton Kobo dans les clés de cache ;
- bouton « Actualiser Kobo » pour ignorer les caches ;
- correction du matching auteur : correspondance complète stricte, tolérance d’une faute légère et de l’ordre `Nom, Prénom`, suppression des faux positifs de type `Ken Follet` → `Ken` ;
- nouvel onglet Stats avec Top 10 / Top 20 / Tous des auteurs achetés, filtres langue/type et navigation directe vers Rapprochement en mode Auteur ;
- regroupement des variantes simples d’auteur comme `Ken Follett` / `Follett, Ken` dans les statistiques ;
- affichage de l’année de parution sur les cartes ;
- tri par date de parution croissante/décroissante dans Bibliothèque et Rapprochement, plus tris titre/auteur et acquisition dans la bibliothèque ;
- normalisation Kobo étendue à plusieurs champs possibles de date de publication ;
- export CSV enrichi avec `publicationYear` ;
- coffre migré automatiquement vers le schéma 3, sans migration D1 ;
- nouveaux tests de non-régression auteur, stats, tri/date et conformité PWA ;
- gestion de la navigation **Retour / Avancer** du navigateur entre les onglets via History API ;
- « Comparer auteur » renommé **Rapprochement** ;
- Rapprochement étendu à trois modes : **Auteur**, **Série / collection** et **Recherche libre**, cette dernière permettant notamment des requêtes comme « Prix du Quai des Orfèvres » ;
- cache local de catalogue différencié par mode de rapprochement et nouveaux tests de navigation/recherche libre.

## 0.2.0 — 2026-08-18

- noms d’auteur cliquables dans la bibliothèque : ouverture de « Comparer auteur » et recherche automatique ;
- cartes de synthèse de comparaison cliquables : Tous / Possédés / Lus-déjà connus / Potentiellement manquants ;
- titres de livres cliquables vers Kobo, avec URL produit quand disponible et recherche Kobo par ISBN/titre en repli ;
- marquage local « lu / déjà connu » pour masquer un titre non possédé du filtre des manquants ;
- synchronisation chiffrée multi-device des marquages avec états horodatés et annulation propagée ;
- export JSON enrichi avec les états de lecture locaux ;
- normalisation d’une éventuelle URL produit Kobo issue des métadonnées ;
- cache PWA incrémenté et scripts de déploiement alignant automatiquement `APP_VERSION` après auto-update.

## 0.1.0 — 2026-08-18

- première version complète ;
- activation Kobo et gestion access/refresh token ;
- synchronisation des acquisitions ;
- recherche et filtres locaux ;
- comparaison auteur/catalogue ;
- coffre AES-GCM client-side + D1 fragmenté ;
- synchronisation multi-device avec contrôle de version ;
- PWA responsive ;
- scripts Linux de setup, développement, déploiement et mise à jour ZIP.
