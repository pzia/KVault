# Handoff — Kobo Vault 0.9.7

## Baseline

- Application : **Kobo Vault 0.9.7**.
- Provider API : **2.3**.
- Révision du contrat : **2.3.3**.
- Schéma acquisition : **1.4**.
- Migration D1 : **aucune nouvelle migration** par rapport à 0.9.6.4.
- Architecture : **Paris décide ; Vault expose Kobo ; Adept exécute localement**.

La 0.9.7 part de la baseline 0.9.6.4 validée. L’OpenAPI 2.3.3 et le schéma acquisition 1.4 restent byte-identiques : les changements concernent l’UX multi-profil et la production de recettes déjà autorisées par le contrat.

## 1. Comptes Vault et profils

### Plus de création implicite

L’écran d’ouverture n’a plus le comportement « ouvrir ou créer ». Un UID inconnu ne crée plus de coffre par effet de bord : Vault renvoie une erreur explicite invitant à utiliser le parcours de création.

La création devient volontaire :

- depuis un coffre déjà ouvert : **Créer un nouveau compte Vault** ;
- sur une installation vierge qui ne connaît encore aucun profil : bootstrap de création explicite.

La migration ne supprime ni ne transforme les coffres existants.

### Sélecteur de profils

Vault conserve localement la liste des UIDs connus par l’appareil et propose un sélecteur pour basculer entre coffres. Ce registre local n’est pas une ACL et ne fusionne aucune identité : chaque coffre conserve son propre secret, ses credentials Kobo, sa projection et ses tokens Provider.

Le modèle fonctionnel reste compatible avec plusieurs installations Paris : une installation peut ne connaître qu’un sous-ensemble des identités présentes dans Vault.

## 2. « Accès acquisition » devient « Accès Provider Kobo »

Le libellé IHM est renommé **Accès Provider Kobo**. Les credentials publiés côté Worker servent désormais à deux fonctions :

1. résoudre les acquisitions Kobo sans navigateur ouvert ;
2. rafraîchir automatiquement la projection bibliothèque Provider lorsque la dernière synchro réussie a plus de 24 h (comportement 0.9.6.4 conservé).

Le modèle de sécurité ne change pas : ces credentials restent chiffrés côté serveur et cette fonction n’est pas zero-knowledge vis-à-vis du Worker.

## 3. KDRM / scope `kobo.acquisition.delegate`

### Cause du cas « premier profil OK / nouveau profil KO »

Le serveur ne traite pas différemment un « premier » et un « nouveau » coffre. La différence observée provient du **provisioning du token Provider Paris**.

Le défaut serveur historique d’un token consommateur est :

```text
kobo.catalog.read
kobo.library.read
kobo.acquisition.read
```

Le scope sensible :

```text
kobo.acquisition.delegate
```

n’est pas inféré automatiquement par le serveur. Avant 0.9.7, la case IHM correspondante était décochée par défaut. Un token créé ainsi peut lire les candidats mais ne peut pas demander `mode=delegated`, ce qui explique l’échec Paris lorsqu’un livre exige `handling=kobo_kdrm`.

Un profil qui fonctionnait déjà utilisait donc un token provisionné différemment du token en échec ; l’identité Vault elle-même n’est pas la cause.

### Comportement 0.9.7

Dans le preset **Paris Library** :

- `kobo.acquisition.delegate` est affiché dans un encart visible ;
- la case est **cochée par défaut** ;
- l’IHM précise qu’il est requis pour l’acquisition KDRM via Kobo-Adept ;
- l’utilisateur peut toujours le décocher volontairement.

Le défaut de l’API serveur générique reste au moindre privilège : une requête de création de token qui omet `scopes` n’obtient pas automatiquement le droit delegated.

### Tokens existants

**0.9.7 ne modifie jamais les scopes d’un token existant.** Cela éviterait une élévation de privilège silencieuse.

Pour corriger une identité Paris existante comme `user-example` :

1. ouvrir le coffre Vault correspondant ;
2. aller dans **Données → API fournisseur Kobo** ;
3. vérifier que `kobo.acquisition.delegate` est coché ;
4. créer un nouveau token Paris ;
5. remplacer le bearer du credential Paris concerné (`kobo-example` dans le cas diagnostiqué) ;
6. tester KDRM ;
7. révoquer l’ancien token lorsque le nouveau fonctionnement est confirmé.

Les tokens sans délégation sont signalés dans l’IHM comme incapables d’exécuter KDRM delegated.

## 4. Normalisation FLEPUB / `library_sync`

Le cas réel observé sur Livre test KDRM A / Livre test KDRM B reste le cas de référence : Kobo peut répartir la recette entre :

```text
library_sync            → DownloadUrls (payload KDRM / FLEPUB)
content_access_book     → ContentKeys
```

0.9.7 améliore cette recette sans modifier son contrat :

- `Format=FLEPUB` → `media_format=epub` ;
- `source_format=FLEPUB` est conservé ;
- `handling=kobo_kdrm` et `drm.family=kobo_kdrm` sont conservés ;
- pour une URL provenant de `library_sync`, `kobo.display_profile=null` ;
- `kobo.platform` porte la plateforme réelle de `DownloadUrls` (`Android`, `Generic`, etc.) ;
- les variantes `*SAMPLE` sont toujours exclues du livre complet ;
- les recettes équivalentes provenant d’entitlements dupliqués sont dédupliquées sémantiquement, même lorsque leurs URLs contiennent des tokens différents.

Cette séparation évite de présenter `Desktop` ou `Android` comme un `DisplayProfile` ayant produit une URL qui provient en réalité de `library_sync`.

## 5. Contrat delegated Vault → Paris

L’invariant reste :

```text
http_plain  → HTTP direct autorisé
kobo_kdrm   → acquisition delegated obligatoire
adobe_adept → pipeline Adept / ACSM
```

et jamais :

```text
kobo_kdrm → descriptor-http
```

Avec un token possédant `kobo.acquisition.delegate`, `POST /api/v2/library/{product_id}/acquisition` en `mode=delegated` peut fournir la recette reproductible dans :

```text
acquisition.delegation.content_access_request
```

avec l’Authorization Kobo temporaire et le contexte nécessaire au premier hop Kobo. Le refresh token et les valeurs `ContentKeys` ne sont jamais exposés par Vault.

Le test d’intégration 0.9.7 reproduit le problème Paris :

```text
token sans delegate → HTTP 403
token Paris avec delegate → HTTP 200
                           candidat handling=kobo_kdrm
                           media_format=epub
                           source_format=FLEPUB
                           kobo.source=library_sync
                           kobo.display_profile=null
                           kobo.platform=Android
                           recette content_access_request présente
```

Il vérifie également qu’aucun refresh token ni valeur ContentKey ne fuit dans la réponse.

## 6. Limite de validation Kobo-Adept

Cette release valide le côté **Vault** du handoff, mais le code/runtime Kobo-Adept correspondant n’est pas présent dans la distribution Vault examinée. Le test Vault ne permet donc pas d’affirmer à lui seul que Kobo-Adept déchiffre le KDRM jusqu’à produire un artefact lisible.

Le critère end-to-end reste à vérifier avec Paris + Kobo-Adept :

```text
candidate handling=kobo_kdrm
→ mode=delegated-kobo
→ executor=kobo-adept
→ status=complete
→ artefact final lisible
```

sans fallback `descriptor-http`.

## 7. Contrats et base D1

Aucun nouveau champ public n’est nécessaire : le schéma acquisition 1.4 autorise déjà `kobo.source=library_sync`, `kobo.display_profile=null`, `kobo.platform` et les formats normalisés utilisés ici.

Donc :

```text
Provider API          2.3
contract_revision     2.3.3
acquisition schema    1.4
```

restent inchangés et byte-identiques à 0.9.6.4.

Aucune migration D1 0005 n’est créée. La migration la plus récente reste `0004_library_sync_state.sql` de 0.9.6.4.

## 8. Tests

`npm run check` couvre toute la suite historique et les nouveaux tests 0.9.7, notamment :

- absence de création implicite ;
- présence du sélecteur/créateur de profils ;
- preset Paris avec delegate coché ;
- défaut serveur sans delegate inchangé ;
- FLEPUB → EPUB ;
- séparation `display_profile` / `platform` ;
- exclusion des samples ;
- déduplication sémantique `library_sync` ;
- 403 sans scope delegated ;
- réponse delegated KDRM avec scope.

## 9. Mise à jour

Depuis 0.9.6.4 :

```bash
./scripts/update-from-zip.sh kobo-library-vault-v0.9.7.zip --deploy
```

Aucune migration D1 nouvelle n’est attendue.

Après déploiement, **réémettre les tokens Paris qui doivent exécuter KDRM et qui ne possèdent pas `kobo.acquisition.delegate`**. La mise à jour du code seule ne modifie pas leurs scopes.
