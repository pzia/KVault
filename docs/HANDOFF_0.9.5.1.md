# Handoff — Kobo Vault 0.9.5.1

## Baseline

- Application : **Kobo Vault 0.9.5.1**.
- Provider API : **2.3**.
- Révision du contrat : **2.3.2**, inchangée.
- Schéma acquisition : **1.3**, inchangé.
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.

## Objet de 0.9.5.1

0.9.5.1 est un correctif ergonomique de 0.9.5. Le probe `library_sync` peut désormais être lancé directement depuis l'IHM du coffre, sans récupérer manuellement `uid_hash` ou `X-Vault-Auth`.

Dans l'onglet **Données**, panneau **Diagnostic acquisition / Livraison device / library_sync** :

1. cliquer **Lancer le diagnostic library_sync** ;
2. Vault utilise la session déjà ouverte (`session.uidHash` et `session.authSecret`) ;
3. si l'accès acquisition est déjà publié, il est réutilisé tel quel ;
4. sinon, les jetons Kobo du coffre sont publiés chiffrés temporairement, le probe est exécuté, puis cette publication est supprimée dans un `finally` ;
5. le JSON expurgé peut être copié ou téléchargé.

Le corpus par défaut reste :

- `11111111-1111-4111-8111-111111111111` — Livre test KDRM A ;
- `22222222-2222-4222-8222-222222222222` — Livre test KDRM B ;
- `33333333-3333-4333-8333-333333333333` — Livre test sans recette.

## Sécurité

- Aucun UID hash ou secret d'authentification n'est affiché dans l'IHM.
- Le rapport reste expurgé selon les règles introduites en 0.9.5.
- Le probe utilise `HEAD` pour caractériser les URL candidates et ne télécharge pas le contenu des livres.
- Une publication acquisition créée uniquement pour le diagnostic est supprimée automatiquement, y compris en cas d'erreur du probe. Si cette suppression échoue, l'IHM le signale explicitement.
- Si l'accès acquisition était déjà activé avant le diagnostic, son état est conservé.

## Contrat Provider

Aucun changement du contrat public. `interfaces/kobo-vault-openapi-v2.3.2.yaml` reste byte-identique à la baseline 0.9.5.

La route `/api/v2/vault/{uid_hash}/diagnostics/library-sync` reste une route d'administration interne et ne fait pas partie du contrat Provider.

## Validation

`npm run check` passe intégralement, y compris le nouveau test `tests/ui-v0951.test.mjs`.

Aucune migration D1.

## Suite

Ne pas modifier `acquisition.candidates` avant analyse d'un rapport réel des trois titres. Si `library_sync` expose une recette absente de `content_access_book` et `get_download_link`, normaliser cette recette comme nouvelle source Kobo générique (`kobo.source=library_sync`) et ne réviser le contrat public que si le schéma actuel ne permet pas de l'exprimer proprement.
