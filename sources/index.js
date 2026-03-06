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

const loadRandomRound = require('./supabase');

/**
 * Charge une manche aléatoire depuis la BDD.
 * Retourne { imageUrl, answers, hints } ou null en cas d'échec.
 */
async function loadNextRound() {
  try {
    return await loadRandomRound();
  } catch (e) {
    console.error('[SOURCES] Erreur lors du chargement aléatoire :', e.message);
    return null;
  }
}

module.exports = { loadNextRound };
