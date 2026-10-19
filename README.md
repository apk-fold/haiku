<p align="center"><img src="scripts/icons/icon-512.png" width="120" alt="Haiku"></p>

# Haiku

Gestionnaire de mots de passe **hors ligne** pour Android : les fonctions de [Bitwarden](https://bitwarden.com) et de
[Keyra](https://github.com/Tahir-1907/Keyra) dans une appli mobile, avec des animations GSAP partout et une interface
entièrement personnalisable par modules. Aucun compte, aucun serveur, aucune télémétrie : le coffre ne quitte jamais
le téléphone.

Emballé en APK avec [Capacitor](https://capacitorjs.com/), compilé automatiquement par GitHub Actions, et pensé pour le
Galaxy Z Fold (plié : barre d'onglets ; déplié : rail à gauche et fiche ouverte à droite).

## Télécharger l'APK

➡️ **[Télécharger Haiku (`haiku.apk`)](https://github.com/apk-fold/haiku/raw/main/haiku.apk)** — le fichier est aussi dans
l'onglet *Releases*, avec son empreinte SHA-256.

1. Télécharge `haiku.apk` sur le téléphone et ouvre-le.
2. Autorise l'installation depuis cette source si Android le demande, puis **Installer**.
3. Au premier lancement : *Créer mon coffre* (ou *Restaurer une sauvegarde*).

Toutes les versions sont signées avec **la même clé** (dossier `signing/`) : une mise à jour s'installe par-dessus la
précédente sans désinstaller, donc sans perdre le coffre. Cette clé est publique dans le dépôt : n'installe Haiku que
depuis ce dépôt. Pour une clé privée, ajoute les secrets `HAIKU_KEYSTORE_B64`, `HAIKU_KEYSTORE_PASSWORD` et
`HAIKU_KEY_PASSWORD` dans *Settings › Secrets › Actions* (changer de clé impose une désinstallation : fais d'abord une
sauvegarde).

## Ce que fait Haiku

### Coffre
- **7 types d'éléments** : identifiant, carte bancaire (carte 3D retournable pour voir le cryptogramme), identité, note
  sécurisée, clé SSH (génération Ed25519 au format OpenSSH), réseau Wi-Fi (partage par QR code), serveur (copie de la
  commande `ssh`/`sftp`).
- Plusieurs **adresses par identifiant** avec règle de détection (domaine, hôte, exact, expression régulière…),
  **champs personnalisés** (texte, masqué, oui/non), **pièces jointes** chiffrées (10 Mo), **notes**.
- **Dossiers** (couleur, ordre par glisser), **étiquettes** (20 par élément, règles de Keyra), **favoris**.
- **Recherche** sans accents ni casse, `#étiquette`, `#"deux mots"`, `type:carte`, `is:fav`, `has:totp`, `in:dossier`.
- **Historique** : 20 versions par élément, restaurables avec comparaison avant/après ; 10 anciens mots de passe.
- **Corbeille** avec purge automatique (7, 30, 90 jours, 1 an ou jamais), **historique global** des modifications.
- **Re-saisie du mot de passe maître** par élément (comme Bitwarden), **sélection multiple** (déplacer, favoris,
  corbeille), **duplication**, gestes : glisser à droite = copier, à gauche = favori, appui long = menu.
- **Plusieurs coffres** indépendants, chacun avec son mot de passe.

### Remplissage automatique
- Haiku est un **service de remplissage Android** (Réglages › Remplissage automatique) : dans une appli ou un
  navigateur, touche le champ puis « Remplir avec Haiku », déverrouille (biométrie, PIN ou mot de passe) et choisis
  l'identifiant. Les correspondances suivent les règles de Bitwarden (domaine, hôte, `androidapp://paquet`…), et
  l'association à une appli peut être mémorisée en un geste.
- Le code 2FA de l'identifiant est copié automatiquement pour l'étape suivante.
- Après une connexion, Android propose d'**enregistrer** (ou de mettre à jour) l'identifiant dans Haiku.
- Chrome : *Paramètres › Remplissage automatique › Utiliser un autre service*.

### Authentificateur (2FA)
- Codes **TOTP** (SHA-1/256/512, 6 ou 8 chiffres, période libre), **HOTP** et **Steam Guard**, en direct avec anneau de
  compte à rebours et code suivant.
- Ajout par **scan de QR code** (caméra ou capture d'écran), clé manuelle ou lien `otpauth://`.
- Import de l'export **Google Authenticator** (« Transférer des comptes ») et d'**Aegis**.

### Générateur
- Mots de passe (5 à 128 caractères, minimums de chiffres/symboles, caractères ambigus exclus, symboles au choix),
  **phrases de passe** (listes de 7 776 mots en français et en anglais), **pseudos** (mots, aléatoire, adresse
  `moi+xxxx@gmail.com`, domaine catch-all), **codes PIN**. Entropie exacte et temps de cassage affichés.
- Historique des valeurs générées, chiffré dans le coffre.

### Santé du coffre
Score sur 100 et rapports : mots de passe **faibles**, **réutilisés**, **anciens** (plus d'un an), **manquants**,
**sites en http://**, **cartes expirées**, et à la demande : **fuites** (Have I Been Pwned, k-anonymat : seuls
5 caractères d'empreinte SHA-1 partent) et **2FA disponible mais inactive** (liste 2fa.directory).

### Send (partage chiffré)
L'équivalent hors ligne de Bitwarden Send : un texte ou un fichier (15 Mo) devient une **page HTML autonome** chiffrée
(AES-256-GCM, PBKDF2-SHA256 600 000 itérations), avec date d'expiration. Le destinataire l'ouvre dans n'importe quel
navigateur avec le mot de passe que tu lui transmets par un autre canal.

### Import / export
| Format | Import | Export |
|---|---|---|
| Haiku chiffré (`.haiku.json`, Argon2id + AES-256-GCM, tout le coffre) | ✅ | ✅ |
| Coffre Haiku (`.haiku`, sauvegarde ou autre téléphone) | ✅ | ✅ |
| Bitwarden JSON (en clair) | ✅ | ✅ |
| Bitwarden JSON **protégé par mot de passe** (PBKDF2 ou Argon2id) | ✅ | ✅ |
| Bitwarden CSV | ✅ | ✅ |
| Keyra `.mcfexport` chiffré | ✅ | ✅ (se réimporte dans Keyra) |
| Keyra CSV | ✅ | ✅ |
| KeePassXC CSV, KeePass 2 XML | ✅ | — |
| Chrome / Edge / Brave / Opera, Firefox, Safari / Mots de passe Apple | ✅ | ✅ (CSV navigateur) |
| LastPass, 1Password, Dashlane, Proton Pass, NordPass (CSV) | ✅ | — |
| Aegis (JSON en clair), Google Authenticator (QR) | ✅ | ✅ (liens `otpauth://`) |

Aperçu avant import (sans les mots de passe), dossiers créés automatiquement, doublons ignorés, rappel de supprimer
les fichiers en clair. Les types propres à Haiku (Wi-Fi, serveur) font l'aller-retour par Bitwarden grâce à un champ
`haiku-type`. L'export redemande le mot de passe maître.

### Sécurité
```text
mot de passe maître ──Argon2id (64 Mio, 3 passes, 4 voies)──► KEK
KEK ──AES-256-GCM──► DEK (clé de données aléatoire 256 bits)
DEK ──AES-256-GCM──► contenu du coffre (JSON compressé)
```
- Le mot de passe maître n'est jamais stocké. Changer de mot de passe ré-emballe la DEK sans tout rechiffrer.
- Résistance Argon2id réglable : légère (32 Mio), standard (64 Mio, comme Keyra), renforcée (128 Mio · 4 passes).
- **Clé de récupération** façon Keyra : 32 caractères (base32 de Crockford, 150 bits + contrôle), affichée une seule
  fois ; « mot de passe oublié » crée une nouvelle clé et invalide l'ancienne.
- **Biométrie** : la DEK est chiffrée par une clé AES de l'**Android Keystore** utilisable seulement après une
  authentification biométrique forte, invalidée si une nouvelle empreinte est ajoutée.
- **Code PIN** (4 à 12 chiffres) dérivé par Argon2id, désactivé après 5 erreurs (réglable), option « redemander le
  mot de passe maître au redémarrage ».
- **Verrouillage automatique** (immédiat à 4 h, ou jamais), en arrière-plan aussi ; **presse-papiers** effacé après
  30 s (réglable) et marqué *sensible* (masqué dans l'aperçu d'Android 13+) ; **écran sécurisé** (pas de capture,
  aperçu masqué dans les applis récentes) ; sauvegarde Android du dossier de l'appli désactivée ; APK *release*
  (non débogable).
- **Sauvegardes** automatiques au verrouillage (si le coffre a changé) dans `Documents/Haiku/Sauvegardes`, 10 gardées
  (réglable) ; elles se restaurent comme un **nouveau** coffre, rien n'est écrasé.

### Personnalisation : le Studio et les modules
- **9 thèmes** (Haïku, Sumi-e, Sakura, Néon, Matrice, Solaire, Glacier, Papier, Monochrome), modes sombre, AMOLED,
  clair et verre, deux couleurs d'accent libres (ou une harmonie au hasard), partage de thème par code.
- **Fonds animés** : aurore, constellation (réagit au doigt), encre sumi-e (une goutte à chaque toucher), pétales de
  sakura, grille rétro, ondes, pluie de code ; intensité, grain de papier, halo.
- **8 polices** (Sora, Manrope, Outfit, Space Grotesk, Syne, Unbounded, Shippori Mincho, JetBrains Mono), arrondis,
  flou du verre, densité, liste en cartes / lignes / grille, initiales ou pictogrammes.
- **Animations GSAP** réglables (aucune, douces, normales, *de fou*) : intro au tampon 俳句, ensō tracé au pinceau sur
  l'écran de verrouillage et serrure qui tourne au déverrouillage, révélation des secrets façon décryptage
  (ScrambleText), gerbes de particules (Physics2D), listes qui se réorganisent (Flip), feuilles et lignes à glisser
  (Draggable + Inertia), cartes qui s'inclinent en 3D, transitions de page au choix (glissé, zoom, bascule 3D,
  rideau, flou).
- **Modules** : chaque fonction (2FA, générateur, santé, Send, dossiers, historique, corbeille, import/export,
  sauvegardes) s'active ou se désactive ; la **barre d'onglets** se compose (5 au plus, ordre par glisser) ; l'**accueil**
  est fait de widgets réordonnables (haïku du jour, recherche, raccourcis, favoris, codes 2FA, score de santé,
  récents, générateur express, statistiques, dossiers, nuage d'étiquettes).
- **Palette de commandes** (glisser vers le bas sur l'en-tête, ou Ctrl+K au clavier) et raccourcis clavier
  (Ctrl+N, Ctrl+L, Ctrl+G, Ctrl+F, Ctrl+,).

## Limites connues
- Pas de synchronisation ni de partage de coffre entre personnes : c'est un coffre local (comme Keyra). Pour passer
  d'un téléphone à l'autre : sauvegarde `.haiku` ou export chiffré.
- Le remplissage automatique passe par l'écran de Haiku (pas de suggestions en ligne dans le clavier) : un toucher
  de plus, mais aucun secret n'est jamais conservé en clair pour le système.
- Les fichiers `.kdbx` ne sont pas lus directement : exporte-les en CSV ou XML depuis KeePassXC / KeePass.
- L'estimation de robustesse est hors ligne et approximative.

## Compiler soi-même (Windows, Android Studio, JDK 21)
```bash
npm install
npm test                 # tests du cœur (chiffrement, imports/exports, 2FA…)
npm run android:add      # seulement si le dossier android/ n'existe pas
npm run sync             # build web + copie dans le projet Android + réglages Haiku
npm run open             # ouvre Android Studio (ou : cd android && gradlew assembleRelease)
```
L'APK est signé avec la clé de `signing/`, comme celui de GitHub Actions : les deux s'installent l'un par-dessus
l'autre.

## Organisation du code
```text
src/core/      chiffrement, coffre, importeurs/exporteurs, TOTP, générateur, robustesse, audit, Send, SSH
src/views/     écrans (accueil, coffre, fiche, édition, 2FA, générateur, santé, Send, Studio, modules…)
src/ui/        effets GSAP, fonds animés, thème, composants, écran de verrouillage
scripts/       réglages du projet Android, plugin natif Java (biométrie Keystore, écran sécurisé, remplissage automatique), icônes
tests/         tests Node (avec un vrai export de Keyra) et test d'interface Playwright
```

## Crédits
Haiku est une réécriture indépendante : il reprend les **fonctionnalités** de Bitwarden et de Keyra et lit/écrit
leurs **formats d'export**, sans réutiliser leur code. Merci à [GSAP](https://gsap.com) (Webflow), [Lucide](https://lucide.dev)
(ISC), [hash-wasm](https://github.com/Daninet/hash-wasm) (MIT), [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0),
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), la liste de mots
[EFF](https://www.eff.org/dice) (CC BY 3.0), [diceware-wordlists-fr](https://github.com/mbelivo/diceware-wordlists-fr)
(dérivée de Lexique 3.81), et aux polices Sora, Manrope, Outfit, Space Grotesk, Syne, Unbounded, Shippori Mincho et
JetBrains Mono (SIL Open Font License).
