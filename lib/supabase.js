'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('[SUPABASE] Client initialisé');
} else {
  console.warn('[SUPABASE] Variables manquantes (SUPABASE_URL / SUPABASE_ANON_KEY) — désactivé');
}

module.exports = supabase;
