// ─────────────────────────────────────────────
// GAME DATA
// ─────────────────────────────────────────────
const ROUNDS = [
  {
    imageUrl: 'https://i0.wp.com/dawtonasarl.com/wp-content/uploads/2025/03/unnamed.jpg?fit=900,900&ssl=1',
    answers: ['nutella', 'pâte à tartiner', 'noisette', 'ferrero'],
    hints: ['à tartiner', 'chocolat', 'pot'],
    label: 'UN MUR DE NUTELLA'
  },
  {
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/b5/Rook-Corvus_frugilegus.jpg',
    answers: ['corbeau', 'corbeaux', 'rook', 'corvus', 'freux', 'corneille'],
    hints: ['oiseau', 'noir', 'passereau'],
    label: 'UN CORBEAU'
  },
  {
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/34/Anser_anser_1_%28Piotr_Kuczynski%29.jpg',
    answers: ['oie', 'oies', 'goose', 'anser', 'bernache'],
    hints: ['oiseau', 'palmipède', 'volatile'],
    label: 'UNE OIE'
  },
  {
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/LutraCanadensis_fullres.jpg/1280px-LutraCanadensis_fullres.jpg',
    answers: ['loutre', 'loutres', 'otter', 'lutra'],
    hints: ['mammifère', 'aquatique', 'fourrure'],
    label: 'UNE LOUTRE'
  }
];

// Schedule de pixelisation : résolution (blocs/côté) + durée de l'étape en secondes
const schedule = [
  { res:   4, duration:  5 },   //  5s en 4×4
  { res:   8, duration:  7 },   //  7s en 8×8
  { res:  16, duration:  9 },   //  9s en 16×16
  { res:  32, duration: 11 },   // 11s en 32×32
  { res:  64, duration: 13 },   // 13s en 64×64
  { res: 128, duration: 15 },   // 15s en 128×128
];

// Paramètres du shimmer (repris du prototype original)
const shimmerInterval   = 150;  // ms entre deux cycles de scintillement
const shimmerPercentage = 0.25; // 25% de blocs mis à jour par cycle de base
const SHIMMER_DECAY     = 1.5;  // diviseur par palier (calme l'effet en haute rés.)

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
let currentRound    = 0;
let totalScore      = 0;
let currentStep     = 0;
let stepTimer       = null;   // setTimeout inter-étapes
let shimmerFrameId  = null;   // requestAnimationFrame shimmer
let lastShimmerTime = 0;
let roundTimer      = null;
let roundTimeLeft   = 30;
let roundSolved     = false;
let sourceImage     = null;

// Pixels natifs de l'image source (résolution originale)
let nativeW      = 0;
let nativeH      = 0;
let nativePixels = null;

// Grille de pixelisation
let blocksX       = 0;
let blocksY       = 0;
let totalBlocks   = 0;
const gridCanvas  = document.createElement('canvas');
const gridCtx     = gridCanvas.getContext('2d', { willReadFrequently: true });
let gridImageData = null;

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
const W      = canvas.width;   // 520
const H      = canvas.height;  // 520 — toujours carré

// ─────────────────────────────────────────────
// LETTERBOX HELPER
// Retourne {dx, dy, dw, dh} pour que l'image
// tienne entièrement dans le canvas carré,
// centrée, sans crop.
// ─────────────────────────────────────────────
function getLetterbox(img) {
  // Force l'image à remplir tout le canvas (déformation)
  return { dx: 0, dy: 0, dw: W, dh: H };
}

// ─────────────────────────────────────────────
// ALGORITHME MOSAÏQUE
// gridSize = nombre de cases par côté (4, 8…)
// On réduit l'image à gridSize cases puis on
// ré-agrandit sans lissage → effet mosaïque.
// Le letterbox est respecté à chaque étape.
// ─────────────────────────────────────────────
function drawMosaic(img, gridSize) {
  const { dx, dy, dw, dh } = getLetterbox(img);

  // 1. Réduction à la résolution cible (proportions destination)
  const offW = gridSize;
  const offH = Math.max(1, Math.round(gridSize * dh / dw));

  const offscreen   = document.createElement('canvas');
  offscreen.width   = offW;
  offscreen.height  = offH;
  const offCtx      = offscreen.getContext('2d');
  offCtx.imageSmoothingEnabled = true;
  offCtx.drawImage(img, 0, 0, offW, offH);

  // 2. Fond noir (barres letterbox)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // 3. Ré-agrandissement nearest-neighbor → mosaïque
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offscreen, dx, dy, dw, dh);
}

// ─────────────────────────────────────────────
// EXTRACTION DES PIXELS NATIFS
// Conserve la résolution originale de l'image pour
// un échantillonnage de couleur fidèle.
// ─────────────────────────────────────────────
function extractNativePixels(imgOrCanvas) {
  nativeW = imgOrCanvas.naturalWidth  || imgOrCanvas.width;
  nativeH = imgOrCanvas.naturalHeight || imgOrCanvas.height;
  const tmp  = document.createElement('canvas');
  tmp.width  = nativeW;
  tmp.height = nativeH;
  const tCtx = tmp.getContext('2d', { willReadFrequently: true });
  tCtx.drawImage(imgOrCanvas, 0, 0);
  try {
    nativePixels = tCtx.getImageData(0, 0, nativeW, nativeH).data;
  } catch(e) {
    nativePixels = null; // CORS fallback
  }
}

// ─────────────────────────────────────────────
// MISE À JOUR D'UN BLOC
// Pioche un pixel aléatoire dans la zone native
// correspondant au bloc i → couleur toujours exacte.
// ─────────────────────────────────────────────
function updateBlockColorInGrid(i) {
  const bx = i % blocksX;
  const by = Math.floor(i / blocksX);
  const x1 = Math.floor(bx       * nativeW / blocksX);
  const x2 = Math.floor((bx + 1) * nativeW / blocksX);
  const y1 = Math.floor(by       * nativeH / blocksY);
  const y2 = Math.floor((by + 1) * nativeH / blocksY);
  const rx = x1 + Math.floor(Math.random() * Math.max(1, x2 - x1));
  const ry = y1 + Math.floor(Math.random() * Math.max(1, y2 - y1));
  const srcIdx = (Math.min(ry, nativeH - 1) * nativeW + Math.min(rx, nativeW - 1)) * 4;
  const dstIdx = i * 4;
  gridImageData.data[dstIdx]     = nativePixels[srcIdx];
  gridImageData.data[dstIdx + 1] = nativePixels[srcIdx + 1];
  gridImageData.data[dstIdx + 2] = nativePixels[srcIdx + 2];
  gridImageData.data[dstIdx + 3] = 255;
}

// ─────────────────────────────────────────────
// CHANGEMENT D'ÉTAPE AVEC HÉRITAGE DES COULEURS
// Les nouveaux petits blocs héritent la couleur exacte
// de l'ancien grand bloc qu'ils subdivisent.
// ─────────────────────────────────────────────
function setupPixelStep(stepIndex) {
  const res        = schedule[stepIndex].res;
  const prevBX     = blocksX;
  const prevBY     = blocksY;
  const prevData   = gridImageData;

  blocksX     = res;
  blocksY     = res;
  totalBlocks = blocksX * blocksY;
  gridCanvas.width  = blocksX;
  gridCanvas.height = blocksY;
  gridImageData = gridCtx.createImageData(blocksX, blocksY);

  if (stepIndex === 0 || !prevData || !nativePixels) {
    // Initialisation complète au début
    for (let i = 0; i < totalBlocks; i++) updateBlockColorInGrid(i);
  } else {
    // Héritage : nouveau petit bloc = couleur de l'ancien grand bloc
    for (let y = 0; y < blocksY; y++) {
      for (let x = 0; x < blocksX; x++) {
        const oldX   = Math.floor(x * prevBX / blocksX);
        const oldY   = Math.floor(y * prevBY / blocksY);
        const oldIdx = (oldY * prevBX + oldX) * 4;
        const newIdx = (y * blocksX + x) * 4;
        gridImageData.data[newIdx]     = prevData.data[oldIdx];
        gridImageData.data[newIdx + 1] = prevData.data[oldIdx + 1];
        gridImageData.data[newIdx + 2] = prevData.data[oldIdx + 2];
        gridImageData.data[newIdx + 3] = prevData.data[oldIdx + 3];
      }
    }
  }
  gridCtx.putImageData(gridImageData, 0, 0);
}

// ─────────────────────────────────────────────
// RENDU GRILLE → CANVAS PRINCIPAL
// ─────────────────────────────────────────────
function renderPixelated() {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(gridCanvas, 0, 0, blocksX, blocksY, 0, 0, W, H);
}

// ─────────────────────────────────────────────
// BOUCLE SHIMMER (requestAnimationFrame)
// Met à jour un % de blocs aléatoires toutes les
// shimmerInterval ms. Le % diminue aux hautes rés.
// ─────────────────────────────────────────────
function shimmerLoop(timestamp) {
  if (roundSolved) return;

  if (timestamp - lastShimmerTime >= shimmerInterval) {
    if (nativePixels) {
      const dynamicPct = shimmerPercentage / Math.pow(SHIMMER_DECAY, currentStep);
      const count      = Math.max(1, Math.floor(totalBlocks * dynamicPct));
      for (let k = 0; k < count; k++) {
        updateBlockColorInGrid(Math.floor(Math.random() * totalBlocks));
      }
      gridCtx.putImageData(gridImageData, 0, 0);
    }
    lastShimmerTime = timestamp;
  }

  renderPixelated();
  shimmerFrameId = requestAnimationFrame(shimmerLoop);
}

function drawFull(img) {
  const { dx, dy, dw, dh } = getLetterbox(img);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled    = true;
  ctx.imageSmoothingQuality    = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);
}

// ─────────────────────────────────────────────
// CHARGEMENT IMAGE
// ─────────────────────────────────────────────
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img        = new Image();
    img.crossOrigin  = 'anonymous';
    img.onload       = () => resolve(img);
    img.onerror      = reject;
    img.src          = url;
  });
}

// ─────────────────────────────────────────────
// GESTION DES MANCHES
// ─────────────────────────────────────────────
async function startGame() {
  document.getElementById('start-screen').style.display = 'none';
  currentRound = 0;
  totalScore   = 0;
  updateScore(0);
  await loadRound();
}

async function loadRound() {
  roundSolved   = false;
  currentStep   = 0;
  roundTimeLeft = 30;

  const round = ROUNDS[currentRound];

  // Reset UI
  document.getElementById('round-num').textContent          = `${currentRound + 1} / ${ROUNDS.length}`;
  document.getElementById('guess-input').value              = '';
  document.getElementById('guess-input').className          = 'guess-input';
  document.getElementById('guess-input').disabled           = false;
  document.getElementById('answer-reveal').style.display    = 'none';
  document.getElementById('btn-next').style.display         = 'none';
  document.getElementById('feedback-overlay').className     = 'feedback-overlay';
  document.getElementById('canvas-container').className     = 'canvas-container';

  // Ajoute un séparateur de manche dans l'historique
  addRoundSeparator(currentRound + 1);

  renderHints(round.hints, []);

  // Écran de chargement
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2a2a3a';
  ctx.font      = '700 1rem Space Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CHARGEMENT...', W / 2, H / 2);

  try {
    sourceImage = await loadImage(round.imageUrl);
  } catch (e) {
    generateFallbackImage();
  }

  // Extraire les pixels natifs pour l'échantillonnage
  extractNativePixels(sourceImage);
  lastShimmerTime = 0;

  updatePixelInfo(0);
  startTimers();
  document.getElementById('guess-input').focus();
}

function generateFallbackImage() {
  const offscreen  = document.createElement('canvas');
  offscreen.width  = W;
  offscreen.height = H;
  const c          = offscreen.getContext('2d');
  const grad       = c.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${Math.random() * 360},60%,30%)`);
  grad.addColorStop(1, `hsl(${Math.random() * 360},60%,15%)`);
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);
  c.fillStyle      = 'rgba(255,255,255,0.3)';
  c.font           = 'bold 48px sans-serif';
  c.textAlign      = 'center';
  c.textBaseline   = 'middle';
  c.fillText('?', W / 2, H / 2);
  sourceImage = offscreen;
}

// ─────────────────────────────────────────────
// TIMERS
// ─────────────────────────────────────────────
function startTimers() {
  clearAllTimers();

  // Lance immédiatement la première étape
  runStep();

  // Compte à rebours de 30 secondes
  roundTimeLeft = 30;
  updateTimerUI(30, 30);
  roundTimer = setInterval(() => {
    if (roundSolved) return;
    roundTimeLeft--;
    updateTimerUI(roundTimeLeft, 30);
    if (roundTimeLeft <= 0) {
      clearAllTimers();
      revealFullImage(true);
      showTimeoutResult();
    }
  }, 1000);
}

// Lance une étape : frames aléatoires toutes les shimmerInterval,
// puis passage à l'étape suivante selon le schedule.
function runStep() {
  if (roundSolved) return;

  // Prépare la grille et lance la boucle shimmer
  const gridSize = schedule[currentStep].res;
  updatePixelInfo(currentStep);

  // Révèle un indice tous les 2 paliers
  const hintIdx = Math.floor(currentStep / 2);
  if (hintIdx < ROUNDS[currentRound].hints.length) {
    renderHints(ROUNDS[currentRound].hints, Array.from({ length: hintIdx + 1 }, (_, i) => i));
  }

  setupPixelStep(currentStep);
  shimmerFrameId = requestAnimationFrame(shimmerLoop);

  // Après la durée du palier (selon le schedule), passer à l'étape suivante
  stepTimer = setTimeout(() => {
    cancelAnimationFrame(shimmerFrameId);
    shimmerFrameId = null;
    if (roundSolved) return;

    currentStep++;
    if (currentStep >= schedule.length - 1) {
      clearAllTimers();
      revealFullImage(true);
      showTimeoutResult();
      return;
    }

    runStep();
  }, schedule[currentStep].duration * 1000);
}

function clearAllTimers() {
  cancelAnimationFrame(shimmerFrameId);
  shimmerFrameId = null;
  clearTimeout(stepTimer);
  stepTimer = null;
  clearInterval(roundTimer);
  roundTimer = null;
}

function updatePixelInfo(stepIdx) {
  const gridSize = schedule[stepIdx].res;
  const progress = (stepIdx / (schedule.length - 1)) * 100;
  document.getElementById('pixel-progress-fill').style.width = progress + '%';
  document.getElementById('pixel-label').textContent         = gridSize < 128 ? `${gridSize}×${gridSize} PX` : 'NET';
}

function updateTimerUI(current, total) {
  const frac         = current / total;
  const circumference = 125.6;
  const offset       = circumference * (1 - frac);
  const circle       = document.getElementById('timer-circle');
  circle.style.strokeDashoffset = offset;

  // Vert → jaune → rouge
  if (frac > 0.5)       circle.style.stroke = 'var(--accent2)';
  else if (frac > 0.25) circle.style.stroke = 'var(--gold)';
  else                  circle.style.stroke = 'var(--accent)';

  document.getElementById('timer-text').textContent = current;
}

// ─────────────────────────────────────────────
// LOGIQUE DE RÉPONSE
// ─────────────────────────────────────────────
function addGuessToHistory(text, isCorrect) {
  const history = document.getElementById('guess-history');
  const entry   = document.createElement('div');
  entry.className = 'guess-entry' + (isCorrect ? ' correct' : '');
  entry.innerHTML = `<span class="guess-name">TOI</span><span class="guess-text">${text}</span>`;
  history.appendChild(entry);
  history.scrollTop = history.scrollHeight;
}

function addRoundSeparator(roundNumber) {
  const history = document.getElementById('guess-history');
  if (history.children.length === 0) return; // pas de séparateur avant la toute première manche
  const sep = document.createElement('div');
  sep.className = 'round-separator';
  sep.textContent = `── MANCHE ${roundNumber} ──`;
  history.appendChild(sep);
  history.scrollTop = history.scrollHeight;
}

function addAnswerToHistory(label, won) {
  const history = document.getElementById('guess-history');
  const entry   = document.createElement('div');
  entry.className = 'guess-entry answer-reveal-history';
  const icon = won ? '✓' : '✕';
  entry.innerHTML = `<span class="guess-name">${icon}</span><span class="guess-text answer-text-history">${label}</span>`;
  history.appendChild(entry);
  history.scrollTop = history.scrollHeight;
}

function submitGuess() {
  if (roundSolved) return;
  const input = document.getElementById('guess-input');
  const guess = input.value.trim().toLowerCase();
  if (!guess) return;

  const round   = ROUNDS[currentRound];
  const correct = round.answers.some(a =>
    a.toLowerCase() === guess ||
    guess.includes(a.toLowerCase()) ||
    a.toLowerCase().includes(guess)
  );

  if (correct) {
    addGuessToHistory(guess, true);
    handleCorrect();
  } else {
    addGuessToHistory(guess, false);
    input.classList.remove('wrong');
    void input.offsetWidth;
    input.classList.add('wrong');
    setTimeout(() => input.classList.remove('wrong'), 400);
    input.value = '';
  }
}

function handleCorrect() {
  roundSolved = true;
  clearAllTimers();

  const input = document.getElementById('guess-input');
  input.classList.add('correct');
  input.disabled = true;

  // Calcul des points
  const basePoints = 500;
  const stepBonus  = (schedule.length - 1 - currentStep - 1) * 100;
  const timeBonus  = roundTimeLeft * 10;
  const points     = basePoints + stepBonus + timeBonus;
  totalScore      += points;
  updateScore(totalScore);

  // Image nette immédiatement
  revealFullImage(false);
  document.getElementById('canvas-container').classList.add('solved');

  // Popup points
  const popup       = document.getElementById('points-popup');
  popup.textContent = `+${points}`;
  popup.className   = 'points-popup animate';
  setTimeout(() => { popup.className = 'points-popup'; }, 1300);

  // Feedback overlay
  const overlay       = document.getElementById('feedback-overlay');
  overlay.textContent = '✓ BRAVO!';
  overlay.className   = 'feedback-overlay correct-msg show';
  setTimeout(() => { overlay.className = 'feedback-overlay'; }, 1500);

  // Révèle tous les indices
  renderHints(ROUNDS[currentRound].hints, ROUNDS[currentRound].hints.map((_, i) => i));

  // La réponse dans l'historique
  addAnswerToHistory(ROUNDS[currentRound].label, true);

  // Passage automatique à la manche suivante après 3s
  setTimeout(nextRound, 3000);
}

function showTimeoutResult() {
  roundSolved = true;
  const round = ROUNDS[currentRound];
  document.getElementById('guess-input').disabled = true;

  const overlay       = document.getElementById('feedback-overlay');
  overlay.textContent = '✗ RATÉ';
  overlay.className   = 'feedback-overlay wrong-msg show';
  setTimeout(() => { overlay.className = 'feedback-overlay'; }, 1500);

  document.getElementById('answer-reveal').style.display = 'block';
  document.getElementById('answer-text').textContent     = round.label;

  // La réponse dans l'historique
  addAnswerToHistory(round.label, false);

  // Passage automatique à la manche suivante après 4s
  setTimeout(nextRound, 4000);
}

function revealFullImage(animated = false) {
  if (!sourceImage) return;

  if (!animated) {
    // Bonne réponse → image nette instantanément
    drawFull(sourceImage);
    updatePixelInfo(schedule.length - 1);
  } else {
    // Timeout → dévoilement progressif rapide
    const remaining = schedule.slice(currentStep + 1).map(s => s.res);
    let i = 0;
    const reveal = setInterval(() => {
      if (i < remaining.length - 1) {
        drawMosaic(sourceImage, remaining[i]);
        i++;
      } else {
        clearInterval(reveal);
        drawFull(sourceImage);
        updatePixelInfo(schedule.length - 1);
      }
    }, 80);
  }
}

function showNextButton() {
  const btn     = document.getElementById('btn-next');
  btn.textContent = currentRound < ROUNDS.length - 1
    ? 'MANCHE SUIVANTE →'
    : 'VOIR MON SCORE FINAL';
  btn.style.display = 'block';
}

async function nextRound() {
  currentRound++;
  if (currentRound >= ROUNDS.length) {
    showFinalScore();
    return;
  }
  document.getElementById('btn-next').style.display = 'none';
  await loadRound();
}

function showFinalScore() {
  clearAllTimers();
  document.getElementById('canvas-container').className = 'canvas-container';

  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,215,0,0.05)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd700';
  ctx.font      = 'bold 80px Bebas Neue, sans-serif';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 60);

  ctx.fillStyle = '#e8e8f0';
  ctx.font      = '600 24px Space Mono, monospace';
  ctx.fillText(`SCORE FINAL : ${totalScore} pts`, W / 2, H / 2 + 20);

  ctx.fillStyle = '#6060a0';
  ctx.font      = '400 14px Space Mono, monospace';
  ctx.fillText(`${ROUNDS.length} MANCHES JOUÉES`, W / 2, H / 2 + 60);

  document.getElementById('guess-input').style.display   = 'none';
  document.querySelector('.btn-submit').style.display    = 'none';
  document.getElementById('hints-area').innerHTML        = '';

  const btn       = document.getElementById('btn-next');
  btn.textContent = '↺ REJOUER';
  btn.style.display = 'block';
  btn.onclick = () => {
    currentRound = 0;
    totalScore   = 0;
    updateScore(0);
    document.getElementById('guess-input').style.display  = '';
    document.querySelector('.btn-submit').style.display   = '';
    btn.onclick = nextRound;
    loadRound();
  };
}

// ─────────────────────────────────────────────
// HELPERS UI
// ─────────────────────────────────────────────
function updateScore(val) {
  document.getElementById('score-display').textContent = val;
}

function renderHints(allHints, revealedIndexes) {
  const area    = document.getElementById('hints-area');
  area.innerHTML = allHints.map((h, i) => `
    <div class="hint-chip ${revealedIndexes.includes(i) ? 'revealed' : ''}">
      ${revealedIndexes.includes(i) ? h.toUpperCase() : '?????'}
    </div>
  `).join('');
}

// Touche Entrée
document.getElementById('guess-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitGuess();
});
