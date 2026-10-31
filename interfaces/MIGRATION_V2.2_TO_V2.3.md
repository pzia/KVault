# Migration consommateur — API v2.2 → v2.3

## Résumé

La v2.3 ajoute une **source d'acquisition alternative ACSM** aux candidats déjà issus de `content_access_book`.

Le point d'entrée reste :

```http
POST /api/v2/library/{product_id}/acquisition
```

La réponse passe de `schema_version: "1.2"` à `schema_version: "1.3"`.

## Nouveau comportement par défaut

Vault demande d'abord les variantes de lecture via `content_access_book`, puis tente aussi de résoudre l'export Adobe via la ressource Kobo `get_download_link` annoncée par `/v1/initialization`.

Un ACSM trouvé est ajouté à **la même liste `acquisition.candidates`** :

```json
{
  "kind": "acsm",
  "media_format": "acsm",
  "source_format": "ACSM",
  "handling": "adobe_adept",
  "drm": {
    "family": "adobe_adept",
    "raw_type": "AdobeDrm",
    "protected": true
  },
  "kobo": {
    "source": "library_download_link",
    "display_profile": null,
    "content_keys_present": false,
    "content_key_count": 0,
    "requires_kobo_authorization": false
  },
  "url": "https://.../URLLink.acsm?..."
}
```

Le consommateur ne doit donc pas considérer qu'un seul candidat existe par livre.

## Source du candidat

Chaque candidat possède désormais :

```text
kobo.source
```

Valeurs actuelles :

```text
content_access_book
library_download_link
```

Les candidats `content_access_book` conservent leur `display_profile`.

Un candidat `library_download_link` est indépendant de `DisplayProfile` et expose donc :

```json
"display_profile": null
```

## Authentification du candidat ACSM

La majorité des liens ACSM attendus sont des URL de fulfillment HTTPS autonomes. Dans ce cas :

```json
"requires_kobo_authorization": false
```

Si Kobo sert directement le corps ACSM depuis son endpoint authentifié plutôt que de fournir/rediriger vers une URL distincte, Vault peut publier l'URL de cet endpoint avec :

```json
"requires_kobo_authorization": true
```

En mode `delegated`, Vault ajoute alors l'Authorization Kobo nécessaire dans `candidate.headers`.

En mode `descriptor`, aucun bearer Kobo n'est exposé : le consommateur doit redemander l'acquisition en `delegated` avant d'utiliser un candidat qui exige cette autorisation.

## État des sources

La réponse ajoute :

```json
"sources": {
  "content_access_book": {
    "status": "available",
    "candidate_count": 2
  },
  "acsm_export": {
    "requested": true,
    "status": "available",
    "source": "get_download_link",
    "candidate_count": 1,
    "request_shape": "get_revision_id"
  }
}
```

`acsm_export.status` vaut :

```text
available
not_available
resource_unavailable
upstream_error
skipped
```

L'absence d'ACSM n'empêche jamais Vault de retourner les candidats `content_access_book` existants.

## Désactivation ponctuelle

Le lookup ACSM est activé par défaut. Il peut être désactivé par requête :

```json
{
  "include_acsm": false
}
```

## Règle de sélection recommandée

Paris Library ne doit pas transformer automatiquement tout candidat Kobo en EPUB HTTP.

Il transmet au moteur local le candidat choisi avec son `handling` :

```text
http_plain   → téléchargement direct
adobe_adept  → ACSM/ADEPT ou artefact Adobe selon le candidat
kobo_kdrm    → moteur Kobo KDRM
unknown      → ne pas deviner
```

Lorsqu'un candidat `kind=acsm` existe, c'est le candidat naturel pour un flux Adobe ADEPT/libgourou.
