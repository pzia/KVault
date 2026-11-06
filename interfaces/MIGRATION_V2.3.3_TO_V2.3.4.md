# Migration Provider API 2.3.3 → 2.3.4

KVault 0.9.8 conserve `api_version=2.3` et le schéma d'acquisition `1.4`. La révision 2.3.4 rend la revalidation des données explicite et séparée de leur lecture.

## Catalogue

`GET /api/v2/catalog/search` accepte désormais :

```text
refresh=true
```

Cette option contourne le cache Cloudflare Provider pour **la requête normalisée courante**, relit Kobo et remplace la valeur correspondante. Toute autre valeur que `true|false`, ou un paramètre dupliqué, est rejetée.

La réponse ajoute :

```text
cache_status = hit | miss | revalidated
origin_fetched_at = ISO-8601 | null
```

Aucun token n'entre dans la clé du cache public.

## Bibliothèque

Les routes suivantes sont désormais **passives** :

```text
GET /api/v2/library/manifest
GET /api/v2/library/search
GET /api/v2/library/{product_id}
```

Elles lisent la projection D1 existante et ne déclenchent plus implicitement un appel Kobo.

La revalidation explicite utilise :

```http
POST /api/v2/library/refresh
Authorization: Bearer <kvt_...>
```

avec le nouveau scope :

```text
kobo.library.refresh
```

Ce scope est opt-in et n'est ajouté à aucun token existant. Les défauts serveur restent au moindre privilège.

Le résultat est typé :

```text
refreshed | fresh | refreshing | backoff | stale | failed
```

Le Worker conserve le verrou/singleflight par coffre, un délai minimal de cinq minutes après un succès explicite et le backoff de quinze minutes après un échec. Une projection précédente reste consultable si Kobo est indisponible.

## Découverte

Avec un bearer, `GET /api/v2/status` ne publie `library_refresh` que si le token courant porte `kobo.library.refresh`. La même règle continue de s'appliquer à `acquisition_delegation` et `kobo.acquisition.delegate`.

## Compatibilité

- aucune migration D1 ;
- les anciens tokens continuent de lire catalogue/bibliothèque selon leurs scopes existants ;
- ils ne peuvent pas demander de refresh bibliothèque tant qu'un nouveau token doté de `kobo.library.refresh` n'a pas été émis ;
- le contrat d'acquisition 1.4 est inchangé.
