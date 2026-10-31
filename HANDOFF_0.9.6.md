# Handoff — Kobo Vault 0.9.6

## Baseline

- Application : **Kobo Vault 0.9.6**.
- Provider API : **2.3**.
- Révision du contrat : **2.3.3**.
- Schéma acquisition : **1.4**.
- Architecture inchangée : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.
- Aucune migration D1.

## Pourquoi le contrat change

Le probe 0.9.5.1 sur des titres Kobo réels a démontré un cas non couvert par 2.3.2 : `content_access_book` peut renvoyer des `ContentKeys` mais aucun `ContentUrl`, alors que `/v1/library/sync` fournit `BookMetadata.DownloadUrls` pour le même entitlement. Le contrat 1.3 limitait `candidate.kobo.source` à `content_access_book` et `library_download_link` ; le cas réel justifie donc la révision 2.3.3.

## Acquisition library_sync

`content_access_book` reste prioritaire. Si aucun candidat n’en sort, Vault effectue une sync Kobo avec `Filter=ALL`, `DownloadUrlFilter=Generic,Android` et `PrioritizeRecentReads=true`, corrèle ProductId/RevisionId et normalise les `DownloadUrls` du `BookMetadata` correspondant.

Pour les candidats observés `FLEPUB + KDRM` :

- `handling = kobo_kdrm` ;
- `kobo.source = library_sync` ;
- `kobo.platform` reprend la plateforme Kobo annoncée ;
- `x-amz-request-payer=requester` reste dans la recette de transport ;
- les valeurs `ContentKeys` ne sont jamais exposées ; leur présence et leur nombre seulement sont signalés.

Les formats contenant `SAMPLE` sont volontairement exclus des candidats de livre complet.

## Contrat 2.3.3 / schema 1.4

Nouveautés :

- `candidate.kobo.source` accepte `library_sync` ;
- `candidate.kobo.platform` est optionnel ;
- `acquisition.sources.library_sync` expose `status`, `candidate_count`, `pages`, `event_count` ;
- aucun nouveau `handling` n’est créé.

Fichiers canoniques :

- `interfaces/kobo-vault-openapi-v2.3.3.yaml`
- `interfaces/kobo-vault-acquisition.schema.json`
- `interfaces/kobo-vault-acquisition-v1.4.schema.json`
- `interfaces/MIGRATION_V2.3.2_TO_V2.3.3.md`

## Diagnostic transport

Le probe `library_sync` utilise maintenant un `GET` avec `Range: bytes=0-0` au lieu de `HEAD`, car `storedownloads.kobo.com` peut ne pas représenter le comportement réel avec HEAD. Le Bearer Kobo reste supprimé lors d’un redirect cross-origin ; `x-amz-request-payer` est conservé.

## Compatibilité Paris

La compatibilité fonctionnelle attendue avec Paris 0.7.11 est bonne si Paris sélectionne les candidats par `handling` et ignore les champs Kobo additionnels. À valider en live : Vault 0.9.6 doit transformer les deux BD du corpus en candidat `kobo_kdrm` sans hotfix Paris. Livre test sans recette reste sans recette connue si les trois sources sont vides.

## Tests

La suite historique 0.6→0.9.5.1 reste verte. 0.9.6 ajoute :

- test de schéma/normalisation `library_sync` ;
- exclusion du sample ;
- test d’intégration `content_access_book` vide + ContentKeys + `library_sync` FLEPUB/KDRM → acquisition 200.

## Suite

1. Déployer 0.9.6.
2. Retester Livre test KDRM A et Livre test KDRM B via Paris 0.7.11.
3. Vérifier le résultat du GET Range dans le diagnostic.
4. Ne traiter Livre test sans recette comme `metadata_only` qu’après preuve complémentaire ; conserver `unknown` sinon.
