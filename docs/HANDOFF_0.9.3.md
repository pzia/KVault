# Handoff — Kobo Vault 0.9.3

## Baseline à transmettre à l’écosystème

- Application : **Kobo Vault 0.9.3**.
- Provider API : **2.3**.
- Révision du contrat : **2.3.2**.
- Schéma acquisition : **1.3**.
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.
- Le contrat 2.3.x est gelé jusqu’à 1.0 sauf correctif motivé par un cas réel.

## Compatibilité Paris Library

Paris continue d’utiliser `/api/v2/` pour recherche, bibliothèque/manifest et acquisition. Vault retourne des candidats décrits (`http_plain`, `adobe_adept`, `kobo_kdrm`, ACSM best effort) sans en imposer l’ordre de préférence. Paris choisit le candidat et le `display_profile` selon les capacités locales.

Le scope standard d’un token est :

```text
kobo.catalog.read
kobo.library.read
kobo.acquisition.read
```

`kobo.acquisition.delegate` est sensible et **opt-in**. Il peut transmettre temporairement un bearer Kobo dans une recette déléguée.

## Legacy

L’ancienne API `/api/v1/` jobs/agents est obsolète et désactivée par défaut. Compatibilité temporaire seulement :

```text
LEGACY_API_V1_ENABLED=true
```

Les anciennes tables D1 peuvent rester inertes ; aucune migration destructive n’est nécessaire.

Les routes `/api/v2/vault/{uid}/...` sont le backend d’administration de l’IHM Vault. Elles sont **internes** et ne font pas partie du contrat Provider.

## Acquisition et sécurité

- ACSM : best effort/expérimental ; l’échec du lookup conserve les autres candidats.
- KDRM : Vault expose le mécanisme et permet le replay délégué ; les ContentKeys ne sont pas publiées par Vault.
- Transport Kobo : la recette comprend les headers nécessaires, dont `x-amz-request-payer=requester`; un Bearer ne doit pas suivre une redirection cross-origin vers S3.
- Vault ne stocke ni ne stream les ebooks.
- Aucun classement de préférence des candidats n’est défini par Vault.

## Livre archivé — impact récupération Paris

Un titre archivé peut apparaître dans le manifest, mais son acquisition retourne :

```text
409 archived_book
```

Conséquence : Paris peut identifier le livre manquant, mais une récupération totalement autonome n’est pas possible pour ce cas. L’utilisateur restaure d’abord le titre dans Kobo, puis Paris resynchronise et relance l’acquisition.

Une future automatisation ne devra **jamais** désarchiver implicitement pendant `acquisition`. Elle nécessitera une mutation Vault explicite, une capability et un scope d’écriture dédiés. Cela modifierait l’état distant du compte Kobo.

## Distribution 0.9.3

- Wrangler est verrouillé sur `4.30.0`.
- `package-lock.json` devient partie de la distribution.
- les scripts d’installation utilisent `npm ci`.
- transition depuis ≤0.9.2 : `scripts/ensure-lockfile.sh` restaure le lockfile racine depuis une copie bootstrap si l’ancien updater ne l’a pas copié.
- `interfaces/` est la source canonique du contrat ; le miroir `docs/interfaces/` est supprimé.
- aucune migration D1 nouvelle.

## Suite validée du release plan

- **0.9.4** : timeout, retry borné, `Retry-After`, homogénéisation des erreurs Kobo.
- **0.9.5** : conformance OpenAPI/JSON Schema, tests N-1/N, découpage de `worker.js`.
- **0.9.6** : RC 1.0, panel live Kobo Android/Desktop/ACSM, procédure de rollback distant.
- **1.0.0** : baseline provider stable, retrait du legacy si plus consommé, politique de support et rotation de clé.

Aucune synchronisation de versions entre Paris Library, Vault et Adept n’est requise. La négociation se fait par capacités et contrat public.
