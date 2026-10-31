# Kobo Vault API v2.3.2 — Sémantique acquisition / DRM

## 1. Problème résolu

Une URL HTTP Kobo ne suffit pas à déterminer comment un fichier doit être traité. Deux candidats pouvant tous deux ressembler à un ebook téléchargeable peuvent relever de mécanismes distincts.

Kobo Vault 0.9.2 conserve donc explicitement la sémantique du candidat jusqu’au consommateur.

## 2. Modèle candidat

Exemple sans DRM :

```json
{
  "kind": "http",
  "media_format": "epub",
  "source_format": "EPUB3",
  "handling": "http_plain",
  "drm": {
    "family": "none",
    "raw_type": "SignedNoDrm",
    "protected": false
  },
  "kobo": {
    "display_profile": "Android",
    "content_keys_present": false,
    "content_key_count": 0
  }
}
```

Exemple KDRM :

```json
{
  "kind": "http",
  "media_format": "kepub",
  "source_format": "KEPUB",
  "handling": "kobo_kdrm",
  "drm": {
    "family": "kobo_kdrm",
    "raw_type": "KDRM",
    "protected": true
  },
  "kobo": {
    "display_profile": "Android",
    "content_keys_present": true,
    "content_key_count": 12
  }
}
```

Exemple Adobe :

```json
{
  "kind": "http",
  "media_format": "epub",
  "source_format": "EPUB3",
  "handling": "adobe_adept",
  "drm": {
    "family": "adobe_adept",
    "raw_type": "AdobeDrm",
    "protected": true
  }
}
```

## 3. Règles consommateur

Le consommateur doit prioriser `handling` et `drm.family`.

```text
handling=http_plain
→ téléchargement HTTP direct ; aucune étape DRM à déduire.

handling=adobe_adept
→ mécanisme Adobe ; déléguer à une capacité ADEPT compatible.

handling=kobo_kdrm
→ mécanisme Kobo KDRM ; ne pas envoyer automatiquement à un outil ADEPT Adobe.

handling=unknown
→ refuser proprement ou demander une décision explicite.
```

La présence d’une extension `.epub` ou d’un `media_format=epub` ne permet pas à elle seule de conclure que le fichier est ADEPT, sans DRM ou KDRM.

## 4. DisplayProfile

Le corps de `/acquisition` accepte `display_profile=Android|Desktop`.

Le profil peut influencer ce que Kobo expose. Vault ne garantit pas qu’un profil produira toujours une famille DRM donnée ; il transmet le profil à Kobo et rapporte le résultat réel.

Un orchestrateur peut donc essayer un autre profil lorsqu’un premier mécanisme n’est pas pris en charge localement, à condition de respecter les erreurs/limites Kobo.

## 5. ContentKeys

Le descripteur expose uniquement :

```json
{
  "content_keys": {
    "present": true,
    "count": 12,
    "values_exposed": false,
    "retrieval": "not_exposed"
  }
}
```

En mode `delegated`, `retrieval` vaut `consumer_replays_content_access` et le bloc `delegation.content_access_request` décrit une requête Kobo que l’outil local peut reproduire.

Vault ne transmet donc pas les valeurs `ContentKeys` à Paris Library.

## 6. Compatibilité de transition

Les anciens champs v2.1 restent présents dans chaque candidat :

```text
drm_type
format
protected
```

Ils sont marqués dépréciés. Les nouveaux consommateurs doivent utiliser :

```text
drm.raw_type
drm.family
source_format
media_format
handling
```

## Source d’acquisition

Depuis la v2.3, la sémantique DRM est complétée par la provenance du candidat :

```text
kobo.source = content_access_book
kobo.source = library_download_link
```

`library_download_link` représente l’export utilisateur Kobo, notamment le chemin ACSM Adobe lorsqu’il est disponible. Ce candidat n’est pas dérivé du `DisplayProfile` et porte donc `display_profile = null`.

Un ACSM reste une licence à transmettre au moteur ADEPT ; il ne doit jamais être traité comme un EPUB téléchargé.


## Transport HTTP associé

La famille DRM ne suffit pas à exécuter le téléchargement. Le consommateur doit aussi appliquer `candidate.headers`. Voir `DOWNLOAD_TRANSPORT_SEMANTICS.md`.
