# 🎮 GuessWhat

Jeu de devinettes multijoueur en temps réel — devine l'image avant les autres !

🔗 **[Jouer en ligne](https://guesswhat.up.railway.app/)**

---

## Comment jouer

1. Entre ton pseudo sur l'écran de connexion
2. Attends que la partie démarre
3. Une image pixelisée apparaît — elle se précise progressivement sur ~60 secondes
4. Tape ta réponse dans le champ en bas et appuie sur **Entrée** ou **OK**
5. Le premier à trouver le mot correct remporte les points
6. Le score augmente selon la vitesse : plus tu trouves tôt, plus tu gagnes de points

---

## Règles

- La partie tourne en boucle sur plusieurs images, sans fin
- La réponse est insensible à la casse et aux accents (`é` = `e`)
- Si personne ne trouve avant la fin du timer, la réponse est révélée dans le chat et la manche suivante commence
- Les joueurs qui rejoignent en cours de partie voient l'image à l'état actuel

---

## Stack technique

- **Node.js** + **Express** — serveur HTTP
- **Socket.io 4** — communication temps réel (WebSockets)
- **Sharp** — traitement d'images côté serveur (pixelisation progressive)
- **HTML / CSS / JS vanilla** — client léger, aucun framework

Les images ne transitent jamais en URL brute vers le client — elles sont converties en buffers RGB pixelisés par le serveur, garantissant que la réponse reste secrète.

---

## Lancer en local

```bash
npm install
npm start
```

Puis ouvre [http://localhost:5454](http://localhost:5454) dans ton navigateur.

---

## Déploiement

Hébergé sur [Railway](https://railway.app) avec déploiement automatique depuis ce dépôt GitHub.
