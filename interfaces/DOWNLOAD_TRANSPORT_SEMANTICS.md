# Kobo Vault API v2.3.x — Sémantique de transport des candidats Kobo

## 1. Objet

Le comportement transport a été introduit avec la révision **2.3.1** et reste inchangé en **2.3.2**. Il ne change ni la base `/api/v2`, ni `api_version=2.3`, ni le schéma d’acquisition `1.3`.

Elle précise et durcit la recette HTTP nécessaire pour télécharger les candidats produits par `content_access_book`.

Un consommateur ne doit pas considérer `candidate.url` comme suffisant : **`candidate.headers` fait partie du contrat de téléchargement**.

## 2. Variantes Kobo normalisées

Vault accepte les variantes observées dans les réponses Kobo :

```text
ContentUrls[]
DownloadUrls[]
```

et, dans une entrée :

```text
DownloadUrl
Url
```

Les candidats des deux conteneurs sont fusionnés, dédupliqués et conservés jusqu’à la limite de sécurité de l’API.

## 3. Header requester-pays

Pour les candidats issus de `content_access_book`, Vault publie :

```json
{
  "headers": {
    "x-amz-request-payer": "requester"
  }
}
```

Ce header doit être envoyé sur le premier téléchargement et préservé lorsqu’un endpoint Kobo redirige vers un objet S3 requester-pays. Une URL `*.amazonaws.com` déjà pré-signée est conservée telle quelle : Vault ne retire pas son paramètre `b`, car toute mutation de query peut invalider la signature.

Un client qui reconstruit lui-même la requête au lieu d’appliquer `candidate.headers` peut recevoir une erreur du stockage amont alors que le candidat est valide.

## 4. Authorization Kobo

Le champ :

```text
candidate.kobo.requires_kobo_authorization
```

indique qu’un Bearer Kobo peut être requis sur le **premier hop Kobo**.

En mode `descriptor`, le Bearer n’est jamais exposé.

En mode `delegated`, lorsque cette valeur vaut `true`, Vault peut ajouter :

```http
Authorization: Bearer <access-token>
```

à `candidate.headers`.

### Règle de sécurité

L’Authorization Kobo est destinée au premier origin Kobo. Lors d’une redirection cross-origin (par exemple Kobo → Amazon S3), le consommateur **ne doit pas propager l’Authorization Kobo vers le nouvel origin**.

Le header :

```http
x-amz-request-payer: requester
```

peut en revanche devoir survivre à cette redirection.

## 5. Exemple

```json
{
  "kind": "http",
  "media_format": "kepub",
  "handling": "kobo_kdrm",
  "url": "https://storedownloads.kobo.com/...",
  "headers": {
    "x-amz-request-payer": "requester"
  },
  "kobo": {
    "source": "content_access_book",
    "display_profile": "Android",
    "content_keys_present": true,
    "content_key_count": 12,
    "requires_kobo_authorization": true
  }
}
```

En mode `delegated`, le même candidat peut inclure temporairement `Authorization` dans `headers`.

## 6. Livres archivés

Un livre marqué `archived=true` dans la projection n’est plus aplati en simple `not_downloadable`.

L’acquisition retourne :

```text
HTTP 409
error = archived_book
```

Le consommateur doit demander à l’utilisateur de restaurer le titre dans sa bibliothèque Kobo avant de réessayer.


## 7. Note de compatibilité amont

Ces variantes sont des comportements observés de clients Kobo non officiels et ne constituent pas une promesse d’API publique de Kobo. La normalisation reste donc tolérante et doit être couverte par les diagnostics réels de l’instance.
