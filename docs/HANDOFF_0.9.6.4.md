# Handoff — Kobo Vault 0.9.6.4

## Baseline

- Application : **Kobo Vault 0.9.6.4**.
- Base fonctionnelle : **0.9.6 validée en live**, avec correctifs de couverture 0.9.6.2 + 0.9.6.3.
- Provider API : **2.3**.
- Révision du contrat : **2.3.3**.
- Schéma acquisition : **1.4**.
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.
- Nouvelle migration D1 : **`0004_library_sync_state.sql`**.
- Les évolutions 0.9.6.1 restent reportées au backlog et ne sont pas réintroduites ici.

## Objectif 0.9.6.4

Quand une installation Paris utilise le Provider pour lire **sa bibliothèque Kobo publiée**, Vault doit éviter de servir indéfiniment une projection ancienne. La fraîcheur devient une responsabilité interne de Vault ; Paris n'a pas à piloter la synchro Kobo.

La règle est : **si aucune synchro Kobo réussie n'a eu lieu dans les dernières 24 h, la première lecture Provider de la bibliothèque déclenche une synchro Kobo puis republie la projection**.

Ce mécanisme concerne :

- première page de `GET /api/v2/library/manifest` ;
- première page de `GET /api/v2/library/search` ;
- `GET /api/v2/library/{product_id}`.

Il ne concerne pas `GET /api/v2/catalog/search`, qui représente le catalogue Kobo global et conserve sa propre politique de cache/recherche.

## État de fraîcheur D1

La migration `0004_library_sync_state.sql` ajoute un état par `uid_hash` :

```text
library_sync_state
  uid_hash              PK / FK vaults
  last_success_at        dernière vraie synchro Kobo réussie
  last_attempt_at        dernière tentative automatique
  last_error             dernière erreur non sensible
  refresh_started_at     verrou de refresh
  updated_at
```

Aucun token, URL de livre, ContentKey ou contenu Kobo n'est stocké dans cette table.

Paramètres 0.9.6.4 :

```text
fraîcheur          24 h
verrou refresh      5 min
backoff après échec 15 min
```

Le verrou est par `uid_hash`. Deux installations Paris utilisant la même identité Vault peuvent donc lire la même projection, mais une seule déclenche la synchro Kobo lorsqu'elle devient stale.

## Source des credentials

Le refresh automatique réutilise la copie serveur chiffrée des credentials Kobo déjà gérée par `kobo_api_credentials` et `KOBO_API_CREDENTIAL_KEY`. Aucun credential n'est ajouté au contrat Provider ni renvoyé à Paris.

Si Kobo renouvelle l'access token pendant la synchro, le bundle chiffré est republié côté serveur.

Si aucun accès Kobo serveur n'est publié, Vault ne peut pas synchroniser de manière autonome : il continue alors à servir la dernière projection disponible. La publication de credentials réarme immédiatement les tentatives automatiques.

## Synchro manuelle depuis l'IHM

Avant 0.9.6.4, D1 connaissait la date de publication de `library_projection`, mais pas forcément la date de la vraie synchro Kobo faite dans le navigateur.

`buildProjectionPayload()` transmet maintenant :

```json
{
  "source_sync_at": "<vault.purchasesFetchedAt>"
}
```

La route d'administration `PUT /api/v2/vault/{uid_hash}/projection` utilise cette date comme fraîcheur réelle.

Une ancienne installation/navigateur peut republier un snapshot plus ancien : dans ce cas, la fraîcheur est volontairement ramenée à la date de ce snapshot, afin que le prochain appel Provider le répare automatiquement plutôt que de considérer à tort la projection comme fraîche.

## Pagination

Aucun refresh n'est déclenché au milieu d'un parcours paginé :

- `manifest` : contrôle uniquement lorsque `offset == 0` ;
- `library/search` : contrôle uniquement lorsque `offset == 0`.

Paris ne peut donc pas lire la page 1 d'une génération puis provoquer lui-même un refresh en demandant une page suivante.

## Défaillance Kobo

Le refresh automatique est **fail-soft** :

1. Vault tente la synchro Kobo si la projection est stale ;
2. si elle réussit, la projection est remplacée et `last_success_at` est avancé ;
3. si Kobo échoue, Vault conserve et sert la dernière projection D1 ;
4. `last_error` est mémorisé sans secret ;
5. les appels suivants n'assaillent pas Kobo : backoff de 15 minutes.

Le contrat de réponse Provider reste inchangé ; aucune métadonnée de fraîcheur n'est imposée aux consommateurs.

## Multi-utilisateur / plusieurs Paris

L'état de fraîcheur est strictement partitionné par `uid_hash`, comme la projection et les credentials Kobo.

Exemple supporté :

```text
Vault identity B
├── Paris #1
└── Paris #2
```

Les deux Paris lisent la même projection B. Lorsque celle-ci dépasse 24 h, le premier appel qui obtient le verrou synchronise Kobo ; l'autre continue à pouvoir servir la projection existante et ne démarre pas une deuxième synchro concurrente.

## Contrat

Aucun changement public :

- OpenAPI **2.3.3** inchangé byte-for-byte ;
- acquisition schema **1.4** inchangé byte-for-byte ;
- aucun nouveau champ obligatoire dans les réponses ;
- aucune révision 2.3.4.

La nouvelle migration est une évolution d'implémentation/stockage interne, pas une évolution du Provider contract.

## Correctifs de couverture conservés

0.9.6.4 conserve les correctifs 0.9.6.2 / 0.9.6.3 :

- `CoverImageUrl` / `ImageUrl` directs ;
- `CoverImageId` / `ImageId` comme identifiants CDN ;
- normalisation des URLs `//cdn.kobo.com/...` ;
- cache catalogue v3 ;
- bibliothèque, Rapprochement, projection et API Provider cohérents.

Le cache PWA passe à `kobo-vault-v0964`. Les caches catalogue v3 ne changent pas car cette release ne modifie pas leur représentation.

## Acquisition / library_sync

Le comportement validé en 0.9.6 reste inchangé : fallback acquisition `library_sync`, candidats KDRM, transport opaque pour Paris, ContentKeys jamais publiées.

Le refresh bibliothèque 0.9.6.4 réutilise le même endpoint Kobo `/v1/library/sync`, mais son résultat sert à reconstruire la projection Provider et non à modifier le contrat d'acquisition.

## Tests

La suite historique 0.6 -> 0.9.6.4 est verte.

Le nouveau test `tests/api-v0964-integration.test.mjs` vérifie :

1. snapshot initial vieux de 48 h ;
2. appel première page du manifest => synchro Kobo et remplacement de la projection ;
3. second appel dans les 24 h => aucun appel Kobo ;
4. publication d'un snapshot navigateur plus ancien => prochain appel Provider le répare ;
5. page paginée non initiale => aucun refresh ;
6. verrou déjà détenu par une autre instance => aucune seconde synchro ;
7. échec Kobo => projection existante toujours servie ;
8. nouvel appel après échec => backoff 15 min, sans tempête de requêtes.

## Déploiement

Le script standard applique automatiquement les migrations avant le Worker :

```bash
./scripts/update-from-zip.sh kobo-library-vault-v0.9.6.4.zip --deploy
```

ou, depuis le projet déjà mis à jour :

```bash
./scripts/deploy.sh
```

`deploy.sh` exécute `wrangler d1 migrations apply ... --remote` avant `wrangler deploy`.

## Validation live recommandée

Après déploiement :

1. vérifier que l'accès Kobo serveur est activé dans **Données → API fournisseur Kobo** ;
2. attendre/forcer un état stale si nécessaire ;
3. appeler le manifest :

```bash
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v2/library/manifest?limit=200" \
  | jq '.items | length'
```

Une première lecture stale peut être plus lente car elle attend la synchro Kobo. Les lectures suivantes dans les 24 h doivent être servies directement depuis D1.

## Backlog conservé

Multi-utilisateur :

- interdire à terme la création implicite d'un coffre depuis l'écran de connexion lorsqu'un UID inconnu est saisi ;
- ajouter depuis un compte déjà ouvert un bouton explicite **Créer un compte Vault** ;
- aucun droit implicite du compte créateur sur le nouveau coffre ;
- prévoir ensuite un sélecteur local de profils/coffres.

Améliorations 0.9.6.1 reportées :

- normalisation explicite `FLEPUB -> epub` ;
- séparation stricte `display_profile` / `kobo.platform` ;
- déduplication renforcée des recettes `library_sync`.
