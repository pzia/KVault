# Migration Provider 2.3.2 → 2.3.3

La révision 2.3.3 est motivée par un cas Kobo réel observé en production : certains ebooks possédés ont des `ContentUrls` vides dans `content_access_book` alors que `/v1/library/sync` fournit un `BookMetadata.DownloadUrls` exploitable.

## Changements publics

- `schema_version` d'acquisition passe de `1.3` à `1.4`.
- `candidate.kobo.source` accepte désormais `library_sync`.
- `candidate.kobo.platform` peut indiquer la plateforme annoncée par Kobo (`Android`, `Generic`, etc.).
- `acquisition.sources.library_sync` expose le statut de cette source et le nombre de candidats trouvés.

Aucun nouveau `handling` n'est introduit. Un contenu `FLEPUB` protégé par `KDRM` reste `handling=kobo_kdrm`. Vault n'expose toujours pas les valeurs de `ContentKeys`.

## Résolution

Vault interroge `library_sync` uniquement en fallback lorsque `content_access_book` n'a produit aucun candidat. Les variantes dont le format contient `SAMPLE` ne sont pas proposées comme acquisition du livre complet.

Paris peut continuer à sélectionner les candidats par `handling`; la provenance Kobo reste une information de recette.
