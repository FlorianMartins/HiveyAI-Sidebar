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

## Description détaillée (fiche, en anglais)

```
Hivey AI puts the AI of your choice in Chrome's side panel, next to every page.

• Your providers, your keys: Claude, OpenAI, Gemini, Mistral, Groq, DeepSeek, OpenRouter (with free models), a local model (Ollama, LM Studio) or your own server.
• The page in context: ask about the page, a selection, several tabs or a PDF.
• Translate, summarise, explain, improve a text — from a right-click.
• An agent that acts in the browser on request (open, click, fill in); every sensitive action waits for your approval, and a refusal stops it.
• MCP services: connect Notion, Jira, Linear, Gmail via Zapier… and talk to them in plain words.
• Wisebase: your own knowledge base, indexed in the browser, with answers that cite their sources.
• Images, interactive artifacts, diagrams, model comparison, benchmark.

Privacy first: no server, no telemetry. Your keys and history stay in your browser; your messages only go to the AI service you choose, and sensitive data is anonymised before the cloud.

Open source: https://github.com/FlorianMartins/HiveyAI-Sidebar
```

## Description détaillée (fiche, en français)

```
Hivey AI met l'IA de votre choix dans le panneau latéral de Chrome, à côté de chaque page.

• Vos fournisseurs, vos clés : Claude, OpenAI, Gemini, Mistral, Groq, DeepSeek, OpenRouter (avec des modèles gratuits), un modèle local (Ollama, LM Studio) ou votre propre serveur.
• La page en contexte : posez une question sur la page, une sélection, plusieurs onglets ou un PDF.
• Traduire, résumer, expliquer, améliorer un texte — d'un clic droit.
• Un agent qui agit dans le navigateur à votre demande (ouvrir, cliquer, remplir) ; chaque action sensible attend votre accord, et un refus l'arrête.
• Services MCP : connectez Notion, Jira, Linear, Gmail via Zapier… et parlez-leur en langage naturel.
• Wisebase : votre base de connaissance indexée dans le navigateur, avec des réponses qui citent leurs sources.
• Images, artifacts interactifs, diagrammes, comparaison de modèles, banc d'essai.

Confidentialité d'abord : aucun serveur, aucune télémétrie. Vos clés et votre historique restent dans votre navigateur ; vos messages ne partent que vers le service d'IA que vous choisissez, et les données sensibles sont anonymisées avant le cloud.

Open source : https://github.com/FlorianMartins/HiveyAI-Sidebar
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
  peut en contenir (nom, adresse e-mail) ; en mode « Cloud · anonymisé », elles sont remplacées par
  des marqueurs avant l'envoi.
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
