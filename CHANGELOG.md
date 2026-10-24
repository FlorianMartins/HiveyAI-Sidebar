# Journal des modifications

Ce qui change pour vous, version après version. Les versions de développement (lien
permanent ci-dessous) reçoivent chaque modification dès qu'elle est poussée ; une entrée est
ajoutée ici à chaque changement visible.

Version de développement, toujours à jour :
- Firefox : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-firefox.zip>
- Chrome / Edge / Brave : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-chrome.zip>

## Prochaine version

### Chat, Sécurité et Wisebase : des réponses plus justes, sans brider les modèles

- **Les vrais niveaux de réflexion de chaque modèle** : le menu ne propose plus « Off / On / Max »
  pour tous, mais les niveaux que le modèle choisi possède réellement — Direct, Bref, Standard,
  Approfondi, Extrême, Maximum — et chacun est envoyé comme le fournisseur le documente (Claude,
  OpenAI, OpenRouter, Gemini, DeepSeek, Mistral, xAI, Groq, Perplexity, serveur personnel). Avant,
  « Off » laissait réfléchir les modèles qui réfléchissent par défaut, et « On / Max » se contentaient
  de demander au modèle d'écrire une balise `<think>` dans sa réponse.
- **Sans choix de votre part** : un modèle cloud garde son comportement par défaut (rien de plus
  facturé) ; sur votre serveur ou votre passerelle, c'est « Standard », plus rapide que le maximum
  qu'appliquait le modèle (Qwen 3.8), avec un budget de réflexion par niveau.
- **Plus aucune limite fixe de longueur** : les réponses ne sont plus coupées à 4 096 jetons (Claude)
  ou à une valeur devinée d'après le nom du modèle (OpenRouter) ; c'est la limite réelle du modèle qui
  s'applique, apprise de sa propre réponse quand l'API en exige une.
- **Le contexte suit la vraie fenêtre du modèle** : la conversation n'est plus résumée dès 28 000
  caractères quel que soit le modèle, mais à 75 % de la fenêtre réelle (catalogue, ou serveur
  interrogé directement) ; si le serveur répond que la conversation ne tient plus, elle est résumée
  et la question reposée, au lieu d'une erreur.
- **Réponse coupée, connexion réinitialisée** : une réponse interrompue en cours de route est
  complétée, une connexion coupée avant la réponse est relancée une fois.
- **La réflexion n'est plus perdue d'une étape à l'autre** (serveur personnel, DeepSeek, OpenRouter) :
  le modèle reprend son raisonnement au lieu de tout recommencer, et le cache du serveur tient d'une
  question à l'autre.
- **Moins cher avec Claude** : le cache de prompt d'Anthropic est utilisé sur les longues
  conversations (lecture à un dixième du prix).
- **Toujours dans votre langue** : la langue de votre question est nommée au modèle, dans vos propres
  mots, même après la lecture d'une page dans une autre langue.

### Fiabilité et sécurité du projet

- **Chaque modification est vérifiée automatiquement** avant d'être acceptée : les tests sur
  Node 20, 22 et 24 (Linux et Windows), l'analyse de Mozilla sur le paquet Firefox exact,
  l'empreinte des bibliothèques tierces, l'analyse de code CodeQL, la recherche de secrets et
  l'audit des workflows.
- **Paquets signés** : chaque paquet construit par la CI porte une attestation de provenance
  (`gh attestation verify <fichier> --repo FlorianMartins/HiveyAI-Sidebar`) et son empreinte
  SHA-256.
- **Lien de version de développement permanent** pour Firefox et Chromium, remplacé à chaque
  envoi, avec un numéro de version qui augmente à chaque fois.
- La mise à jour quotidienne du catalogue de modèles passe désormais par une demande de fusion
  vérifiée, au lieu d'écrire directement sur la branche principale.
- `npm test` fonctionne de nouveau sous Node 24.
- **Banc de qualité chat + agent** (`npm run bench`) : 27 tâches sur les onglets Chat, Agent,
  Sécurité et Wisebase, vérifiées par des faits (un chiffre, une langue, du code qui s'exécute, ce que
  l'agent a envoyé ou payé) sur un web simulé. Chaque amélioration du chat ou de l'agent doit faire au
  moins aussi bien que la version précédente avant d'être publiée.

## 2.201.0

État de départ de ce journal : 11 espaces (Chat, Web chats, Agent, Traduire, Améliorer, Image,
PDF, Sécurité, Wisebase, Benchmark, Code), moteur Hivey multi-modèles, mémoire locale
optionnelle, 6 langues d'interface.
