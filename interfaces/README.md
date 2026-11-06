# Interfaces publiques Kobo Vault 0.9.8 / API v2.3.4

Ce répertoire est le contrat publié par **Kobo Vault** en tant que fournisseur spécialisé Kobo.

Principe : **Paris Library décide ; Kobo Vault expose Kobo ; Kobo-Adept exécute localement**. Vault ne suppose ni Paris Library ni Kobo-Adept comme consommateur final.

## Fichiers

- `kobo-vault-openapi-v2.3.4.yaml` — contrat HTTPS courant ;
- `kobo-vault-openapi-v2.3.3.yaml` — contrat précédent conservé pour référence ;
- `kobo-vault-openapi-v2.3.1.yaml` — contrat précédent conservé pour référence ;
- `kobo-vault-openapi-v2.3.yaml` — contrat précédent conservé pour référence ;
- `kobo-vault-openapi-v2.yaml` — alias du contrat courant ;
- `kobo-vault-openapi-v2.2.yaml` — contrat précédent conservé pour référence ;
- `kobo-vault-status.schema.json` — découverte/capabilities ;
- `kobo-vault-library-item.schema.json` — notice Kobo normalisée ;
- `kobo-vault-acquisition.schema.json` — descripteur d'acquisition v1.4 ;
- `kobo-vault-acquisition-v1.2.schema.json` — schéma historique v2.2 ;
- `DRM_ACQUISITION_SEMANTICS.md` — sémantique formats/DRM ;
- `DOWNLOAD_TRANSPORT_SEMANTICS.md` — headers, redirections et Authorization ;
- `ACSM_EXPORT_SEMANTICS.md` — résolution de l'export ACSM ;
- `MIGRATION_V2.3.3_TO_V2.3.4.md` — revalidation explicite catalogue/bibliothèque ;
- `MIGRATION_V2.3.1_TO_V2.3.2.md` — clarification versionnement et sécurité des scopes ;
- `MIGRATION_V2.3_TO_V2.3.1.md` — mise à jour transport consommateur ;
- `MIGRATION_V2.2_TO_V2.3.md` — migration précédente ;
- `MIGRATION_V2.1_TO_V2.2.md` — migration précédente ;
- `PARIS_LIBRARY_0.5_COMPATIBILITY.md` — couverture du besoin Paris 0.5 ;
- `API_NOTES.md` — sécurité et versionnement.

## Scopes

- `kobo.catalog.read`
- `kobo.library.read`
- `kobo.library.refresh`
- `kobo.acquisition.read`
- `kobo.acquisition.delegate`

## Revalidation explicite v2.3.4

La révision 2.3.4 conserve `api_version=2.3` et l'acquisition `1.4`, mais sépare la lecture de la revalidation :

```text
GET  /api/v2/catalog/search?...&refresh=true
POST /api/v2/library/refresh
```

Le refresh de bibliothèque exige `kobo.library.refresh`, scope opt-in absent des anciens tokens. Les lectures de bibliothèque restent passives. Un `GET /api/v2/status` authentifié annonce les capacités effectives du bearer courant, notamment `library_refresh` et `acquisition_delegation`.

## Stabilisation v2.3.2

La révision 2.3.2 gèle le contrat 2.3.x en vue de Kobo Vault 1.0 et rend les axes de version explicites dans `/status` :

```text
api_version = 2.3
contract_revision = 2.3.2
acquisition_schema_version = 1.3
```

`kobo.acquisition.delegate` reste une capacité du contrat, mais **n’est plus accordé par défaut** lors de la création d’un token. Il doit être demandé explicitement. Les routes de gestion navigateur `/api/v2/vault/{uid}/...` restent internes à Kobo Vault et ne font pas partie du contrat Provider.

L’API historique `/api/v1/` jobs/agents est obsolète et désactivée par défaut dans Vault 0.9.4. Elle n’appartient pas au contrat Provider v2.3.x.

## Correctif transport v2.3.1

La révision 2.3.1 conserve `api_version=2.3` et `schema_version=1.3`, mais normalise davantage les réponses Kobo :

```text
ContentUrls + DownloadUrls
DownloadUrl + Url
```

Les headers de chaque candidat font désormais explicitement partie de sa recette de téléchargement. Les candidats `content_access_book` publient notamment `x-amz-request-payer=requester`, et le mode `delegated` ajoute le Bearer Kobo uniquement lorsque `kobo.requires_kobo_authorization=true`.

Un livre archivé retourne `409 archived_book` afin que le consommateur puisse demander sa restauration dans Kobo.

## Changement principal v2.3

L'acquisition n'est plus limitée aux `ContentUrls` de `content_access_book`.

Par défaut Vault tente également la ressource Kobo :

```text
get_download_link
```

et ajoute le lien ACSM trouvé à **la même liste `acquisition.candidates`**.

Chaque candidat expose sa provenance :

```text
kobo.source = content_access_book
kobo.source = library_download_link
kobo.source = library_sync
```

Le consommateur peut donc recevoir simultanément, pour le même livre :

```text
EPUB3 + AdobeDrm
KEPUB + KDRM
EPUB sans DRM
ACSM + Adobe ADEPT
```

Il choisit le chemin adapté à ses propres capacités ; Vault ne choisit pas Kobo-Adept à sa place.

## ACSM

Un candidat ACSM est identifié par :

```text
kind         = acsm
media_format = acsm
handling     = adobe_adept
drm.family   = adobe_adept
kobo.source  = library_download_link
```

Le lookup peut être désactivé ponctuellement avec :

```json
{"include_acsm": false}
```

Son état est visible dans :

```text
acquisition.sources.acsm_export
```

L'absence ou l'échec de cette source alternative n'empêche pas le retour des autres candidats Kobo.

## ContentKeys

Vault **n'expose toujours pas les valeurs des `ContentKeys`**. En mode `delegated`, le consommateur local peut rejouer `content_access_book` directement auprès de Kobo.

Aucun EPUB/PDF ne transite par Kobo Vault.
