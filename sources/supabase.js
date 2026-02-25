'use strict';

/**
 * ═══════════════════════════════════════════════════════════
 *  SOURCE : Supabase (images personnalisées)
 *  Retourne toutes les images actives de la base de données.
 *  Format de retour : [{ imageUrl, answers, hints }, ...]
 * ═══════════════════════════════════════════════════════════
 */

const { supabase } = require('../supabaseClient');

async function loadSupabaseImages() {
  const { data, error } = await supabase
    .from('game_images')
    .select('url, answers, hints')
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[SOURCES/Supabase] Erreur :', error.message);
    return [];
  }

  if (!data || data.length === 0) {
    console.log('[SOURCES/Supabase] Aucune image dans la base.');
    return [];
  }

  // Filtre les entrées sans réponses
  const rounds = data
    .filter(row => row.answers && row.answers.length > 0)
    .map(row => ({
      imageUrl: row.url,
      answers:  row.answers,
      hints:    row.hints || []
    }));

  console.log(`[SOURCES/Supabase] ${rounds.length} images chargées.`);
  return rounds;
}

module.exports = loadSupabaseImages;
