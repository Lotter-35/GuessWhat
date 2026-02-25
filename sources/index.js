'use strict';

/**
 * ═══════════════════════════════════════════════════════════
 *  SOURCES — Orchestrateur
 *  Pour ajouter une nouvelle source :
 *    1. Crée un fichier dans ce dossier (ex: sources/anime.js)
 *    2. Exporte une fonction async qui retourne :
 *         [{ imageUrl, answers: string[], hints: string[] }, ...]
 *    3. Ajoute le require() dans le tableau SOURCES ci-dessous
 * ═══════════════════════════════════════════════════════════
 */

const movies  = require('./movies');
const pokemon = require('./pokemon');
// ↓ Ajoute tes nouvelles sources ici ↓
// const anime  = require('./anime');
// const flags  = require('./flags');

const SOURCES = [
  movies,
  pokemon,
  // anime,
  // flags,
];

/** Mélange un tableau en place (Fisher-Yates). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Charge toutes les sources en parallèle et retourne un tableau
 * fusionné et mélangé de manches.
 * Si une source échoue, elle est ignorée sans bloquer les autres.
 */
async function loadAllRounds() {
  const results = await Promise.all(
    SOURCES.map(fn =>
      fn().catch(e => {
        console.error('[SOURCES] Erreur sur une source :', e.message);
        return [];
      })
    )
  );

  const all = results.flat();
  console.log(`[SOURCES] Total : ${all.length} manches chargées depuis ${SOURCES.length} source(s)`);
  return shuffle(all);
}

module.exports = { loadAllRounds };
