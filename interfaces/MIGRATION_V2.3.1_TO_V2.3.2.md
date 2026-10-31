# Migration Provider API v2.3.1 → v2.3.2

Cette migration est additive et compatible. Les routes restent sous `/api/v2/` et les candidats d’acquisition restent en `schema_version=1.3`.

## Changements consommateur

- `GET /api/v2/status` ajoute `contract_revision=2.3.2` et `acquisition_schema_version=1.3`.
- Un token créé sans liste de scopes reçoit seulement : `kobo.catalog.read`, `kobo.library.read`, `kobo.acquisition.read`.
- `kobo.acquisition.delegate` doit être demandé explicitement.
- Aucun ordre de préférence entre candidats n’est fourni par Vault : le consommateur choisit selon ses capacités locales.
- `display_profile` reste choisi explicitement par le consommateur ; Vault ne lance pas automatiquement Android + Desktop.

## Hors contrat

Les routes `/api/v2/vault/{uid}/...` sont des routes d’administration de l’interface Vault et ne constituent pas l’API Provider. L’API `/api/v1/` jobs/agents est legacy, hors contrat et désactivée par défaut dans Vault 0.9.4.

## Archivage

`409 archived_book` est inchangé. Le contrat 2.3.2 n’introduit aucune mutation de restauration distante : un titre archivé doit être restauré dans Kobo avant une nouvelle acquisition.
