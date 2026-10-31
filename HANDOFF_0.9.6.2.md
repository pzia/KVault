# Handoff — Kobo Vault 0.9.6.2

## Baseline

- Application : **Kobo Vault 0.9.6.2**.
- Base fonctionnelle : **0.9.6 validée en live**.
- Provider API : **2.3**.
- Révision du contrat : **2.3.3**.
- Schéma acquisition : **1.4**.
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.
- Aucune migration D1.
- Les évolutions expérimentales produites en 0.9.6.1 ne sont **pas** réintroduites dans cette version ; elles restent reportées au backlog.

## Correctif couvertures

Un compte Kobo réel expose certaines notices avec `CoverImageUrl` sans `CoverImageId`. La 0.9.6 ne conservait que `CoverImageId`, ce qui produisait des couvertures absentes à la fois dans l'API Provider et dans l'onglet Rapprochement.

0.9.6.2 corrige la normalisation commune :

1. `CoverImageUrl` / variantes de casse Kobo est conservé dans `book.coverUrl` ;
2. une URL protocole-relative `//cdn.kobo.com/...` est normalisée en `https://cdn.kobo.com/...` ;
3. l'URL Kobo directe est prioritaire ;
4. `CoverImageId` reste un fallback pour reconstruire une URL CDN ;
5. `null` n'est conservé que lorsqu'aucune information de couverture exploitable n'est fournie.

Le même chemin est utilisé pour :

- les cartes Bibliothèque ;
- le catalogue / Rapprochement ;
- la projection publiée dans `library_projection` ;
- `/api/v2/catalog/search` ;
- `/api/v2/library/*` après republication de la projection.

## Invalidation cache

Le correctif change les clés des deux caches catalogue Vault afin d'éviter qu'un résultat 0.9.6 déjà normalisé sans couverture reste servi après déploiement :

- cache Provider catalogue : `__v2_catalog_v2` ;
- cache catalogue interne : `__internal-cache/kobo-catalog-v2`.

Le cache PWA passe à `kobo-vault-v0962`.

Après mise à jour, une **actualisation Kobo** du coffre concerné puis une **publication du manifest** suffit pour reconstruire les lignes D1 avec `cover_url` renseigné. Aucune migration D1 n'est nécessaire.

## Contrat

Aucun changement de contrat :

- OpenAPI **2.3.3** inchangé ;
- acquisition schema **1.4** inchangé ;
- `cover_url` existait déjà dans le schéma de notice et accepte déjà `string | null`.

Il ne faut donc pas créer de révision 2.3.4 pour ce correctif.

## Acquisition / library_sync

Le comportement validé en 0.9.6 reste inchangé : fallback `library_sync`, candidats `kobo_kdrm`, transport Kobo opaque pour Paris, ContentKeys jamais publiées.

Les améliorations suivantes restent reportées : normalisation explicite `FLEPUB -> epub`, séparation plus stricte `display_profile` / `kobo.platform`, déduplication renforcée des recettes `library_sync`. Elles ne sont pas requises par le flux live actuellement validé.

## Multi-utilisateur — backlog

Le modèle reste : un pseudo-compte Vault / coffre isolé peut correspondre à une identité Paris et à un profil Adept ; plusieurs installations Paris peuvent utiliser des sous-ensembles d'identités Vault avec des tokens Provider distincts.

Évolution demandée avant une future stabilisation :

- **interdire la création implicite d'un nouveau coffre depuis l'écran de connexion lorsqu'un UID inconnu est saisi** ;
- l'écran d'ouverture doit seulement ouvrir un compte existant et retourner clairement `compte inconnu` sinon ;
- ajouter depuis un compte déjà ouvert un bouton explicite **Créer un compte Vault** ;
- ne donner aucun droit implicite du compte créateur sur le nouveau coffre ;
- préserver tous les coffres existants lors de la migration ;
- prévoir ensuite un sélecteur local de profils/coffres pour l'usage familial.

## Tests

La suite historique 0.6 -> 0.9.6 reste verte après mise à jour des assertions de release. 0.9.6.2 ajoute un test dédié qui couvre :

- `CoverImageUrl` seul ;
- URL protocole-relative ;
- rejet d'un schéma non HTTP(S) ;
- fallback `CoverImageId` ;
- normalisation catalogue ;
- exposition Provider `cover_url` ;
- invalidation des caches catalogue et PWA.

## Validation live recommandée

1. Déployer 0.9.6.2.
2. Ouvrir le coffre affecté et actualiser la bibliothèque Kobo.
3. Vérifier les couvertures dans Bibliothèque et Rapprochement.
4. Republier le manifest API.
5. Vérifier sur un titre connu que `/api/v2/library/{product_id}` et `/api/v2/catalog/search` renvoient une `cover_url` non nulle.
