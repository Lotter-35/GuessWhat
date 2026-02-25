'use strict';

/**
 * SOURCE : sampleapis.com — Films
 * Catégories disponibles : comedy | animation | adventure | horror | ...
 * Doc : https://sampleapis.com/api-list/movies
 *
 * Chaque entrée retournée doit avoir la forme :
 *   { imageUrl: string, answers: string[], hints: string[] }
 */

const fetch = require('node-fetch');

const CATEGORIES = ['comedy', 'animation', 'adventure'];

function uniqueArr(arr) {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}

module.exports = async function loadMovies() {
  const rounds = [];

  await Promise.all(CATEGORIES.map(async cat => {
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

        const titleSimple = title.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').trim();
        const answers = uniqueArr([title, titleSimple].filter(Boolean));

        rounds.push({
          imageUrl: m.posterURL,
          answers,
          hints: ['film', 'cinéma', cat]
        });
      }
      console.log(`[SOURCE movies] ${cat} : ${rounds.length} films chargés`);
    } catch (e) {
      console.error(`[SOURCE movies] ${cat} erreur :`, e.message);
    }
  }));

  return rounds;
};
