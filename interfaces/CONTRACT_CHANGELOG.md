# Kobo Vault Provider API — Changelog de contrat

## 2.3.3 — library_sync device delivery

- acquisition schema 1.4 ;
- `candidate.kobo.source=library_sync` ;
- `candidate.kobo.platform` optionnel ;
- `acquisition.sources.library_sync` ;
- aucun nouveau handling : FLEPUB/KDRM reste `kobo_kdrm`.


## 2.3.2 — 2026-09-28

- patch compatible ; `api_version` reste `2.3` et le schéma acquisition reste `1.3` ;
- `/status` expose explicitement `contract_revision=2.3.2` et `acquisition_schema_version=1.3` ;
- `kobo.acquisition.delegate` devient explicitement opt-in à la création d’un token ;
- les routes `/api/v2/vault/{uid}/...` sont documentées comme administration interne, hors contrat Provider ;
- l’API v1 jobs/agents est documentée comme legacy hors contrat et désactivée par défaut côté Vault 0.9.4 ;
- l’export ACSM reste qualifié best effort/expérimental ;
- aucun changement de forme des candidats d’acquisition 1.3.

## 2.3.1 — 2026-09-27

- patch compatible : `api_version` reste `2.3` et `schema_version` reste `1.3` ;
- normalise `ContentUrls` et `DownloadUrls` ;
- normalise `DownloadUrl` et `Url` ;
- préserve les query strings des URLs S3 pré-signées ;
- conserve plusieurs candidats au lieu de dépendre d’une seule variante amont ;
- publie `x-amz-request-payer=requester` dans les headers des candidats `content_access_book` ;
- signale `requires_kobo_authorization` selon l’origin du premier hop ;
- en mode délégué, ajoute le Bearer uniquement aux candidats qui en ont besoin ;
- formalise la règle de non-propagation du Bearer vers un redirect cross-origin ;
- ajoute l’erreur `409 archived_book` pour un titre archivé.

## 2.3.0 — 2026-09-27

- schéma acquisition `1.3` ;
- résolution best effort de l'export ACSM via la ressource Kobo `get_download_link` ;
- ajout des ACSM à `acquisition.candidates` aux côtés des EPUB/KEPUB/PDF ;
- ajout de `kobo.source` et `kobo.requires_kobo_authorization` sur les candidats ;
- `display_profile` peut être `null` pour un candidat indépendant de `content_access_book` ;
- ajout de `acquisition.sources.content_access_book` et `acquisition.sources.acsm_export` ;
- ajout de l'option `include_acsm` (true par défaut) ;
- l'échec de la source ACSM reste non bloquant lorsque d'autres candidats sont disponibles.

## 2.2.0 — 2026-09-27

- schéma acquisition `1.2` ;
- ajout de `display_profile=Android|Desktop` ;
- ajout de `media_format` / `source_format` ;
- ajout de `drm.family` / `drm.raw_type` ;
- ajout de `handling=http_plain|adobe_adept|kobo_kdrm|unknown` ;
- ajout du résumé `content_keys` sans valeurs ;
- le mode délégué formalise le replay local de `content_access_book` ;
- conservation transitoire des champs `format`, `drm_type`, `protected`.

## 2.1.0 — 2026-09-27

- découverte publique ;
- recherche bibliothèque ;
- acquisition `descriptor|delegated` ;
- validité/renouvellement ;
- scope `kobo.acquisition.delegate`.

## 2.0.0 — 2026-09-27

- introduction de Kobo Vault comme provider Kobo indépendant ;
- catalogue, bibliothèque, manifest et acquisition.
