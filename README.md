# Hivey AI — IA multi-fournisseurs pour Firefox & Chromium

![version](https://img.shields.io/badge/version-2.201.0-8b5cf6) ![MV3](https://img.shields.io/badge/manifest-v3-blue) ![licence](https://img.shields.io/badge/licence-MIT-green) [![CI](https://github.com/FlorianMartins/HiveyAI-Sidebar/actions/workflows/ci.yml/badge.svg)](https://github.com/FlorianMartins/HiveyAI-Sidebar/actions/workflows/ci.yml)

Une extension **open-source** qui ajoute une **sidebar IA** à la manière de
[sider.ai](https://sider.ai), mais où **vous branchez votre propre IA** (BYOK) et
qui **interagit réellement avec la page et les onglets** — ce que la sidebar native
de Firefox ne permet pas. Un équivalent libre n'existait pas.

**Aucun backend, aucune télémétrie, aucune clé fournie.** Tout (clés, conversations,
base de connaissance, embeddings) reste dans votre navigateur.

**Confidentialité d'abord** : vous choisissez où tourne le modèle — 🏠 **local** (rien ne sort),
🔒 **votre passerelle** (vos données restent chez vous) ou ☁️ **cloud** (les données sensibles sont
anonymisées avant l'envoi, puis remises en clair dans la réponse).

📖 **Nouveau venu ?** Le [guide d'utilisation](docs/GUIDE.md) part de zéro : installer, choisir son
modèle, réflexion, agent, contexte, confidentialité.

## 11 espaces de travail

Une **barre d'onglets** à gauche (façon « activity bar » de VS Code), ouverte par défaut (☰ la
masque, et le choix est gardé), donne accès à :

| Espace | Rôle |
|---|---|
| 💬 **Chat** | Conversation avec la page comme contexte, recherche web quand la question le demande, DeepSearch, artefacts |
| 🌐 **Web chats** | Gemini, Claude, ChatGPT, Copilot, Mistral, DeepSeek, Qwen, Kimi, Z.ai, HuggingFace **dans la sidebar, sans clé API** (votre session web) |
| 🤖 **Agent** | L'IA lit, navigue, clique, remplit — autorisations réglables + garde-fou anti-achat |
| 🌍 **Traduire** | Traduction d'un texte, de la page ou de la sélection ; langue choisie au-dessus du cadre (liste alphabétique, on tape pour y sauter) |
| ✨ **Améliorer** | Réécriture avec styles (Marketing, Newsletter, Email pro, LinkedIn, Tweet, Blog…) |
| 🎨 **Image** | Génération d'images (endpoint compatible OpenAI) |
| 📄 **PDF** | Lecture d'un document et questions dessus |
| 🛡 **Sécurité** | Assistant **cybersécurité défensive** — analyse de capture `.pcap` résumée localement |
| 🧠 **Wisebase** | **Base de connaissance locale + RAG**, embeddings calculés dans le navigateur ; « Créer ma première collection » quand elle est vide |
| 📊 **Benchmark** | **Testez vos modèles** (tout fournisseur connecté, local et passerelle compris) sur jusqu'à 39 questions notées automatiquement (logique, consignes, JSON, outils, plusieurs étapes, code, rédaction, pièges — au choix), avec un **rapport** qui s'ouvre tout seul ; classements **publiés** à côté, avec leur fraîcheur réelle |
| `</>` **Code** | Atelier d'app IA complet (aperçu live, terminal, QR Expo Go) |

## Fonctionnalités

- 🔒 **Confidentialité d'abord — local, passerelle ou cloud** : les fournisseurs sont rangés du plus
  privé au moins privé. Avant toute requête vers un modèle **cloud**, identifiants secrets, e-mails,
  téléphones, IBAN, cartes, numéros d'entreprise, noms de sociétés et vos propres termes deviennent
  des marqueurs (`⟨EMAIL_1⟩`…), constants dans la conversation, **remis en clair** dans la réponse,
  la réflexion et les actions de l'agent — automatiquement, sans rien demander. **Anonymisation
  désactivée**, une **fenêtre des données sensibles** montre où se trouve chaque clé ou mot de passe
  (fichier et ligne, page) avant l'envoi : *Envoyer* / *Toujours envoyer (cette conversation)* /
  *Annuler*. Votre machine et votre passerelle reçoivent vos données telles quelles.
- 🧠 **Les vrais niveaux de réflexion de chaque modèle** : Direct, Bref, Standard, Approfondi,
  Extrême, Maximum — seulement ceux que le modèle choisi possède, chacun envoyé comme son fournisseur
  le documente (table reprise de [Hivey Code](https://github.com/FlorianMartins/hivey-vscode)).
- 📏 **Aucune limite manuelle** : ni plafond de longueur de réponse, ni nombre d'étapes de l'agent, ni
  coupe fixe des pages lues — c'est la fenêtre réelle du modèle qui décide. La conversation est
  résumée d'elle-même à 75 % de cette fenêtre, et un serveur qui la refuse la voit résumée puis la
  question reposée.
- 🎛 **Un contexte maîtrisé, dans tous les onglets** : mettre un échange **en veille** (affiché mais
  plus envoyé), l'**épingler** (gardé mot pour mot dans les résumés), le **supprimer** ; une **jauge
  de contexte** cliquable pour résumer et libérer la fenêtre.
- 🐝 **Moteur Hivey — orchestration multi-modèles** (via OpenRouter) : au lieu de choisir un
  modèle, choisissez une **intention**. Trois variantes routent chaque message vers le meilleur
  modèle pour la tâche — un dispatcher bon marché classe la demande (code / raisonnement /
  recherche / maths / créatif / test / trivial), avec repli heuristique s'il échoue :
  - **🎁 Free** — les meilleurs modèles gratuits, avec rotation automatique quand l'un est limité ;
  - **⚡ Smart** — le plus précis pour le moins cher : **Sonnet 5.5** partout, **Opus 5.5** pour
    les raisonnements et les maths ;
  - **✨ Pro** — le plus puissant : **Fable 5.1** pour les raisonnements et les maths, **Opus 5.5**
    pour le chat, le code, l'agent et la rédaction, **Sonnet 5.5** pour la vision, la recherche et
    la vérification.

  La jauge de contexte affiche la plus petite fenêtre des modèles du préréglage. Le catalogue est
  **auto-curé quotidiennement**, sans version en dur.
- 🧠 **Wisebase (RAG 100% local)** : importez documents et pages dans des collections ;
  le texte est découpé, **vectorisé dans le navigateur** (transformers.js +
  onnxruntime WASM, modèle `all-MiniLM-L6-v2`) et stocké en **IndexedDB**. Les
  réponses citent vos sources. Rien n'est jamais téléversé ; désinstaller l'extension
  purge la base.
- 🌐 **Recherche web quand elle sert** : « Web » est activé par défaut dans le Chat, mais une
  règle gratuite décide si la question en a besoin (un lien, l'actualité, un prix, des horaires →
  recherche ; écrire, traduire, coder, calculer → non) et seuls les cas douteux posent une question
  oui/non d'un mot à un modèle économique. Le modèle choisi cherche lui-même quand son fournisseur le
  permet (OpenRouter, Anthropic) et cite ses sources.
- 🔎 **DeepSearch** : bascule de recherche web approfondie dans le chat, avec une
  **profondeur réglable** (rapide / standard / approfondie).
- 📚 **Prompt Library** : prompts prêts à l'emploi (rédaction, code, cybersec,
  marketing, productivité, apprentissage, business, data) + vos propres prompts,
  favoris et insertion en un clic.
- ⚡ **Skills & slash-commands** : `/skill` applique un prompt d'expert qui reste actif
  (chip) et rend **n'importe quel modèle** meilleur sur un domaine — pur prompt
  engineering côté client, donc compatible avec tous les fournisseurs.
- 📊 **Modèles classés par spécialité** : chaque espace trie sa liste de modèles selon
  un **index de qualité curé par catégorie** (les endpoints `/models` n'exposent aucun
  score) — le picker de l'onglet Image ne classe pas comme celui de l'onglet Code.
- ⌨️ **Raccourcis clavier configurables** (nouveau chat, zone de saisie, historique, recherche
  web, onglets, bibliothèque de prompts) : on clique, on appuie sur la combinaison ; Échap annule,
  Retour arrière désactive, ↺ rétablit ; conflits et combinaisons réservées au navigateur signalés.
- 🎛️ **Réglages clairs** : une colonne de cartes qui suit votre thème, de 360 px à l'écran large,
  et un **Accès rapide** d'interrupteurs (anonymisation, recherche web, suggestion, artefacts,
  vérification, compaction, mémoire, son, thème clair…) enregistrés aussitôt.
- 🔐 **Sauvegarde/synchro chiffrée** : export d'un blob **AES-256-GCM** (PBKDF2, 100k
  itérations) de vos réglages et clés, à transporter vers un autre appareil.
  Rien ne transite par un serveur — la synchro, c'est vous qui déplacez le fichier.
- 📤 **Export de conversation** (impression / PDF via le rendu natif du navigateur).
- 🎨 **Interface moderne & personnalisable** : **6 thèmes** (Dark, Hive, Modern, Neon,
  Sunset, Light) avec **personnalisation des couleurs par-dessus** (accent, fond,
  surface, texte) et une **pipette** pour capturer une couleur à l'écran.
- ✍️ **Une seule zone de saisie dans tous les onglets**, comme dans Hivey Code : le texte, puis
  `+` (joindre un fichier ; capturer une zone, choisir un élément, onglets ouverts, surveiller la
  page), micro, **la puce du modèle** avec l'icône de son fournisseur, **la puce de réflexion** (le
  niveau recommandé du modèle, retenu par modèle) et les options (Vérifier, DeepSearch, Web,
  Artifacts). Pas de bouton Envoyer : **Entrée** envoie, ■ arrête. Le cadre s'illumine pendant que
  le modèle répond ou agit. Sous le cadre : où tourne le modèle (🏠 / 🔒 / ☁️, cliquable pour
  l'anonymisation) et **la jauge de contexte** avec le coût de la conversation.
- 🔌 **Tous les fournisseurs** : **Claude**, **OpenAI**, **Gemini**, **Mistral**,
  **Groq**, **DeepSeek**, **xAI (Grok)**, **Perplexity**, **Together**, **Fireworks**,
  **DeepInfra**, **Cerebras**, **Cohere**, **OpenRouter**, et les **modèles locaux**
  **Ollama** / **LM Studio** (ou tout serveur compatible OpenAI via URL personnalisée).
- 📋 **Seulement les modèles disponibles** : la liste (unifiée, ouverte par la puce du
  modèle) n'affiche que les fournisseurs **connectés** (clé/compte/serveur local) et,
  pour chacun, les **modèles réellement accessibles** à votre clé (lus en direct via
  l'endpoint `/models`).
- 🔑 **Connexion par compte** : bouton **« Se connecter avec OpenRouter »** (OAuth
  PKCE — login Google / GitHub / email côté OpenRouter) qui débloque tous les
  modèles. Les autres fournisseurs utilisent une clé API (ils n'offrent pas d'OAuth).
- ⚖️ **Comparaison de modèles** : sur **la dernière réponse**, un bouton
  **« Comparer »** rejoue votre demande sur **un autre modèle**, directement dans le chat.
- 🧩 **Artifacts interactifs (façon Claude)**, **seulement quand vous le demandez** : demandez une
  app, un outil ou un **jeu** → l'IA renvoie un document HTML/JS (ou un composant **React/JSX**) ;
  une carte « Ouvrir dans un onglet » le lance en plein écran, isolé, où il est jouable. Les
  diagrammes **Mermaid** et le SVG s'affichent dans la réponse, aux couleurs du thème, avec zoom
  (− ⟲ +, Ctrl + molette, glisser pour se déplacer).
- 🕘 **Historique local** : vos conversations sont enregistrées **uniquement dans
  ce navigateur** (privacy) ; liste, rechargement, et « tout effacer ».
- 🌐 **Web chats sans clé API** : dix IA grand public (Gemini, Claude, ChatGPT,
  Copilot, Mistral, DeepSeek, Qwen, Kimi, Z.ai, HuggingFace) s'ouvrent **dans la
  sidebar**, via votre session web déjà connectée — utile quand vous n'avez pas de
  clé ou que votre abonnement est déjà payé. Claude y garde **son propre menu** (conversations
  passées, projets) et sa page de connexion ; un site qui refuse de s'afficher propose de s'ouvrir
  dans un onglet. Ces sites ne peuvent être intégrés que par l'extension, pas par une autre page.
- 🛡 **Espace Sécurité défensive** : assistant orienté défense, avec un parseur
  `.pcap` **côté client** qui ne produit qu'un **résumé anonymisé** (flux, top
  talkers/ports, mix protocolaire, heuristiques de scan TCP) — **jamais** les
  charges utiles. Seul ce résumé peut partir vers le modèle.
- 🌍 **Interface multilingue** : anglais, français, espagnol, allemand, italien,
  portugais (réglable dans les paramètres) — les six sont **complètes**, et un test
  échoue si une clé manque dans l'une d'elles.
- 👁 **L'IA voit la page, quand vous le voulez** : tapez `@` dans la zone de saisie → « Page
  actuelle » (ou un onglet ouvert), ou activez « L'IA voit la page courante » dans les réglages
  (désactivé par défaut). La page est alors relue **à chaque navigation** (changement de
  sous-domaine et navigations SPA compris) et donnée une fois par conversation.
- 📑 **Lecture multi-onglets** : cochez plusieurs onglets ouverts pour les donner
  comme contexte à l'IA (comparer, synthétiser, recouper).
- ⚡ **Actions rapides** + **clic droit** : Résumer / Traduire la **page** ou la
  **sélection**, Expliquer, Améliorer, **Rédiger une réponse**.
- 🔍 **Recherche dans la conversation**, **glisser-déposer** de fichiers, et dans le menu `+` un
  **outil de capture de zone** qui ajoute une capture d'écran de la page au contexte, ou **choisir
  un élément** (une capture de la zone et le texte des éléments, en une seule pièce jointe).
- 💭 **Réflexion** : le raisonnement du modèle (thinking adaptatif de Claude, `reasoning` d'OpenRouter,
  `reasoning_content` de DeepSeek et des serveurs llama.cpp) s'affiche dans un bloc replié par défaut, et
  **revient au modèle à l'étape suivante** — il reprend son raisonnement au lieu de tout recommencer.
- 🤖 **Espace Agent** (onglet dédié) : l'IA peut lire la page/les onglets, naviguer,
  cliquer, remplir des champs. **Sans limite d'étapes** : il s'arrête quand la tâche est finie, sur
  ■, ou quand il tourne en rond (la même lecture sans que rien n'ait changé — il écrit alors où il
  en est). Un message tapé pendant qu'il travaille **corrige sa trajectoire** à l'étape suivante.
  **Autorisations réglables** : *Autoriser* (par défaut —
  exécution automatique, mais les **actions sensibles** comme télécharger, réserver,
  supprimer, s'inscrire demandent quand même confirmation) ou *validation manuelle*
  (confirmation avant chaque action). Un **liseré lumineux** s'affiche sur la page
  pendant que l'agent travaille. Musique et vidéos : quand le navigateur n'autorise le son qu'après
  un clic sur la page (Firefox), la vidéo attend **en pause, son activé** — un seul clic la lance.
  Dans les deux cas, le **garde-fou anti-achat** s'applique : elle peut remplir un
  panier mais **ne peut jamais payer/commander**. Un **modèle d'agent** dédié est
  réglable (beaucoup de modèles rapides/gratuits ne savent pas appeler d'outils).
- 🔌 **MCP — vos services dans la conversation** : connectez des serveurs **MCP distants** et
  demandez en langage naturel (« retrouve la dernière facture », « crée une tâche »). Un catalogue
  de **plus de 70 services vérifiés**, classés et cherchables — Gmail, Google Agenda et Drive (serveurs
  officiels de Google, avec votre propre client OAuth), Zapier et Pipedream (des milliers d'applis),
  Slack, Notion, Jira/Confluence, Linear, Asana, ClickUp, Airtable, HubSpot, Attio, Stripe, PayPal,
  Supabase, GitLab, Sentry, PostHog, Canva, Webflow… — plus **n'importe quelle
  adresse** de serveur MCP. Connexion **OAuth 2.1** dans la fenêtre de connexion du navigateur
  (enregistrement automatique du client, PKCE), jetons gardés dans ce navigateur. **La lecture se fait
  seule ; tout outil qui envoie, crée, modifie ou supprime demande votre accord**, et ce que
  renvoient les outils (un e-mail, une page) est traité comme des données, jamais comme des ordres.
  Seuls les serveurs en ligne sont joignables (une extension ne peut pas lancer de programme local).
- 🛠 **Atelier Hivey Code** : un lien en bas de la barre des onglets ouvre, dans un **nouvel
  onglet**, le builder d'apps web & mobiles **HiveyCode** (`https://app.hivey.be` par défaut, URL
  configurable dans les réglages) — aperçu live, terminal, QR code Expo Go. *Pourquoi un onglet et
  pas une iframe ?* il s'appuie sur **WebContainers**, qui exigent l'isolation cross-origine
  (COOP/COEP) impossible dans une iframe d'extension.
- [x] **Wisebase** : base de connaissance locale + RAG, embeddings dans le navigateur
- [x] **DeepSearch**, **Prompt Library**, **Skills** en slash-commands
- [x] **Web chats sans clé API** (10 IA grand public dans la sidebar)
- [x] **Espace Sécurité défensive** + parseur `.pcap` anonymisant côté client
- [x] Lecture auto de la page à chaque navigation (sous-domaine, SPA) + multi-onglets
- [x] Espace agent avec autorisations réglables + garde-fou anti-achat
- [x] Onglet MCP : services distants (catalogue + adresse libre, OAuth), confirmation avant toute écriture
- [x] Atelier Hivey Code en nouvel onglet (preview, terminal, Expo Go), lié depuis la barre des onglets
- [x] Artifacts interactifs façon Claude (HTML/JS jouable, React/JSX)
- [x] Historique local, export de conversation, sauvegarde chiffrée, raccourcis configurables
- [x] 6 thèmes + couleurs personnalisées, interface en 6 langues
- [x] **Conformité magasins** : `addons-linter` **0 erreur / 0 note**, manifests Firefox
      et Chromium dédiés, périmètre `declarativeNetRequest` restreint, déclaration de
      collecte de données
- [ ] Soumission **AMO** (canal *listed*)
- [ ] Soumission **Chrome Web Store**
- [x] **Confidentialité d'abord** : local / passerelle / cloud, anonymisation et fenêtre des données sensibles
- [x] **Niveaux de réflexion propres à chaque modèle**, sans limite manuelle de longueur ni d'étapes
- [x] **Contexte maîtrisé** : veille, épingle, suppression par échange, jauge et résumé à la demande
- [x] **CI/CD** au niveau de Hivey Code + **banc chat + agent** comme condition de fusion

## Licence

MIT — voir [LICENSE](./LICENSE).

## Building

The extension ships hand-written, non-minified source (only `vendor/` holds unmodified third-party libraries). To reproduce the exact packages: `bash scripts/build.sh`. Verify the third-party libs with `bash scripts/fetch-vendor.sh --check`.
