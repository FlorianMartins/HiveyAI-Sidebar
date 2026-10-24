# Journal des modifications

Ce qui change pour vous, version après version. Les versions de développement (lien
permanent ci-dessous) reçoivent chaque modification dès qu'elle est poussée ; une entrée est
ajoutée ici à chaque changement visible.

Version de développement, toujours à jour :
- Firefox : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-firefox.zip>
- Chrome / Edge / Brave : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-chrome.zip>

## Prochaine version

### Une zone de saisie unique, comme dans Hivey Code — avec le contexte et le coût

- **La même zone de saisie dans tous les onglets** : le texte, puis une rangée `+`, micro, **le
  modèle avec l'icône de son fournisseur**, **le niveau de réflexion** (menu des niveaux propres au
  modèle), les options et le bouton **Envoyer** (Stop pendant la réponse). Les réglages propres à un
  onglet (langue, style, taille d'image, collection…) sont des puces en haut du cadre. La barre de
  choix de modèle séparée disparaît.
- **Sous le cadre** : où tourne le modèle (🏠 Local, 🔒 Votre passerelle, ☁️ Cloud · anonymisé) et
  **le contexte rempli** — anneau, pourcentage, jetons utilisés sur la fenêtre du modèle — avec **le
  coût de la conversation** pour les modèles cloud. Un clic résume la conversation.
- **Le coût de chaque réponse**, sous la réponse : jetons envoyés → reçus, et le prix (exact quand
  OpenRouter le donne, sinon estimé d'après les prix publics, marqué « ≈ »). Gratuit en local.
- **Suggestion de la prochaine demande** : après une réponse, une suite proposée apparaît en grisé
  dans le champ ; **Tab** (ou →) la reprend. Désactivable dans les réglages.
- « **Veille** » et « **Épingler** » sont maintenant des boutons libellés sous chaque message (ils
  n'étaient que de petites icônes difficiles à trouver) ; l'étiquette « Hors contexte » d'un échange
  en veille le remet dans le contexte d'un clic.

### Interface : plus simple, et le local dès le premier lancement

- **Premier lancement** : « 🏠 Modèle local » trouve Ollama ou LM Studio sur votre machine et le
  sélectionne ; « 🔒 Ma passerelle / mon serveur » demande l'URL (et la clé si besoin), vérifie le
  serveur et choisit son premier modèle — à côté d'OpenRouter, plus derrière « autres fournisseurs ».
- **Défilement intelligent** : en bas, la conversation suit la réponse ; remontez pour lire, elle
  reste où vous êtes même pendant que le modèle écrit ; le bouton ↓ ou un retour en bas la fait suivre
  de nouveau. L'option « Défilement auto » disparaît.
- **La réflexion est repliée par défaut** : « Réflexion… » clignote pendant que le modèle réfléchit,
  un clic l'ouvre.
- L'action « Transformer en carte mentale / diagramme » est retirée.

### L'onglet Benchmark, enfin lisible — avec un rapport à la fin

- **Trois étapes, de haut en bas** : ① les modèles à tester (le modèle actuel est déjà là, « + Ajouter
  un modèle » ouvre la liste habituelle), un bouton **Lancer le test** et une barre de progression ;
  ② les résultats, une carte par modèle avec son score et une barre par famille (raisonnement,
  consignes, JSON, outils), le meilleur en tête ; ③ les classements publics, repliés, expliqués en
  clair (« Code : plus haut = mieux », « Invente : plus bas = mieux ») avec leur retard en mois.
- **Tous vos modèles se testent** : local, passerelle ou cloud — plus seulement OpenRouter. Gratuit
  sur votre machine ; le coût est affiché pour le cloud.
- **Un rapport s'ouvre tout seul à la fin du test** : qui choisir en une phrase (et le moins cher
  presque aussi bon), un graphique des scores, le détail par famille, le temps et le coût, et **chaque
  question manquée** avec la raison. Enregistrable en HTML ou imprimable en PDF.
- Le chat et la zone de saisie ne s'affichent plus sous le Benchmark, et un modèle qui réfléchit
  avant de répondre n'est plus coupé (la limite de 4 000 jetons du test est retirée).

### Documentation

- **Guide d'utilisation** complet ([docs/GUIDE.md](docs/GUIDE.md)) : installer, choisir entre local,
  passerelle et cloud, niveaux de réflexion, agent, contexte, confidentialité, chaque onglet.
- **Nouveautés dans les réglages** : un lien ouvre ce journal, inclus dans l'extension.
- README, modèle de menaces et politique de confidentialité à jour ; guide de contribution.
- **Chat** : un message tapé pendant qu'une réponse s'écrit n'est plus perdu — il reste dans le
  champ, avec un avis.

### Un contexte maîtrisé, dans tous les onglets

- **Mettre en veille un échange** (question + réponse) : il reste affiché, grisé et marqué « Hors
  contexte », mais n'est plus envoyé au modèle — une fausse piste, un long journal déjà analysé, une
  réponse hors sujet ne tirent plus les réponses suivantes. Un clic le remet dans le contexte.
- **Épingler un échange** : il est gardé mot pour mot quand la conversation est résumée.
- **Supprimer un échange** l'efface de l'écran et du contexte, question et réponse ensemble.
- **Jauge de contexte** à côté du champ de saisie : la part de la fenêtre du modèle choisi qu'occupe
  ce qui est réellement envoyé (les échanges en veille ne comptent pas) ; elle passe à l'orange puis
  au rouge, et **un clic résume la conversation** pour libérer le contexte, tout restant affiché.
- Disponible dans **Chat, Agent, Sécurité, Traduire, Améliorer, PDF et Wisebase** — qui devient
  multi-tours (une question de suivi voit les précédentes). Dans l'onglet **Image**, chaque image
  générée peut être **utilisée comme référence** de la génération suivante (et décochée pour la
  retirer).

### Confidentialité d'abord : local, passerelle ou cloud — et anonymisation avant le cloud

- **Trois façons d'utiliser un modèle, clairement séparées** dans les réglages : 🏠 **Local** (rien
  ne quitte votre machine), 🔒 **Passerelle / votre serveur** (vos données restent chez vous),
  ☁️ **Cloud** (les données sensibles sont anonymisées avant l'envoi). Le local et la passerelle
  sont présentés en premier.
- **Anonymisation automatique avant tout modèle cloud**, dans tous les onglets et pour toutes les
  requêtes (y compris les tâches annexes : titres, résumés…) : identifiants secrets, e-mails,
  téléphones, IBAN, cartes, numéros d'entreprise et de TVA, noms de sociétés, montants que vous
  écrivez, et vos propres termes (clients, noms de code) deviennent des marqueurs comme
  `⟨EMAIL_1⟩` — le même marqueur pour la même valeur dans toute la conversation, pour que le modèle
  continue de raisonner — puis sont **remis en clair** dans la réponse, la réflexion et les actions
  de l'agent (un formulaire est rempli avec la vraie adresse, pas avec son marqueur).
- **Sans perdre en qualité** : vos serveurs (local, passerelle) reçoivent vos données telles
  quelles ; sur une page web publique, les prix restent lisibles (le modèle peut comparer et
  additionner), seuls les identifiants et données personnelles sont masqués.
- **Fenêtre des données sensibles** : avant d'envoyer au cloud un identifiant secret, ou une donnée
  personnelle ou d'entreprise que vous n'avez pas tapée vous-même (une page, un fichier joint, un
  résultat), la sidebar vous montre **où** elle se trouve (fichier et ligne, page…) et vous
  choisissez : « Envoyer (marqueurs en place) », « Toujours envoyer (cette conversation) » ou
  « Annuler ». Une valeur acceptée n'est plus redemandée dans la conversation.
- **Réglages** (Sécurité et confidentialité) : niveau Strict / Équilibré (par défaut) / Identifiants
  seulement, mots à toujours anonymiser, et « faire confiance à mes serveurs ».

### Agent : il va au bout des tâches longues, et ne tourne plus en rond

- **Plus de limite de 24 étapes** : une tâche qui demande d'ouvrir et de lire douze pages va
  jusqu'au bout. Ce qui arrête l'agent, c'est la fin de la tâche, votre bouton Stop, ou une vraie
  boucle.
- **Les boucles sont repérées** : la même lecture refaite sans que la page ait changé n'est pas
  relancée (l'agent est invité à utiliser ce qu'il a déjà) ; s'il insiste, il s'arrête et vous écrit
  où il en est. Une réflexion qui se répète mot pour mot est interrompue et l'agent doit décider.
- **Il lit les pages en entier** : un résultat d'outil n'est plus coupé à 8 000 caractères, mais
  dimensionné à la fenêtre de contexte du modèle choisi.
- **Plus d'erreur « contexte plein » en pleine tâche** : les plus anciens résultats sont raccourcis,
  puis, si besoin, le travail déjà fait est résumé et l'agent continue.
- **Corrigez-le pendant qu'il travaille** : un message tapé pendant que l'agent agit lui est transmis
  à l'étape suivante, sans devoir l'arrêter (avant, il était perdu).
- **Toujours dans votre langue**, rappelée après chaque lecture de page.

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
