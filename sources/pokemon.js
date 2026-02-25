'use strict';

/**
 * SOURCE : pokeapi.co — Pokémon
 * Génération 1 (IDs 1-151) avec artwork officiel.
 * Doc : https://pokeapi.co/docs/v2
 *
 * Pour ajouter une nouvelle génération, mets à jour POKE_COUNT.
 * Ex : Gen 1+2 → POKE_COUNT = 251
 *
 * Chaque entrée retournée doit avoir la forme :
 *   { imageUrl: string, answers: string[], hints: string[] }
 */

const fetch = require('node-fetch');

const POKE_COUNT = 151;   // IDs 1 → POKE_COUNT
const BATCH_SIZE = 15;    // requêtes parallèles par lot

function uniqueArr(arr) {
  return arr.filter((v, i, a) => a.indexOf(v) === i);
}

module.exports = async function loadPokemon() {
  const rounds = [];

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

        const nameFr    = species.names.find(n => n.language.name === 'fr')?.name || '';
        const nameEnRaw = poke.name;
        const nameEn    = nameEnRaw.charAt(0).toUpperCase() + nameEnRaw.slice(1);

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
        console.error(`[SOURCE pokemon] #${id} erreur :`, e.message);
      }
    }));
  }

  console.log(`[SOURCE pokemon] ${rounds.length} pokémon chargés`);
  return rounds;
};
