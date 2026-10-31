# Kobo Vault API v1 — contrat implémenté en V0.6.0

## Authentification

Paris Library utilise un token créé depuis **Données → Paris Library & kobo-adept** :

```http
Authorization: Bearer <kvp_...>
Accept: application/json
```

Scopes V0.6.0 :

- `paris.read`
- `paris.jobs.create`

Les tokens sont affichés une seule fois ; Kobo Vault ne stocke que leur SHA-256.

## Capabilities

```http
GET /api/v1/status
```

Retour V0.6.0 :

```json
{
  "ok": true,
  "api_version": "1.0",
  "service": "kobo-vault",
  "capabilities": ["library", "library_search", "agent_export"]
}
```

`catalog_search` n'est pas annoncé : en mode zero-knowledge aucun credential Kobo persistant n'est disponible au Worker pour une recherche catalogue autonome.

## Compte et bibliothèque

```http
GET /api/v1/account
GET /api/v1/search?q=LivreTest&scope=library&field=all&limit=50
GET /api/v1/library/manifest?limit=200
```

`scope=catalog` et `scope=all` renvoient actuellement `501 catalog_search_requires_agent`.

Le manifest contient uniquement des métadonnées et jamais de binaire.

## Jobs de téléchargement

```http
POST /api/v1/library/{product_id}/download-jobs
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "revision_id": "...",
  "format": "epub"
}
```

Réponse : `202` avec un job `queued`, ou `200` si un job idempotent/actif existe déjà.

Suivi :

```http
GET /api/v1/jobs/{job_id}
```

États :

```text
queued
claimed
downloading
processing
complete
failed
cancelled
```

## Appairage kobo-adept

L'agent démarre :

```http
POST /api/v1/agent/pair/start

{"agent_name":"linux-home"}
```

Il reçoit `pair_id`, un code court et une expiration. L'utilisateur saisit le code dans Kobo Vault. Après approbation :

```http
POST /api/v1/agent/pair/complete

{"pair_id":"...","code":"..."}
```

L'agent reçoit une seule fois son token `kva_...`.

## API agent

Toutes ces routes utilisent :

```http
Authorization: Bearer <kva_...>
```

Routes :

```http
GET  /api/v1/agent/jobs/next
POST /api/v1/agent/jobs/{job_id}/claim
POST /api/v1/agent/jobs/{job_id}/progress
POST /api/v1/agent/jobs/{job_id}/complete
POST /api/v1/agent/jobs/{job_id}/failed
POST /api/v1/agent/heartbeat
```

`claim` accorde un lease de 5 minutes. Les appels `progress` prolongent le lease. Un lease expiré remet le job en file d'attente lors du prochain poll.

Exemple `complete` :

```json
{
  "filename": "Auteur - Titre.epub",
  "size": 1834921,
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hook": {
    "status": "success",
    "exit_code": 0
  }
}
```

Le serveur n'attend jamais le contenu du fichier.

## Projection de métadonnées

La projection n'est pas activée par défaut. L'utilisateur doit cliquer **Publier le manifest**.

Elle contient uniquement les champs nécessaires au manifest/recherche bibliothèque. Elle ne contient pas :

- access token Kobo ;
- refresh token Kobo ;
- mot de passe Kobo ;
- contenu EPUB ;
- secrets ADEPT.

**Retirer la projection** supprime `account_projection` et `library_projection` sans toucher au coffre chiffré.
