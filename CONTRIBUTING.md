# Contribuer à Hivey AI

## Démarrer

Le code de l'extension est écrit à la main, sans étape de build : `src/` est chargé tel quel par le
navigateur. Node (20 ou plus) ne sert qu'aux tests et aux scripts.

```sh
npm test                 # tous les tests (node:test, zéro dépendance)
bash scripts/build.sh    # paquets Firefox + Chromium (.zip)
```

Charger la version de travail : Firefox `about:debugging` → *Charger un module temporaire* →
`manifest.json` ; Chromium : `bash scripts/build-chrome.sh` puis *Charger l'extension non
empaquetée* sur `.build-chrome/`.

## Les règles

1. **Une PR par sujet**, jamais de poussée directe sur `main` (protégée : « CI complete », gitleaks
   et l'audit des workflows doivent être verts).
2. **Chaque changement visible a son entrée dans [CHANGELOG.md](CHANGELOG.md)**, en français, du
   point de vue de l'utilisateur : ce qu'il remarque, pourquoi, et l'effet mesuré quand il y en a un.
3. **Aucune régression mesurée** : une modification de ce que lit ou fait le modèle (prompts,
   fournisseurs, boucle d'agent, contexte) passe le banc avant et après, sur le même serveur au même
   moment, et n'est fusionnée que si le **total ne baisse pas** :

   ```sh
   node scripts/bench.mjs --root <copie de main> --as avant --url <serveur> --model <modèle>
   node scripts/bench.mjs --root <copie de la branche> --as apres --url <serveur> --model <modèle>
   ```

   Une fonctionnalité qui ne change rien à ce que le banc envoie (interface, anonymisation vers un
   cloud quand le banc tourne en local…) se valide par des tests ciblés et un essai réel.
4. **Aucune limite manuelle** : pas de `max_tokens` fixe, pas de plafond d'étapes, pas de coupe fixe
   du contexte — on s'adapte aux limites réelles du modèle (`conversation.js`, `agent-guards.js`).
5. **La confidentialité ne se négocie pas dans un prompt** : ce qui protège (anti-achat, séparation
   du contenu non fiable, anonymisation) est du code, testé.
6. **Les chiffres de la doc sont vérifiés** (`npm run check:numbers`, `--fix` pour les réécrire) et
   toute nouvelle chaîne d'interface existe dans les **six langues** (un test l'impose).

## Ce que fait la CI

Tests sur Node 20, 22 et 24 (Linux + Windows), chiffres de la doc, empreinte SHA-256 des
bibliothèques de `vendor/`, catalogue de modèles, paquets Firefox et Chromium, `web-ext lint` sur le
paquet exact, empreinte + attestation de provenance des paquets, CodeQL, gitleaks, actionlint +
zizmor. Chaque envoi publie aussi la **version de développement** (pré-version `dev`), installable
par un lien fixe.
