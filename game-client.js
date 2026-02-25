/* =====================================================
   PIXELIZ — Client Socket.io
   =====================================================
   Le client ne connaît JAMAIS l'URL des images.
   Il reçoit uniquement des buffers RGB binaires
   (grille N×N octets) et les dessine sur canvas.
   ===================================================== */

// ─────────────────────────────────────────────
// CANVAS
// ─────────────────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const W      = canvas.width;
const H      = canvas.height;

// Grille offscreen (1 px = 1 bloc pixelisé)
const gridCanvas = document.createElement('canvas');
const gridCtx    = gridCanvas.getContext('2d', { willReadFrequently: true });

// État UI local
let mySocketId     = null;
let myPseudo       = '';
let totalScore     = 0;
let currentRound   = 1;   // numéro affiché
let currentStep    = 0;
let roundSolved    = false;
let schedule       = [];
let roundEndImg    = null;
let stepTimerInterval = null;  // timer local pour le cercle
let currentPlayers    = [];    // liste joueurs courante (pour re-render au skip)
let skipVotedIds      = new Set(); // IDs ayant voté skip cette manche
let isHost            = false;     // vrai uniquement pour le premier joueur
let sourceMode        = 'api';     // 'api' | 'db'
// CONNEXION SOCKET.IO
// ─────────────────────────────────────────────
const socket = io();

socket.on('connect', () => {
  mySocketId = socket.id;
  console.log('[CLIENT] Connecté :', mySocketId);
});

socket.on('disconnect', () => {
  console.log('[CLIENT] Déconnecté du serveur');
  showCanvasMessage('Connexion perdue…', '#ff3c5a');
});

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
function joinGame() {
  const input  = document.getElementById('pseudo-input');
  const pseudo = input.value.trim();
  if (!pseudo) {
    input.classList.add('error');
    setTimeout(() => input.classList.remove('error'), 600);
    return;
  }
  myPseudo = pseudo;
  socket.emit('player:join', pseudo);

  // Cache l'écran de login
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setTimeout(() => document.getElementById('guess-input').focus(), 50);
}

// Permettre Entrée sur le champ pseudo
document.getElementById('pseudo-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinGame();
});

// Indices révélés dans la manche courante (côté client)
let hintsRevealedClient = [];

// Helper : crée une pill par indice dans #hint-block
// hintsArg: null | string | string[]
// newIndex : index du dernier indice ajouté (animé), -1 = tous affichés sans anim
function showHint(hintsArg, newIndex = -1) {
  const block = document.getElementById('hint-block');
  if (!block) return;

  // Normalise en tableau
  let list;
  if (!hintsArg || (Array.isArray(hintsArg) && hintsArg.length === 0)) {
    list = [];
  } else if (Array.isArray(hintsArg)) {
    list = hintsArg;
  } else {
    list = [hintsArg];
  }

  if (list.length === 0) {
    block.style.display = 'none';
    block.innerHTML = '';
    return;
  }

  block.style.display = 'flex';

  // Ne recréer que les pills manquantes (evite de ré-animer les existantes)
  const existing = block.querySelectorAll('.hint-block__pill').length;
  list.forEach((hint, i) => {
    if (i < existing) return; // déjà affichée
    const pill = document.createElement('span');
    pill.className = 'hint-block__pill';
    pill.textContent = hint.toUpperCase();
    // Pas d'animation si on affiche toutes d'un coup (reconnexion)
    if (newIndex === -1) pill.style.animation = 'none';
    block.appendChild(pill);
  });

  // Recale la position par rapport à la bottom-bar (iOS)
  const bar = document.querySelector('.bottom-bar');
  if (bar && window.innerWidth <= 639) {
    const barBottom = parseInt(bar.style.bottom || '0', 10) || 0;
    block.style.bottom = (barBottom + bar.offsetHeight) + 'px';
  }
}

// ─────────────────────────────────────────────
// ÉVÉNEMENT : SYNCHRONISATION INITIALE
// ─────────────────────────────────────────────
socket.on('game:sync', (state) => {
  schedule     = state.schedule || [];
  currentRound = state.roundNumber || 1;
  currentStep  = state.currentStep;
  roundSolved  = state.roundSolved;
  sourceMode   = state.sourceMode || 'api';
  isHost       = (mySocketId === state.hostId);
  updateSourceToggleUI();

  // Sync des votes skip déjà en cours
  skipVotedIds = new Set(state.skipIds || []);
  const btnSkip = document.getElementById('btn-skip');
  if (btnSkip && skipVotedIds.has(mySocketId)) {
    btnSkip.classList.add('voted');
    btnSkip.disabled = true;
  }

  updateRoundInfo(currentRound);
  updatePixelInfo(currentStep);
  renderPlayerList(state.players || []);

  // Indices déjà révélés avant la connexion
  hintsRevealedClient = state.hintsRevealed || [];
  showHint(hintsRevealedClient, -1); // -1 = pas d'animation (déjà révélés)

  // Timer late-joiner : recalcule la position correcte dans les ~60s
  if (state.started && !state.roundSolved && state.stepStartedAt && state.totalRemainingAtStart > 0) {
    const _s         = state.schedule || schedule;
    const _totalMs   = _s.reduce((a, e) => a + e.duration, 0) * 1000;
    const _stepEl    = Date.now() - state.stepStartedAt;          // ms écoulées depuis début étape
    const _remaining = state.totalRemainingAtStart * 1000 - _stepEl; // ms restantes dans la manche
    const _adjStart  = Date.now() - (_totalMs - _remaining);      // référence comme si on avait démarré au bon moment
    clearInterval(stepTimerInterval);
    stepTimerInterval = setInterval(() => {
      const _el  = Date.now() - _adjStart;
      const _rem = Math.ceil((_totalMs - _el) / 1000);
      const _fr  = Math.max(0, 1 - _el / _totalMs);
      document.getElementById('timer-text').textContent = _rem > 0 ? _rem : '';
      updateTimerUI(_fr);
      if (_el >= _totalMs) clearInterval(stepTimerInterval);
    }, 100);
  }

  if (state.started) {
    showCanvasMessage('Connexion…', '#00e5ff');
  }
});

// ─────────────────────────────────────────────
// ÉVÉNEMENT : NOUVEAU FRAME PIXELISÉ (binaire)
// ─────────────────────────────────────────────
socket.on('game:frame', (meta, buffer) => {
  if (roundSolved) return;  // si la manche est résolue, ne met pas à jour le canvas

  const { blocksX, blocksY } = meta;
  currentStep = meta.step;

  // Redimensionne le canvas offscreen si besoin
  if (gridCanvas.width !== blocksX || gridCanvas.height !== blocksY) {
    gridCanvas.width  = blocksX;
    gridCanvas.height = blocksY;
  }

  // Remplit l'ImageData depuis le buffer RGB binaire
  const arr       = new Uint8Array(buffer);
  const imageData = gridCtx.createImageData(blocksX, blocksY);

  for (let i = 0; i < blocksX * blocksY; i++) {
    imageData.data[i * 4]     = arr[i * 3];       // R
    imageData.data[i * 4 + 1] = arr[i * 3 + 1];   // G
    imageData.data[i * 4 + 2] = arr[i * 3 + 2];   // B
    imageData.data[i * 4 + 3] = 255;               // A
  }

  gridCtx.putImageData(imageData, 0, 0);
  renderPixelated();
  updatePixelInfo(currentStep);
});

function renderPixelated() {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (gridCanvas.width > 0 && gridCanvas.height > 0) {
    ctx.drawImage(gridCanvas, 0, 0, gridCanvas.width, gridCanvas.height, 0, 0, W, H);
  }
}

// ─────────────────────────────────────────────
// ÉVÉNEMENT : DÉBUT DE MANCHE
// ─────────────────────────────────────────────
socket.on('game:roundStart', (data) => {
  currentRound = data.roundNumber || (currentRound + 1);
  schedule     = data.schedule || schedule;
  roundSolved  = false;
  roundEndImg  = null;
  currentStep  = 0;

  // Reset UI
  updateRoundInfo(currentRound);
  updatePixelInfo(0);

  // Séparateur dans le chat
  const history = document.getElementById('guess-history');
  if (history && history.children.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'chat-round-sep';
    sep.innerHTML = `<span class="chat-round-sep__line"></span><span class="chat-round-sep__label">MANCHE ${currentRound}</span><span class="chat-round-sep__line"></span>`;
    appendToAllHistories(sep);
  }

  const input = document.getElementById('guess-input');
  input.value     = '';
  input.disabled  = false;
  input.className = 'guess-input';
  input.focus();

  // Masque les indices au début de chaque manche
  hintsRevealedClient = [];
  showHint([], -1);

  document.getElementById('canvas-container').className  = 'canvas-container';
  document.getElementById('feedback-overlay').className  = 'feedback-overlay';
  document.querySelector('.timer-wrap').style.visibility = 'visible';

  // Reset skip
  skipVotedIds = new Set();
  const btnSkip = document.getElementById('btn-skip');
  if (btnSkip) { btnSkip.classList.remove('voted'); btnSkip.disabled = false; }
  renderPlayerList(currentPlayers);

  // Canvas de chargement
  showCanvasMessage('CHARGEMENT…', '#2a2a3a');

  // Timer de manche — une seule course pour les ~60s, ne se remet PAS à zéro à chaque étape
  clearInterval(stepTimerInterval);
  const _sched       = data.schedule || schedule;
  const _totalRndMs  = _sched.reduce((s, e) => s + e.duration, 0) * 1000;
  const _rndStartTs  = Date.now();
  stepTimerInterval = setInterval(() => {
    const _el  = Date.now() - _rndStartTs;
    const _rem = Math.ceil((_totalRndMs - _el) / 1000);
    const _fr  = Math.max(0, 1 - _el / _totalRndMs);
    document.getElementById('timer-text').textContent = _rem > 0 ? _rem : '';
    updateTimerUI(_fr);
    if (_el >= _totalRndMs) clearInterval(stepTimerInterval);
  }, 100);
});

// ─────────────────────────────────────────────
// ÉVÉNEMENT : INDICE (révélé progressivement)
// ─────────────────────────────────────────────
socket.on('game:hint', (data) => {
  hintsRevealedClient = data.hintsRevealed || (data.hint ? [data.hint] : []);
  // newIndex = indice du dernier élément ajouté (seul lui sera animé)
  showHint(hintsRevealedClient, hintsRevealedClient.length - 1);
});

// ─────────────────────────────────────────────
// ÉVÉNEMENT : FIN DE MANCHE
// ─────────────────────────────────────────────
socket.on('game:roundEnd', (data) => {
  roundSolved = true;

  const overlay   = document.getElementById('feedback-overlay');
  const myWin     = data.won && data.winnerId === mySocketId;
  const otherWin  = data.won && data.winnerId !== mySocketId;

  if (myWin) {
    overlay.textContent = '✓ BRAVO!';
    overlay.className   = 'feedback-overlay correct-msg show';
  } else if (otherWin) {
    overlay.textContent = `${data.winner} a trouvé !`;
    overlay.className   = 'feedback-overlay other-win show';
  } else {
    overlay.textContent = '✗ RATÉ';
    overlay.className   = 'feedback-overlay wrong-msg show';
  }
  setTimeout(() => { overlay.className = 'feedback-overlay'; }, 1800);

  clearInterval(stepTimerInterval);
  document.getElementById('timer-text').textContent = '';
  updateTimerUI(0);
  document.querySelector('.timer-wrap').style.visibility = 'hidden';

  // Met dans l'historique
  addAnswerToHistory(data.answer, data.won, data.winner);

  // Si le serveur envoie l'imageUrl en fin de manche, on affiche l'image nette
  if (data.imageUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      roundEndImg = img;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
    };
    img.src = data.imageUrl;
  }

  document.getElementById('guess-input').disabled = true;

  // Masque + désactive le skip
  const btnSkip = document.getElementById('btn-skip');
  if (btnSkip) { btnSkip.disabled = true; btnSkip.classList.remove('voted'); }

  // Points si on a gagné
  if (myWin && data.points) {
    totalScore += data.points;

    const popup       = document.getElementById('points-popup');
    popup.textContent = `+${data.points}`;
    popup.className   = 'points-popup animate';
    setTimeout(() => { popup.className = 'points-popup'; }, 1300);

    document.getElementById('canvas-container').classList.add('solved');
  }
});

// ─────────────────────────────────────────────
// ÉVÉNEMENT : DÉBUT D'UNE ÉTAPE
// ─────────────────────────────────────────────
// Le timer circulaire est géré par game:roundStart (une seule course / manche).
// Ici on ne fait plus rien de spécial pour le timer.
socket.on('game:stepStart', () => {
  // (timer déjà en cours depuis game:roundStart)
});

// ─────────────────────────────────────────────
// ÉVÉNEMENT : GUESS D'UN JOUEUR (tous les joueurs)
// ─────────────────────────────────────────────
socket.on('game:guess', (data) => {
  const isMe = data.socketId === mySocketId;
  addGuessToHistory(data.pseudo, data.text, data.correct, isMe);

  if (isMe && !data.correct) {
    // Animation secousse sur le champ
    const input = document.getElementById('guess-input');
    input.classList.remove('wrong');
    void input.offsetWidth;
    input.classList.add('wrong');
    setTimeout(() => input.classList.remove('wrong'), 400);
    input.value = '';
  }
  if (isMe && data.correct) {
    const input = document.getElementById('guess-input');
    input.classList.add('correct');
  }
});

// ─────────────────────────────────────────────
// ÉVÉNEMENT : LISTE DES JOUEURS
// ─────────────────────────────────────────────
socket.on('players:update', (players) => {
  renderPlayerList(players);
});

// ─────────────────────────────────────────────
// FIN DE PARTIE → plus utilisé (boucle infinie) - conservé précaution
// ─────────────────────────────────────────────
socket.on('game:over', () => { /* partie infinie, ne se déclenche plus */ });

// ─────────────────────────────────────────────
// SOURCE MODE — rôle hôte & toggle
// ─────────────────────────────────────────────
// Le serveur nous informe si on devient hôte (quand l'ancien part)
socket.on('game:roleChanged', (data) => {
  isHost     = data.isHost;
  sourceMode = data.sourceMode || sourceMode;
  updateSourceToggleUI();
});

// Quelqu'un (le host) a changé la source — tout le monde est informé
socket.on('game:sourceModeChanged', (data) => {
  sourceMode = data.sourceMode;
  updateSourceToggleUI();
});

function updateSourceToggleUI() {
  const btn = document.getElementById('btn-source-toggle');
  if (!btn) return;
  btn.style.display = isHost ? 'flex' : 'none';
  if (sourceMode === 'db') {
    btn.classList.add('active');
    btn.innerHTML = '📦 BDD';
    btn.title = 'Source : base de données — Cliquer pour passer aux APIs';
  } else {
    btn.classList.remove('active');
    btn.innerHTML = '🌐 API';
    btn.title = 'Source : APIs — Cliquer pour passer à la BDD';
  }
}

function toggleSourceMode() {
  if (!isHost) return;
  const next = sourceMode === 'api' ? 'db' : 'api';
  socket.emit('game:setSourceMode', next);
}

function addSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'chat-system-msg';
  el.textContent = text;
  appendToAllHistories(el);
}

// ─────────────────────────────────────────────
// ÉVÉNEMENT : VOTES SKIP
// ─────────────────────────────────────────────
socket.on('game:skipUpdate', (data) => {
  skipVotedIds = new Set(data.skipIds);
  const btnSkip = document.getElementById('btn-skip');
  if (btnSkip) {
    const iVoted = skipVotedIds.has(mySocketId);
    btnSkip.classList.toggle('voted', iVoted);
    btnSkip.disabled = iVoted;
    btnSkip.title = `${data.skipIds.length}/${data.total} vote(s) — ${data.needed} nécessaire(s)`;
  }
  renderPlayerList(currentPlayers);
});

// ─────────────────────────────────────────────
// SUBMIT GUESS
// ─────────────────────────────────────────────
function submitGuess() {
  if (roundSolved) return;
  const input = document.getElementById('guess-input');
  const text  = input.value.trim();
  if (!text) return;
  socket.emit('player:guess', text);
  input.value = '';
}

function submitSkip() {
  if (roundSolved) return;
  socket.emit('player:skip');
}

document.getElementById('guess-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitGuess();
});

// ─────────────────────────────────────────────
// HELPERS UI
// ─────────────────────────────────────────────
function showCanvasMessage(msg, color = '#e8e8f0') {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.font      = '700 1.2rem Space Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(msg, W / 2, H / 2);
}

function updateRoundInfo() {}

function updateScore(val) {
  totalScore = val;
}

function updatePixelInfo(stepIdx) {
  if (!schedule.length) return;
  const idx      = Math.min(stepIdx, schedule.length - 1);
  const gridSize = schedule[idx].res;
  const progress = (idx / Math.max(1, schedule.length - 1)) * 100;
  const fill  = document.getElementById('pixel-progress-fill');
  const label  = document.getElementById('pixel-label');
  if (fill)  fill.style.width = progress + '%';
  if (label) label.textContent =
    gridSize < 128 ? `${gridSize}×${gridSize} PX` : 'NET';
}

function renderPlayerList(players) {
  currentPlayers = players;
  const html = players
    .sort((a, b) => b.score - a.score)
    .map(p => `
      <div class="player-entry ${p.id === mySocketId ? 'me' : ''}">
        <span class="player-pseudo">${escapeHtml(p.pseudo)}</span>
        <span class="player-skip-wrap">${skipVotedIds.has(p.id) ? '⏭' : ''}</span>
        <span class="player-score-box">${p.score}</span>
      </div>
    `).join('');

  const list = document.getElementById('player-list');
  if (list) list.innerHTML = html;
  const mobileList = document.getElementById('mobile-player-list');
  if (mobileList) mobileList.innerHTML = html;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function appendToAllHistories(el) {
  const history = document.getElementById('guess-history');
  history.appendChild(el);
  history.scrollTop = history.scrollHeight;
  const mobileHistory = document.getElementById('mobile-guess-history');
  if (mobileHistory) {
    mobileHistory.appendChild(el.cloneNode(true));
    mobileHistory.scrollTop = mobileHistory.scrollHeight;
  }
}

function addGuessToHistory(pseudo, text, correct, isMe) {
  const entry   = document.createElement('div');
  entry.className = 'guess-entry' + (correct ? ' correct' : '');
  const name = escapeHtml((isMe ? myPseudo : pseudo).toUpperCase());
  entry.innerHTML = `<span class="guess-name">${name}</span><span class="guess-text">${escapeHtml(text)}</span>`;
  appendToAllHistories(entry);
}

function addRoundSeparator(roundNum) {
  const history = document.getElementById('guess-history');
  if (history.children.length === 0) return;
  const sep = document.createElement('div');
  sep.className   = 'round-separator';
  sep.innerHTML   = `<span class="sep-line"></span><span class="sep-label">MANCHE ${roundNum}</span><span class="sep-line"></span>`;
  appendToAllHistories(sep);
}

function addAnswerToHistory(answer, won, winner) {
  const entry = document.createElement('div');
  entry.className = won ? 'chat-result chat-result--found' : 'chat-result chat-result--missed';

  if (won) {
    const who = winner ? escapeHtml(winner.toUpperCase()) : 'QUELQU\'UN';
    entry.innerHTML =
      `<span class="chat-result__who">${who} a trouvé :</span>` +
      `<span class="chat-result__answer chat-result__answer--found">${escapeHtml(answer.toUpperCase())}</span>`;
  } else {
    entry.innerHTML =
      `<span class="chat-result__who">Réponse :</span>` +
      `<span class="chat-result__answer chat-result__answer--missed">${escapeHtml(answer.toUpperCase())}</span>`;
  }

  appendToAllHistories(entry);
}

// ─────────────────────────────────────────────
// iOS KEYBOARD FIX — visualViewport API
// Sur iOS Safari, quand le clavier s'ouvre, window.innerHeight ne change pas
// mais window.visualViewport.height se réduit. On repositionne la bottom-bar
// pour qu'elle reste collée au-dessus du clavier.
// ─────────────────────────────────────────────
(function iosKeyboardFix() {
  if (!window.visualViewport) return;

  const getBar   = () => document.querySelector('.bottom-bar');
  const getHint  = () => document.querySelector('.hint-block');

  const update = () => {
    const bar = getBar();
    if (!bar) return;
    // Seulement sur mobile (position:fixed appliqué par le CSS media query)
    if (window.innerWidth > 639) {
      bar.style.bottom = '';
      const hint = getHint();
      if (hint) hint.style.bottom = '';
      return;
    }
    // Décalage entre le bas de innerHeight et le bas du viewport visible
    const offsetFromBottom =
      window.innerHeight -
      window.visualViewport.offsetTop -
      window.visualViewport.height;
    const barBottom = Math.max(0, offsetFromBottom);
    bar.style.bottom = barBottom + 'px';
    // Hint-block collé juste au-dessus de la bottom-bar
    const hint = getHint();
    if (hint) hint.style.bottom = (barBottom + bar.offsetHeight) + 'px';
  };

  window.visualViewport.addEventListener('resize', update);
  window.visualViewport.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  update();
})();

// Timer UI (le serveur ne gère plus de timer explicite côté client,
// mais on garde la roue visuelle alimentée par les events de step)
function updateTimerUI(fraction) {
  const circumference = 125.6;
  const offset  = circumference * (1 - fraction);
  const circle  = document.getElementById('timer-circle');
  if (!circle) return;
  circle.style.strokeDashoffset = offset;
  if (fraction > 0.5)       circle.style.stroke = 'var(--accent2)';
  else if (fraction > 0.25) circle.style.stroke = 'var(--gold)';
  else                      circle.style.stroke = 'var(--accent)';
}
