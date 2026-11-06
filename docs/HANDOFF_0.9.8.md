# Handoff Kobo Vault 0.9.8

Date : 2026-11-06  
Provider API : **2.3 / révision 2.3.4**  
Acquisition schema : **1.4** (inchangé)  
Migration D1 : **aucune**

## Objectif

0.9.8 ferme le backlog de revalidation explicite des caches Provider et ajoute une voie opérateur stable pour récupérer et déployer KVault directement depuis GitHub.

## Revalidation catalogue

`GET /api/v2/catalog/search` accepte désormais `refresh=true`.

- sans `refresh` : cache Provider normal ;
- cache absent : lecture Kobo puis stockage ;
- `refresh=true` : le cache de **la même requête normalisée** est ignoré, Kobo est relu et la valeur est remplacée ;
- réponse : `cache_status=hit|miss|revalidated` et `origin_fetched_at` ;
- les tokens ne font jamais partie de la clé de cache.

Le cache Provider v2 passe à la génération `__v2_catalog_v4`. Le cache navigateur interne passe également à sa génération v4, sans fusionner les deux espaces de clés.

## Revalidation bibliothèque

Les lectures sont passives :

```text
GET /api/v2/library/manifest
GET /api/v2/library/search
GET /api/v2/library/{product_id}
```

Le refresh est une action séparée :

```http
POST /api/v2/library/refresh
Authorization: Bearer <kvt_...>
```

Scope requis :

```text
kobo.library.refresh
```

Ce scope n'est pas ajouté aux tokens existants ni aux scopes serveur par défaut. Le preset UI Paris Library le propose explicitement.

États retournés :

```text
refreshed
fresh
refreshing
backoff
stale
failed
```

Protections conservées :

- verrou/singleflight par `uid_hash` : 5 min ;
- délai minimal après un succès explicite : 5 min ;
- backoff après échec : 15 min ;
- dernière projection servie séparément des tentatives de refresh ;
- aucune donnée privée dans un cache public.

Republier les credentials Provider Kobo remet `last_success_at` à `NULL`, afin qu'un ancien état de fraîcheur ne survive pas à un changement d'authentification.

## Découverte des capacités

`GET /api/v2/status` reste public sans bearer. Avec un bearer valide, `capabilities` est filtré sur les scopes effectifs du token.

Nouveau couple :

```text
library_refresh ↔ kobo.library.refresh
```

Le couple existant reste inchangé :

```text
acquisition_delegation ↔ kobo.acquisition.delegate
```

## Mise à jour directe depuis GitHub

Nouveau point d'entrée :

```bash
bash scripts/update_from_git
```

Déroulé :

1. résout `pzia/KVault:main` (ou `--ref`) par l'API GitHub ;
2. exige un SHA de commit de 40 caractères ;
3. télécharge l'archive correspondant exactement à ce SHA ;
4. passe l'archive à `scripts/update-from-zip.sh --install --deploy` ;
5. réutilise donc staging, tests, sauvegarde transactionnelle, rollback, migrations D1 et déploiement Wrangler existants.

Options :

```bash
bash scripts/update_from_git --dry-run
bash scripts/update_from_git --no-deploy
bash scripts/update_from_git --ref <tag-branche-ou-sha>
```

Variables :

```text
KOBO_VAULT_GITHUB_REPO
KOBO_VAULT_GITHUB_REF
GITHUB_TOKEN
```

`GITHUB_TOKEN` n'est utilisé que pour l'appel GitHub ; il n'est pas copié dans la release candidate.

## Fichiers principaux

- `src/worker.js`
- `public/index.html`
- `public/app.js`
- `public/sw.js`
- `scripts/update_from_git`
- `scripts/update-from-zip.sh`
- `interfaces/kobo-vault-openapi-v2.3.4.yaml`
- `interfaces/MIGRATION_V2.3.3_TO_V2.3.4.md`
- `tests/api-v098.test.mjs`
- `tests/api-v098-integration.test.mjs`
- `tests/update-from-git.test.mjs`

## Critères de validation

- token ancien sans `kobo.library.refresh` → refresh refusé 403 ;
- token nouveau avec scope → refresh explicite autorisé ;
- manifest/recherche/détail bibliothèque → aucun refresh implicite ;
- catalogue : miss → hit → `refresh=true` → revalidated ;
- valeur invalide de `refresh` → 400 ;
- status authentifié → capacités effectives du bearer ;
- updater GitHub → SHA immuable + updater transactionnel ;
- `npm run check` vert sur CI.
