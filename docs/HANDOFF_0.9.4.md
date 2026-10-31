# Handoff — Kobo Vault 0.9.4

## Baseline à transmettre à l’écosystème

- Application : **Kobo Vault 0.9.4**.
- Provider API : **2.3**.
- Révision du contrat : **2.3.2** (inchangée depuis 0.9.3).
- Schéma acquisition : **1.3**.
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.
- Le contrat 2.3.x reste gelé jusqu’à 1.0 sauf correctif motivé par un cas réel.

## Objet de 0.9.4

0.9.4 est une release de **consolidation/robustesse**. Elle ne change ni les routes Provider, ni les scopes, ni les schémas publics. Le fichier canonique du contrat reste `interfaces/kobo-vault-openapi-v2.3.2.yaml` et n’est pas révisé artificiellement pour cette release applicative.

Tous les accès HTTP Kobo du Worker passent désormais par une politique commune :

- timeout par tentative : **10 secondes** ;
- retries supplémentaires : **2 maximum** (3 tentatives au total) ;
- statuts retryables : `408`, `429`, `500`, `502`, `503`, `504` ;
- erreurs réseau et timeouts retryables dans la même borne ;
- backoff exponentiel à partir de 250 ms ;
- `Retry-After` est interprété en secondes ou date HTTP et prioritaire sur le backoff ;
- l’attente locale issue de `Retry-After` est plafonnée à **2 secondes** afin d’éviter qu’un Worker reste immobilisé sur une consigne amont longue.

Après épuisement des retries, une réponse HTTP Kobo reste disponible à la couche appelante. Les erreurs réseau sans réponse sont normalisées en `kobo_upstream_unreachable` et les timeouts en `kobo_upstream_timeout` (`502`).

## Erreurs et rate limiting

Un `429` Kobo n’est plus systématiquement converti en `502`. Lorsqu’une route peut exposer l’erreur amont, Vault retourne `429` et propage le header `Retry-After` s’il existe. Cela reste conforme au contrat Provider 2.3.2, qui déclarait déjà `429` sur les routes amont concernées.

Les erreurs non transitoires ne sont pas retryées. Les retries ne constituent pas une boucle infinie et ne changent pas l’ordre fonctionnel des opérations Kobo.

## Compatibilité Paris Library

Paris continue d’utiliser `/api/v2/` pour recherche, bibliothèque/manifest et acquisition. Vault retourne des candidats décrits (`http_plain`, `adobe_adept`, `kobo_kdrm`, ACSM best effort) sans imposer leur ordre de préférence. Paris choisit le candidat et le `display_profile` selon les capacités locales.

Le scope standard d’un token reste :

```text
kobo.catalog.read
kobo.library.read
kobo.acquisition.read
```

`kobo.acquisition.delegate` reste sensible et **opt-in**.

## Invariants acquisition et sécurité

- ACSM : best effort/expérimental ; son échec ne supprime pas les autres candidats.
- KDRM : Vault expose le mécanisme et permet le replay délégué ; les ContentKeys ne sont jamais publiées.
- Transport Kobo : les headers d’un candidat font partie de la recette ; un Bearer Kobo ne suit jamais une redirection cross-origin vers S3.
- Vault ne stocke ni ne stream les ebooks.
- Vault ne classe pas les candidats par préférence.
- `409 archived_book` reste inchangé ; aucune acquisition ne désarchive implicitement un titre.

## Legacy et administration

L’API `/api/v1/` jobs/agents reste obsolète et désactivée par défaut (`LEGACY_API_V1_ENABLED=true` uniquement pour compatibilité temporaire). Les routes `/api/v2/vault/{uid}/...` restent le backend d’administration de l’IHM et ne font pas partie du contrat Provider.

## Distribution 0.9.4

- Wrangler reste verrouillé sur `4.30.0`.
- `package-lock.json` reste partie de la distribution ; installation par `npm ci`.
- `scripts/package-lock.bootstrap.json` reste synchronisé avec le lockfile distribué.
- `interfaces/` reste la source canonique du contrat.
- aucune migration D1 nouvelle.
- la suite de tests ajoute `tests/api-v094.test.mjs` pour la politique réseau Kobo.

## Suite du release plan

- **0.9.5** : conformance OpenAPI/JSON Schema, tests N-1/N, découpage de `worker.js` sans changement de comportement public.
- **0.9.6** : RC 1.0, panel live Kobo Android/Desktop/ACSM, procédure de rollback distant.
- **1.0.0** : baseline Provider stable, retrait du legacy si plus consommé, politique de support et rotation de clé.

Aucune synchronisation de versions entre Paris Library, Vault et Adept n’est requise. La négociation continue de se faire par capacités et contrat public.
