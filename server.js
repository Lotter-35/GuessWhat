'use strict';

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const path        = require('path');
const GameManager = require('./gameManager');

const PORT = process.env.PORT || 5454;

// ─────────────────────────────────────────────
// EXPRESS — sert les fichiers statiques
// ─────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// Sert index.html, style.css, game-client.js depuis la racine du projet
app.use(express.static(path.join(__dirname)));

// Tous les autres routes → index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' }
});

const game = new GameManager(io);

io.on('connection', (socket) => {
  console.log(`[SOCKET] Connexion : ${socket.id}`);

  // ── Rejoindre la partie ──────────────────────
  socket.on('player:join', (pseudo) => {
    if (!pseudo || typeof pseudo !== 'string') return;
    const clean = pseudo.trim().slice(0, 20);
    if (!clean) return;

    console.log(`[GAME] ${clean} a rejoint (${socket.id})`);
    game.addPlayer(socket.id, clean);

    // Envoie l'état courant au nouveau joueur
    socket.emit('game:sync', game.getState());

    // Démarre la partie au premier joueur (ou re-sync si déjà en cours)
    if (!game.started) {
      game.start().catch(err => console.error('[GAME] Erreur startRound :', err));
    } else {
      // Re-envoie le dernier frame connu pour que le joueur voit quelque chose
      if (game.gridData) {
        socket.emit('game:frame', {
          blocksX: game.blocksX,
          blocksY: game.blocksY,
          step:    game.currentStep
        }, game.gridData);
      }
    }
  });

  // ── Guess ────────────────────────────────────
  socket.on('player:guess', (text) => {
    if (typeof text !== 'string') return;
    game.handleGuess(socket.id, text);
  });

  // ── Vote Skip ────────────────────────────────
  socket.on('player:skip', () => {
    game.handleSkip(socket.id);
  });

  // ── Déconnexion ──────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[SOCKET] Déconnexion : ${socket.id}`);
    game.removePlayer(socket.id);
  });
});

// ─────────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   PIXELIZ   →   http://localhost:${PORT}  ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
