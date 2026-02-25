'use strict';

/**
 * ═══════════════════════════════════════════════════════════
 *  ROUTES ADMIN — CRUD images
 *  Toutes ces routes nécessitent le header :
 *    x-admin-password: <ADMIN_PASSWORD>
 *  Variable d'env sur Railway : ADMIN_PASSWORD (défaut : "admin")
 * ═══════════════════════════════════════════════════════════
 */

const express  = require('express');
const multer   = require('multer');
const sharp    = require('sharp');
const { supabaseAdmin, STORAGE_BUCKET } = require('../supabaseClient');

const router = express.Router();

// Multer v2 : memoryStorage via l'instance
const storage = multer.memoryStorage();
const upload  = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('[ADMIN] Variable d\'env ADMIN_PASSWORD manquante.');

// ──────────────────────────────────────────────────────────
//  INITIALISATION AUTOMATIQUE (bucket)
// ──────────────────────────────────────────────────────────
async function initSupabase() {
  console.log('[ADMIN] Vérification bucket Supabase Storage…');

  // ── 1. Bucket ────────────────────────────────────────────
  const { data: buckets, error: bucketListErr } = await supabaseAdmin.storage.listBuckets();

  if (bucketListErr) {
    console.error('[ADMIN] Impossible de lister les buckets :', bucketListErr.message);
  } else {
    const exists = buckets.some(b => b.name === STORAGE_BUCKET);
    if (!exists) {
      console.log(`[ADMIN] Bucket "${STORAGE_BUCKET}" absent → création…`);
      const { error: createErr } = await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        fileSizeLimit:    20971520  // 20 MB
      });
      if (createErr) {
        console.error('[ADMIN] Erreur création bucket :', createErr.message);
      } else {
        console.log(`[ADMIN] Bucket "${STORAGE_BUCKET}" créé avec succès.`);
      }
    } else {
      console.log(`[ADMIN] Bucket "${STORAGE_BUCKET}" OK.`);
    }
  }

  // ── 2. Table ─────────────────────────────────────────────
  console.log('[ADMIN] Vérification table game_images…');

  // Tente une lecture légère pour savoir si la table existe
  const { error: testErr } = await supabaseAdmin.from('game_images').select('id').limit(1);
  if (testErr) {
    console.error('[ADMIN] ⚠️  Table "game_images" introuvable. Ouvre /admin pour voir le SQL de setup.');
  } else {
    console.log('[ADMIN] Table "game_images" OK.');
  }
}

// Lance l'init au démarrage (non bloquant)
initSupabase().catch(e => console.error('[ADMIN] initSupabase :', e.message));

// ── Middleware d'auth ────────────────────────
function requireAuth(req, res, next) {
  const pwd = req.headers['x-admin-password'] || req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  next();
}

// ── GET /admin/api/images ── liste toutes les images ───────
router.get('/images', requireAuth, async (req, res) => {
  const page  = parseInt(req.query.page  || '1', 10);
  const limit = parseInt(req.query.limit || '100', 10);
  const from  = (page - 1) * limit;
  const to    = from + limit - 1;

  const { data, error, count } = await supabaseAdmin
    .from('game_images')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ images: data, total: count, page, limit });
});

// ── GET /admin/api/images/:id ── détail d'une image ────────
router.get('/images/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('game_images')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Image introuvable.' });
  res.json(data);
});

// ── POST /admin/api/images ── upload d'une nouvelle image ──
router.post('/images', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });

  const rawAnswers = req.body.answers || '';
  const rawHints   = req.body.hints   || '';

  const answers = rawAnswers.split('\n').map(s => s.trim()).filter(Boolean);
  const hints   = rawHints.split('\n').map(s => s.trim()).filter(Boolean);

  if (answers.length === 0) {
    return res.status(400).json({ error: 'Au moins une réponse est requise.' });
  }

  try {
    // ── Traitement de l'image avec Sharp ──────
    const processed = await sharp(req.file.buffer)
      .resize(520, 520, { fit: 'fill' })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer();

    // ── Nom de fichier unique ──────────────────
    const ext      = '.jpg';
    const safeName = answers[0].toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '_').slice(0, 40);
    const filename = `${Date.now()}_${safeName}${ext}`;
    const storagePath = filename;

    // ── Upload vers Supabase Storage ──────────
    const { error: uploadError } = await supabaseAdmin
      .storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, processed, {
        contentType:  'image/jpeg',
        cacheControl: '3600',
        upsert:       false
      });

    if (uploadError) throw new Error(uploadError.message);

    // ── URL publique ──────────────────────────
    const { data: urlData } = supabaseAdmin
      .storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const url = urlData.publicUrl;

    // ── Insertion en base ─────────────────────
    const { data: row, error: dbError } = await supabaseAdmin
      .from('game_images')
      .insert({ filename, url, answers, hints, active: true })
      .select()
      .single();

    if (dbError) throw new Error(dbError.message);

    res.status(201).json(row);

  } catch (err) {
    console.error('[ADMIN] Erreur upload :', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/api/images/:id ── modifier réponses/indices/active ─
router.patch('/images/:id', requireAuth, express.json(), async (req, res) => {
  const { answers, hints, active } = req.body;
  const updates = {};
  if (Array.isArray(answers)) updates.answers = answers;
  if (Array.isArray(hints))   updates.hints   = hints;
  if (typeof active === 'boolean') updates.active = active;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Rien à mettre à jour.' });
  }

  const { data, error } = await supabaseAdmin
    .from('game_images')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /admin/api/images/:id ── supprimer image ────────
router.delete('/images/:id', requireAuth, async (req, res) => {
  // Récupère le nom du fichier
  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('game_images')
    .select('filename')
    .eq('id', req.params.id)
    .single();

  if (fetchErr) return res.status(404).json({ error: 'Image introuvable.' });

  // Supprime le fichier dans Storage
  await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([row.filename]);

  // Supprime l'entrée en base
  const { error: dbError } = await supabaseAdmin
    .from('game_images')
    .delete()
    .eq('id', req.params.id);

  if (dbError) return res.status(500).json({ error: dbError.message });
  res.json({ success: true });
});

// ── GET /admin/api/stats ── statistiques générales ─────────
router.get('/stats', requireAuth, async (req, res) => {
  const [r1, r2, r3] = await Promise.all([
    supabaseAdmin.from('game_images').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('game_images').select('*', { count: 'exact', head: true }).eq('active', true),
    supabaseAdmin.from('game_images').select('*', { count: 'exact', head: true }).eq('active', false),
  ]);

  // Si la table n'existe pas encore, on retourne un indicateur spécial
  if (r1.error) {
    const msg = r1.error.message || '';
    const needsSetup = msg.includes('does not exist') || msg.includes('relation') || msg.includes('42P01');
    return res.status(needsSetup ? 503 : 500).json({
      error:      r1.error.message,
      needsSetup: needsSetup
    });
  }

  res.json({ total: r1.count, active: r2.count, inactive: r3.count });
});

// ── GET /admin/api/setup ── retourne le SQL à exécuter ─────
router.get('/setup', requireAuth, (req, res) => {
  res.json({
    sql: [
      `-- 1. Créer la table`,
      `CREATE TABLE IF NOT EXISTS game_images (`,
      `  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,`,
      `  filename   TEXT NOT NULL,`,
      `  url        TEXT NOT NULL,`,
      `  answers    TEXT[] NOT NULL DEFAULT '{}',`,
      `  hints      TEXT[] NOT NULL DEFAULT '{}',`,
      `  active     BOOLEAN DEFAULT TRUE,`,
      `  created_at TIMESTAMPTZ DEFAULT NOW()`,
      `);`,
      ``,
      `-- 2. Activer la sécurité par lignes`,
      `ALTER TABLE game_images ENABLE ROW LEVEL SECURITY;`,
      ``,
      `-- 3. Politique lecture publique (jeu)`,
      `CREATE POLICY "read_active" ON game_images`,
      `  FOR SELECT TO anon USING (active = TRUE);`,
      ``,
      `-- 4. Politique admin totale`,
      `CREATE POLICY "service_all" ON game_images`,
      `  FOR ALL TO service_role USING (TRUE);`,
    ].join('\n'),
    dashboardUrl: 'https://supabase.com/dashboard/project/ywmmxtkdtusdqluxmczv/sql/new'
  });
});

module.exports = { router, ADMIN_PASSWORD };
