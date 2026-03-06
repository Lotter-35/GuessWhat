'use strict';

/**
 * SOURCE : Supabase — table `images`
 * Charge une image aléatoire via COUNT puis SELECT par offset.
 * Format retourné : { imageUrl, answers: string[], hints: string[] } | null
 */

const supabase = require('../lib/supabase');

async function loadRandomRound() {
  if (!supabase) {
    console.warn('[SOURCE supabase] Client non initialisé');
    return null;
  }

  // 1. COUNT des images actives
  console.log('[DB] → COUNT images WHERE active = true');
  const { count, error: countErr } = await supabase
    .from('images')
    .select('*', { count: 'exact', head: true })
    .eq('active', true);

  if (countErr) {
    console.error('[DB] ✗ COUNT échoué :', countErr.message);
    return null;
  }
  if (!count || count === 0) {
    console.warn('[DB] ✗ Aucune image active en BDD');
    return null;
  }
  console.log(`[DB] ✓ COUNT = ${count}`);

  // 2. SELECT d'une image à un offset aléatoire
  const offset = Math.floor(Math.random() * count);
  console.log(`[DB] → SELECT image à l'offset ${offset + 1}/${count}`);
  const { data, error } = await supabase
    .from('images')
    .select('name, url, aliases, image_hints(hints(label))')
    .eq('active', true)
    .range(offset, offset)
    .single();

  if (error || !data) {
    console.error('[DB] ✗ SELECT échoué :', error?.message);
    return null;
  }

  const answers = [data.name, ...(data.aliases || [])].filter(Boolean);
  const hints   = (data.image_hints || []).map(ih => ih.hints?.label).filter(Boolean);

  if (!data.url || answers.length === 0) {
    console.warn('[DB] ✗ Données invalides pour cette image (pas d\'URL ou pas de réponse)');
    return null;
  }

  console.log(`[DB] ✓ Image chargée : "${answers[0]}" | ${hints.length} indice(s) | offset ${offset + 1}/${count}`);
  return { imageUrl: data.url, answers, hints };
}

module.exports = loadRandomRound;
