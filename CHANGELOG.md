# Journal des modifications

Ce qui change pour vous, version après version. Les versions de développement (lien
permanent ci-dessous) reçoivent chaque modification dès qu'elle est poussée ; une entrée est
ajoutée ici à chaque changement visible.

Version de développement, toujours à jour :
- Firefox : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-firefox.zip>
- Chrome / Edge / Brave : <https://github.com/FlorianMartins/HiveyAI-Sidebar/releases/download/dev/hivey-ai-sidebar-chrome.zip>

## Prochaine version

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

## 2.201.0

État de départ de ce journal : 11 espaces (Chat, Web chats, Agent, Traduire, Améliorer, Image,
PDF, Sécurité, Wisebase, Benchmark, Code), moteur Hivey multi-modèles, mémoire locale
optionnelle, 6 langues d'interface.
