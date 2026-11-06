# Kobo Vault — Profil de distribution et de mise à jour

Version du profil : 1.0  
Application : Kobo Library Vault 0.9.8  
Référence : `DISTRIBUTION_BLUEPRINT_REFERENCE.md`

## 1. Portée

Le blueprint de distribution commun décrit en priorité des **applications Python locales** : venv privé, `project.scripts`, launchers dans `~/.local/bin`, releases immuables et bascule `current`.

Kobo Vault est différent : c'est une application **Cloudflare Workers + Static Assets + D1**, développée en JavaScript/Node et déployée par Wrangler. Les règles Python (`venv`, `project.scripts`, sélection d'interpréteur) ne s'appliquent donc pas directement.

Kobo Vault adopte néanmoins les invariants transposables :

- valider avant d'activer ;
- ne jamais modifier les données ou secrets lors d'une mise à jour de code ;
- utiliser un staging ;
- refuser les archives dangereuses ou d'un autre projet ;
- tester la release candidate avant la bascule ;
- préserver une sauvegarde permettant un rollback ;
- garder des commandes de maintenance stables ;
- faire en sorte qu'un échec avant bascule laisse la version locale précédente utilisable.

## 2. Commandes stables

Le projet conserve comme points d'entrée opérateur :

```text
./scripts/setup-cloudflare.sh
./scripts/deploy.sh
./scripts/update-from-zip.sh
bash scripts/update_from_git
./scripts/configure-acquisition-secret.sh
```

Ces scripts appartiennent au projet Cloudflare ; ils ne sont pas installés comme commandes Python système.

## 3. Données et configuration hors distribution

Les mises à jour de code ne remplacent pas :

```text
wrangler.jsonc
.dev.vars
.wrangler/
.git/
```

`node_modules/` n'est remplacé que si `--install` a produit et validé un nouvel environnement de dépendances dans le staging.

Le stockage D1 distant n'appartient pas à l'archive de release. Ses évolutions passent uniquement par les migrations versionnées.

## 4. Mise à jour directe depuis GitHub

La commande stable :

```bash
bash scripts/update_from_git
```

résout par défaut `pzia/KVault:main` via l'API GitHub en un SHA de commit de 40 caractères, puis télécharge l'archive de **ce SHA exact**. La validation et la bascule ne sont pas réimplémentées : le script transmet l'archive à `update-from-zip.sh --install --deploy`.

Cela garantit que la révision testée est celle déployée et conserve les mêmes propriétés de staging, sauvegarde et rollback. Options utiles :

```bash
bash scripts/update_from_git --dry-run
bash scripts/update_from_git --no-deploy
bash scripts/update_from_git --ref <tag-branche-ou-sha>
```

`GITHUB_TOKEN` est facultatif. Il sert uniquement à l'appel GitHub et n'est jamais copié dans la release candidate.

## 5. Pipeline de mise à jour ZIP

La commande :

```bash
./scripts/update-from-zip.sh nouvelle-version.zip --install --deploy
```

suit désormais :

```text
ZIP
 ↓
validation des chemins et identité projet
 ↓
extraction en staging
 ↓
contrôles syntaxiques
 ↓
npm install dans la release candidate
 ↓
tests complets
 ↓
sauvegarde de la distribution locale active
 ↓
bascule du code local
 ↓
contrôle final
 ↓
déploiement Cloudflare depuis la candidate validée
```

La release locale n'est donc plus remplacée avant les tests de la candidate.

## 6. Dry-run

```bash
./scripts/update-from-zip.sh nouvelle-version.zip --dry-run
```

Le dry-run vérifie notamment :

- lisibilité du ZIP ;
- absence de chemin absolu / traversal `..` ;
- absence de symlink dans la distribution ;
- présence d'une seule racine `.project-id` ;
- identité du projet ;
- `package.json` et version ;
- présence des répertoires essentiels ;
- syntaxe JS et shell de base.

Il ne modifie ni le projet, ni npm, ni Cloudflare.

## 7. Sauvegarde et rollback

Avant la bascule locale, l'updater crée une sauvegarde **de la distribution seulement** :

```text
../.kobo-library-vault-backups/
    kobo-library-vault-dist-<version>-<timestamp>.tar.gz
```

Elle ne contient ni `.dev.vars`, ni `wrangler.jsonc`, ni secrets Cloudflare.

Par défaut les trois dernières sauvegardes transactionnelles sont conservées. La rétention peut être modifiée avec :

```bash
KOBO_VAULT_KEEP_BACKUPS=5 ./scripts/update-from-zip.sh ...
```

Rollback :

```bash
./scripts/update-from-zip.sh --rollback --install --deploy
```

Le script sélectionne la dernière sauvegarde transactionnelle, la valide comme une release candidate, puis applique le même pipeline. Pour la première migration depuis une version ≤ 0.8.0, il sait également relire la sauvegarde historique créée par l’ancien updater.

## 8. Failure model

Échec avant bascule locale :

```text
version locale active inchangée
```

Échec pendant la bascule locale :

```text
restauration automatique de la sauvegarde de distribution
```

Avec `--deploy`, le Worker est déployé depuis le staging **après tests et après la bascule locale contrôlée**. Si le déploiement échoue, la distribution locale est restaurée automatiquement. Cloudflare reste responsable de son propre mécanisme de publication/versionnement du Worker.

Une migration D1 doit toujours être conçue comme compatible avec la version immédiatement précédente : une migration de base distante n'est pas annulée par le rollback du code local.

## 9. Différence avec le pattern Python commun

Kobo Vault ne met pas en place :

```text
releases/<version>/.venv
current -> release
~/.local/bin/<commande>
```

Ces mécanismes sont destinés aux applications Python locales telles que Paris Library ou Kobo-Adept.

L'équivalent fonctionnel de Kobo Vault est :

```text
release candidate locale testée
        +
publication versionnée Cloudflare
        +
sauvegarde transactionnelle du source local
```

## 10. Contrat d'interface

Le profil de distribution reste indépendant du contrat métier. La V0.9.2 conserve ce mécanisme de distribution et fait évoluer séparément l'API fournisseur publique vers :

```text
Kobo Vault Provider API v2.3 (révision contractuelle 2.3.4)
```

La révision courante v2.3.4 est documentée dans `interfaces/MIGRATION_V2.3.3_TO_V2.3.4.md`. Le correctif transport v2.3.1 reste documenté séparément ; ces évolutions de contrat ne sont pas une conséquence du mécanisme de distribution.
