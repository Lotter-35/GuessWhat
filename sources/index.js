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

const movies          = require('./movies');
const pokemon         = require('./pokemon');
const loadSupabase    = require('./supabase');
// ↓ Ajoute tes nouvelles sources ici ↓
// const anime  = require('./anime');
// const flags  = require('./flags');

const API_SOURCES = [
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
 * Priorité : Supabase (images personnalisées). Si Supabase contient
 * des images, on n'utilise QUE celles-ci. Sinon, fallback sur les APIs.
 */
/** Charge uniquement les APIs (Pokemon, films…) */
async function loadApiRounds() {
  const results = await Promise.all(
    API_SOURCES.map(fn =>
      fn().catch(e => {
        console.error('[SOURCES/API] Erreur :', e.message);
        return [];
      })
    )
  );
  const all = results.flat();
  console.log(`[SOURCES/API] ${all.length} manches chargées depuis ${API_SOURCES.length} source(s).`);
  return shuffle(all);
}

/** Charge uniquement la base de données Supabase */
async function loadSupabaseRounds() {
  const rounds = await loadSupabase().catch(e => {
    console.error('[SOURCES/Supabase] Erreur :', e.message);
    return [];
  });
  console.log(`[SOURCES/Supabase] ${rounds.length} images chargées.`);
  return shuffle(rounds);
}

/** Compat : charge selon le mode passé en paramètre ('api' | 'db') */
async function loadAllRounds(mode = 'api') {
  return mode === 'db' ? loadSupabaseRounds() : loadApiRounds();
}

module.exports = { loadAllRounds, loadApiRounds, loadSupabaseRounds };
