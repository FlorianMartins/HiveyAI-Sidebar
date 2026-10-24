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

Le modèle se choisit ensuite dans la liste juste au-dessus du champ de saisie. Seuls les
fournisseurs connectés y apparaissent.

## 3. Le Chat : questions, page en contexte, recherche web

- **La page que vous regardez** est lue et donnée au modèle (une seule fois par conversation, pour
  ne pas la payer à chaque question). Le contenu d'une page est traité comme une **donnée**, jamais
  comme une instruction : une page qui écrit « ignore tes consignes » n'est pas obéie.
- **Recherche web** (bouton 🌐 des options) : un modèle capable de chercher sur le web répond avec
  ses sources. **DeepSearch** mène une recherche en plusieurs étapes, avec un rapport cité.
- **Pièces jointes** : glissez des fichiers, des images ou un PDF ; une case permet de laisser une
  pièce jointe hors du contexte sans la retirer.
- **La langue** : le modèle répond dans la langue de votre question, quelle qu'elle soit, même
  après avoir lu une page dans une autre langue.

## 4. Les niveaux de réflexion

Dans les options du champ de saisie, la ligne **Réflexion** propose **les niveaux que le modèle
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

La réflexion s'affiche dans un bloc « Réflexion » repliable au-dessus de la réponse.

## 5. L'Agent : il agit dans le navigateur

L'onglet 🤖 **Agent** lit les pages, navigue, clique, remplit des formulaires, compare des onglets.

- **Il travaille dans un onglet qui lui est dédié** : vous pouvez continuer à naviguer ailleurs.
- **Il va au bout** : pas de limite au nombre d'étapes. Il s'arrête quand la tâche est finie, quand
  vous appuyez sur ■, ou s'il tourne en rond (la même lecture refaite sans que rien n'ait changé) —
  il vous dit alors où il en est.
- **Corrigez-le en route** : tapez un message pendant qu'il travaille ; il le lit à l'étape
  suivante (« ↪ Transmis à l'agent »), sans devoir l'arrêter.
- **Il ne paiera jamais** : le garde-fou anti-achat est dans le code ; il s'arrête au panier. Les
  actions très sensibles (téléchargement, réservation, suppression, inscription) vous sont
  demandées même en mode « Autoriser ».
- Pour les longues tâches, il résume lui-même son travail quand la fenêtre du modèle se remplit,
  et continue.

## 6. Garder un contexte propre

Tout ce qui reste dans la conversation est relu par le modèle à chaque question. Une fausse piste
ou un long journal déjà analysé « tirent » les réponses suivantes. Au survol d'une bulle :

| Bouton | Effet |
|---|---|
| ⏸ **Mettre en veille** | l'échange (votre question + la réponse) reste affiché, grisé, marqué « Hors contexte », mais **n'est plus envoyé**. Un nouveau clic le remet. |
| 📌 **Épingler** | l'échange est gardé **mot pour mot** quand la conversation est résumée |
| 🗑 **Supprimer** | l'échange disparaît de l'écran et du contexte |

La **jauge de contexte** (petit anneau près du champ de saisie) montre la part de la fenêtre du
modèle qu'occupe ce qui est réellement envoyé. Elle devient orange puis rouge ; **un clic résume la
conversation** et libère le contexte (tout reste affiché). La conversation se résume aussi d'elle-même
à 75 % de la fenêtre, et si un serveur répond qu'elle ne tient plus, elle est résumée puis la
question est reposée.

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
