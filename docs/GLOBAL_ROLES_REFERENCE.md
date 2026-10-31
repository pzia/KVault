# Blueprint global — Répartition des rôles

Version : 0.1  
Statut : architecture de référence

## 1. Principe directeur

L’écosystème repose sur trois projets indépendants :

- **Paris Library** orchestre l’expérience utilisateur et le portefeuille local de livres ;
- **Kobo Vault** fournit un accès spécialisé aux données et services Kobo ;
- **Kobo-Adept** exécute des opérations locales de téléchargement et de gestion de liseuses.

Aucun projet ne doit dépendre de l’identité ou de l’implémentation interne des deux autres.

Principe :

> Paris orchestre.  
> Vault expose Kobo.  
> Adept exécute localement.

Chaque projet est propriétaire des interfaces qu’il expose.

Les contrats précis sont définis ultérieurement par chaque projet, en fonction de ses responsabilités et des besoins exprimés par ses consommateurs.

---

## 2. Architecture logique

```text
                         Utilisateur
                             │
                             ▼
                       Paris Library
              IHM + portefeuille + ~/EBooks
                             │
                 ┌───────────┴───────────┐
                 │                       │
                 ▼                       ▼
             Library                  Devices /
             Provider                 Download Tool
                 │                       │
                 ▼                       ▼
             Kobo Vault              Kobo-Adept
                 │                       │
                 ▼                  ┌────┴─────┐
                Kobo              ADEPT      Devices Kobo
```

Paris Library connaît des **capacités** et des **modules**, pas leurs implémentations internes.

---

## 3. Paris Library

### 3.1 Rôle

Paris Library est le **point d’entrée utilisateur global**.

Il est responsable :

- de l’IHM ;
- de la fédération des différentes bibliothèques et sources ;
- de la gestion fonctionnelle du portefeuille de livres ;
- des décisions d’acquisition, téléchargement et synchronisation ;
- du suivi des opérations ;
- de l’organisation de la bibliothèque locale ;
- de `~/EBooks`.

Paris Library décide **quoi faire**.

Il délègue aux composants spécialisés **comment le faire**.

### 3.2 Bibliothèque locale

Paris Library est propriétaire fonctionnel de :

```text
~/EBooks
```

Il connaît notamment :

- les livres présents ;
- leur provenance ;
- leur état local ;
- leurs métadonnées utiles ;
- leur association éventuelle avec une source distante ;
- leur état de synchronisation avec une ou plusieurs liseuses.

Un outil externe peut écrire ou modifier des fichiers dans cet espace lorsqu’il est explicitement sollicité par Paris.

### 3.3 Modules conceptuels

Paris Library peut consommer plusieurs catégories de partenaires.

#### Module de type `Library`

Un module bibliothèque peut notamment offrir :

- recherche ;
- catalogue public ;
- bibliothèque d’un utilisateur ;
- métadonnées ;
- disponibilité ;
- possession ;
- informations permettant une acquisition.

Kobo Vault appartient à cette catégorie.

#### Module de type `Devices`

Un module devices peut notamment offrir :

- découverte des appareils ;
- inventaire de leur contenu ;
- informations sur les appareils ;
- transfert de livres ;
- suppression ;
- synchronisation.

Kobo-Adept appartient à cette catégorie.

#### Outil de téléchargement

Paris peut également déléguer un téléchargement à un outil spécialisé.

Kobo-Adept peut remplir ce rôle.

### 3.4 Dépendances

Paris peut connaître :

```text
Vault comme fournisseur de bibliothèque
Adept comme outil de téléchargement
Adept comme fournisseur de devices
```

Paris peut appeler directement les interfaces publiques de chacun.

Il n’a pas à connaître leur implémentation interne.

---

## 4. Kobo Vault

### 4.1 Rôle

Kobo Vault est un composant **spécialisé exclusivement sur Kobo**.

Il consolide la relation avec les services Kobo.

Il connaît notamment :

- les APIs Kobo ;
- les comptes Kobo ;
- les credentials nécessaires à l’accès Kobo ;
- le catalogue Kobo ;
- la bibliothèque d’un utilisateur ;
- les droits et états associés aux livres ;
- les informations nécessaires à leur téléchargement.

### 4.2 Deux usages conceptuels

Pour un consommateur comme Paris, Vault peut être vu sous deux formes.

#### Vault public

Proxy d’accès au catalogue Kobo global.

Exemples de capacités :

```text
search
book detail
metadata
catalog availability
```

#### Vault authentifié

Proxy d’accès aux données Kobo propres à un compte.

Exemples :

```text
user library
ownership
downloadability
account-specific metadata
download information
credentials or tokens required for acquisition
```

### 4.3 Credentials

Vault est autorisé à connaître les credentials Kobo.

Lorsqu’une opération locale doit être réalisée par un autre composant, Vault peut exposer les informations nécessaires à cette opération.

Ces informations peuvent ensuite être transmises par le consommateur à un outil local, y compris **via une invocation CLI**.

Le transport de credentials par arguments ou paramètres CLI est donc autorisé par l’architecture.

Les implémentations peuvent néanmoins éviter leur persistance dans les logs ou sorties de diagnostic.

### 4.4 Indépendance

Vault :

- ne connaît pas spécifiquement Paris Library ;
- ne connaît pas spécifiquement Kobo-Adept ;
- ne pilote pas d’agent Adept ;
- ne gère pas de lease Adept ;
- ne suppose pas la présence d’une liseuse locale ;
- ne possède pas `~/EBooks`.

Vault expose simplement des APIs Kobo utiles à ses consommateurs.

---

## 5. Kobo-Adept

### 5.1 Rôle

Kobo-Adept est un **outil local générique d’exécution**.

Il ne connaît pas spécifiquement Paris Library ni Kobo Vault.

Il exécute des instructions reçues par son interface publique, principalement sa CLI.

### 5.2 Téléchargement

Adept peut télécharger un contenu à partir d’informations fournies par son appelant.

L’instruction peut contenir notamment :

```text
source
URL
credentials
headers ou tokens
destination
metadata éventuelles
```

Adept n’a pas besoin de connaître l’origine de ces informations.

La source peut être :

- un téléchargement HTTP direct ;
- Kobo ;
- un ACSM ;
- toute autre source supportée ultérieurement.

### 5.3 ADEPT

Adept gère les aspects techniques liés à Adobe ADEPT, notamment :

- profils ADE ;
- activations ;
- ACSM ;
- libgourou ;
- récupération des fichiers protégés ;
- association entre profils et devices si nécessaire.

Les profils ADE appartiennent au domaine d’Adept.

### 5.4 Devices

Adept connaît un ou plusieurs devices Kobo locaux.

Il peut notamment exposer :

```text
liste des devices
caractéristiques des devices
liste des profils ADE
association profils / devices
contenu d’une liseuse
copie d’un ebook vers une liseuse
suppression éventuelle
état des fichiers présents
```

Adept représente donc pour Paris un **proxy d’accès aux devices locaux**.

### 5.5 Fichiers

Adept peut écrire dans une destination fournie explicitement par son appelant.

Il n’est pas propriétaire fonctionnel de la bibliothèque locale.

Ainsi :

```text
Paris possède ~/EBooks
Adept peut y écrire sur instruction de Paris
```

### 5.6 Interface

La CLI constitue l’interface publique principale d’Adept.

Conceptuellement :

```text
adept download ...
adept profiles list
adept devices list
adept device info ...
adept device books ...
adept device push ...
adept device remove ...
```

Les commandes exactes et leurs formats seront définis par le projet Adept dans son propre contrat.

---

## 6. Relations entre les trois projets

### Paris ↔ Vault

Paris utilise Vault comme module bibliothèque Kobo.

```text
Paris
  ↓
recherche / bibliothèque / informations d'acquisition
  ↓
Vault
  ↓
Kobo
```

Vault ignore que son consommateur est Paris.

### Paris ↔ Adept

Paris invoque directement Adept pour les opérations locales.

```text
Paris
  ↓
instruction CLI
  ↓
Adept
  ↓
download / ADEPT / device
```

Adept ignore que son appelant est Paris.

### Vault ↔ Adept

Il n’existe **aucune dépendance structurelle obligatoire** entre Vault et Adept.

Un flux peut néanmoins être orchestré par un tiers :

```text
Vault
  ↓
URL + credentials + metadata
  ↓
Paris
  ↓
CLI Adept
  ↓
fichier
```

Dans ce scénario, Paris relie les deux capacités.

Vault et Adept n’ont pas besoin de se connaître.

---

## 7. Exemple : téléchargement d’un ebook Kobo

```text
Utilisateur
   ↓
Paris Library
   ↓
demande les informations du livre
   ↓
Vault
   ↓
Kobo
   ↓
Vault retourne les informations nécessaires
   ↓
Paris construit une instruction de téléchargement
   ↓
Adept CLI
   ↓
téléchargement
   ↓
~/EBooks
   ↓
résultat retourné à Paris
```

Les credentials peuvent faire partie des paramètres transmis à Adept.

Paris décide de la destination.

Adept réalise le téléchargement.

Vault fournit les éléments Kobo nécessaires.

---

## 8. Exemple : acquisition via ACSM

```text
Paris
   ↓
obtient un ACSM ou une source ACSM
   ↓
Adept CLI
   ↓
profil ADE approprié
   ↓
libgourou / ADEPT
   ↓
EPUB/PDF
   ↓
destination demandée par Paris
```

Paris n’implémente pas ADEPT.

Vault n’a aucun rôle obligatoire dans ce parcours.

---

## 9. Exemple : synchronisation avec une liseuse

```text
Paris
   ↓
demande inventaire devices
   ↓
Adept
   ↓
liste devices + contenu
   ↓
Paris compare avec ~/EBooks
   ↓
Paris décide des opérations
   ↓
Adept
   ↓
push / remove / autre opération device
```

Paris possède la logique de synchronisation souhaitée.

Adept possède la connaissance technique du device.

---

## 10. Propriété des domaines

### Paris Library possède

```text
IHM globale
orchestration fonctionnelle
portefeuille de livres
~/EBooks
index local
état souhaité
fédération de providers
choix des actions
suivi fonctionnel
```

### Kobo Vault possède

```text
protocole Kobo
credentials Kobo
catalogue Kobo
bibliothèque Kobo d'un compte
authentification Kobo
métadonnées Kobo
droits Kobo
informations et credentials permettant les téléchargements
API Kobo exposée aux consommateurs
```

### Kobo-Adept possède

```text
CLI
moteur de téléchargement
ACSM
ADEPT / libgourou
profils ADE
détection des devices
protocoles et filesystem des liseuses
inventaire device
transfert local vers les liseuses
```

---

## 11. Règle de propriété des interfaces

Principe structurant :

```text
Le fournisseur d’une capacité
possède et versionne son interface.

Le consommateur exprime un besoin
et s’adapte au contrat publié.
```

Ainsi :

- Paris ne définit pas l’API de Vault ;
- Paris ne définit pas la CLI d’Adept ;
- Vault ne définit pas les modèles internes de Paris ;
- Vault ne définit pas l’interface d’Adept ;
- Adept ne définit pas les workflows de Paris ;
- Adept ne dépend pas du modèle métier de Vault.

---

## 12. Définition future des contrats

Ce blueprint ne définit volontairement pas les contrats détaillés.

Chaque projet doit produire son propre contrat lorsqu’un besoin concret apparaît.

Exemple :

```text
Besoin Paris :
"obtenir la bibliothèque Kobo d'un compte"

→ Vault définit l'API correspondante.


Besoin Paris :
"télécharger cette source vers ~/EBooks/x.epub"

→ Adept définit la commande CLI correspondante.


Besoin Paris :
"connaître le contenu du device X"

→ Adept définit la commande et le format de sortie.
```

Le besoin appartient au consommateur.

La forme du contrat appartient au fournisseur.

---

## 13. Critères d’acceptation architecturaux

L’architecture est correcte si :

1. Paris peut remplacer Vault par un autre module `Library` sans modifier sa logique fondamentale ;
2. Paris peut remplacer Adept par un autre moteur de téléchargement ou de devices ;
3. Vault peut fonctionner et être testé sans Paris ;
4. Vault peut fonctionner sans Adept ;
5. Adept peut fonctionner et être testé sans Paris ;
6. Adept peut fonctionner sans Vault ;
7. Adept peut télécharger une ressource sans connaître le système ayant fourni ses credentials ;
8. Vault peut exposer des informations de téléchargement sans savoir quel outil les utilisera ;
9. Paris reste propriétaire de `~/EBooks` ;
10. Adept reste propriétaire des détails techniques des devices et d’ADEPT ;
11. Vault reste propriétaire des détails techniques de Kobo ;
12. aucun contrat n’impose une montée de version synchronisée des trois projets.

---

## 14. Résumé

```text
PARIS LIBRARY
─────────────
Connaît :
- utilisateurs
- portefeuille de livres
- providers
- fichiers locaux
- état souhaité
- actions à déclencher

Décide.


KOBO VAULT
──────────
Connaît :
- Kobo
- comptes Kobo
- credentials Kobo
- catalogue Kobo
- bibliothèques Kobo
- droits et informations de téléchargement

Expose.


KOBO-ADEPT
──────────
Connaît :
- downloads
- ACSM
- ADEPT
- profils ADE
- devices
- contenu des liseuses
- opérations locales

Exécute.
```

> **Paris décide. Vault expose Kobo. Adept exécute.**