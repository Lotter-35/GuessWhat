'use strict';

const sharp     = require('sharp');
const fetch     = require('node-fetch');

// ─────────────────────────────────────────────
// MANCHES DE SECOURS (si les APIs échouent)
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
  },
  {
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/34/Anser_anser_1_%28Piotr_Kuczynski%29.jpg',
    answers:  ['oie', 'oies', 'goose', 'anser', 'bernache'],
    hints:    ['oiseau', 'palmipède', 'volatile']
  },
  {
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/LutraCanadensis_fullres.jpg/1280px-LutraCanadensis_fullres.jpg',
    answers:  ['loutre', 'loutres', 'otter', 'lutra'],
    hints:    ['mammifère', 'aquatique', 'fourrure']
  }
];

// ─────────────────────────────────────────────
// CHARGEMENT DYNAMIQUE DES MANCHES DEPUIS LES APIs
// ─────────────────────────────────────────────

/** Supprime les doublons dans un tableau (comparaison stricte). */
function uniqueArr(arr) {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}

/** Mélange un tableau en place (Fisher-Yates). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Charge les manches depuis :
 *  - sampleapis.com  → films avec poster Amazon
 *  - PokéAPI         → 151 Pokémon Gen-1 avec artwork officiel
 */
async function loadRoundsFromAPIs() {
  const rounds = [];

  // ── 1. Films ──────────────────────────────────────────────────────────────
  const MOVIE_CATS = ['comedy', 'animation', 'adventure'];

  await Promise.all(MOVIE_CATS.map(async cat => {
    try {
      const resp = await fetch(`https://api.sampleapis.com/movies/${cat}`, {
        headers: { Accept: 'application/json' }
      });
      if (!resp.ok) return;
      const movies = await resp.json();
      if (!Array.isArray(movies)) return;

      for (const m of movies) {
        if (!m.posterURL || m.posterURL === 'N/A') continue;
        const title = (m.title || '').trim();
        if (!title) continue;

        // Proposer le titre complet ET une version sans ponctuation complexe
        const titleSimple = title.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').trim();
        const answers = uniqueArr([title, titleSimple].filter(Boolean));

        rounds.push({
          imageUrl: m.posterURL,
          answers,
          hints: ['film', 'cinéma', cat]
        });
      }
      console.log(`[API] movies/${cat} : ${movies.filter(m => m.posterURL && m.posterURL !== 'N/A').length} films chargés`);
    } catch (e) {
      console.error(`[API] movies/${cat} erreur :`, e.message);
    }
  }));

  // ── 2. Pokémon Génération 1 (ids 1-151) ───────────────────────────────────
  const POKE_COUNT  = 151;
  const BATCH_SIZE  = 15;

  for (let start = 1; start <= POKE_COUNT; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, POKE_COUNT);
    const ids  = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    await Promise.all(ids.map(async id => {
      try {
        const [poke, species] = await Promise.all([
          fetch(`https://pokeapi.co/api/v2/pokemon/${id}`).then(r => r.json()),
          fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`).then(r => r.json())
        ]);

        const img = poke.sprites?.other?.['official-artwork']?.front_default;
        if (!img) return;

        const nameFr    = species.names.find(n => n.language.name === 'fr')?.name   || '';
        const nameEnRaw = poke.name; // ex: "bulbasaur"
        const nameEn    = nameEnRaw.charAt(0).toUpperCase() + nameEnRaw.slice(1);

        // Construire la liste de réponses acceptées
        const answers = uniqueArr([
          nameFr,
          nameFr.toLowerCase(),
          nameEn,
          nameEnRaw
        ].filter(Boolean));

        const types = poke.types.map(t => t.type.name);

        rounds.push({
          imageUrl: img,
          answers,
          hints: ['pokémon', ...types]
        });
      } catch (e) {
        console.error(`[API] Pokémon #${id} erreur :`, e.message);
      }
    }));
  }
  console.log(`[API] Pokémon : ${rounds.filter(r => r.hints[0] === 'pokémon').length} chargés`);

  // ── 3. Mélange final ──────────────────────────────────────────────────────
  shuffle(rounds);

  console.log(`[API] Total manches disponibles : ${rounds.length}`);
  return rounds.length > 0 ? rounds : FALLBACK_ROUNDS;
}

// ─────────────────────────────────────────────
// PARAMÈTRES DE PIXELISATION
// ─────────────────────────────────────────────
const SCHEDULE = [
  { res:   4, duration:  1 },
  { res:   8, duration:  7 },
  { res:  16, duration:  9 },
  { res:  32, duration: 11 },
  { res:  64, duration: 13 },
  { res: 128, duration: 15 },
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
    // Réévaluer le skip si ce joueur avait voté (le seuil change avec 1 joueur en moins)
    if (hadVoted && !this.roundSolved && this.players.size > 0) {
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
  async startRound(roundIndex) {
    this.currentRound = roundIndex;
    this.currentStep  = 0;
    this.roundSolved  = false;
    this.roundWinner  = null;
    this._skipVotes   = new Set();
    this._clearTimers();

    const round = this._rounds[this.currentRound];
    console.log(`[GAME] Manche ${this.roundNumber} (image ${this.currentRound + 1}/${this._rounds.length}) : ${round.answers[0]}`);

    // Charge l'image côté serveur
    try {
      await this._loadImage(round.imageUrl);
    } catch (e) {
      console.error('[IMG] Erreur de chargement :', e.message);
      // Crée une grille de fallback (gris uni)
      this.nativeW = 256; this.nativeH = 256; this.channels = 3;
      this.nativePixels = Buffer.alloc(256 * 256 * 3, 80);
    }

    // Informe les clients (sans image, sans réponse)
    this.io.emit('game:roundStart', {
      roundNumber: this.roundNumber,
      schedule:    SCHEDULE.map(s => ({ res: s.res, duration: s.duration }))
    });

    this._runStep(0);
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

    // Calcul du score
    const basePoints = 500;
    const stepBonus  = (SCHEDULE.length - 1 - this.currentStep - 1) * 100;
    const points     = Math.max(100, basePoints + stepBonus);

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
    this._stepTimer    = null;
    this._shimmerTimer = null;
    this._nextTimer    = null;
  }

  // Démarre dès le lancement du serveur, sans attendre de joueurs
  async start() {
    if (this.started) return;
    this.started = true;
    console.log('[API] Chargement des manches depuis les APIs...');
    this._rounds = await loadRoundsFromAPIs();
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
      players:      Array.from(this.players.entries()).map(([id, p]) => ({
        id, pseudo: p.pseudo, score: p.score
      })),
      schedule:     SCHEDULE.map(s => ({ res: s.res, duration: s.duration })),
      started:      this.started
    };
  }
}

module.exports = GameManager;
