# Compatibilité — Paris Library 0.5.0 → Kobo Vault 0.9.4 / API v2.3.2

| Besoin Paris | Contrat Vault 0.9.2 | Couverture |
|---|---|---|
| Découverte / version / capacités | `GET /api/v2/status` public + axes `api_version/contract_revision/acquisition_schema_version` | Oui |
| Identité stable du compte | `GET /api/v2/account` | Oui |
| Recherche catalogue | `GET /api/v2/catalog/search` | Oui |
| Recherche bibliothèque | `GET /api/v2/library/search` | Oui |
| Manifest léger paginé | `GET /api/v2/library/manifest` | Oui |
| Infos d’acquisition | `POST .../acquisition` | Oui |
| DRM non aplati | `drm.family`, `drm.raw_type`, `handling` | Oui |
| Format Kobo + format normalisé | `source_format`, `media_format` | Oui |
| Profil client Kobo | `display_profile` + `candidate.kobo.display_profile` | Oui |
| Export Adobe ACSM alternatif | candidat `kind=acsm`, `kobo.source=library_download_link` | Oui, best effort |
| Variantes ContentUrls/DownloadUrls | fusionnées par Vault | Oui |
| Variantes DownloadUrl/Url | normalisées par Vault | Oui |
| Headers de transport S3 | `candidate.headers.x-amz-request-payer=requester` | Oui |
| Livre archivé | `409 archived_book` | Oui |
| État de la résolution ACSM | `acquisition.sources.acsm_export` | Oui |
| Présence ContentKeys | `content_keys.present/count`, sans valeurs | Oui |
| Délégation locale | mode `delegated` + scope dédié explicitement opt-in | Oui |
| Renouvellement | `validity.refresh_strategy=resolve_again` | Oui |
| Aucun couplage Adept | aucune route Adept dans API v2 | Oui |
| Aucun stockage ebook | aucun binaire dans l’API | Oui |

## Conséquence pour l’orchestrateur

Paris ne doit sélectionner un candidat ni sur l’extension ni sur le mot « EPUB » seul.

Il peut recevoir simultanément plusieurs mécanismes pour le même achat :

```text
http_plain  → téléchargement direct
adobe_adept → ACSM/ADEPT ou artefact Adobe selon kind/media_format
kobo_kdrm   → capacité Kobo KDRM
unknown     → erreur explicite
```

Pour Adobe, lorsqu’un candidat :

```text
kind=acsm
media_format=acsm
handling=adobe_adept
```

est présent, Paris peut le transmettre directement à la capacité ACSM/ADEPT du moteur local.

L’absence d’ACSM n’est pas assimilée à l’absence de téléchargement : Paris conserve les autres candidats retournés par `content_access_book`.

Si le mécanisme retourné n’est pas supporté par l’outil local, Paris peut demander une nouvelle résolution avec un autre `display_profile`. L’export ACSM, lui, est une source alternative indépendante du `DisplayProfile`.


## Transport HTTP — exigence Paris

Paris doit transmettre à son moteur local la recette complète `url + headers`. Si `Authorization` est présent en mode délégué, il est limité au premier hop Kobo ; il ne doit pas être propagé vers un redirect cross-origin. `x-amz-request-payer` doit en revanche pouvoir survivre au redirect Kobo → S3.

## Livre archivé et récupération Paris

Un livre `archived=true` reste visible dans la projection/manifest lorsqu’il y est publié, mais une demande d’acquisition retourne `409 archived_book`. Paris peut donc détecter qu’une copie locale manque, mais **ne peut pas restaurer ce titre de manière entièrement autonome** avec le contrat 2.3.x.

Workflow actuel :

```text
Paris détecte le manque
→ Vault retourne archived_book
→ l’utilisateur restaure le titre dans Kobo
→ la projection est republiée/synchronisée
→ Paris relance l’acquisition
```

Vault 0.9.4 ne désarchive jamais implicitement un titre lors d’une acquisition. Une éventuelle restauration automatique future devra être une mutation explicite, avec capability/scope d’écriture propre et sémantique idempotente.
