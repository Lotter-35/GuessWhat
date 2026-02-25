'use strict';

const sharp                  = require('sharp');
const fetch                  = require('node-fetch');
const { loadAllRounds }      = require('./sources');

// ─────────────────────────────────────────────
// MANCHES DE SECOURS (utilisées si toutes les sources échouent)
// ─────────────────────────────────────────────
const FALLBACK_ROUNDS = [
  {
    imageUrl: 'https://i0.wp.com/dawtonasarl.com/wp-content/uploads/2025/03/unnamed.jpg?fit=900,900&ssl=1',
    answers:  ['nutella', 'pâte à tartiner', 'noisette', 'ferrero'],
    hints:    ['à tartiner', 'chocolat', 'pot']
  },
  {
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b5/Rook-Corvus_frugilegus.jpg',
    answers:  ['corbeau', 'corbeaux', 'rook', 'corvus', 'freux', 'corneille'],
    hints:    ['oiseau', 'noir', 'passereau']
  }
];

// ─────────────────────────────────────────────
// PARAMÈTRES DE PIXELISATION
// ─────────────────────────────────────────────
const SCHEDULE = [
  { res:   4, duration:  1 },
  { res:   8, duration:  7 },
  { res:  16, duration:  9 },
  { res:  32, duration: 11 },
  { res:  64, duration: 13 },
  { res: 128, duration: 14 },
  { res: 256, duration: 5 },
];

const SHIMMER_INTERVAL   = 150;   // ms entre deux calculs de shimmer
const SHIMMER_PERCENTAGE = 0.25;  // 25% de blocs mis à jour par cycle
const SHIMMER_DECAY      = 1.5;   // diviseur par palier

// ─────────────────────────────────────────────
// CLASSE GESTIONNAIRE DE PARTIE
// ─────────────────────────────────────────────
class GameManager {

  constructor(io) {
    this.io           = io;
    this.players      = new Map();   // socketId → { pseudo, score }
    this._rounds      = FALLBACK_ROUNDS; // manches chargées dynamiquement (APIs)
    this.currentRound = 0;           // index dans this._rounds (modulo)
    this.roundNumber  = 1;           // numéro de manche affiché (incrémente à l'infini)
    this.currentStep  = 0;
    this.roundSolved  = false;
    this.roundWinner  = null;
    this.started      = false;
    this._stepStartedAt          = null;   // timestamp du début de l'étape courante
    this._totalRemainingAtStart  = 0;      // secondes restantes au début de l'étape courante
    this._skipVotes              = new Set(); // socketIds ayant voté skip

    // Pixels natifs (chargés en mémoire, jamais envoyés)
    this.nativePixels = null;
    this.nativeW      = 0;
    this.nativeH      = 0;
    this.channels     = 3;

    // Grille de pixelisation (Buffer RGB, 3 octets/bloc)
    this.blocksX   = 0;
    this.blocksY   = 0;
    this.gridData  = null;   // Buffer R,G,B × blocksX×blocksY

    // Timers serveur
    this._stepTimer    = null;
    this._shimmerTimer = null;
    this._nextTimer    = null;
    this._hintTimer    = null;
  }

  // ── Joueurs ─────────────────────────────────
  addPlayer(socketId, pseudo) {
    this.players.set(socketId, { pseudo, score: 0 });
    this._broadcastPlayers();
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    const hadVoted = this._skipVotes.delete(socketId);
    this._broadcastPlayers();

    // Plus personne dans le lobby → on laisse la manche se terminer normalement,
    // le compteur sera réinitialisé dans _scheduleNextRound
    if (this.players.size === 0) {
      console.log('[GAME] No players — waiting for round to end.');
      return;
    }

    // Réévaluer le skip si ce joueur avait voté (le seuil change avec 1 joueur en moins)
    if (hadVoted && !this.roundSolved) {
      const count  = this.players.size;
      const needed = Math.floor(count / 2) + 1;
      if (this._skipVotes.size >= needed) {
        console.log(`[GAME] Skip validé après déconnexion d'un joueur (${this._skipVotes.size}/${count})`);
        this._handleTimeout();
      } else {
        this._broadcastSkipUpdate();
      }
    }
  }

  _broadcastPlayers() {
    const list = Array.from(this.players.entries()).map(([id, p]) => ({
      id, pseudo: p.pseudo, score: p.score
    }));
    this.io.emit('players:update', list);
  }

  // ── Chargement image ────────────────────────
  async _loadImage(url) {
    console.log(`[IMG] Téléchargement : ${url}`);
    const resp   = await fetch(url);
    const buffer = await resp.buffer();

    // Sharp : décode + converti en RGB brut (sans alpha)
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    this.nativePixels = data;
    this.nativeW      = info.width;
    this.nativeH      = info.height;
    this.channels     = info.channels; // 3 (RGB)
    console.log(`[IMG] Chargée : ${this.nativeW}×${this.nativeH}, ${Math.round(data.length/1024)} Ko`);
  }

  // ── Grille de pixelisation ───────────────────
  _updateBlockColorInGrid(i) {
    const bx = i % this.blocksX;
    const by = Math.floor(i / this.blocksX);

    const x1 = Math.floor(bx       * this.nativeW / this.blocksX);
    const x2 = Math.floor((bx + 1) * this.nativeW / this.blocksX);
    const y1 = Math.floor(by       * this.nativeH / this.blocksY);
    const y2 = Math.floor((by + 1) * this.nativeH / this.blocksY);

    const rx = x1 + Math.floor(Math.random() * Math.max(1, x2 - x1));
    const ry = y1 + Math.floor(Math.random() * Math.max(1, y2 - y1));

    const srcIdx = (Math.min(ry, this.nativeH - 1) * this.nativeW + Math.min(rx, this.nativeW - 1)) * this.channels;
    const dstIdx = i * 3;

    this.gridData[dstIdx]     = this.nativePixels[srcIdx];
    this.gridData[dstIdx + 1] = this.nativePixels[srcIdx + 1];
    this.gridData[dstIdx + 2] = this.nativePixels[srcIdx + 2];
  }

  _setupStep(stepIndex) {
    const res      = SCHEDULE[stepIndex].res;
    const prevBX   = this.blocksX;
    const prevBY   = this.blocksY;
    const prevData = this.gridData ? Buffer.from(this.gridData) : null;

    this.blocksX  = res;
    this.blocksY  = res;
    const total   = res * res;
    this.gridData = Buffer.alloc(total * 3);

    if (stepIndex === 0 || !prevData) {
      // Initialisation complète
      for (let i = 0; i < total; i++) this._updateBlockColorInGrid(i);
    } else {
      // Héritage : chaque nouveau petit bloc prend la couleur de l'ancien grand
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const oldX   = Math.floor(x * prevBX / res);
          const oldY   = Math.floor(y * prevBY / res);
          const oldIdx = (oldY * prevBX + oldX) * 3;
          const newIdx = (y * res + x) * 3;
          this.gridData[newIdx]     = prevData[oldIdx];
          this.gridData[newIdx + 1] = prevData[oldIdx + 1];
          this.gridData[newIdx + 2] = prevData[oldIdx + 2];
        }
      }
    }
  }

  _shimmerTick() {
    if (this.roundSolved || !this.nativePixels) return;

    const dynamicPct    = SHIMMER_PERCENTAGE / Math.pow(SHIMMER_DECAY, this.currentStep);
    const total         = this.blocksX * this.blocksY;
    const blocksToUpdate = Math.max(1, Math.floor(total * dynamicPct));

    for (let k = 0; k < blocksToUpdate; k++) {
      this._updateBlockColorInGrid(Math.floor(Math.random() * total));
    }

    // Émet le buffer binaire à tous les clients connectés
    this.io.emit('game:frame', {
      blocksX: this.blocksX,
      blocksY: this.blocksY,
      step:    this.currentStep
    }, this.gridData);
  }

  // ── Manche ──────────────────────────────────
  // attempt : nombre d'essais successifs pour cette manche (évite boucle infinie)
  async startRound(roundIndex, attempt = 0) {
    const MAX_SKIP = Math.min(10, this._rounds.length - 1);

    this.currentRound  = roundIndex;
    this.currentStep   = 0;
    this.roundSolved   = false;
    this.roundWinner   = null;
    this._skipVotes    = new Set();
    this._hintRevealed = null;
    this._clearTimers();

    const round = this._rounds[this.currentRound];
    console.log(`[GAME] Manche ${this.roundNumber} (image ${this.currentRound + 1}/${this._rounds.length}) : ${round.answers[0]}`);

    // Charge l'image côté serveur
    try {
      await this._loadImage(round.imageUrl);
    } catch (e) {
      console.error(`[IMG] Erreur de chargement (essai ${attempt + 1}/${MAX_SKIP + 1}) :`, e.message);

      if (attempt < MAX_SKIP) {
        // Passe silencieusement à l'entrée suivante
        const next = (roundIndex + 1) % this._rounds.length;
        console.log(`[IMG] Image ignorée → passage à l'entrée ${next + 1}`);
        return this.startRound(next, attempt + 1);
      }

      // Toutes les tentatives épuisées → on lance quand même avec une grille grise
      console.error('[IMG] Impossible de charger une image valide après plusieurs essais. Grille de secours utilisée.');
      this.nativeW = 256; this.nativeH = 256; this.channels = 3;
      this.nativePixels = Buffer.alloc(256 * 256 * 3, 80);
    }

    // Informe les clients (sans image, sans réponse)
    this.io.emit('game:roundStart', {
      roundNumber: this.roundNumber,
      schedule:    SCHEDULE.map(s => ({ res: s.res, duration: s.duration }))
    });

    this._runStep(0);

    // Révèle l'indice de source à tous les joueurs après 10s
    const _hint = round.hints?.[0];
    if (_hint) {
      this._hintTimer = setTimeout(() => {
        if (!this.roundSolved) {
          console.log(`[GAME] Indice révélé : ${_hint}`);
          this._hintRevealed = _hint;
          this.io.emit('game:hint', { hint: _hint });
        }
      }, 10000);
    }
  }

  _runStep(stepIndex) {
    if (this.roundSolved) return;
    this.currentStep = stepIndex;

    // Calcule et envoie la grille initiale de l'étape
    this._setupStep(stepIndex);

    // Envoie le premier frame de l'étape
    this._shimmerTick();

    // Lance le shimmer
    this._shimmerTimer = setInterval(() => {
      if (!this.roundSolved) this._shimmerTick();
    }, SHIMMER_INTERVAL);

    // Informe le client de la durée de cette étape + temps total restant pour le timer visuel
    const duration       = SCHEDULE[stepIndex].duration;
    const totalRemaining = SCHEDULE.slice(stepIndex).reduce((acc, s) => acc + s.duration, 0);
    this._stepStartedAt         = Date.now();
    this._totalRemainingAtStart = totalRemaining;
    this.io.emit('game:stepStart', { step: stepIndex, duration, totalRemaining });

    // Planifie le passage à l'étape suivante
    const durationMs = duration * 1000;
    this._stepTimer = setTimeout(() => {
      clearInterval(this._shimmerTimer);
      if (this.roundSolved) return;

      const nextStep = stepIndex + 1;
      if (nextStep >= SCHEDULE.length) {
        // Toutes les étapes épuisées → timeout
        this._handleTimeout();
      } else {
        this._runStep(nextStep);
      }
    }, durationMs);
  }

  _handleTimeout() {
    if (this.roundSolved) return;
    this.roundSolved = true;
    this._clearTimers();

    const round = this._rounds[this.currentRound];
    console.log(`[GAME] Timeout — réponse : ${round.answers[0]}`);

    this.io.emit('game:roundEnd', {
      won:      false,
      answer:   round.answers[0],
      winner:   null,
      imageUrl: round.imageUrl
    });

    this._scheduleNextRound(4000);
  }

  handleGuess(socketId, text) {
    if (this.roundSolved) return;

    const player = this.players.get(socketId);
    if (!player) return;

    const round   = this._rounds[this.currentRound];
    const normalize = s => s.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // ignore accents
    const cleaned = normalize(text);
    const correct = round.answers.some(a => normalize(a) === cleaned);

    // Broadcast la tentative à tous (sans révéler si c'est correct avant le verdict)
    this.io.emit('game:guess', {
      pseudo:   player.pseudo,
      text:     text.trim(),
      correct,
      socketId
    });

    if (correct) {
      this._handleCorrect(socketId, player);
    }
  }

  _handleCorrect(socketId, player) {
    if (this.roundSolved) return;
    this.roundSolved = true;
    this._clearTimers();

    const round = this._rounds[this.currentRound];

    // Calcul du score : 100 pts au step 0 (très tôt) → 10 pts au dernier step
    const maxPts = 100;
    const minPts = 10;
    const points = Math.round(maxPts - this.currentStep * (maxPts - minPts) / (SCHEDULE.length - 1));

    player.score += points;
    this.players.set(socketId, player);
    this._broadcastPlayers();

    console.log(`[GAME] ${player.pseudo} a trouvé : ${round.answers[0]} (+${points} pts)`);

    this.io.emit('game:roundEnd', {
      won:      true,
      answer:   round.answers[0],
      winner:   player.pseudo,
      winnerId: socketId,
      points,
      imageUrl: round.imageUrl
    });

    this._scheduleNextRound(3000);
  }

  // ── Vote Skip ─────────────────────────────────
  handleSkip(socketId) {
    if (this.roundSolved || !this.players.has(socketId)) return;
    this._skipVotes.add(socketId);
    this._broadcastSkipUpdate();

    const count  = this.players.size;
    const needed = Math.floor(count / 2) + 1; // majorité stricte
    if (this._skipVotes.size >= needed) {
      console.log(`[GAME] Skip voté (${this._skipVotes.size}/${count}) → passage à la suite`);
      this._handleTimeout();
    }
  }

  _broadcastSkipUpdate() {
    const count  = this.players.size;
    const needed = Math.floor(count / 2) + 1;
    this.io.emit('game:skipUpdate', {
      skipIds: Array.from(this._skipVotes),
      needed,
      total: count
    });
  }

  _scheduleNextRound(delay) {
    this._nextTimer = setTimeout(async () => {
      // Ne lance pas de nouvelle manche si le lobby est vide
      if (this.players.size === 0) {
        console.log('[GAME] No players — game paused, counters reset.');
        this.started      = false;
        this.roundNumber  = 1;
        this.currentRound = 0;
        return;
      }
      // Boucle infinie sur les images
      this.currentRound = (this.currentRound + 1) % this._rounds.length;
      this.roundNumber++;
      await this.startRound(this.currentRound);
    }, delay);
  }

  _clearTimers() {
    clearTimeout(this._stepTimer);
    clearInterval(this._shimmerTimer);
    clearTimeout(this._nextTimer);
    clearTimeout(this._hintTimer);
    this._stepTimer    = null;
    this._shimmerTimer = null;
    this._nextTimer    = null;
    this._hintTimer    = null;
  }

  // Démarre dès le lancement du serveur, sans attendre de joueurs
  async start() {
    if (this.started) return;
    this.started = true;
    console.log('[SOURCES] Chargement des manches...');
    const loaded = await loadAllRounds();
    this._rounds = loaded.length > 0 ? loaded : FALLBACK_ROUNDS;
    this.currentRound = 0;
    await this.startRound(this.currentRound);
  }

  // Retourne l'état courant pour un joueur qui se (re)connecte
  getState() {
    return {
      roundNumber:           this.roundNumber,
      currentStep:           this.currentStep,
      roundSolved:           this.roundSolved,
      stepStartedAt:         this._stepStartedAt,
      totalRemainingAtStart: this._totalRemainingAtStart,
      skipIds:               Array.from(this._skipVotes),
      hintRevealed:          this._hintRevealed,
      players:      Array.from(this.players.entries()).map(([id, p]) => ({
        id, pseudo: p.pseudo, score: p.score
      })),
      schedule:     SCHEDULE.map(s => ({ res: s.res, duration: s.duration })),
      started:      this.started
    };
  }
}

module.exports = GameManager;
