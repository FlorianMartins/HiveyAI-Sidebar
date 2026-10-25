# Guide d'utilisation de Hivey AI

Ce guide part de zéro : installer la sidebar, choisir où tourne votre modèle, puis tirer le
meilleur de chaque onglet sans perdre en confidentialité. Chaque section est indépendante.

- [1. Installer](#1-installer)
- [2. Choisir son modèle : local, passerelle ou cloud](#2-choisir-son-modèle--local-passerelle-ou-cloud)
- [3. Le Chat : questions, page en contexte, recherche web](#3-le-chat--questions-page-en-contexte-recherche-web)
- [4. Les niveaux de réflexion](#4-les-niveaux-de-réflexion)
- [5. L'Agent : il agit dans le navigateur](#5-lagent--il-agit-dans-le-navigateur)
- [6. Garder un contexte propre](#6-garder-un-contexte-propre)
- [7. Confidentialité : ce qui part, et sous quelle forme](#7-confidentialité--ce-qui-part-et-sous-quelle-forme)
- [8. Sécurité, Wisebase, PDF, Image](#8-sécurité-wisebase-pdf-image)
- [9. Questions fréquentes](#9-questions-fréquentes)

---

## 1. Installer

**Version de développement (toujours à jour)** — reconstruite à chaque modification, après les
vérifications de la CI :

| Navigateur | Lien | Installation |
|---|---|---|
| Firefox | [hivey-ai-sidebar-firefox.zip](https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-firefox.zip) | `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire…** → choisir le `.zip` |
| Chrome / Edge / Brave | [hivey-ai-sidebar-chrome.zip](https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-chrome.zip) | décompresser → `chrome://extensions` → **Mode développeur** → **Charger l'extension non empaquetée** |

La sidebar s'ouvre par l'icône de la barre latérale (Firefox, `Ctrl+Shift+Y`) ou du panneau latéral
(Chromium). Ce qui change à chaque version est dans le [journal des modifications](../CHANGELOG.md).

**Les réglages** (⚙) s'ouvrent dans un onglet : une colonne de cartes, chaque réglage avec son nom à
gauche et sa commande à droite (empilés sur une fenêtre étroite), une liste « Aller à » pour sauter
d'une section à l'autre et une recherche en haut. La première carte, **Accès rapide**, réunit des
interrupteurs pour ce qu'on bascule le plus : anonymisation, recherche web, suggestion de la
prochaine demande, artefacts, vérification des réponses, compaction automatique, mémoire, son et
notifications, thème clair, effets, côté du menu et langue de l'interface. Chaque interrupteur est
enregistré aussitôt et la sidebar ouverte suit sans être rechargée. Tout se règle aussi en détail
plus bas, et la page suit votre thème, clair ou sombre.

**Raccourcis clavier** (Réglages → Raccourcis clavier) : cliquez sur un raccourci puis appuyez sur la
nouvelle combinaison, avec Ctrl, Alt ou ⌘ ; **Échap** annule, **Retour arrière** le désactive, ↺
rétablit sa valeur par défaut. Une combinaison déjà prise passe à la nouvelle action (la page dit
laquelle l'a perdue), et une combinaison que le navigateur garde pour lui (`Ctrl+Shift+W`,
`Ctrl+Shift+P`…) est signalée. Par défaut : `Ctrl+Shift+O` nouvelle conversation, `Ctrl+Shift+L`
zone de saisie, `Ctrl+Shift+H` historique, `Ctrl+Shift+E` recherche web, `Ctrl+Shift+1/2/3/5`
Chat, Traduire, Améliorer, Sécurité, `Ctrl+Shift+K` bibliothèque de prompts. Ils agissent quand la
sidebar a le focus.

## 2. Choisir son modèle : local, passerelle ou cloud

Ouvrez ⚙ **Réglages** → **Fournisseurs**. Ils sont rangés du plus privé au moins privé :

| | Où tourne le modèle | Ce qui part de votre machine | Pour qui |
|---|---|---|---|
| 🏠 **Local** | Ollama ou LM Studio sur votre ordinateur (ou votre réseau local) | rien | confidentialité maximale, hors ligne |
| 🔒 **Passerelle / votre serveur** | un serveur compatible OpenAI que vous (ou votre entreprise) contrôlez — par exemple `https://ai.votre-domaine/v1` + une clé | vers votre serveur seulement | équipe, modèle partagé, sans fournisseur tiers |
| ☁️ **Cloud** | Claude, OpenAI, Gemini, Mistral, DeepSeek, OpenRouter… avec **votre** clé | vers ce fournisseur, **après anonymisation** des données sensibles | les modèles les plus puissants |

- **Local** : installez [Ollama](https://ollama.com) (`ollama pull qwen3`) ou LM Studio, activez la
  carte dans les réglages ; la liste des modèles installés apparaît seule.
- **Passerelle** : carte « Passerelle / serveur personnel », renseignez l'URL (terminée par `/v1`)
  et la clé si votre serveur en demande une. La fenêtre de contexte réelle du serveur est lue
  automatiquement (llama.cpp, llama-swap, vLLM, LM Studio l'annoncent).
- **Cloud** : collez une clé API, ou utilisez **« Se connecter avec OpenRouter »** (connexion par
  compte, sans clé à copier).

Dès le **premier lancement**, trois boutons : OpenRouter, « 🏠 Modèle local » (trouve Ollama ou
LM Studio sur votre machine) et « 🔒 Ma passerelle / mon serveur » (URL + clé, vérifiées sur place).

Le modèle se choisit ensuite **dans la zone de saisie** : la puce qui porte l'icône du fournisseur et
le nom du modèle. Seuls les fournisseurs connectés y apparaissent. La zone de saisie est la même dans
tous les onglets :

| Élément | Rôle |
|---|---|
| `+` | un menu : **joindre un fichier**, ou apporter la page — **capturer une zone**, **choisir un élément**, **onglets ouverts…**, **surveiller cette page** (et, dans Sécurité, **les en-têtes de sécurité de la page**) |
| 🎤 | dicter |
| **puce du modèle** (icône du fournisseur) | changer de modèle |
| **puce de réflexion** (✦ et le niveau du modèle) | le niveau de réflexion, voir §4 |
| **Entrée** / **■** | Entrée envoie ; ■ arrête pendant la réponse |
| sous le cadre, à gauche | où tourne le modèle : 🏠 Local, 🔒 Votre passerelle, ☁️ Cloud · anonymisé — sur un modèle cloud, **un clic active ou désactive l'anonymisation** (voir §7) |
| sous le cadre, à droite | le contexte rempli (anneau, %, jetons) et, pour un modèle cloud, le coût de la conversation ; **un clic** ouvre la taille du contexte et « Résumer maintenant » (voir §6) |

Toutes les icônes de la rangée ont la même taille et la couleur de votre thème. Les réglages propres
à un onglet (« Traduire en : … », style, collection Wisebase…) sont **au-dessus du cadre**, comme les
analyses de l'onglet Sécurité ; dans Image, la **taille** est une puce en bas à droite. La dernière
langue de traduction est retenue.

## 3. Le Chat : questions, page en contexte, recherche web

- **La page que vous regardez** est lue et donnée au modèle (une seule fois par conversation, pour
  ne pas la payer à chaque question). Le contenu d'une page est traité comme une **donnée**, jamais
  comme une instruction : une page qui écrit « ignore tes consignes » n'est pas obéie.
- **Recherche web** (activée par défaut, 🌐 dans les options) : la recherche ne part **que si la
  question en a besoin** (actualité, prix, horaires, un lien…), et le modèle répond avec ses sources. **DeepSearch** mène une recherche en plusieurs étapes, avec un rapport cité.
- **Pièces jointes** : glissez des fichiers, des images ou un PDF ; une case permet de laisser une
  pièce jointe hors du contexte sans la retirer.
- **La langue** : le modèle répond dans la langue de votre question, quelle qu'elle soit, même
  après avoir lu une page dans une autre langue.
- **Le coût** : sous chaque réponse d'un modèle cloud, les jetons envoyés → reçus et le prix (exact
  quand OpenRouter le donne, sinon estimé d'après les prix publics et marqué « ≈ »). Gratuit en local
  et sur votre passerelle.
- **Suggestion de la prochaine demande** : après une réponse, une suite proposée apparaît en italique
  pâle dans le champ vide ; **Tab** (ou →) la reprend, il suffit sinon de taper autre chose.
  Désactivable dans les réglages.

## 4. Les niveaux de réflexion

La **puce de réflexion** de la zone de saisie (à côté du modèle) propose **les niveaux que le modèle
choisi possède vraiment**, et seulement ceux-là :

| Niveau | Effet |
|---|---|
| **Direct** | pas de réflexion préalable — le plus rapide (absent si le modèle réfléchit toujours) |
| **Bref** | une réflexion courte |
| **Standard** | l'équilibre ; le choix par défaut sur votre serveur |
| **Approfondi** | réfléchit longuement avant de répondre |
| **Extrême**, **Maximum** | les efforts supplémentaires de certains modèles (Claude récents, GPT, Grok…) |

Au survol d'un niveau, vous voyez le mot exact envoyé au modèle. **Sans choix de votre part**, un
modèle cloud garde son propre réglage par défaut (rien de plus n'est facturé) et votre serveur
travaille en **Standard**. Un niveau choisi pour un modèle que le suivant ne possède pas est
remplacé par le niveau par défaut de ce dernier.

La réflexion s'affiche dans un bloc « Réflexion » **replié** au-dessus de la réponse (il clignote
pendant que le modèle réfléchit) ; un clic l'ouvre.

## 5. L'Agent : il agit dans le navigateur

L'onglet 🤖 **Agent** lit les pages, navigue, clique, remplit des formulaires, compare des onglets.

- **Il travaille dans un onglet qui lui est dédié** : vous pouvez continuer à naviguer ailleurs.
- **Il va au bout** : pas de limite au nombre d'étapes. Il s'arrête quand la tâche est finie, quand
  vous appuyez sur ■, ou s'il tourne en rond (la même lecture refaite sans que rien n'ait changé) —
  il vous dit alors où il en est.
- **Corrigez-le en route** : tapez un message pendant qu'il travaille ; il le lit à l'étape
  suivante (« ↪ Transmis à l'agent »), sans devoir l'arrêter.
- **Réservations et voyages** : il remplit le formulaire de recherche des sites (destination, dates,
  voyageurs), applique vos critères, lit le total du séjour ou du trajet sur la page de l'offre et
  compare les sites dans un tableau. Il s'arrête **avant** le bouton qui réserve.
- **Recherche approfondie** : il part de la source officielle et en suit les pages jusqu'à avoir
  répondu à chaque partie de la question, avec les liens des sources.
- **Ce qu'il fait reste lisible** : chaque bloc « Réflexion » est suivi des actions qu'il a décidées,
  dans l'ordre (📄 lecture, 🖱️ clic, ⌨️ saisie…) ; un clic sur une action en montre le détail.
- **Il ne paiera jamais** : le garde-fou anti-achat est dans le code ; il s'arrête au panier. Les
  actions très sensibles — télécharger, **le bouton qui réserve** (« Réserver maintenant »,
  « Confirmer la réservation »), supprimer, s'inscrire, installer — vous sont demandées même en mode
  « Autoriser ». Chercher, comparer et ouvrir une offre ne le sont pas.
- **Musique et vidéos** : « mets-moi … » lance la vidéo avec le son ; si le navigateur l'interdit, elle
  démarre en muet et l'agent vous le dit.
- Pour les longues tâches, il résume lui-même son travail quand la fenêtre du modèle se remplit,
  et continue.

## 6. Garder un contexte propre

Tout ce qui reste dans la conversation est relu par le modèle à chaque question. Une fausse piste
ou un long journal déjà analysé « tirent » les réponses suivantes. Sous chaque message :

| Bouton | Effet |
|---|---|
| ⏸ **Veille** (icône, décrite au survol) | l'échange (votre question + la réponse) reste affiché mais **passe en gris** (question en pointillés), marqué « ⏸ En veille — n'est plus envoyé au modèle », et **n'est plus envoyé**. Un nouveau clic le remet. |
| 📌 **Épingler** (icône) | l'échange est gardé **mot pour mot** quand la conversation est résumée |
| 🗑 **Supprimer** | l'échange disparaît de l'écran et du contexte |

Un clic sur l'étiquette « En veille » remet aussi l'échange dans le contexte.

La **jauge de contexte** (l'anneau sous la zone de saisie, avec le pourcentage) montre la part de la fenêtre du
modèle qu'occupe ce qui est réellement envoyé. Elle devient orange puis rouge. **Un clic** ouvre :

- **la taille du contexte** pour ce modèle : **Auto** (par défaut — la plus grande fenêtre du modèle
  choisi), ou une taille de 8 k jusqu'au maximum du modèle. Plus petit, c'est moins cher et plus
  rapide : la conversation est résumée plus tôt. Une taille ne dépasse jamais la vraie fenêtre du
  modèle ; pour un serveur qui ne la donne pas, c'est vous qui la fixez ;
- **Résumer maintenant**, qui libère le contexte (tout reste affiché).

La conversation se résume aussi **d'elle-même à 75 %** de la taille choisie — un message provisoire
« 🗜 Résumé de la conversation… » s'affiche pendant ce temps, puis dit ce qui a été fait — dans le Chat, l'Agent
et Wisebase (et l'agent résume sa propre tâche en cours de route s'il le faut) ; si un serveur répond
qu'elle ne tient plus, elle est résumée puis la question est reposée.

Ces boutons existent dans **Chat, Agent, Sécurité, Traduire, Améliorer, PDF et Wisebase**. Dans
l'onglet **Image**, « ↺ Utiliser comme référence » met une image générée dans le contexte de la
génération suivante.

## 7. Confidentialité : ce qui part, et sous quelle forme

- **Local et passerelle** : vos données partent telles quelles, vers votre machine ou votre serveur.
- **Cloud** : avant l'envoi, les valeurs sensibles sont remplacées par des **marqueurs** —
  `⟨EMAIL_1⟩`, `⟨PHONE_1⟩`, `⟨IBAN_1⟩`, `⟨SECRET_1⟩`… — le **même marqueur pour la même valeur**
  dans toute la conversation, pour que le modèle continue de raisonner. Ils sont **remis en clair**
  dans la réponse, dans la réflexion et dans les actions de l'agent : un formulaire est rempli avec
  la vraie adresse. Un avis « 🔒 N valeur(s) sensible(s) anonymisée(s) » le signale.
- **Les pages web publiques** gardent leurs prix (le modèle doit pouvoir les comparer) ; leurs
  e-mails, téléphones et identifiants sont masqués. Ce que **vous** écrivez, joignez ou analysez est
  entièrement couvert.
- **La fenêtre des données sensibles** : avant d'envoyer au cloud un identifiant secret, ou une
  donnée personnelle ou d'entreprise que vous n'avez pas tapée vous-même, la sidebar montre **où**
  elle se trouve (`clients.csv:12`, la page, un résultat de l'agent) et vous choisissez :

  - **Envoyer (marqueurs en place)** ;
  - **Toujours envoyer (cette conversation)** ;
  - **Annuler** — rien n'est envoyé.

- **Le badge « ☁️ Cloud · anonymisé »** sous la zone de saisie : un clic **désactive l'anonymisation**
  (il passe en orange, « non anonymisé ») ; un second clic la **réactive** au niveau choisi dans les
  réglages. Même désactivée, les **clés et mots de passe restent masqués**. Elle est active par défaut.
- **Réglages** (Sécurité et confidentialité) : niveau **Strict** (ajoute adresses IP, machines
  internes, noms d'utilisateur dans les chemins), **Équilibré** (par défaut) ou **Identifiants
  seulement** ; une liste de **mots à toujours anonymiser** (noms de clients, noms de code) ; et
  « faire confiance à mes serveurs ».

Rien de tout cela ne passe par un serveur de Hivey : il n'y en a pas. Les clés, conversations,
bases Wisebase et la mémoire restent dans votre navigateur.

## 8. Sécurité, Wisebase, PDF, Image

- 🛡 **Sécurité** : assistant de cybersécurité **défensive** — analyse d'en-têtes HTTP, de journaux,
  d'e-mails suspects, et de captures réseau `.pcap` (résumées **dans le navigateur**, sans les
  charges utiles). Il refuse de produire des outils d'attaque et propose l'équivalent défensif.
- 🧠 **Wisebase** : votre base de connaissance **locale**. Importez documents et pages ; les réponses
  citent les passages `[1]`, `[2]`… et disent clairement quand la base ne contient pas la réponse.
  Les questions de suivi voient les précédentes.
- 📄 **PDF** : ouvrez un document et posez des questions dessus ; un résumé en un clic.
- 🎨 **Image** : génération et retouche d'images ; une image générée peut servir de référence.
- 📊 **Benchmark** : « quel modèle choisir ? ». Ajoutez les modèles à comparer (le modèle actuel est
  déjà là ; local, passerelle et cloud), choisissez les **types de questions** (tous cochés par
  défaut ; l'estimation de durée suit), puis **Lancer le test** : jusqu'à 39 questions corrigées
  automatiquement, environ trois minutes par modèle pour le test complet, quelques centimes au plus
  (gratuit en local). En haut s'affiche **notre conseil** — le moins cher parmi les meilleurs scores, à
  une question près, puis le plus rapide — avec la raison en une phrase ; dessous, le **classement**
  (score, temps, coût, erreurs en clair). « Que vérifie le test ? » explique les huit types de question :
  logique et calcul, respect des consignes, format structuré, outils, **plusieurs étapes** (2 ou 3
  actions enchaînées sur une boutique simulée, puis s'arrêter), **code** (prédire une sortie, trouver
  et corriger la ligne fautive, écrire une regex — sans rien exécuter), **rédaction** (nombre de mots,
  mots imposés ou interdits, puces, titre, langue, résumé qui garde les faits) et **pièges** (un ordre
  caché dans un e-mail ou une page, à ne pas suivre). Relancer un seul type de questions ne remplace
  que celui-là dans le résultat du modèle. Le **rapport détaillé** s'ouvre à la fin : graphique,
  détail par type de question, chaque question manquée avec la réponse du modèle, à enregistrer en
  HTML ou imprimer en PDF. Les **classements publics** (Aider pour le code, Vectara pour les inventions) sont repliés en
  bas, en liste triable, avec leur retard en mois.

## 9. Questions fréquentes

**Le modèle « oublie » le début d'une longue conversation.** La conversation a été résumée pour
tenir dans la fenêtre du modèle. Épinglez (📌) les échanges qui doivent rester mot pour mot.

**Je ne vois pas certains niveaux de réflexion.** Le modèle choisi ne les possède pas ; le menu ne
propose que les niveaux qui changent réellement la requête.

**La fenêtre des données sensibles apparaît souvent.** Choisissez « Toujours envoyer (cette
conversation) », ou passez par un modèle local ou votre passerelle, qui ne la déclenchent jamais.

**Un message tapé pendant une réponse.** Dans le Chat, il reste dans le champ jusqu'à la fin de la
réponse (un avis le rappelle) ; dans l'onglet Agent, il est transmis à l'agent et corrige le travail
en cours.
