# Handoff — Kobo Vault 0.9.5

## Baseline

- Application : **Kobo Vault 0.9.5**.
- Provider API : **2.3**.
- Révision du contrat : **2.3.2** (inchangée).
- Schéma acquisition : **1.3** (inchangé).
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.
- Aucune migration D1 nouvelle.

## Objet de 0.9.5

0.9.5 est une release de **diagnostic/conformance Kobo device delivery** motivée par trois titres possédés qui retournent `422 not_downloadable` après absence de candidat `content_access_book` (Android/Desktop) et ACSM.

Corpus par défaut :

```text
11111111-1111-4111-8111-111111111111  Livre test KDRM A
22222222-2222-4222-8222-222222222222  Livre test KDRM B
33333333-3333-4333-8333-333333333333  Livre test sans recette
```

Question à trancher : **`/v1/library/sync` transporte-t-il une recette d’acquisition exploitable qui n’apparaît pas dans `/products/books/{id}/access` ?**

Aucune hypothèse de format (PDF/EPUB/KEPUB/autre) n’est codée comme conclusion.

## Probe interne

Nouvelle route d’administration, hors contrat Provider :

```text
POST /api/v2/vault/{uid_hash}/diagnostics/library-sync
X-Vault-Auth: <secret du coffre>
Content-Type: application/json
```

Corps optionnel :

```json
{
  "product_ids": ["..."],
  "probe_urls": true
}
```

Sans `product_ids`, le corpus ci-dessus est utilisé. `probe_urls=false` désactive les requêtes HEAD.

Le probe utilise les credentials Kobo déjà publiés via l’accès acquisition. Il :

- récupère `initialization` puis `library_sync` avec `Filter=ALL`, `DownloadUrlFilter=Generic,Android`, `PrioritizeRecentReads=true` ;
- capture toutes les pages de la première sync ;
- conserve le dernier `x-kobo-synctoken` observé et tente une sync incrémentale si un token existe ;
- corrèle chaque titre avec `ProductId` et le `RevisionId` projeté ;
- rapporte le type exact d’événement (`NewEntitlement`, `ChangedEntitlement`, etc.) ;
- extrait les champs dont les noms contiennent URL/download/content/key/mime/format ;
- rapporte host, noms de query params, signal URL signée/tokenisée et signal d’expiration ;
- rapporte les noms de headers nécessaires (`Authorization` uniquement quand l’origine Kobo l’exige, `x-amz-request-payer` pour le transport contenu) ;
- effectue au plus des requêtes `HEAD` sur les URLs de contenu candidates, avec suppression du Bearer lors d’un redirect cross-origin ;
- rapporte `Content-Type`, `Content-Disposition`, taille annoncée et format inféré (`EPUB`, `KEPUB`, `PDF`, `CBZ`, `unknown`).

Vault ne télécharge ni ne stocke le payload du livre pendant ce probe.

## Expurgation

Le rapport est destiné à pouvoir être partagé pour analyse sans publier les secrets Kobo :

- access/refresh/user tokens et Authorization : expurgés ;
- `ContentKeys[].Value` : expurgé ;
- valeurs des paramètres de signature/token/auth/credential/policy : expurgées ;
- host, path et **noms** de paramètres restent visibles ;
- aucune valeur de ContentKey n’est publiée.

Le fichier produit reste néanmoins un diagnostic sensible : le conserver localement et le partager seulement avec les personnes nécessaires.

## Utilisation CLI

```bash
KOBO_VAULT_URL=https://<worker> \
KOBO_VAULT_UID_HASH=<uid_hash> \
KOBO_VAULT_AUTH=<secret> \
node scripts/probe-library-sync.mjs
```

Le nom du rapport est affiché en sortie. On peut définir `KOBO_VAULT_PROBE_OUTPUT=/chemin/rapport.json` et/ou passer des ProductId en arguments.

## Décision volontairement différée

0.9.5 **n’ajoute pas** `library_sync` à `acquisition.candidates`. Le contrat public reste byte-for-byte celui de 0.9.4 tant que les captures réelles n’ont pas prouvé :

1. une URL de contenu portée par l’objet sync ;
2. sa relation avec le titre et sa révision ;
3. le transport/DRM/format associé ;
4. l’absence équivalente dans `content_access_book` / `get_download_link`.

Si la preuve est positive, l’évolution suivante devra normaliser la recette de façon générique (`kobo.source=library_sync`) en réutilisant autant que possible `http_plain`, `kobo_kdrm` ou `adobe_adept`. Une révision distincte du contrat sera alors produite uniquement si le schéma public doit effectivement changer.

## Compatibilité Paris

Aucun changement Paris n’est requis pour installer 0.9.5 : aucune route Provider, aucun scope et aucun schéma public ne changent. Paris continue de recevoir les mêmes candidats qu’en 0.9.4.

## Suite

Après capture des trois rapports :

- si `library_sync` contient une recette exploitable : définir la normalisation et vérifier si le schéma acquisition 1.3 accepte déjà la nouvelle source ; réviser le contrat seulement si nécessaire ;
- sinon : classer les trois titres `unknown` ou `metadata_only` selon les preuves et poursuivre l’analyse d’autres ressources annoncées par `initialization` / workflow device ;
- reprendre ensuite le chantier de conformance OpenAPI/JSON Schema et le découpage de `worker.js` prévu avant RC 1.0.
