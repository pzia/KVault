# Handoff — Kobo Vault 0.9.6.3

## Baseline

- Application : **Kobo Vault 0.9.6.3**.
- Base fonctionnelle : **0.9.6 validée en live**, avec correctifs de couverture 0.9.6.2 + 0.9.6.3.
- Provider API : **2.3**.
- Révision du contrat : **2.3.3**.
- Schéma acquisition : **1.4**.
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.
- Aucune migration D1.
- Les évolutions 0.9.6.1 restent reportées au backlog et ne sont pas réintroduites ici.

## Correctif catalogue couvertures

Le test live de `/api/v2/catalog/search` a montré que la 0.9.6.2 restait incomplète : le chemin `library_sync` fournit fréquemment `CoverImageUrl`, mais les résultats Kobo `/v1/products` et `/v2/products` exposent couramment un **`ImageId`** dans `ProductMetadata.Book`.

0.9.6.3 complète la normalisation commune :

1. URL directe : `CoverImageUrl`, variantes de casse, puis `ImageUrl` / `ImageURL` ;
2. identifiant image : `CoverImageId`, variantes de casse, puis **`ImageId` / `ImageID`** ;
3. les URLs protocole-relative `//cdn.kobo.com/...` sont normalisées en HTTPS ;
4. si seule l'identité image est fournie, Vault reconstruit l'URL depuis le CDN Kobo ;
5. `cover_url=null` n'est conservé que si aucune donnée image exploitable n'est fournie.

Cette correction couvre désormais :

- bibliothèque issue de `library_sync` ;
- onglet **Rapprochement** ;
- projection D1 publiée ;
- `/api/v2/library/*` ;
- **catalogue global `/api/v2/catalog/search` avec la forme réelle `ProductMetadata.Book.ImageId`**.

## Invalidation cache

Comme la 0.9.6.2 a pu mémoriser des résultats catalogue `cover_url:null`, les deux clés de cache sont à nouveau versionnées :

- cache Provider catalogue : `__v2_catalog_v3` ;
- cache catalogue interne : `__internal-cache/kobo-catalog-v3` ;
- cache PWA : `kobo-vault-v0963`.

Le déploiement 0.9.6.3 suffit à éviter les anciennes entrées du cache catalogue. Pour `/api/v2/library/*`, actualiser Kobo puis republier le manifest si la projection existante doit être reconstruite.

## Contrat

Aucun changement de contrat :

- OpenAPI **2.3.3** inchangé byte-for-byte ;
- acquisition schema **1.4** inchangé byte-for-byte ;
- `cover_url` existait déjà dans la notice Provider.

Aucune révision 2.3.4 ne doit être créée pour ce correctif.

## Acquisition / library_sync

Le comportement fonctionnel validé en 0.9.6 reste inchangé : fallback `library_sync`, candidats `kobo_kdrm`, transport opaque pour Paris, ContentKeys jamais publiées.

Les améliorations expérimentales produites en 0.9.6.1 restent reportées : normalisation explicite `FLEPUB -> epub`, séparation stricte `display_profile` / `kobo.platform`, déduplication renforcée des recettes device.

## Multi-utilisateur — backlog

Le modèle cible reste un pseudo-compte Vault / coffre isolé par identité, pouvant être lié à une identité Paris et à un profil Adept.

Backlog validé :

- interdire à terme la création implicite d'un coffre depuis l'écran de connexion lorsqu'un UID inconnu est saisi ;
- l'écran d'ouverture doit uniquement ouvrir un compte existant ;
- ajouter depuis un compte déjà ouvert un bouton explicite **Créer un compte Vault** ;
- aucun droit implicite du compte créateur sur le nouveau coffre ;
- préserver tous les coffres existants ;
- prévoir ensuite un sélecteur local de profils/coffres.

## Tests

La suite historique 0.6 -> 0.9.6.3 est verte. Le nouveau test 0.9.6.3 reproduit explicitement la forme réelle du catalogue Kobo :

```json
{
  "ProductMetadata": {
    "Book": {
      "Title": "...",
      "RevisionId": "...",
      "ImageId": "..."
    }
  }
}
```

Il vérifie que `ImageId` produit une `cover_url` CDN non nulle, ainsi que le fallback `ImageUrl` direct et l'invalidation des caches v3.

## Validation live recommandée

Après déploiement, rejouer directement :

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v2/catalog/search?q=example&field=all&limit=50&page=0" \
  | jq '.items[] | {title, product_id, cover_url}' | head -80
```

Les résultats disposant d'un `ImageId` Kobo doivent désormais avoir une `cover_url` CDN renseignée.
