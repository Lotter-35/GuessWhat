'use strict';

/**
 * SOURCE : Supabase — table `images`
 * Lit toutes les images actives et leurs indices depuis la BDD.
 * Format retourné : { imageUrl, answers: string[], hints: string[] }
 */

const supabase = require('../lib/supabase');

module.exports = async function loadFromSupabase() {
  if (!supabase) {
    console.warn('[SOURCE supabase] Client non initialisé — source ignorée');
    return [];
  }

  // Charge les images actives avec leurs indices via la table de jointure
  const { data, error } = await supabase
    .from('images')
    .select('name, url, aliases, image_hints(hints(label))')
    .eq('active', true);

  if (error) {
    console.error('[SOURCE supabase] Erreur lecture :', error.message);
    return [];
  }

  const rounds = (data || []).map(row => {
    const answers = [row.name, ...(row.aliases || [])].filter(Boolean);
    const hints   = (row.image_hints || [])
      .map(ih => ih.hints?.label)
      .filter(Boolean);

    return { imageUrl: row.url, answers, hints };
  }).filter(r => r.imageUrl && r.answers.length > 0);

  console.log(`[SOURCE supabase] ${rounds.length} image(s) chargée(s) depuis la BDD`);
  return rounds;
};
