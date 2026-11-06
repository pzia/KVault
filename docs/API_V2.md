# Kobo Vault Provider API v2.3.4 — Kobo Vault 0.9.8

## Versionnement

- base URL inchangée : `/api/v2/` ;
- `GET /api/v2/status` annonce toujours `api_version = 2.3` ;
- la révision contractuelle courante est `2.3.4` ;
- acquisition : `schema_version = 1.4`.

## Revalidation explicite — 0.9.8

Les lectures Provider de bibliothèque sont désormais passives. `GET /library/manifest`, `GET /library/search` et `GET /library/{product_id}` ne déclenchent plus d'appel Kobo implicite.

La revalidation privée est une action séparée :

```http
POST /api/v2/library/refresh
Authorization: Bearer <kvt_...>
```

Elle exige le scope opt-in `kobo.library.refresh`. Le Worker applique un singleflight/verrou, un délai minimal de cinq minutes entre succès explicites et un backoff de quinze minutes après échec. Le résultat est `refreshed | fresh | refreshing | backoff | stale | failed`.

Le catalogue Provider accepte `refresh=true` sur `GET /api/v2/catalog/search`. Cette option contourne puis remplace **la même clé de cache Provider** et la réponse expose `cache_status` ainsi que `origin_fetched_at`. Elle ne partage pas de données privées ni de token dans la clé.

## Sécurité des scopes — 0.9.8

Les scopes standards d’un token consommateur sont `kobo.catalog.read`, `kobo.library.read` et `kobo.acquisition.read`. Le scope `kobo.library.refresh` est séparé et opt-in. Le scope sensible `kobo.acquisition.delegate` reste **explicite côté API serveur** : il ne doit jamais être déduit d’une omission de `scopes`. L’IHM 0.9.8 applique toutefois un preset **Paris Library** où cette case est visible et cochée par défaut, car KDRM exige le mode delegated. Les tokens existants ne sont pas élevés automatiquement.

Les routes `/api/v2/vault/{uid}/...` servent à l’administration par l’interface web de Vault (publication de projection, credentials d’acquisition, création/révocation des tokens). Elles sont internes et ne font pas partie du contrat Provider consommateur.

L’API historique jobs/agents `/api/v1/` est hors contrat, obsolète et désactivée par défaut. Une compatibilité temporaire peut être activée côté déploiement par `LEGACY_API_V1_ENABLED=true`.

## ACSM

La capability `acquisition_acsm_export` reste **best effort / expérimentale** tant qu’un panel réel de titres Kobo n’a pas validé de manière suffisante la ressource `get_download_link`. Son échec ne retire jamais les autres candidats d’acquisition.

## Acquisition multi-source

`POST /api/v2/library/{product_id}/acquisition` agrège désormais :

1. les candidats Kobo `content_access_book` ;
2. l'export ACSM obtenu en best effort via la ressource d'initialisation `get_download_link`.

Le champ `kobo.source` identifie la provenance de chaque candidat.

Le lookup ACSM est activé par défaut et peut être désactivé avec `include_acsm=false` dans le corps JSON.

## Données sensibles

La réponse d'acquisition est toujours `private, no-store`.

Une URL ACSM peut embarquer un token de fulfillment et doit être traitée comme une donnée sensible temporaire.

Le mode `descriptor` n'expose aucun bearer Kobo.

Le mode `delegated`, protégé par `kobo.acquisition.delegate`, peut exposer l'Authorization Kobo nécessaire pour rejouer une requête locale. Le refresh token n'est jamais exposé.

## Tolérance amont

`get_download_link` est une ressource Kobo annoncée par `/v1/initialization`, mais son contrat détaillé n'est pas public. Vault traite donc ce chemin comme une source alternative best effort :

- plusieurs formes d'identifiant sont essayées ;
- redirections et réponses JSON/texte sont reconnues ;
- l'échec du lookup ACSM ne fait pas disparaître les candidats de `content_access_book` ;
- `acquisition.sources.acsm_export` rend le résultat du lookup observable sans exposer le corps amont.


## Transport content_access_book — 0.9.2

Vault fusionne `ContentUrls` et `DownloadUrls`, accepte `DownloadUrl` et `Url`, et conserve tous les candidats dédupliqués dans la limite de sécurité. Les URLs S3 déjà pré-signées ne sont pas réécrites.

`candidate.headers` fait partie de la recette. Pour les candidats `content_access_book`, Vault publie `x-amz-request-payer=requester`. En mode `delegated`, le Bearer Kobo est ajouté uniquement lorsque le premier hop Kobo peut l’exiger. Le consommateur doit supprimer ce Bearer lors d’une redirection vers un origin tiers.

Un livre projeté avec `archived=true` retourne `409 archived_book` avant tout appel de contenu Kobo.

## Livraison device via library_sync — 0.9.7

Le fallback introduit en 0.9.6 est conservé : lorsque `content_access_book` ne fournit aucune URL, Vault peut exploiter `BookMetadata.DownloadUrls` de `/v1/library/sync`. En 0.9.7, `FLEPUB` est normalisé en `media_format=epub` tout en conservant `source_format=FLEPUB`. Pour ces candidats, `kobo.display_profile` vaut `null` car l’URL ne provient pas d’un appel `content_access_book`; le champ `kobo.platform` porte la valeur réelle de la recette (`Android`, `Generic`, etc.). Les variantes `*SAMPLE` sont exclues et les recettes équivalentes sont dédupliquées sémantiquement même si leurs URLs tokenisées diffèrent.
