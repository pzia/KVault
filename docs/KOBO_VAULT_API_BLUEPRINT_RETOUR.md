# Kobo-Vault API v1 — Blueprint retour

Version : 0.1  
Statut : proposition d’architecture retour  
Base : `KOBO_VAULT_API_SPEC_0.4.0.md`

## 1. Décision structurante

Kobo-Vault conserve son modèle **zero-knowledge** :

- les credentials Kobo restent chiffrés côté client ;
- le Worker Kobo-Vault ne doit pas pouvoir utiliser directement les access/refresh tokens Kobo d’un utilisateur ;
- Kobo-Vault ne devient pas un proxy de téléchargement massif ;
- les EPUB ne transitent pas durablement par Cloudflare ;
- les téléchargements sont réalisés par `kobo-adept`, qui possède sa propre session Kobo locale.

Conséquence :

```text
Kobo-Vault = identité + métadonnées + bibliothèque + orchestration
kobo-adept = session Kobo locale + téléchargement + stockage local
Paris Library = recherche / UX / backup local / consommation des statuts
```

---

## 2. Objectif du contrat v1 révisé

Python Paris Library doit pouvoir :

1. vérifier que Kobo-Vault est disponible ;
2. identifier le compte logique lié ;
3. rechercher dans le catalogue Kobo et la bibliothèque connue ;
4. récupérer un manifest léger pour un backup incrémental ;
5. créer une demande de téléchargement ;
6. suivre l’état de cette demande ;
7. laisser `kobo-adept` télécharger directement depuis Kobo ;
8. ne jamais recevoir de secret Kobo ;
9. ne jamais faire transiter le fichier EPUB par Kobo-Vault.

---

## 3. Architecture cible

```text
                      Kobo
                       ▲
                       │ API Kobo
                       │
                 kobo-adept
                 ├── session Kobo locale
                 ├── download
                 ├── état local
                 └── post-download hook
                       ▲
                       │ pull HTTPS
                       │
                  Kobo-Vault
                 ├── API v1
                 ├── manifest
                 ├── recherche
                 ├── jobs
                 └── états
                       ▲
                       │ HTTPS
                       │
                 Paris Library
```

Cloudflare ne transporte que :

```text
métadonnées
jobs
états
identifiants
```

Pas les EPUB.

---

## 4. Responsabilités

### 4.1 Kobo-Vault

Responsable de :

- bibliothèque Kobo connue ;
- métadonnées ;
- recherche catalogue ;
- correspondance `owned=true/false` ;
- génération du manifest ;
- création des jobs de téléchargement ;
- authentification Paris Library ↔ Kobo-Vault ;
- authentification kobo-adept ↔ Kobo-Vault ;
- suivi de l’état des jobs.

Ne fait pas :

- stockage permanent des EPUB ;
- utilisation serveur des credentials Kobo ;
- téléchargement direct des contenus Kobo ;
- déchiffrement des secrets Kobo utilisateur.

### 4.2 kobo-adept

Responsable de :

- sa propre session Kobo locale ;
- appels `content_access_book` et autres endpoints nécessaires ;
- téléchargement direct Kobo → disque local ;
- ACSM / libgourou si nécessaire ;
- checksum ;
- état local ;
- hook post-download ;
- reporting du résultat au serveur.

### 4.3 Paris Library

Responsable de :

- UX ;
- recherche unifiée ;
- consultation du manifest ;
- déclenchement des jobs ;
- suivi d’état ;
- copie locale éventuelle si elle partage le même hôte que l’agent ;
- historique local de backup.

---

## 5. Authentification

Deux tokens distincts.

### Paris Library → Kobo-Vault

```http
Authorization: Bearer <PARIS_API_TOKEN>
```

### kobo-adept → Kobo-Vault

```http
Authorization: Bearer <AGENT_TOKEN>
```

Contraintes :

- ne jamais réutiliser un token Kobo ;
- tokens longs et aléatoires ;
- rotation possible ;
- scopes séparés ;
- logs expurgés.

Exemples de scopes :

```text
paris.read
paris.jobs.create
agent.jobs.read
agent.jobs.update
```

---

## 6. API Paris Library → Kobo-Vault

Base :

```text
/api/v1/
```

### 6.1 `GET /api/v1/status`

Réponse :

```json
{
  "ok": true,
  "api_version": "1.0",
  "service": "kobo-vault",
  "capabilities": [
    "catalog_search",
    "library",
    "agent_export"
  ]
}
```

`download` n’est plus une capability obligatoire.

### 6.2 `GET /api/v1/account`

Réponse :

```json
{
  "account": {
    "id": "stable-kobo-account-id",
    "display_name": "Mon compte Kobo",
    "email_hint": "m***@example.com"
  }
}
```

Aucun secret Kobo.

### 6.3 `GET /api/v1/search`

Paramètres :

```text
q
field=all|title|author|isbn|subject
scope=all|catalog|library
limit
cursor
```

Exemple d’item :

```json
{
  "product_id": "44444444-4444-4444-8444-444444444444",
  "revision_id": "55555555-5555-4555-8555-555555555555",
  "title": "LivreTest",
  "authors": ["Auteur"],
  "format": "EPUB",
  "content_type": "ebook",
  "owned": true,
  "downloadable": true,
  "cover_url": "https://...",
  "product_url": "https://..."
}
```

### 6.4 `GET /api/v1/library/manifest`

But : backup incrémental sans téléchargement.

Exemple :

```json
{
  "items": [
    {
      "product_id": "44444444-4444-4444-8444-444444444444",
      "revision_id": "55555555-5555-4555-8555-555555555555",
      "title": "LivreTest",
      "authors": ["Auteur"],
      "format": "EPUB",
      "content_type": "ebook",
      "downloadable": true,
      "cover_url": "https://...",
      "product_url": "https://..."
    }
  ],
  "next_cursor": null
}
```

Règles :

- `product_id` = identité métier ;
- `revision_id` = version technique courante ;
- aucune donnée binaire ;
- `sha256` facultatif uniquement s’il est déjà connu ;
- ne jamais télécharger juste pour calculer le hash.

---

## 7. Nouvelle API de jobs

### 7.1 `POST /api/v1/library/{product_id}/download-jobs`

But : demander un téléchargement sans faire transiter le fichier par Kobo-Vault.

Requête :

```json
{
  "revision_id": "55555555-5555-4555-8555-555555555555",
  "format": "epub"
}
```

Réponse `202` :

```json
{
  "job": {
    "id": "job_01H...",
    "type": "DOWNLOAD_KOBO_BOOK",
    "product_id": "44444444-4444-4444-8444-444444444444",
    "revision_id": "55555555-5555-4555-8555-555555555555",
    "status": "queued",
    "created_at": "2026-09-17T20:00:00Z"
  }
}
```

Idempotence recommandée :

```http
Idempotency-Key: <uuid>
```

Si le même `product_id + revision_id` est déjà en cours : retourner le job existant.

### 7.2 `GET /api/v1/jobs/{job_id}`

Réponse :

```json
{
  "job": {
    "id": "job_01H...",
    "type": "DOWNLOAD_KOBO_BOOK",
    "status": "complete",
    "product_id": "...",
    "revision_id": "...",
    "created_at": "...",
    "started_at": "...",
    "completed_at": "...",
    "result": {
      "filename": "Auteur - LivreTest.epub",
      "size": 1834921,
      "sha256": "012345...",
      "storage": "local-agent"
    }
  }
}
```

Aucun chemin local absolu n’est requis côté Paris Library.

### 7.3 Statuts

```text
queued
claimed
downloading
processing
complete
failed
cancelled
```

### 7.4 Erreurs job

```text
not_owned
not_downloadable
revision_mismatch
kobo_session_expired
upstream_error
download_failed
hook_failed
```

Le téléchargement peut être `complete` même si le hook a échoué si la policy du hook est `warn`.

---

## 8. API kobo-adept → Kobo-Vault

Base recommandée :

```text
/api/v1/agent/
```

### 8.1 `GET /api/v1/agent/jobs/next`

Retourne le prochain job disponible.

Réponse :

```json
{
  "job": {
    "id": "job_01H...",
    "type": "DOWNLOAD_KOBO_BOOK",
    "product_id": "...",
    "revision_id": "...",
    "format": "epub",
    "title": "LivreTest",
    "authors": ["Auteur"]
  }
}
```

Aucun token Kobo.

### 8.2 `POST /api/v1/agent/jobs/{job_id}/claim`

Optionnel mais recommandé pour éviter qu’un deuxième agent prenne le même job.

Réponse :

```json
{
  "ok": true,
  "lease_until": "2026-09-17T20:05:00Z"
}
```

### 8.3 `POST /api/v1/agent/jobs/{job_id}/progress`

Exemple :

```json
{
  "status": "downloading",
  "progress": 42
}
```

Facultatif pour le MVP.

### 8.4 `POST /api/v1/agent/jobs/{job_id}/complete`

Exemple :

```json
{
  "revision_id": "...",
  "filename": "Auteur - LivreTest.epub",
  "size": 1834921,
  "sha256": "0123456789abcdef...",
  "hook": {
    "status": "success",
    "exit_code": 0
  }
}
```

### 8.5 `POST /api/v1/agent/jobs/{job_id}/failed`

Exemple :

```json
{
  "error": {
    "code": "kobo_session_expired",
    "message": "La session Kobo locale doit être renouvelée."
  }
}
```

---

## 9. Workflow backup incrémental

```text
Paris Library
    │
    ├── GET /library/manifest
    │
    ├── compare avec SQLite local
    │
    ├── absent ?
    │
    ├── revision_id changé ?
    │
    └── fichier manquant ?
             │
             ▼
POST /download-jobs
             │
             ▼
        job queued
             │
             ▼
kobo-adept poll
             │
             ▼
   download direct Kobo
             │
             ▼
   fichier local + checksum
             │
             ▼
   post-download hook
             │
             ▼
     POST complete
             │
             ▼
Paris Library observe complete
```

---

## 10. Même machine : cas recommandé

Si Paris Library et kobo-adept tournent sur la même machine :

```text
kobo-adept écrit directement dans le répertoire de backup attendu par Paris Library
```

Exemple :

```toml
[general]
library_dir = "/srv/ebooks/kobo"
```

Paris Library conserve uniquement :

```text
product_id
revision_id
chemin relatif
taille
sha256
état
date
```

Pas besoin de transfert supplémentaire.

---

## 11. Machines différentes

Hors MVP.

Solutions futures possibles :

```text
NFS
SMB
Syncthing
rsync via hook
Nextcloud
```

Kobo-Vault ne doit pas devenir un relais de fichier pour résoudre ce cas.

---

## 12. Gestion des révisions

Règle :

```text
product_id  = identité logique
revision_id = version technique Kobo
```

Algorithme :

```text
manifest revision == local revision
    → pas de download

manifest revision != local revision
    → nouveau job
```

Si l’agent découvre que Kobo expose une autre révision :

```text
job → revision_mismatch
```

Paris Library refait un manifest avant de retenter.

---

## 13. Sémantique de `downloadable`

`downloadable=true` signifie :

```text
Kobo-Vault connaît suffisamment le livre pour autoriser la création d’un job
```

Cela ne garantit pas que le téléchargement final réussira.

L’agent reste l’autorité réelle sur :

```text
content_access_book
DRM
format
session locale
compatibilité
```

---

## 14. Manifest léger

Kobo-Vault doit construire le manifest à partir de ses métadonnées synchronisées.

Il ne doit pas ouvrir chaque ebook, télécharger chaque contenu ni calculer un hash réseau pour répondre au manifest.

---

## 15. Stockage Cloudflare

Autorisé :

```text
D1:
- jobs
- états
- métadonnées légères
- mapping compte/agent
```

À éviter :

```text
R2:
- EPUB
- ACSM permanents
- fichiers temporaires
```

Le système doit rester fonctionnel sans R2.

---

## 16. Modèle de job D1

Exemple logique :

```sql
jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    product_id TEXT,
    revision_id TEXT,
    format TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT,
    error_code TEXT,
    error_message TEXT,
    result_json TEXT
)
```

Index :

```sql
CREATE INDEX idx_jobs_user_status
ON jobs(user_id, status, created_at);
```

---

## 17. Liaison utilisateur ↔ agent

Un agent doit être associé explicitement à un utilisateur Kobo-Vault.

Workflow recommandé :

```text
kobo-adept pair
   ↓
code court temporaire
   ↓
Kobo-Vault
   ↓
validation utilisateur
   ↓
agent_token long
```

L’agent reçoit :

```text
agent_id
agent_token
vault_user_id
```

Le token Kobo reste local et indépendant.

---

## 18. Multi-agent

Optionnel.

Par défaut :

```text
1 utilisateur → 1 agent actif
```

Plus tard :

```text
1 utilisateur → plusieurs agents
```

avec :

```text
agent_name
capabilities
last_seen
priority
```

---

## 19. Heartbeat agent

Optionnel pour le MVP, recommandé ensuite.

```http
POST /api/v1/agent/heartbeat
```

Exemple :

```json
{
  "agent_id": "agent_linux_home",
  "version": "0.4.0",
  "capabilities": [
    "kobo_download",
    "adept",
    "post_download_hook"
  ]
}
```

Kobo-Vault peut afficher :

```text
Agent en ligne
Dernier contact : il y a 12 s
Version : 0.4.0
```

---

## 20. Sécurité

Kobo-Vault :

- HTTPS obligatoire ;
- Bearer token distinct Paris / agent ;
- aucun credential Kobo côté serveur ;
- aucun secret ADEPT côté serveur ;
- aucun EPUB côté serveur ;
- rate limiting ;
- contrôle propriétaire sur `product_id` ;
- contrôle utilisateur sur chaque job.

kobo-adept :

- Kobo auth locale ;
- permissions `0600` ;
- logs expurgés ;
- TLS obligatoire ;
- hook sans secret ;
- `shell=False` par défaut.

---

## 21. Compatibilité avec la spec 0.4.0 existante

Conserver sans modification majeure :

```text
GET /api/v1/status
GET /api/v1/account
GET /api/v1/search
GET /api/v1/library/manifest
```

Remplacer :

```text
GET /api/v1/library/{product_id}/download
```

par :

```text
POST /api/v1/library/{product_id}/download-jobs
GET  /api/v1/jobs/{job_id}
```

Ajouter :

```text
GET  /api/v1/agent/jobs/next
POST /api/v1/agent/jobs/{job_id}/claim
POST /api/v1/agent/jobs/{job_id}/progress
POST /api/v1/agent/jobs/{job_id}/complete
POST /api/v1/agent/jobs/{job_id}/failed
POST /api/v1/agent/heartbeat
```

---

## 22. Capability negotiation

Réponse cible :

```json
{
  "ok": true,
  "api_version": "1.0",
  "service": "kobo-vault",
  "capabilities": [
    "catalog_search",
    "library",
    "agent_export"
  ]
}
```

Capability optionnelle future :

```text
direct_download
```

Paris Library ne doit jamais supposer sa présence.

---

## 23. Critères d’acceptation MVP

Le MVP est validé si :

1. `/status` annonce `agent_export` ;
2. `/account` fonctionne ;
3. `/search` retourne catalogue + `owned` ;
4. `/library/manifest` retourne tous les ebooks possédés connus ;
5. Paris Library crée un job ;
6. kobo-adept récupère le job ;
7. kobo-adept télécharge directement depuis Kobo ;
8. le fichier n’a jamais transité par Cloudflare ;
9. le hook post-download est exécuté ;
10. l’agent remonte `size + sha256` ;
11. Paris Library voit le job `complete` ;
12. un second passage avec la même révision ne crée aucun nouveau download.

---

## 24. Hors scope v1

- stockage permanent EPUB dans Cloudflare ;
- streaming EPUB via Worker ;
- partage de fichier entre plusieurs machines ;
- achat Kobo ;
- modification de bibliothèque Kobo ;
- annotations ;
- progression de lecture ;
- suppression de DRM ;
- gestion avancée multi-agent ;
- synchronisation de fichiers distants.

---

## 25. Vision cible

```text
Recherche / UX / catalogues
          ↓
     Paris Library
          ↓
       Kobo-Vault
    ┌─────┴─────┐
    │           │
manifest      jobs
    │           │
    │           ▼
    │       kobo-adept
    │           │
    │           ▼
    │          Kobo
    │           │
    │           ▼
    └──────► EPUB local
                │
                ▼
        post-download hook
```

Principe directeur :

> Kobo-Vault orchestre.  
> kobo-adept télécharge.  
> Paris Library consomme et présente.  
> Cloudflare ne stocke ni ne transporte durablement les ebooks.
