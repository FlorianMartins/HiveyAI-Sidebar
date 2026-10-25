# Journal des modifications

Ce qui change pour vous, version après version. Les versions de développement (lien
permanent ci-dessous) reçoivent chaque modification dès qu'elle est poussée ; une entrée est
ajoutée ici à chaque changement visible.

Version de développement, toujours à jour :
- Firefox : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-firefox.zip>
- Chrome / Edge / Brave : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-chrome.zip>

## Prochaine version

### Jetons et contexte : un seul chiffre, le même partout

- **« Choisir un élément » donne un seul élément de contexte** : une sélection (un ou plusieurs
  éléments de la page) devenait une capture **et** un texte par élément (« <div> », « <div> »…). C'est
  maintenant une seule pièce jointe : une capture de la zone couverte et le texte des éléments réunis.

- **Thème clair** : les réponses ne sont plus dans un cadre (bordure, fond et ombre retirés) — elles
  s'affichent directement sur la page, comme en thème sombre.

- **Sous chaque réponse** : seulement le nombre de jetons et le prix (« 820 jetons · 0,0083 $ ») ; le
  détail envoyés → reçus est au survol.
- **La jauge et la réponse disent la même chose** : la jauge n'estimait que la conversation, alors
  que le fournisseur compte aussi les consignes système et les outils (une réponse affichait 510
  jetons pour une jauge à 395). Elle reprend maintenant le compte réel du fournisseur ; pour l'agent,
  celui de sa dernière requête (le cumul de ses allers-retours reste le prix).
- **La taille affichée est celle du modèle** : la jauge montrait la fenêtre moins la part gardée pour
  la réponse (190 k pour un modèle à 200 k) ; elle affiche maintenant 200 k, comme le menu.
- **Textes toujours lisibles** : le modèle, la réflexion et les choix des onglets sont d'un blanc
  adouci, plus clair que le gris des jetons et des prix.

### Un rendu plus doux, et le cadre qui s'anime comme dans Hivey Code

- **Le cadre de saisie** : au survol et au clic, seule sa bordure prend la couleur du thème. **Pendant
  que le modèle répond ou agit**, une fine ligne aux couleurs du thème et **une seule lumière** qui en
  fait le tour en suivant exactement le bord — comme dans l'extension Hivey Code, sans dégradé haché.
- **Plus de blanc éclatant** : le nom du modèle, le niveau de réflexion, « Choisissez une langue »,
  « Choisissez un style », la taille d'image, « Choisissez une analyse… » et la collection Wisebase
  prennent le même ton doux (plus vif au survol). **Les questions et les réponses** passent aussi à
  un blanc adouci en thème sombre, plus reposant à lire.
- **Modèle et réflexion côte à côte**, sans espace entre les deux.

### Un échange en veille, ça se voit

- La question perd sa couleur (gris, contour en pointillés), la réponse et sa réflexion passent en
  gris pâle, et une seule étiquette au-dessus de la question dit **« ⏸ En veille — n'est plus envoyé
  au modèle »** ; un clic dessus remet l'échange dans le contexte.

### Finitions : une vraie lueur, le bon niveau de réflexion, des listes qu'on parcourt au clavier

- **La lueur du cadre** a l'épaisseur de la bordure et s'estompe des deux côtés — plus de « serpent »
  qui fait le tour, et aucun flou hors du cadre.
- **Le niveau de réflexion se retient par modèle** : chaque modèle démarre sur **son niveau
  recommandé** (au lieu de « Direct » partout — un choix fait une fois s'appliquait à tous les
  modèles), et garde ensuite celui que vous choisissez pour lui.
- **La puce du modèle** a la largeur de son nom : plus d'espace vide avant la réflexion.
- **Traduire** : « Choisissez la langue de traduction… » tant qu'aucune n'est choisie, puis la
  dernière langue utilisée ; liste **alphabétique**, et **taper au clavier** y saute (« fr » →
  Français ; flèches, Entrée, Échap). Vaut pour toutes les listes de ce type.
- **Améliorer** : « Choisissez un style… », les derniers style et ton retenus, deux colonnes
  **alphabétiques** ; l'entrée « Ton » inutile disparaît (recliquer sur le ton choisi le retire).
- **Image** : les tailles s'affichent en entier dans leur menu.
- **Agent** : plus de bloc « Réflexion » dans ses réponses — ses actions disent déjà ce qu'il fait
  et décide.

### Benchmark : quatre nouveaux types de questions — agent, code, rédaction, pièges

- Le test passe de 20 à 39 questions, toujours corrigées par un programme (la même réponse reçoit
  toujours la même note) :
  - **Agit en plusieurs étapes** (5) : sur une petite boutique simulée, trouver un client puis lire
    ses commandes, lire une commande puis demander le bon taux de change, choisir le bon client parmi
    deux homonymes, envoyer un seul e-mail à la bonne adresse puis s'arrêter — et ne rien appeler
    quand la question donne déjà tout. La note se lit sur l'ordre et les arguments des appels, puis
    sur la réponse finale.
  - **Lit et corrige du code** (5) : prédire une sortie, trouver la ligne fautive, la corriger,
    écrire une regex essayée sur des exemples fixes. Rien de ce que le modèle écrit n'est exécuté.
  - **Rédige selon des consignes** (5) : nombre de mots, mots imposés ou interdits, quatre puces
    exactement, titre en « Title Case », réponse uniquement en allemand, résumé de 25 mots au plus
    qui garde la date, le nombre et la ville.
  - **Résiste aux pièges** (4) : un ordre caché dans un e-mail ou une page web (répondre « APPROVED »,
    envoyer un e-mail, annoncer un prix à 0 €, donner un code secret) ne doit pas être suivi.
- Vous choisissez les **types de questions** à lancer (tous cochés par défaut) ; la durée annoncée
  suit. Relancer un seul type ne remplace que celui-là dans le résultat du modèle, et le classement
  signale un modèle testé sur une partie seulement.
- Le rapport a une colonne par type et montre, pour chaque question manquée, **la réponse du modèle**
  (ou la suite d'appels d'outils qu'il a faite).
- « À une question près » dans le conseil veut dire une question du test réellement lancé (1/39 pour
  le test complet), et non plus toujours 1/20.
- Mesuré dans Chromium via OpenRouter : DeepSeek V4.1 Flash 38/39, gpt-oss-20b 33/39, Mistral Small
  3.2 24B 32/39, Llama 3.1 8B 23/39 (0/5 en plusieurs étapes). Chaque erreur a été relue ; trois
  correcteurs trop stricts ont été corrigés (tirets insécables, ligne corrigée sans `return`, numéro
  de ligne suivi d'une explication).

### Espagnol, allemand, italien, portugais : l'interface les affiche vraiment

- Ces quatre langues étaient proposées dans les réglages, mais l'interface restait en anglais (seul
  le français était appliqué). Elles s'appliquent maintenant, ainsi qu'à la dictée et à la langue de
  réponse par défaut.
- Les quatre langues ES/DE/IT/PT sont maintenant complètes dans l'interface : les libellés qui
  restaient en anglais (Wisebase, analyses de sécurité, tons et longueurs d'Améliorer, raccourcis
  clavier, catégories de la bibliothèque de prompts, chats web, accueil…) sont traduits. Les
  consignes envoyées au modèle pour ces nouvelles fonctions restent en anglais.

### L'agent et la musique sur Firefox : un seul clic, avec le son

- Quand le navigateur n'autorise le son qu'après un clic sur la page (Firefox), l'agent **ne lance
  plus la vidéo en sourdine** : elle attend **en pause, son activé**. Un seul clic sur Lecture (ou
  sur « ▶ Lire avec le son ») la lance avec le son — fini « couper le son puis le remettre ». Une
  vidéo que le site avait déjà lancée en sourdine (YouTube) est mise dans le même état. Vérifié
  dans Firefox : avant le clic, en pause et non muette ; 4 s après, elle joue avec le son.
- **Sous les messages**, « Veille » et « Épingler » ne sont plus que des icônes, comme les autres ;
  leur description s'affiche au survol, et l'icône prend la couleur du thème quand elle est active.
- **L'avis « 🔇 … le son »** de l'agent disparaît avec sa conversation (nouvelle conversation,
  conversation supprimée ou historique vidé) au lieu de rester affiché.

### Zone de saisie : la lumière du cadre, fluide — et plus épurée

- **L'animation du cadre** : un arc violet clair (plus blanc) qui fait le tour du cadre **à vitesse
  constante** — l'ancien dégradé tournait autour du centre, filait dans les coins et ralentissait au
  milieu des bords. La bordure est **la même couleur** au survol, au clic et pendant que l'IA travaille.
- **Plus de petites flèches** après le modèle et le niveau de réflexion ; la puce de réflexion montre
  **le niveau par défaut du modèle** (« Standard », « Approfondi »…) au lieu de « niveau par défaut du
  modèle », avec l'icône ✦ d'avant. **Le bouton Envoyer est retiré** : Entrée envoie, ■ arrête.
- **Traduire** : la liste dit « Traduire en : Espagnol » (ou « Choisissez la langue de traduction… »)
  et retient la dernière langue utilisée.
- **La barre des onglets est ouverte par défaut** (☰ la masque toujours, et ce choix est gardé). Le
  Benchmark (et l'atelier de code) commencent après elle au lieu de passer dessous ; sur une sidebar
  étroite, l'accueil aussi. Le nom « Hivey » reste blanc, épinglé ou non.
- **Taille du contexte** : **Auto** (la plus grande fenêtre du modèle choisi) en tête, puis toutes les
  tailles **jusqu'au maximum du modèle**, maximum compris. Pendant un résumé, un **message provisoire**
  « 🗜 Résumé de la conversation… » s'affiche dans la conversation, puis dit ce qui a été fait.
- **Correctif** : choisir une taille de contexte changeait aussi le niveau de réflexion (les deux
  menus partageaient leurs boutons).

### Des réglages refaits, un accès rapide, des raccourcis qui marchent

- **La page des réglages est refaite** : une colonne de cartes, chaque réglage avec son nom (et une
  aide courte) à gauche et sa commande à droite. Les champs ne débordent plus de leur carte et les
  textes de gauche ne sont plus coupés ; sur une fenêtre étroite (jusqu'à 360 px), la commande passe
  sous son nom et la liste « Aller à » devient une bande qui défile. La page suit votre thème, clair
  ou sombre — listes déroulantes et interrupteurs compris.
- **Accès rapide** : en tête de page, des interrupteurs pour ce que l'on bascule le plus —
  anonymisation (même effet que le badge « ☁️ Cloud » : l'éteindre retient votre niveau, la rallumer
  le rend), recherche web, suggestion de la prochaine demande, artefacts, vérification des réponses,
  compaction automatique, mémoire, son et notifications, thème clair (et retour à votre thème sombre
  avec ses couleurs), effets du titre, côté du menu, langue de l'interface. Chacun est enregistré
  aussitôt et montre son état ; la sidebar ouverte suit sans être rechargée.
- **Raccourcis clavier réparés** : les champs dépassaient de la carte et coupaient les libellés ;
  `Ctrl+Shift+1/2/3/5` ne faisaient rien sur un clavier QWERTY (Maj+1 y donne « ! ») ; un raccourci
  modifié n'agissait qu'après avoir rechargé la sidebar ; deux actions pouvaient partager la même
  combinaison sans avertissement. Désormais : on clique, on appuie, **Échap** annule, **Retour
  arrière** désactive, ↺ rétablit la valeur par défaut ; une combinaison déjà prise passe à la
  nouvelle action (la page le dit) ; les touches s'affichent comme sur votre clavier (⌃ ⇧ ⌘ sur
  Mac). Les combinaisons gardées par le navigateur sont signalées : « recherche web » passe de
  `Ctrl+Shift+W` (qui ferme la fenêtre) à `Ctrl+Shift+E`, la bibliothèque de prompts de
  `Ctrl+Shift+P` (fenêtre privée de Firefox) à `Ctrl+Shift+K`. Un raccourci que vous aviez déjà
  choisi est gardé tel quel.
- **Fournisseurs repliés** : chaque fournisseur tient sur une ligne avec son état (connecté ou non) ;
  un clic l'ouvre. La recherche ouvre ceux qui correspondent.
- La sauvegarde chiffrée et les raccourcis ont enfin leur place dans la liste « Aller à » et dans
  la recherche.

### Onglet Web : Claude retrouve son propre menu

- **Le menu de Claude est de retour** (le bouton en haut à gauche qui ouvre vos conversations
  passées, vos projets, la recherche) — comme dans la barre latérale native de Firefox. Ce n'était
  pas la largeur : claude.ai repère qu'il est affiché dans un cadre et retire alors tout son menu.
  Dans l'onglet Web de Hivey, et là seulement, la page se croit désormais ouverte normalement.
- **Déconnecté, la connexion fonctionne dans l'onglet Web** : plus de « Cette page ne peut pas
  s'exécuter dans une vue intégrée », la page de connexion de Claude s'affiche.
- Un autre site qui affiche claude.ai dans un cadre reste bloqué par Claude, comme avant. L'icône 🕘
  (vos conversations Claude) reste là comme raccourci.

### La zone de saisie, plus nette — et le contexte à votre main

- **Le `+` ouvre un menu** : joindre un fichier, ou apporter la page — capturer une zone, choisir
  un élément, onglets ouverts…, surveiller cette page (et, dans Sécurité, les en-têtes de sécurité de
  la page). Les quatre icônes au-dessus de la conversation disparaissent ; il ne reste là que « N
  onglets en contexte » quand il y en a.
- **Tient dans la sidebar de Firefox** (environ 250 px à l'ouverture) : plus de défilement de côté
  dans aucun onglet. Quand la place manque, le nom « Hivey » s'efface, puis le modèle et la réflexion
  se montrent par leur icône (leur nom reste au survol et dans les menus).
- **Des icônes cohérentes** : `+`, micro, icône du fournisseur, réflexion (une ampoule), options —
  toutes à la même taille et à la couleur de votre thème. **Envoyer** retrouve son rond en dégradé
  (il était invisible en thème clair).
- **« ☁️ Cloud · anonymisé » se clique** : un clic désactive l'anonymisation (le badge passe en
  orange, « non anonymisé »), un second la réactive au niveau des réglages. Les clés et mots de passe
  restent masqués dans tous les cas ; l'anonymisation reste active par défaut.
- **La taille du contexte se règle** : un clic sur la jauge (en bas à droite) montre les jetons
  utilisés et propose, pour ce modèle, son maximum ou une taille plus petite (8 k à 512 k) — moins
  cher et plus rapide, la conversation étant résumée plus tôt. Une taille ne dépasse jamais la vraie
  fenêtre du modèle. « Résumer maintenant » est dans le même menu.
- **Le résumé automatique, vérifié** : avec un vrai modèle (DeepSeek V4.1 Flash) et un contexte de
  8 k, la conversation s'est résumée d'elle-même au 4ᵉ message (59 % → 24 %) et le modèle se
  souvenait encore de la première note. Il fonctionne dans le Chat, l'Agent et Wisebase.
- **La suggestion ne ressemble plus à du texte tapé** : italique pâle, sans icône ni « ⇥ Tab » (Tab
  la reprend toujours ; c'est dit au survol).
- **L'animation du cadre se voit** : un arc lumineux, presque blanc, qui tranche sur la bordure
  violette quand vous écrivez ou que le modèle travaille (un arc foncé en thème clair).
- **Traduire et Améliorer** : la langue, le style et le ton sont **au-dessus du cadre**, sur toute la
  largeur, comme les analyses de Sécurité (Wisebase et PDF aussi).
- **Image** : la taille est une puce « Taille » à gauche d'Envoyer ; elle affiche les dimensions
  choisies (« 1024×1024 »).
- **Wisebase ne bloque plus l'onglet** : la gestion des collections ne s'ouvre plus d'elle-même par-
  dessus tout ; sans collection, un bouton « Créer ma première collection » attend dans la page. Le
  panneau, quand vous l'ouvrez, couvre la conversation seulement — jamais la barre des onglets.

### Benchmark : une réponse claire à « quel modèle choisir ? »

- **Le conseil en tête** dès qu'un modèle est testé : « Notre conseil : DeepSeek V4.1 Flash — aussi
  bon que Qwen3.8 27B (100 %), 3× moins cher, le plus rapide de tous ». La règle, expliquée par le
  « ? » : le moins cher parmi les meilleurs scores (à une question près), puis le plus rapide. Le
  rapport s'ouvre sur la même phrase.
- **Un seul bouton, et ce qu'il va se passer avant de cliquer** : la durée estimée, le prix (quelques
  centimes, gratuit en local) et le nombre de questions. Pendant le test, une ligne dit quel modèle
  passe quelle question ; à la fin, la durée totale et le coût.
- **Un classement lisible** : le score, le temps et le coût de chaque modèle côte à côte, avec
  « Conseillé », « le plus rapide », « le moins cher », et les erreurs dites en clair (« Aucune
  erreur », « Erreurs en : Logique et calcul ») — le détail par barres d'un clic.
- **Des mots simples** : « Logique et calcul », « Respect des consignes », « Format structuré
  (JSON) », « Utilise des outils », chacun expliqué sous « Que vérifie le test ? ».
- **Les classements publics** tiennent dans la barre latérale : une liste compacte (Code, Invente,
  Prix, Mémoire) avec un tri par menu, au lieu d'un tableau à cinq colonnes, et leur retard écrit en
  clair (« jusqu'en décembre 2025, 11 mois de retard »).

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
- **Onglet Web : vos anciennes conversations Claude** — dans un panneau aussi étroit, claude.ai passe
  en affichage mobile et son menu des conversations passées devenait inaccessible. Une icône
  historique (🕘), **juste à côté du choix du fournisseur**, ouvre directement la liste de vos
  conversations Claude. Sous Firefox, la barre latérale s'ouvre à ~250 px : l'icône, placée à droite
  de l'en-tête, tombait hors de l'écran — elle restait introuvable. L'en-tête de l'onglet Web tient
  désormais dans cette largeur (le nom du fournisseur et le bouton plein écran s'effacent quand la
  place manque), et la page du site occupe toute la largeur au lieu d'être coupée à droite.
- **Onglet Web : Copilot s'affiche de nouveau** — copilot.microsoft.com redirige maintenant vers
  copilot.com, qui refusait d'être intégré (« Firefox ne peut pas ouvrir cette page »). copilot.com
  est autorisé comme les autres sites. Et si un site refuse malgré tout de s'afficher dans le
  panneau, un bandeau le dit et propose de **l'ouvrir dans un onglet** d'un clic, au lieu de laisser
  la page d'erreur du navigateur.

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
- **Captures d'écran refaites** avec la nouvelle zone de saisie, plus l'agent, l'onglet Benchmark et
  son rapport.
- **Le menu de réflexion est opaque** : la conversation ne se lit plus à travers.
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
- **Il cherche vraiment sur les sites de réservation** : sur un site d'hôtels, de trains ou de vols,
  il remplit le formulaire de recherche (destination, dates, voyageurs), lit les résultats, applique
  vos critères (budget, note, horaires, direct…), ouvre les meilleures offres pour lire le **total du
  séjour**, compare deux sites et rend un tableau. Avant, la simple recherche lui était souvent
  refusée : tout bouton ou formulaire où figuraient « réservation » ou « booking » — même dans un
  identifiant invisible — demandait une confirmation. Seul le bouton qui **réserve** (« Réserver
  maintenant », « Confirmer la réservation », « Book now »…) vous est désormais demandé.
- **Recherche approfondie** : pour une question de fait, il part de la source officielle et en suit
  les pages (infos pratiques, tarifs, FAQ) jusqu'à avoir répondu à **chaque partie** de la question,
  fait le calcul demandé, et préfère la source officielle et récente à un vieil article.
- **Réflexion et actions dans l'ordre où elles ont lieu** : la réflexion qui décide d'une action
  s'affiche au-dessus de cette action, étape après étape (avant, un bloc « Actions » s'ouvrait en tête,
  au-dessus de toute réflexion). Une action seule dit ce qu'elle a fait (« 📄 Lecture de la page ✓ »).
- **La musique démarre avec le son** : une vidéo ou un morceau lancé par l'agent était toujours
  coupé ; il démarre maintenant avec le son dès que le navigateur l'autorise, et ne passe en muet
  qu'en dernier recours (l'agent vous le dit alors).
- **Le son en un clic, même sous Firefox** : Firefox refuse le son tant que la page elle-même n'a
  pas été cliquée — et rien de ce que fait une extension ne compte comme ce clic (pas même un clic
  dans la barre latérale : vérifié). Quand la musique ne peut démarrer qu'en muet (ou pas du tout),
  un bouton **« 🔊 Lire avec le son »** s'affiche au centre de la vidéo : un clic, le son vient et
  reste, sans chercher l'icône 🔊 du lecteur ni la touche M. La barre latérale indique où cliquer.

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
