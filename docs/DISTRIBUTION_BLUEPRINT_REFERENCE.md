# Blueprint — Application Python avec venv privé, commandes système stables et mises à jour atomiques

## 1. Objectif

Ce blueprint décrit une architecture de distribution pour une application Python qui :

- utilise un environnement virtuel Python isolé ;
- expose une ou plusieurs commandes directement utilisables depuis le shell ;
- ne demande jamais à l’utilisateur d’activer manuellement le `venv` ;
- permet plusieurs versions installées simultanément ;
- bascule atomiquement d’une version à l’autre ;
- permet un rollback rapide ;
- sépare les données, la configuration et le runtime applicatif ;
- permet de déclarer les exécutables depuis le packaging Python ;
- évite d’écrire directement dans le Python système.

Le principe central est :

```text
le venv appartient à l'application
≠
le venv appartient à la session shell de l'utilisateur
```

L’activation d’un environnement virtuel n’est pas nécessaire pour exécuter un programme qui s’y trouve.

Un exécutable peut être appelé directement :

```text
/path/to/release/.venv/bin/mycommand
```

L’objectif est simplement de fournir devant cet exécutable un point d’entrée stable présent dans le `PATH`.

---

# 2. Architecture générale

Structure recommandée :

```text
~/.local/share/myapp/
├── releases/
│   ├── 1.2.0-20260927T080000Z/
│   │   ├── .venv/
│   │   ├── pyproject.toml
│   │   ├── src/
│   │   └── ...
│   │
│   └── 1.3.0-20261004T093000Z/
│       ├── .venv/
│       └── ...
│
├── current -> releases/1.3.0-20261004T093000Z/
│
├── config/
├── state/
├── cache/
└── logs/
```

Et :

```text
~/.local/bin/
├── myapp
├── myapp-update
└── autre-commande
```

`~/.local/bin` doit simplement être présent une fois dans le `PATH` de l’utilisateur.

Par exemple :

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Il n’est ensuite plus nécessaire de modifier le shell à chaque utilisation.

---

# 3. Principe des releases immuables

Chaque installation produit un nouveau répertoire :

```text
releases/<version>-<timestamp>/
```

Une release déjà installée n’est jamais modifiée pour devenir la suivante.

Par exemple :

```text
releases/
├── 1.1.0-20260901T121500Z/
├── 1.2.0-20260912T083200Z/
└── 1.3.0-20260927T090500Z/
```

Chaque release possède son propre environnement :

```text
release/
└── .venv/
```

Cela signifie que :

- les dépendances de 1.2 restent celles de 1.2 ;
- une mise à jour de dépendance dans 1.3 ne casse pas 1.2 ;
- un rollback ne nécessite pas de réinstaller Python ou des packages ;
- une installation incomplète n'endommage pas la version active.

---

# 4. Le pointeur `current`

Un lien stable désigne la release active :

```text
current -> releases/1.3.0-20260927T090500Z/
```

Les launchers ne connaissent donc pas la version :

```text
~/.local/bin/myapp
        ↓
~/.local/share/myapp/current/.venv/bin/myapp
```

Ce découplage est essentiel.

Le launcher reste stable pendant que `current` change.

La même architecture permet un runtime du type :

```text
runtime/
├── releases/
└── current
```

avec bascule atomique et rollback.

---

# 5. Déclaration des commandes Python

Les commandes doivent être déclarées dans `pyproject.toml`.

Exemple :

```toml
[project]
name = "my-application"
version = "1.3.0"
requires-python = ">=3.11"

[project.scripts]
myapp = "myapp.cli:main"
myapp-update = "myapp.updater:main"
myapp-admin = "myapp.admin:main"
```

La syntaxe générale est :

```text
nom-de-commande = "package.module:fonction"
```

Lors de :

```sh
python -m pip install .
```

`pip` crée automatiquement les exécutables correspondants dans le `venv` :

```text
.venv/bin/myapp
.venv/bin/myapp-update
.venv/bin/myapp-admin
```

Sous Windows :

```text
.venv\Scripts\myapp.exe
.venv\Scripts\myapp-update.exe
```

C’est le mécanisme à privilégier.

Il évite :

- les scripts shell métier dupliqués ;
- les imports Python bricolés ;
- les appels `python fichier.py`;
- les dépendances à l’emplacement des sources.

---

# 6. Pourquoi `activate` est inutile

La commande :

```sh
source .venv/bin/activate
```

ne rend pas magiquement le `venv` exécutable.

Elle modifie essentiellement l’environnement courant, notamment :

```text
PATH
VIRTUAL_ENV
prompt du shell
```

Pour une application installée, cela n’est pas nécessaire.

On peut directement faire :

```sh
/path/app/.venv/bin/myapp
```

L’exécutable généré par `pip` connaît déjà l’interpréteur Python du `venv`.

Le rôle du launcher global est seulement de rendre ce chemin confortable et stable.

---

# 7. Launcher stable Unix

Créer :

```text
~/.local/bin/myapp
```

contenant :

```sh
#!/bin/sh
exec "$HOME/.local/share/myapp/current/.venv/bin/myapp" "$@"
```

Puis :

```sh
chmod 755 ~/.local/bin/myapp
```

L’utilisateur peut maintenant taper :

```sh
myapp
```

depuis n’importe quel répertoire.

Il n’a besoin ni de connaître le `venv`, ni de l’activer.

---

# 8. Pourquoi utiliser `exec`

Préférer :

```sh
exec "/path/to/program" "$@"
```

à :

```sh
"/path/to/program" "$@"
```

`exec` remplace le processus wrapper par le processus réel.

Cela améliore notamment :

- la propagation des signaux ;
- `Ctrl-C` ;
- les codes de retour ;
- le comportement avec systemd ;
- les scripts appelants ;
- la supervision de processus.

Et :

```sh
"$@"
```

préserve correctement tous les arguments.

---

# 9. Plusieurs binaires

Le principe fonctionne pour autant de commandes que nécessaire.

`pyproject.toml` :

```toml
[project.scripts]
foo = "foo.cli:main"
foo-update = "foo.update:main"
foo-import = "foo.importer:main"
foo-server = "foo.server:main"
```

Le déploiement crée :

```text
~/.local/bin/foo
~/.local/bin/foo-update
~/.local/bin/foo-import
~/.local/bin/foo-server
```

Tous peuvent pointer vers :

```text
current/.venv/bin/<commande>
```

Il n’est donc pas nécessaire de gérer manuellement les dépendances Python de chacun.

---

# 10. Ne pas créer les launchers comme symlinks vers le venv actif

Une possibilité tentante serait :

```text
~/.local/bin/foo
    -> ~/.local/share/foo/current/.venv/bin/foo
```

Cela peut fonctionner.

Cependant un petit wrapper régulier est souvent préférable :

```sh
#!/bin/sh
exec "/.../current/.venv/bin/foo" "$@"
```

Il permet :

- d’ajouter ultérieurement des contrôles ;
- de définir quelques variables d’environnement ;
- d’avoir un comportement Windows équivalent ;
- de remplacer atomiquement le launcher ;
- d’éviter certains problèmes lors de la réécriture d’un symlink.

---

# 11. Écriture atomique des launchers

Ne jamais réécrire naïvement un launcher existant.

Utiliser :

```text
launcher.tmp
→ chmod
→ os.replace(launcher.tmp, launcher)
```

Pseudo-code Python :

```python
def write_launcher(path, content):
    tmp = path.with_name(f".{path.name}.tmp")

    with tmp.open("w") as f:
        f.write(content)

    tmp.chmod(0o755)

    os.replace(tmp, path)
```

`os.replace()` permet une substitution atomique du directory entry sur les systèmes appropriés.

C’est particulièrement utile si le chemin existant est accidentellement devenu un symlink : écrire directement dedans risquerait de modifier sa cible.

---

# 12. Pipeline d’update recommandé

L’update suit cet ordre :

```text
archive
   ↓
validation
   ↓
staging
   ↓
lecture metadata
   ↓
sélection Python
   ↓
création release
   ↓
création venv
   ↓
installation package
   ↓
tests / smoke tests
   ↓
activation current
   ↓
mise à jour launchers
   ↓
garbage collection anciennes releases
```

La règle fondamentale est :

```text
INSTALLER ET TESTER AVANT DE BASCULER current
```

Jamais :

```text
basculer current
→ essayer d'installer
```

---

# 13. Staging

Une archive téléchargée ou fournie ne doit pas être directement installée dans le répertoire final.

Créer d’abord :

```text
/tmp/myapp-update-XXXXXX/
```

Puis :

1. extraire ;
2. vérifier l’arborescence ;
3. vérifier les métadonnées ;
4. déterminer la version ;
5. vérifier Python ;
6. seulement ensuite créer la release finale.

En cas d’échec :

```text
staging supprimé
current inchangé
ancienne version toujours utilisable
```

---

# 14. Validation des archives

Un updater doit au minimum refuser :

```text
/absolute/path
../../escape
symlinks non attendus
plusieurs racines de projet ambiguës
metadata projet inattendue
version absente
```

Une archive ne doit jamais pouvoir écrire hors de son staging.

Exemple de règle :

```python
if path.is_absolute() or ".." in path.parts:
    reject()
```

Le nom du projet doit également être vérifié avant installation.

---

# 15. Choix de l’interpréteur Python

L’updater doit lire :

```toml
requires-python = ">=3.11"
```

dans `pyproject.toml`.

Puis trouver un Python compatible.

Ordre possible :

```text
--python explicite
↓
variable APP_PYTHON
↓
sys.executable
↓
python3.14
↓
python3.13
↓
python3.12
↓
python3.11
↓
python3
```

Avant utilisation :

```sh
python -c 'import sys; print(sys.version_info)'
```

Il est préférable de vérifier réellement la version plutôt que de déduire celle-ci du nom du binaire.

---

# 16. Création du venv de release

Une fois l’interpréteur sélectionné :

```sh
python3.11 -m venv \
  ~/.local/share/myapp/releases/1.3.0-.../.venv
```

Puis :

```sh
/path/release/.venv/bin/python \
    -m pip install /path/release
```

Important :

```text
on utilise explicitement .venv/bin/python
```

et non :

```text
source activate
pip install ...
```

Le script de déploiement lui-même n’a donc jamais besoin d’activer un environnement.

---

# 17. Tests avant activation

Le nouveau runtime peut être testé directement :

```sh
release/.venv/bin/myapp --version
release/.venv/bin/myapp --help
```

Éventuellement :

```sh
release/.venv/bin/python -m pytest tests/
```

Puis seulement si tout fonctionne :

```text
nouvelle release éligible à l'activation
```

---

# 18. Activation atomique

Sur Unix :

```text
.current-<pid> -> nouvelle-release
```

puis :

```python
os.replace(temp_link, current)
```

Ce qui transforme atomiquement :

```text
current -> ancienne-release
```

en :

```text
current -> nouvelle-release
```

La fenêtre pendant laquelle `current` serait inexistant doit être évitée.

---

# 19. Conséquence importante pour les commandes déjà lancées

Une commande déjà en cours peut continuer avec l’ancienne release.

Une nouvelle invocation :

```sh
myapp
```

résoudra :

```text
current/.venv/bin/myapp
```

et utilisera la nouvelle release.

C’est généralement le comportement souhaité.

Il évite d’essayer de modifier les fichiers d’un programme Python pendant qu’il tourne.

---

# 20. Rollback

Avec cette architecture, rollback signifie essentiellement :

```text
current → release précédente
```

Pas :

```text
désinstaller packages
réinstaller packages
reconstruire venv
```

On peut par exemple fournir :

```text
myapp-update --rollback
```

qui :

1. liste les releases ;
2. identifie la précédente ;
3. fait les smoke tests nécessaires ;
4. repointe `current` atomiquement ;
5. laisse les données et la configuration intactes.

---

# 21. Conservation des releases

Ne pas accumuler indéfiniment les environnements virtuels.

Politique typique :

```text
keep = 3
```

Conserver :

```text
release active
release précédente
une release de secours
```

Mais ne jamais supprimer :

```text
la cible actuelle de current
```

même si un problème de tri chronologique survient.

---

# 22. Séparer runtime, données et configuration

Ne jamais mettre les données utilisateur dans :

```text
releases/<version>/
```

Une release doit pouvoir être supprimée sans supprimer :

- configuration ;
- base de données ;
- cache durable nécessaire ;
- documents ;
- logs importants ;
- secrets ;
- état utilisateur.

Exemple :

```text
~/.local/share/myapp/
├── releases/
├── current
├── state/
└── data/

~/.config/myapp/
├── functional.toml
└── local.toml

~/.cache/myapp/
└── ...

~/.local/bin/
└── myapp
```

---

# 23. Configuration en couches

Un modèle recommandé est :

```text
defaults
<
functional.toml
<
local.toml
<
CLI
```

Ce modèle permet de distinguer la **politique fonctionnelle partageable** de la **configuration propre à une installation**. C’est également l’organisation retenue dans KMD.

---

# 24. `functional.toml`

`functional.toml` décrit le comportement logique de l’application.

Exemples :

```toml
[processing]
strategy = "safe"

[classification]
mode = "automatic"

[layout]
documents = "Documents"

[features]
experimental_search = false
```

Il peut être :

- versionné ;
- copié d’une machine à l’autre ;
- partagé entre utilisateurs ;
- utilisé dans les tests ;
- fourni comme exemple avec le logiciel.

Il ne doit généralement pas contenir :

```text
/home/alice/...
/mnt/disk1/...
secret token
socket spécifique machine
chemin d'un binaire local
```

---

# 25. `local.toml`

`local.toml` décrit l’installation.

Exemple :

```toml
[paths]
database = "/home/alice/.local/share/myapp/state.sqlite3"

[undo]
path = "/mnt/fast/myapp-undo"

[binaries]
opener = ["xdg-open"]
```

Il peut contenir :

- chemins locaux ;
- dispositifs externes ;
- programmes auxiliaires ;
- ports ;
- sockets ;
- paramètres de machine ;
- emplacement du catalogue ;
- cache ;
- runtime externe.

Il ne doit généralement pas être synchronisé comme une configuration fonctionnelle portable.

---

# 26. Déclaration des binaires externes

Il faut distinguer deux catégories.

## 26.1 Binaires fournis par l’application

Ils sont déclarés dans :

```toml
[project.scripts]
```

Exemple :

```toml
[project.scripts]
foo = "foo.cli:main"
foo-update = "foo.update:main"
```

C’est du **packaging**.

Ils ne doivent pas être configurés dans `local.toml`.

## 26.2 Binaires externes utilisés par l’application

Exemples :

```text
xdg-open
git
ffmpeg
rsync
recoll
convert
```

Ils relèvent de la **configuration locale**.

Exemple :

```toml
[binaries]
git = ["git"]
ffmpeg = ["/usr/local/bin/ffmpeg"]

[viewer]
opener = ["xdg-open"]
```

Cette distinction est importante :

```text
commande produite par l'application
    → pyproject.toml

commande dont dépend l'installation locale
    → local.toml
```

---

# 27. Éviter les chemins absolus vers les binaires quand ce n'est pas nécessaire

Préférer :

```toml
git = ["git"]
```

à :

```toml
git = ["/usr/bin/git"]
```

si la résolution par `PATH` est acceptable.

Cela facilite :

- les distributions différentes ;
- Homebrew ;
- Nix ;
- environnements utilisateurs ;
- containers ;
- tests.

Un chemin absolu reste utile lorsque l’administrateur veut explicitement sélectionner une implémentation particulière.

---

# 28. Une commande peut être décrite comme une liste

Préférer :

```toml
opener = ["xdg-open"]
```

ou :

```toml
viewer = ["custom-viewer", "--safe-mode"]
```

à une chaîne shell :

```toml
viewer = "custom-viewer --safe-mode"
```

Cela permet ensuite :

```python
subprocess.run(config.viewer + [filename])
```

et évite :

```python
subprocess.run(command, shell=True)
```

Avantages :

- quoting correct ;
- espaces dans les chemins ;
- moins de risque d’injection shell ;
- meilleure portabilité.

---

# 29. Résolution de configuration

Une application doit être capable d'expliquer d’où provient une valeur.

Par exemple :

```text
processing.strategy
    default

layout.documents
    functional:/home/alice/.config/foo/functional.toml

paths.database
    local:/home/alice/.config/foo/local.toml

verbose
    CLI
```

La provenance de configuration est très utile pour diagnostiquer :

```text
« pourquoi cette valeur est-elle utilisée ? »
```

Une commande comme :

```sh
foo config show
```

ou :

```sh
foo config explain paths.database
```

est fortement recommandée.

---

# 30. Configuration et release doivent rester indépendantes

Une nouvelle release ne doit pas écraser :

```text
~/.config/myapp/
```

Elle ne doit embarquer que des exemples :

```text
functional.example.toml
local.example.toml
```

L’update agit sur :

```text
runtime
```

pas sur :

```text
état utilisateur
configuration utilisateur
```

Une migration de configuration doit être une opération explicite et sauvegardée.

Le modèle KMD prévoit notamment backup, dry-run et validation lorsqu’une ancienne configuration est migrée.

---

# 31. Bootstrap updater indépendant

Une subtilité utile est de disposer de deux niveaux :

```text
bootstrap updater
application updater
```

Le bootstrap est un petit script ayant très peu de dépendances.

Son rôle :

```text
archive
→ validation
→ choix Python
→ création venv
→ installation
```

Il ne doit pas dépendre du fait que la version actuelle de l’application fonctionne encore.

Cela permet par exemple de réparer une installation cassée.

---

# 32. La commande d’update peut ensuite être native elle aussi

Une fois l’application installée :

```text
~/.local/bin/myapp-update
```

pointe vers :

```text
current/.venv/bin/myapp-update
```

Donc :

```sh
myapp-update release.zip
```

fonctionne exactement comme :

```sh
myapp
```

sans activation du venv.

Le bootstrap autonome reste simplement le dernier recours.

---

# 33. Dry-run de l’updater

Un updater sérieux doit proposer :

```sh
myapp-update release.zip --dry-run
```

Le dry-run peut vérifier :

- archive lisible ;
- absence de path traversal ;
- identité du projet ;
- version ;
- `requires-python` ;
- présence d’un interpréteur compatible ;
- cohérence de l’arborescence.

Mais il ne doit pas :

- créer la release ;
- créer le venv ;
- modifier `current` ;
- modifier les launchers.

---

# 34. Failure model

Le système doit respecter :

```text
échec avant activation
→ ancienne release intacte
```

Cas :

```text
ZIP invalide
Python absent
venv impossible
pip échoue
dependency impossible
tests échouent
smoke test échoue
```

Dans tous ces cas :

```text
current reste inchangé
```

et la release partielle est supprimée.

---

# 35. Upgrade interrompu

Avec l’ordre :

```text
installer
→ tester
→ activer
```

une interruption pendant l’installation donne :

```text
ancienne version active
+
release incomplète éventuellement nettoyable
```

Une interruption juste après la bascule donne :

```text
nouvelle release complète active
```

C’est nettement plus sûr qu’un environnement virtuel unique mis à jour « en place ».

---

# 36. Anti-pattern : venv unique mutable

Éviter :

```text
~/.local/share/myapp/.venv/
```

mis à jour indéfiniment avec :

```sh
pip install --upgrade ...
```

Cela crée un état difficile à reproduire :

```text
ancienne version du code
+
nouvelle dépendance
+
reste d'un ancien package
+
upgrade interrompu
```

Un venv par release transforme au contraire la release en unité cohérente.

---

# 37. Anti-pattern : demander à l’utilisateur d’activer le venv

Éviter la documentation :

```sh
cd application
source .venv/bin/activate
foo ...
deactivate
```

pour une application CLI installée.

Ce workflow convient au **développement**, pas à l’utilisation normale d’un programme.

Pour l'utilisateur :

```sh
foo ...
```

doit suffire.

---

# 38. Anti-pattern : installer globalement avec sudo pip

Éviter :

```sh
sudo pip install ...
```

et de manière générale les écritures arbitraires dans :

```text
/usr/lib/python...
```

L’architecture proposée nécessite uniquement :

```text
~/.local/bin
~/.local/share
~/.config
```

pour une installation utilisateur.

---

# 39. Arborescence Linux/XDG recommandée

Exemple complet :

```text
~/.local/bin/
    foo
    foo-update

~/.local/share/foo/
    releases/
    current
    state/

~/.config/foo/
    functional.toml
    local.toml

~/.cache/foo/
    ...

~/.local/state/foo/
    logs/
```

Les détails peuvent varier selon les contraintes du projet, mais la séparation logique doit rester.

---

# 40. Windows

Le même modèle peut être conservé.

Au lieu de :

```text
.venv/bin/
```

on utilise :

```text
.venv\Scripts\
```

Et les launchers globaux peuvent être :

```text
foo.cmd
foo-update.cmd
```

Exemple :

```bat
@echo off
"C:\...\release\.venv\Scripts\foo.exe" %*
```

Le remplacement de `current` par symlink étant moins universel sous Windows, un fichier :

```text
current.txt
```

ou un petit launcher capable de résoudre la release active peut être utilisé.

---

# 41. macOS

Même architecture que Unix :

```text
~/Library/Application Support/
```

peut remplacer certains chemins XDG si l’on souhaite respecter les conventions macOS.

Le mécanisme reste :

```text
releases
+
current
+
venv/release
+
launcher stable
```

---

# 42. Tests minimum de ce mécanisme

Un projet qui adopte ce modèle devrait tester au moins :

```text
1. installation initiale
2. commande accessible sans activate
3. arguments transmis intégralement
4. code de retour transmis
5. Ctrl-C transmis
6. deuxième release installée
7. ancienne release active pendant l'installation
8. bascule current après succès seulement
9. échec pip → ancienne version active
10. échec tests → ancienne version active
11. rollback
12. suppression ancienne release
13. active release jamais supprimée
14. launcher remplacé atomiquement
15. ZIP path traversal refusé
16. mauvais projet refusé
17. mauvais Python refusé
18. --python explicite
19. config préservée pendant update
20. données préservées pendant update
```

---

# 43. Test fonctionnel de référence

Après installation :

```sh
which foo
```

doit produire quelque chose comme :

```text
/home/alice/.local/bin/foo
```

Puis :

```sh
foo --version
```

doit fonctionner.

Et :

```sh
echo "$VIRTUAL_ENV"
```

peut parfaitement être vide.

C’est précisément le résultat recherché.

Le programme est exécuté **dans son propre venv**, sans que le shell utilisateur soit « dans le venv ».

---

# 44. Résumé architectural

Le pattern peut être résumé ainsi :

```text
PACKAGE
    pyproject.toml
    [project.scripts]
          │
          ▼
RELEASE IMMUTABLE
    releases/X/
        .venv/
          bin/foo
          bin/foo-update
          │
          ▼
ACTIVATION
    current -> releases/X/
          │
          ▼
LAUNCHERS STABLES
    ~/.local/bin/foo
    ~/.local/bin/foo-update
          │
          ▼
UTILISATEUR
    $ foo
```

Pour la configuration :

```text
DEFAULTS
   ↓
FUNCTIONAL CONFIG
   ↓
LOCAL CONFIG
   ↓
CLI
```

Pour l’update :

```text
VALIDER
→ INSTALLER NOUVELLE RELEASE
→ CRÉER SON VENV
→ INSTALLER LES ENTRY POINTS
→ TESTER
→ BASCULER current ATOMIQUEMENT
→ CONSERVER ROLLBACK
```

---

# 45. Invariants recommandés

Un projet qui adopte ce blueprint devrait considérer comme invariants :

1. **L’utilisateur n’active jamais le venv pour utiliser l’application.**
2. **Chaque release possède son propre venv.**
3. **Les commandes publiques ont des noms et emplacements stables.**
4. **Les commandes Python sont déclarées dans `project.scripts`.**
5. **Les binaires externes relèvent de la configuration locale.**
6. **Une release n’est activée qu’après installation et validation complètes.**
7. **`current` est la seule indirection nécessaire pour changer de version.**
8. **La bascule de `current` est atomique autant que le système le permet.**
9. **Les données et configurations ne vivent jamais dans une release.**
10. **Une erreur d’update laisse l’ancienne release utilisable.**
11. **Le rollback ne nécessite pas de reconstruction d’environnement.**
12. **Le bootstrap updater doit rester aussi indépendant que possible de la release active.**

---

# 46. Formule minimale à répliquer dans un autre projet

Pour un petit projet, le cœur du mécanisme tient finalement à ceci.

`pyproject.toml` :

```toml
[project.scripts]
foo = "foo.cli:main"
foo-update = "foo.update:main"
```

Installation :

```sh
python3 -m venv \
    ~/.local/share/foo/releases/1.0/.venv

~/.local/share/foo/releases/1.0/.venv/bin/python \
    -m pip install /path/to/foo
```

Activation :

```text
~/.local/share/foo/current
    -> ~/.local/share/foo/releases/1.0
```

Launcher :

```sh
#!/bin/sh
exec "$HOME/.local/share/foo/current/.venv/bin/foo" "$@"
```

Installé sous :

```text
~/.local/bin/foo
```

Et l'utilisateur obtient simplement :

```sh
foo --help
```

sans jamais utiliser :

```sh
source .venv/bin/activate
```