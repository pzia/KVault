# Sémantique de l'export ACSM Kobo

## But

Kobo peut exposer plusieurs chemins pour un même achat. Kobo Vault ne doit pas réduire ces chemins à une seule « URL EPUB ».

À partir du contrat v2.3, Vault combine deux sources indépendantes :

```text
content_access_book
    → EPUB / KEPUB / PDF selon DisplayProfile et DRM Kobo

get_download_link
    → export utilisateur, notamment URLLink.acsm lorsque Kobo propose Adobe DRM
```

## Résolution

Vault lit `get_download_link` dans la réponse Kobo `/v1/initialization`. Il ne code pas en dur une URL de fulfillment ACSM.

Le resolver essaie les identifiants techniques connus du livre et accepte notamment :

- une redirection HTTPS vers un fichier `.acsm` ;
- une réponse JSON/texte contenant une URL ACSM ;
- un corps ACSM servi directement par l'endpoint Kobo.

Le lookup est **best effort** : son échec ne supprime pas les autres candidats.

## Candidat ACSM

Un lien de fulfillment identifié est normalisé en :

```json
{
  "kind": "acsm",
  "transport": "https",
  "method": "GET",
  "url": "https://.../URLLink.acsm?...",
  "headers": {},
  "media_format": "acsm",
  "source_format": "ACSM",
  "handling": "adobe_adept",
  "drm": {
    "family": "adobe_adept",
    "raw_type": "AdobeDrm",
    "protected": true
  },
  "kobo": {
    "source": "library_download_link",
    "display_profile": null,
    "content_keys_present": false,
    "content_key_count": 0,
    "requires_kobo_authorization": false,
    "lookup_shape": "get_revision_id"
  }
}
```

L'ACSM est une **licence**, pas le fichier EPUB/PDF final. Le moteur local ADEPT est responsable du fulfillment et du fichier produit.

## Sécurité

Vault ne télécharge pas et ne stocke pas le livre final.

Le lien ACSM peut être temporaire ou contenir un token de fulfillment. La réponse d'acquisition reste donc :

```http
Cache-Control: private, no-store
```

Il ne doit pas être journalisé en clair.

Si la récupération de l'ACSM exige l'Authorization Kobo, ce secret n'est ajouté au candidat qu'en mode `delegated` et avec le scope `kobo.acquisition.delegate`.

Le refresh token Kobo n'est jamais exposé.

## Validation réelle

La ressource `get_download_link` est annoncée par les initialisations Kobo observées, mais ses variantes de requête/réponse ne constituent pas une API publique documentée par Kobo. Le resolver est donc volontairement tolérant et expose dans `sources.acsm_export` l'état de la résolution.

Un premier test réel sur un titre affichant « Adobe DRM EPUB » dans Kobo.com reste la validation de référence du chemin de bout en bout.
