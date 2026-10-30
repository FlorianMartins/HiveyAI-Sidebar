# Chrome Web Store — tout ce que demande la publication

Le bouton **« Envoyer pour examen »** reste grisé tant qu'un champ obligatoire manque dans **un des
onglets** — et tant que le brouillon n'est pas **enregistré**. En haut de la page, le lien
**« Pourquoi ne puis-je pas envoyer ? »** liste ce qui manque encore.

## Liste de contrôle

**Compte** (paramètres du compte développeur, pas la fiche) :
- adresse e-mail de contact **renseignée et vérifiée** (lien reçu par e-mail) ;
- statut **commerçant / non-commerçant** déclaré (obligation européenne) — ici, non-commerçant si
  l'extension est gratuite et sans activité commerciale.

**Fiche du Chrome Web Store** :
- description détaillée (textes ci-dessous, anglais ou français), catégorie (**Productivité** →
  « Outils »), langue (**English** si les captures sont en anglais) ;
- icône 128×128 : `icons/icon-128.png` ;
- au moins une capture d'écran **1280×800** : `docs/store/screenshot-1-1280x800.png` à
  `screenshot-5-1280x800.png` ;
- petite vignette promotionnelle **440×280** : `docs/store/promo-small-440x280.png` ;
- grande vignette 1400×560 (facultative) : `docs/store/promo-marquee-1400x560.png`.

**Pratiques en matière de confidentialité** : toutes les sections ci-dessous, puis **Enregistrer le
brouillon**.

**Distribution** : visibilité (Public ou Non répertorié), régions (toutes), et « gratuit ».

## Nom et description courte

Le nom vient du paquet (`name` de `manifest.chrome.json`) : **Hivey - AI Browser Assistant**. La
description courte aussi (`description`, 132 caractères au plus), en anglais comme la fiche :

```
AI assistant in your side panel: ask about any page, translate, summarise, create images, and a safe browser agent. Your keys.
```

## Description détaillée (fiche, en anglais)

Refusée le 2026-10-27 pour « spam dans les mots clés » (cas *Yellow Argon*) : la liste de
fournisseurs « Claude, OpenAI, Gemini, Mistral, Groq, DeepSeek, OpenRouter » a été vue comme du
bourrage de mots clés. Règle : **aucune liste de marques** (ni fournisseurs d'IA, ni services MCP),
on décrit ce que fait l'extension. Le nom d'OpenRouter n'apparaît qu'une fois, car c'est le bouton
de connexion de l'extension. Même règle pour les **captures et vignettes** (`docs/store/`) : leurs
légendes ne citent aucune marque. Limite du champ : 16 000 caractères (celle-ci en fait 5615).

```
Hivey is an AI assistant that lives in your browser's side panel, right next to the page you are reading. Ask about the page, translate a paragraph, summarise a PDF, let an agent fill in a form for you, or talk to the work tools you use every day — without copying and pasting between tabs, and without handing your data to yet another company.

Hivey has no server of its own. You bring the AI: your own API key, a free account, or a model running on your own computer. Your keys, your conversations and your documents stay in your browser.


★ GET STARTED IN ONE CLICK

• No key yet? Sign in with OpenRouter and start right away with free models.
• Already pay for an AI service? Paste your API key and use the models you already have.
• Want nothing to leave your machine? Point Hivey at a model running on your computer or on your own server.
• Not sure which model to pick? Choose an intention instead — Free, Smart or Pro — and Hivey sends each request to the model best suited to it: a strong reasoning model for a hard problem, a fast one for a quick question, a good coder for code.


★ THE PAGE IN CONTEXT

• Ask about the page you are on: type @ to add the current page or any open tab.
• Select several tabs to compare, cross-check or summarise them together.
• Capture an area of the screen or pick an element of the page, and ask about it.
• Open a PDF and ask questions about it, page after page.
• Right-click any selection, page, link or image: summarise, explain, translate, improve, draft a reply.


★ WRITE, TRANSLATE, IMPROVE

• Translate a text, a selection or a whole page into the language of your choice.
• Rewrite in the right tone: professional email, newsletter, blog post, social post, marketing copy — or simply fix the grammar.
• A prompt library ready to use (writing, code, marketing, productivity, learning, data), plus your own prompts and favourites.
• Slash-command skills that turn any model into a specialist for the task at hand.


★ AN AGENT THAT ACTS FOR YOU — SAFELY

• Describe a task in plain words: the agent opens pages, reads them, clicks, scrolls and fills in forms in its own tab.
• You stay in control: sensitive actions (downloading, booking, deleting, signing up) always wait for your approval, and a refusal stops the run.
• A built-in purchase guard: the agent can fill a cart, but it can never pay or place an order.
• Change its course at any time by typing while it works; stop it with one click.
• It searches the web only when the task needs it, so you do not pay for searches it does not use.


★ YOUR SERVICES IN THE CONVERSATION (MCP)

• Connect remote services through the Model Context Protocol (MCP) — from a catalogue of more than 70 verified services, or any server address — and ask in plain words: "find the last invoice", "create a task for tomorrow".
• Secure sign-in in the browser's own window (OAuth 2.1), tokens kept in your browser.
• Reading happens on its own; anything that sends, creates, changes or deletes asks you first.
• What a service returns is treated as data, never as orders.


★ SEARCH THE WEB WHEN IT HELPS

• With Web on, the model asks itself whether it really knows the answer and whether it may have changed — news, prices, game metas, versions, opening hours — and searches the web when it is not sure, citing its sources. What it knows well is answered directly, which keeps costs down.
• DeepSearch: multi-step research with an adjustable depth, for questions that deserve a real report.


★ WISEBASE — YOUR OWN KNOWLEDGE BASE

• Import documents and pages into collections; they are indexed inside your browser and never uploaded.
• Answers cite the passages they come from.


★ MORE TOOLS

• Images: generate images from a description, or from a picture you attach.
• Interactive artifacts: ask for a small app, a calculator or a game and run it in its own isolated tab.
• Diagrams drawn in the answer, with zoom.
• Compare: replay your last request on another model, right in the conversation.
• Benchmark: test the models you have connected on scored questions (logic, instructions, JSON, tools, code, writing) and get a report.
• Defensive security workspace: analyse a network capture summarised locally — only a summary, never the content, can reach the model.
• Watch a page and get a notification when it changes.
• Dictation with the microphone.


★ PRIVACY FIRST

• No server, no analytics, no telemetry, no tracking.
• Your keys, history, documents and settings stay in your browser; your messages go only to the AI service you chose, when you ask.
• Before a request leaves for a cloud model, the sensitive values of the files you attach — e-mail addresses, phone numbers, IBANs, card numbers, company names, credentials and terms you list — are replaced with markers and put back in the answer on your device; keys and passwords are masked wherever they are.
• Each request shows its cost, side requests included, so there are no surprises on your bill.
• Encrypted backup (AES-256) of your settings, to move them to another device yourself.


★ MADE TO FEEL RIGHT

• One message box in every workspace, the model and its thinking level one click away.
• Thinking levels that match what each model actually supports.
• Context under control: pause, pin or remove any exchange; long conversations are summarised automatically before they overflow.
• Six themes plus your own colours, configurable keyboard shortcuts.
• Interface in English, French, Spanish, German, Italian and Portuguese.


★ OPEN SOURCE

Hivey is free and open source (MIT licence). Read the code, report an issue or suggest an idea:
https://github.com/FlorianMartins/HiveyAI-Sidebar

Privacy policy: https://florianmartins.github.io/HiveyAI-Sidebar/privacy-policy.html
```

## Description détaillée (fiche, en français)

```
Hivey est un assistant IA qui vit dans le panneau latéral de votre navigateur, juste à côté de la page que vous lisez. Posez une question sur la page, traduisez un paragraphe, résumez un PDF, laissez un agent remplir un formulaire à votre place, ou parlez aux outils de travail que vous utilisez chaque jour — sans copier-coller entre les onglets, et sans confier vos données à une entreprise de plus.

Hivey n'a aucun serveur. C'est vous qui apportez l'IA : votre propre clé d'API, un compte gratuit, ou un modèle qui tourne sur votre ordinateur. Vos clés, vos conversations et vos documents restent dans votre navigateur.


★ DÉMARRER EN UN CLIC

• Pas encore de clé ? Connectez-vous avec OpenRouter et commencez tout de suite avec des modèles gratuits.
• Vous payez déjà un service d'IA ? Collez votre clé d'API et utilisez les modèles que vous avez déjà.
• Vous ne voulez rien laisser sortir de votre machine ? Branchez Hivey sur un modèle installé sur votre ordinateur ou sur votre propre serveur.
• Vous ne savez pas quel modèle choisir ? Choisissez plutôt une intention — Free, Smart ou Pro — et Hivey envoie chaque demande au modèle qui lui convient le mieux : un modèle de raisonnement pour un problème difficile, un modèle rapide pour une question simple, un bon codeur pour le code.


★ LA PAGE EN CONTEXTE

• Posez une question sur la page ouverte : tapez @ pour ajouter la page courante ou n'importe quel onglet.
• Cochez plusieurs onglets pour les comparer, les recouper ou les résumer ensemble.
• Capturez une zone de l'écran ou choisissez un élément de la page, et posez votre question.
• Ouvrez un PDF et interrogez-le, page après page.
• Clic droit sur une sélection, une page, un lien ou une image : résumer, expliquer, traduire, améliorer, rédiger une réponse.


★ ÉCRIRE, TRADUIRE, AMÉLIORER

• Traduisez un texte, une sélection ou une page entière dans la langue de votre choix.
• Réécrivez sur le bon ton : e-mail professionnel, newsletter, article de blog, publication sur les réseaux, texte marketing — ou corrigez simplement la grammaire.
• Une bibliothèque de prompts prête à l'emploi (rédaction, code, marketing, productivité, apprentissage, données), plus vos propres prompts et favoris.
• Des compétences en commandes « / » qui font de n'importe quel modèle un spécialiste de la tâche.


★ UN AGENT QUI AGIT POUR VOUS — EN SÉCURITÉ

• Décrivez une tâche en langage courant : l'agent ouvre des pages, les lit, clique, fait défiler et remplit des formulaires dans son propre onglet.
• Vous gardez la main : les actions sensibles (télécharger, réserver, supprimer, s'inscrire) attendent toujours votre accord, et un refus arrête tout.
• Un garde-fou anti-achat intégré : l'agent peut remplir un panier, mais il ne peut jamais payer ni passer commande.
• Corrigez sa trajectoire à tout moment en écrivant pendant qu'il travaille ; arrêtez-le d'un clic.
• Il ne cherche sur le web que lorsque la tâche le demande : vous ne payez pas de recherches inutiles.


★ VOS SERVICES DANS LA CONVERSATION (MCP)

• Connectez des services distants par le Model Context Protocol (MCP) — parmi un catalogue de plus de 70 services vérifiés, ou n'importe quelle adresse de serveur — et demandez en langage courant : « retrouve la dernière facture », « crée une tâche pour demain ».
• Connexion sécurisée dans la fenêtre du navigateur (OAuth 2.1), jetons gardés dans votre navigateur.
• La lecture se fait seule ; tout ce qui envoie, crée, modifie ou supprime vous est d'abord demandé.
• Ce que renvoie un service est traité comme des données, jamais comme des ordres.


★ LE WEB QUAND IL SERT

• Avec « Web » activé, le modèle se demande s'il connaît vraiment la réponse et si elle a pu changer — actualité, prix, méta d'un jeu, versions, horaires — et cherche sur le web quand il n'est pas sûr, en citant ses sources. Ce qu'il sait bien reçoit une réponse directe, ce qui limite les coûts.
• DeepSearch : une recherche en plusieurs étapes, à la profondeur réglable, pour les questions qui méritent un vrai rapport.


★ WISEBASE — VOTRE BASE DE CONNAISSANCE

• Importez documents et pages dans des collections ; ils sont indexés dans votre navigateur et jamais envoyés.
• Les réponses citent les passages d'où elles viennent.


★ ET AUSSI

• Images : créez des images à partir d'une description, ou d'une image que vous joignez.
• Artifacts interactifs : demandez une petite application, un calculateur ou un jeu, et lancez-le dans son propre onglet isolé.
• Des diagrammes dessinés dans la réponse, avec zoom.
• Comparer : rejouez votre dernière demande sur un autre modèle, directement dans la conversation.
• Benchmark : testez vos modèles connectés sur des questions notées (logique, consignes, JSON, outils, code, rédaction) et obtenez un rapport.
• Espace sécurité défensive : analysez une capture réseau résumée localement — seul un résumé, jamais le contenu, peut partir vers le modèle.
• Surveillez une page et soyez prévenu quand elle change.
• Dictée au micro.


★ LA CONFIDENTIALITÉ D'ABORD

• Aucun serveur, aucune statistique, aucune télémétrie, aucun pistage.
• Vos clés, votre historique, vos documents et vos réglages restent dans votre navigateur ; vos messages ne partent que vers le service d'IA que vous avez choisi, quand vous le demandez.
• Avant qu'une requête parte vers un modèle cloud, les valeurs sensibles des fichiers que vous joignez — adresses e-mail, téléphones, IBAN, numéros de carte, noms de sociétés, identifiants et les termes que vous listez — sont remplacées par des marqueurs, puis remises en clair dans la réponse, sur votre appareil ; les clés et mots de passe sont masqués où qu'ils soient.
• Chaque réponse affiche son coût, requêtes annexes comprises : pas de surprise sur votre facture.
• Sauvegarde chiffrée (AES-256) de vos réglages, à transférer vous-même vers un autre appareil.


★ AGRÉABLE AU QUOTIDIEN

• Une seule zone de saisie dans tous les espaces, le modèle et son niveau de réflexion à un clic.
• Des niveaux de réflexion fidèles à ce que chaque modèle sait faire.
• Un contexte maîtrisé : mettez en veille, épinglez ou supprimez n'importe quel échange ; les longues conversations sont résumées automatiquement avant de déborder.
• Six thèmes plus vos propres couleurs, des raccourcis clavier configurables.
• Interface en français, anglais, espagnol, allemand, italien et portugais.


★ OPEN SOURCE

Hivey est gratuit et open source (licence MIT). Lisez le code, signalez un problème ou proposez une idée :
https://github.com/FlorianMartins/HiveyAI-Sidebar

Politique de confidentialité : https://florianmartins.github.io/HiveyAI-Sidebar/privacy-policy.html
```

# Pratiques en matière de confidentialité

Réponses à copier dans l'onglet **Pratiques en matière de confidentialité** de la fiche (Chrome Web
Store, tableau de bord développeur). Les textes à coller sont en anglais, la langue des réviseurs ;
chacun correspond à ce que fait réellement le code (fichiers cités entre parenthèses).

Autorisations de `manifest.chrome.json` : `storage`, `tabs`, `activeTab`, `scripting`,
`contextMenus`, `clipboardWrite`, `identity`, `sidePanel`, `declarativeNetRequest`, `alarms`,
`notifications`, et les hôtes `<all_urls>` (plus les API des fournisseurs d'IA).

## Objectif unique (« Single purpose »)

```
Hivey AI is an AI assistant in the browser's side panel: the user chats with the AI model of their choice (with their own API key, an OpenRouter account, a model on their own computer or server) about the web page they are on, and can let it act in the browser on their request (translate, summarise, fill a form, open a page). Everything the extension does serves this conversation with the user's chosen AI.
```

## Justification des autorisations

**activeTab**
```
When the user invokes the assistant on the current page (context-menu action, keyboard shortcut, side-panel button), the extension reads that tab's content or selection so the AI can answer about it. Nothing is read unless the user asks.
```

**alarms**
```
Used by the optional "Watch this page" feature: a periodic alarm wakes the background service worker to check whether a page the user chose to watch has changed (src/background/background.js, src/lib/bg-lifetime.js).
```

**clipboardWrite**
```
"Copy" buttons let the user copy an AI answer, a code block or a translation (side panel and the result bubble shown on the page).
```

**contextMenus**
```
Adds right-click actions that send the selection, page, image, link or PDF to the assistant: summarise, explain, translate, improve, reply, security analysis, capture an area.
```

**declarativeNetRequest**
```
The side panel has a "Web chats" tab where the user can open their own accounts on AI chat websites (Gemini, Claude, ChatGPT, Mistral…). Those sites refuse to be framed, so a session rule removes their frame-blocking headers ONLY for frames whose initiator is the extension itself (initiatorDomains), never for normal browsing (src/lib/frame-unblock.js).
```

**identity**
```
Used for OAuth sign-in in a browser window (launchWebAuthFlow with PKCE): to connect an OpenRouter account instead of pasting a key, and to connect the services the user adds in the MCP tab (Notion, Linear, Zapier…). No Google account data is requested.
```

**notifications**
```
Tells the user that a page they asked to watch ("Watch this page") has changed. Clicking the notification opens that page.
```

**scripting**
```
Injects the extension's own bundled content script into a tab when it is not already present (pages opened before installation, the tab the AI agent works in), to read the page the user asks about and perform the actions the user asked the agent to do (click, fill, scroll). Only files from the extension package are injected.
```

**sidePanel**
```
The whole user interface (chat, translation, agent, settings shortcuts) lives in the browser's side panel.
```

**storage**
```
Stores the user's settings, their API keys and connected services (locally, in the browser only), and their conversation history on their own computer.
```

**tabs**
```
Lets the user add other open tabs to the conversation (titles and URLs listed, content read only for the tabs they select), keeps the assistant aware of the active page, and lets the AI agent open and use its own tab when the user gives it a task.
```

## Justification de l'autorisation d'hôte (« Host permission »)

```
The assistant works on whatever page the user is viewing, so it must be able to read that page and, in agent mode, act on it at the user's request: the sites cannot be known in advance (<all_urls>). The same permission lets the extension call the AI provider APIs the user configures (OpenAI, Anthropic, Google, Mistral, OpenRouter… or the user's own server at any address) and the MCP servers the user connects. Content is only sent to the AI service the user chose, when they ask.
```

## Code distant (« Remote code »)

Réponse : **Non, je n'utilise pas de code distant.**

Si un champ de justification s'affiche malgré tout :
```
No remote code is executed by the extension. All JavaScript and WebAssembly (including the ONNX runtime used for local embeddings) are included in the package. The only files downloaded at runtime are data: the AI providers' API responses and, for the optional local knowledge base, the weights of an embedding model from Hugging Face (data, not code). Interactive "artifacts" generated by the AI are displayed in a sandboxed iframe of a web page (hivey.be), outside the extension's context, with no access to the extension.
```

## Utilisation des données (cases à cocher)

Données à déclarer : celles qui quittent l'appareil vers le service d'IA que l'utilisateur a choisi.

- **Informations permettant d'identifier personnellement l'utilisateur** — ce que l'utilisateur écrit
  ou joint peut en contenir (nom, adresse e-mail) ; en mode « Cloud · anonymisé », celles des
  fichiers joints sont remplacées par des marqueurs avant l'envoi.
- **Informations d'authentification** — les clés d'API et les jetons de connexion, gardés dans le
  navigateur et envoyés uniquement au fournisseur auquel ils appartiennent.
- **Communications personnelles** — les messages de l'utilisateur, et les e-mails ou messages que lit
  un service MCP qu'il a connecté (Gmail via Zapier…).
- **Localisation** — la langue du navigateur et le fuseau horaire, envoyés à l'agent pour proposer
  des services disponibles dans la région de l'utilisateur (aucune position GPS ni adresse IP).
- **Contenu du site Web** — le texte de la page, de la sélection ou des onglets que l'utilisateur
  envoie à l'IA.

Ne pas cocher : santé, informations financières et de paiement, historique Web, activité de
l'utilisateur.

Puis cocher les trois certifications :
- « Je ne vends ni ne transfère les données des utilisateurs à des tiers, en dehors des cas
  d'utilisation approuvés » ;
- « Je n'utilise ni ne transfère les données des utilisateurs à des fins sans rapport avec l'objectif
  unique de mon article » ;
- « Je n'utilise ni ne transfère les données des utilisateurs pour déterminer leur solvabilité ou
  pour accorder des prêts ».

Elles sont exactes : l'extension n'a pas de serveur, ni statistiques ni télémétrie ; les données ne
vont qu'au service d'IA choisi par l'utilisateur, à sa demande.

**URL des règles de confidentialité** : celle où est publié `privacy-policy.html` (à la racine du
dépôt).
