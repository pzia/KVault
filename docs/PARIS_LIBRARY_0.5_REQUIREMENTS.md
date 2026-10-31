# Paris Library — Besoins exprimés vers Kobo Vault et Kobo-Adept

Version : 0.1  
Cible Paris Library : 0.5.0  
Statut : expression de besoin consommateur — **ne définit pas les contrats des fournisseurs**

## 1. Cadre architectural

Ce document applique le blueprint global de répartition des rôles :

- **Paris Library décide** : UX, portefeuille local, `~/EBooks`, orchestration fonctionnelle ;
- **Kobo Vault expose Kobo** : catalogue, compte, bibliothèque, droits et informations d'acquisition ;
- **Kobo-Adept exécute localement** : téléchargements, ADEPT, profils et devices.

Règle structurante : **le besoin appartient au consommateur ; la forme du contrat appartient au fournisseur**.

En conséquence, les sections ci-dessous décrivent ce dont Paris Library a besoin. Elles ne prescrivent ni les routes HTTP de Vault, ni les noms de commandes/options CLI d'Adept, ni leurs modèles internes.

---

## 2. Besoins de Paris Library envers Kobo Vault

### 2.1 Découverte du service et des capacités

Paris Library a besoin de pouvoir :

- vérifier que Vault est joignable ;
- connaître une version de contrat/API exploitable ;
- connaître les capacités réellement offertes ;
- distinguer les fonctions publiques des fonctions nécessitant un compte authentifié.

Paris n'a pas besoin de connaître la version du Worker, la structure D1/R2 ou l'implémentation interne de Vault.

### 2.2 Identité du compte logique

Pour un accès authentifié, Paris a besoin d'une identité stable du compte Kobo projeté par Vault :

- identifiant stable ;
- libellé affichable ;
- éventuellement une indication d'adresse e-mail expurgée ;
- aucune nécessité d'exposer un secret dans les diagnostics Paris.

### 2.3 Recherche catalogue

Paris a besoin de rechercher le catalogue Kobo avec, lorsque Vault sait les traiter :

- texte libre ;
- titre ;
- auteur ;
- ISBN ;
- sujet ;
- pagination ;
- distinction catalogue global / bibliothèque utilisateur.

Pour chaque résultat, Paris souhaite au minimum pouvoir normaliser :

```text
identifiant Kobo stable
titre
auteur(s)
format / type de contenu
couverture
URL de consultation éventuelle
possession par le compte
possibilité fonctionnelle d'acquisition/téléchargement
révision/version technique si elle existe
prix/devise si pertinent
```

Vault reste libre de son schéma et de sa stratégie de recherche.

### 2.4 Bibliothèque d'un utilisateur / manifest léger

Pour le backup incrémental, Paris a besoin d'obtenir la liste des contenus possédés connus par Vault sans télécharger les fichiers.

Pour chaque entrée, Paris doit pouvoir déterminer :

- l'identité logique du contenu ;
- sa version/révision courante si Kobo en expose une ;
- les métadonnées utiles à l'affichage ;
- si le contenu est potentiellement acquérable ;
- les informations nécessaires pour savoir si une copie locale est déjà à jour.

Le manifest doit être paginable si nécessaire et ne doit pas exiger le téléchargement des ebooks pour être produit.

### 2.5 Informations nécessaires à une acquisition locale

Lorsqu'un ebook possédé doit être acquis, Paris a besoin que Vault puisse fournir **les informations Kobo suffisantes pour qu'un outil local tiers réalise l'opération**.

Selon le mécanisme Kobo concerné, ces informations peuvent comprendre :

```text
identifiants Kobo
URL(s) ou endpoint(s) utiles
jetons / credentials nécessaires
headers ou paramètres nécessaires
durée de validité / expiration éventuelle
format attendu
informations DRM utiles
métadonnées nécessaires à la requête
```

Points importants :

- Paris n'impose pas si ces données sont renvoyées dans un détail de livre, une ressource dédiée ou une autre forme ;
- Paris n'impose pas leur schéma ;
- Vault décide quelles données sont strictement nécessaires et comment les protéger ;
- ces informations doivent être utilisables par un consommateur autre que Paris ;
- Vault ne doit pas supposer que Kobo-Adept est le consommateur final.

### 2.6 Durée de validité et renouvellement

Si les informations d'acquisition sont temporaires, Paris a besoin de savoir :

- qu'elles sont expirables ;
- quand les renouveler, ou comment détecter leur expiration ;
- comment demander des informations fraîches avant une nouvelle tentative.

### 2.7 Erreurs exploitables

Paris a besoin d'erreurs structurées permettant au minimum de distinguer :

```text
non authentifié / session expirée
non possédé
non téléchargeable
contenu introuvable
révision obsolète
rate limit
indisponibilité Kobo
contrat ou capacité non supporté
```

Le texte utilisateur final reste de la responsabilité de Paris.

### 2.8 Ce que Paris ne demande pas à Vault

Paris ne demande pas à Vault :

- de connaître Paris Library ;
- de connaître Kobo-Adept ;
- de piloter un agent local ;
- de gérer les devices locaux ;
- de gérer ADEPT/libgourou ;
- de posséder `~/EBooks` ;
- de décider quels fichiers doivent être téléchargés ou synchronisés ;
- d'imposer le workflow local de backup.

Le mécanisme historique `Paris → job Vault → agent Adept` n'est donc **pas une dépendance architecturale requise** par Paris Library 0.5.0.

---

## 3. Besoins de Paris Library envers Kobo-Adept

### 3.1 Découverte locale et capacités

Paris a besoin de pouvoir déterminer de façon non interactive :

- qu'Adept est installé et exécutable ;
- sa version ;
- les capacités disponibles ;
- si les fonctions ADEPT et devices sont utilisables dans l'environnement local.

La forme exacte (`status`, `capabilities`, etc.) appartient à Adept.

### 3.2 Invocation automatisable

L'interface publique d'Adept doit pouvoir être invoquée par un programme, sans interaction humaine obligatoire pour les opérations courantes.

Paris a besoin :

- de codes de sortie significatifs ;
- d'une sortie machine-readable stable, idéalement JSON ;
- de diagnostics humains séparables de la sortie structurée ;
- d'absence de secrets dans les logs par défaut.

La CLI est l'interface publique privilégiée par le blueprint, mais son vocabulaire exact appartient au projet Adept.

### 3.3 Téléchargement vers une destination choisie par Paris

Paris possède fonctionnellement `~/EBooks`. Il a donc besoin de pouvoir demander à Adept :

> « acquiers cette ressource avec ces informations et écris le résultat à cette destination ».

Les entrées fonctionnelles peuvent comprendre :

```text
nature/source de la ressource
URL ou identifiant
credentials / tokens / headers fournis par le consommateur
destination demandée
format attendu
métadonnées utiles
```

Paris n'impose pas si ces éléments sont passés par arguments, stdin, fichier temporaire, variable d'environnement ou autre mécanisme sûr : cette décision appartient à Adept.

### 3.4 Résultat de téléchargement

Après exécution, Paris a besoin de connaître de manière structurée :

```text
succès / échec
chemin du fichier final
taille
format réellement obtenu
SHA-256 si calculé
état DRM utile
code et message d'erreur en cas d'échec
```

Le fichier doit être considéré comme valide uniquement lorsque l'opération est terminée. Une écriture atomique ou un mécanisme équivalent est souhaité pour éviter qu'un fichier partiel soit pris pour un ebook final.

### 3.5 Sources à supporter

Paris souhaite pouvoir déléguer à Adept, au fur et à mesure des capacités disponibles :

- téléchargement HTTP direct ;
- acquisition Kobo à partir des informations fournies par Vault ;
- ACSM / Adobe ADEPT ;
- autres sources locales ou distantes ajoutées ultérieurement.

Adept reste responsable du détail technique de chaque mécanisme.

### 3.6 ADEPT

Pour les flux ACSM, Paris a besoin de pouvoir :

- connaître les profils ADE disponibles ;
- sélectionner ou référencer un profil lorsque cela est nécessaire ;
- demander l'acquisition d'un ACSM ;
- récupérer le chemin et l'état du fichier produit ;
- demander les opérations de retour lorsque le protocole et le fournisseur le permettent.

Les activations, secrets ADEPT, fichiers `activation.xml`, `device.xml`, `devicesalt` et l'intégration libgourou appartiennent exclusivement à Adept.

### 3.7 Devices Kobo

Paris a besoin d'utiliser Adept comme module `Devices` local.

Besoins fonctionnels :

```text
lister les devices disponibles
obtenir leurs caractéristiques
inventorier les livres présents
connaître l'état de présence d'un fichier/livre
copier un ebook vers un device
supprimer un ebook d'un device, si supporté
connaître les profils ADE associés ou compatibles si pertinent
```

Paris décide de la politique de synchronisation. Adept décide comment interagir techniquement avec le device.

### 3.8 Progression

Pour les opérations longues, Paris souhaite pouvoir afficher une progression lorsque Adept sait la fournir.

Le minimum requis reste un résultat final fiable. Une progression intermédiaire est une capacité optionnelle utile, dont Adept choisit la forme.

### 3.9 Erreurs exploitables

Paris a besoin de distinguer au minimum :

```text
entrée invalide
authentification/source expirée
non possédé / non autorisé
format non supporté
ACSM/ADEPT en échec
download interrompu
fichier final invalide
disque plein / erreur de stockage
device absent
device en lecture seule
profil ADE incompatible
```

Adept choisit les codes exacts ; Paris les traduit ensuite en UX.

### 3.10 Ce que Paris ne demande pas à Adept

Paris ne demande pas à Adept :

- de connaître Paris Library ;
- de connaître Kobo Vault ;
- de rechercher le catalogue Kobo ;
- de posséder la bibliothèque locale ;
- de décider quels ebooks doivent être sauvegardés ;
- de maintenir une projection métier du portefeuille Paris ;
- de dépendre d'un modèle de jobs propre à Vault.

---

## 4. Besoin de composition côté Paris

Paris doit pouvoir composer indépendamment les deux fournisseurs :

```text
1. Paris constate qu'un ebook Kobo manque dans ~/EBooks
2. Paris demande à Vault les informations Kobo nécessaires à l'acquisition
3. Paris traduit ces informations dans son modèle interne d'instruction
4. Paris invoque l'interface publique d'Adept
5. Adept acquiert le fichier et le place à la destination demandée
6. Adept renvoie un résultat structuré
7. Paris met à jour son portefeuille/index local
```

Vault et Adept n'ont pas besoin de se connaître.

---

## 5. Backup Kobo attendu par Paris

Le besoin fonctionnel de Paris est :

```text
bibliothèque/manifest Vault
        ↓
comparaison avec l'index et ~/EBooks
        ↓
absent / révision différente / fichier manquant ?
        ↓ oui
récupération des informations d'acquisition auprès de Vault
        ↓
appel local d'Adept vers une destination choisie par Paris
        ↓
validation du résultat
        ↓
index local mis à jour
```

Propriétés attendues :

- incrémental ;
- idempotent ;
- pas de redownload si la copie locale reconnue est à jour ;
- reprise possible après erreur ;
- aucune nécessité de coupler les versions de Vault et Adept ;
- aucun stockage obligatoire des ebooks dans Vault.

---

## 6. Besoins de sécurité

### Vault

Paris attend :

- HTTPS ;
- authentification appropriée aux fonctions privées ;
- secrets absents des diagnostics par défaut ;
- informations d'acquisition limitées au strict nécessaire ;
- possibilité de renouveler/révoquer l'accès selon le modèle choisi par Vault.

### Adept

Paris attend :

- aucune fuite de credentials/tokens dans stdout/stderr par défaut ;
- pas de construction de commandes via shell non maîtrisé ;
- validation/confinement des chemins ;
- gestion sûre des fichiers temporaires ;
- résultat final distinct d'un fichier partiel.

Paris accepte architecturalement qu'un secret nécessaire à une acquisition soit transmis à l'interface locale d'Adept. Le mécanisme concret et les protections associées sont à définir par Adept.

---

## 7. Compatibilité et versionnement

Paris souhaite pouvoir évoluer indépendamment des deux projets.

Pour cela, chaque fournisseur devrait offrir un moyen de connaître :

- la version de son interface publique ;
- les capacités disponibles ;
- les éventuelles incompatibilités de contrat.

Paris préfère la négociation de capacités à une dépendance rigide à une version d'implémentation.

---

## 8. Critères d'acceptation côté Paris

L'intégration sera considérée comme suffisamment contractée lorsque :

1. Paris peut rechercher Kobo via Vault ;
2. Paris peut obtenir la bibliothèque d'un compte via Vault ;
3. Paris peut savoir qu'un ebook local doit être acquis ou actualisé ;
4. Vault peut fournir les informations nécessaires à cette acquisition sans connaître Adept ;
5. Paris peut transmettre ces informations à Adept sans qu'Adept connaisse Vault ;
6. Adept peut écrire le fichier à une destination choisie par Paris ;
7. Paris reçoit un résultat structuré et peut mettre à jour son index ;
8. Paris peut inventorier un device via Adept ;
9. Paris peut demander un push vers un device via Adept ;
10. Vault fonctionne sans Adept et Adept fonctionne sans Vault.

---

## 9. Points à figer par les projets fournisseurs

### À définir par Kobo Vault

- contrat de découverte/capabilities ;
- contrat de recherche ;
- contrat de bibliothèque/manifest ;
- contrat permettant d'obtenir les informations d'acquisition Kobo ;
- authentification et durée de validité de ces informations ;
- modèle d'erreurs.

### À définir par Kobo-Adept

- commandes de découverte/capabilities ;
- contrat d'entrée/sortie machine-readable du téléchargement ;
- contrat ACSM/ADEPT ;
- contrat profils ADE ;
- contrat Devices ;
- codes d'erreur et éventuellement progression.

Une fois ces deux contrats validés, Paris Library les adaptera à ses interfaces internes sans demander aux fournisseurs de reprendre son modèle métier.
