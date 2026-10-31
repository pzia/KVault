# Migration consommateur — Kobo Vault API v2.1 → v2.2

## Résumé

La route reste :

```text
POST /api/v2/library/{product_id}/acquisition
```

Le changement concerne la sémantique du descripteur.

## Avant (v2.1)

Un consommateur pouvait seulement lire :

```text
format
drm_type
protected
url
```

Cette vue était insuffisante pour décider de la bonne chaîne locale.

## Maintenant (v2.2)

Lire en priorité :

```text
candidate.media_format
candidate.source_format
candidate.handling
candidate.drm.family
candidate.drm.raw_type
candidate.kobo.display_profile
candidate.kobo.content_keys_present
```

## Table de dispatch recommandée

| `handling` | Action locale |
|---|---|
| `http_plain` | téléchargement HTTP direct |
| `adobe_adept` | moteur ADEPT/ACSM/Adobe compatible |
| `kobo_kdrm` | moteur Kobo KDRM compatible |
| `unknown` | erreur explicite / intervention |

Ne pas appliquer systématiquement un traitement ADEPT à tout candidat HTTP Kobo.

## Choix du profil

Le corps accepte désormais :

```json
{
  "mode": "descriptor",
  "display_profile": "Desktop"
}
```

Valeur par défaut : `Android`.

Un consommateur peut demander un autre profil lorsqu’il souhaite connaître les mécanismes réellement exposés par Kobo pour ce profil.

## Délégation

Le mode `delegated` continue d’exiger `kobo.acquisition.delegate`.

Il ne renvoie toujours pas le refresh token ni les valeurs `ContentKeys`. Il fournit une requête `content_access_book` reproductible localement, avec le `DisplayProfile` demandé.

## Compatibilité

Les champs `drm_type`, `format`, `protected` sont conservés pour transition mais dépréciés.

Un validateur strict du schéma acquisition v1.1 doit passer au schéma v1.2, car le descripteur contient de nouveaux champs structurés.
