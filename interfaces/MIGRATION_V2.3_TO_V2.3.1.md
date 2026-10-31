# Mise à jour consommateur — contrat v2.3 → v2.3.1

Cette mise à jour est **compatible au niveau du schéma** :

```text
base API          /api/v2
GET /status       api_version = 2.3
acquisition       schema_version = 1.3
```

Elle corrige et précise la sémantique de transport.

## À faire côté consommateur

1. Parcourir tous les `acquisition.candidates`, sans supposer qu’ils proviennent uniquement de `ContentUrls`.
2. Utiliser `candidate.url` **et** `candidate.headers` ensemble.
3. Préserver `x-amz-request-payer: requester` lors d’une redirection vers S3 ; ne pas réécrire une URL S3 pré-signée.
4. En mode `delegated`, traiter `Authorization` comme un secret temporaire limité au premier hop Kobo et ne pas le propager vers un origin tiers.
5. Traiter `409 archived_book` comme une action utilisateur « restaurer le livre sur Kobo », et non comme une indisponibilité définitive.

Aucun changement n’est nécessaire pour :

```text
handling
drm.family
media_format
source_format
kobo.source
include_acsm
ContentKeys
```
