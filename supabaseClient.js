'use strict';

/**
 * ═══════════════════════════════════════════════════════════
 *  SUPABASE CLIENT
 *  Variables d'environnement (Railway en prod, .env en local) :
 *    SUPABASE_URL
 *    SUPABASE_ANON_KEY
 *    SUPABASE_SERVICE_KEY
 * ═══════════════════════════════════════════════════════════
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
  console.error('[SUPABASE] ⚠️  Variables d\'environnement manquantes : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY');
  console.error('[SUPABASE] En local : crée un fichier .env (voir .env.example)');
  process.exit(1);
}

// Client public (lecture seule) — utilisé par le jeu
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Client admin (service_role) — utilisé par les routes /admin
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const STORAGE_BUCKET = 'game-images';

module.exports = { supabase, supabaseAdmin, STORAGE_BUCKET };
