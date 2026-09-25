#!/usr/bin/env node
/**
 * One-off migration: re-encodes existing recipe photos in Supabase Storage as
 * <=800px WebP (the format new uploads now use) and points the recipes at the
 * new files. Originals are left in place. Mobile Lighthouse flagged the old
 * full-size JPEGs (~130KB each) as the biggest image cost on the storefront.
 *
 * Usage: node server/scripts/optimize-recipe-images.cjs [--dry-run]
 */
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { optimizeImageBuffer, BUCKET } = require('../utils/image-storage.cjs');

const dryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in environment.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const isOurUnoptimizedImage = (url) =>
  typeof url === 'string' && url.includes(`/${BUCKET}/`) && !url.toLowerCase().endsWith('.webp');

async function reencode(url, tenantId) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  const original = Buffer.from(await res.arrayBuffer());
  const ext = (url.split('.').pop() || 'jpeg').toLowerCase();
  const { buffer, extension, contentType } = await optimizeImageBuffer(original, ext === 'jpg' ? 'jpeg' : ext);
  if (extension !== 'webp') throw new Error(`could not optimize ${url}`);

  const filename = `${tenantId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
  if (!dryRun) {
    const { error } = await supabase.storage.from(BUCKET).upload(filename, buffer, {
      contentType,
      cacheControl: '31536000',
      upsert: false
    });
    if (error) throw new Error(`upload failed: ${error.message}`);
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return { url: data.publicUrl, before: original.length, after: buffer.length };
}

async function main() {
  const { data: recipes, error } = await supabase.from('bakery_recipes').select('id,name,tenant_id,images');
  if (error) {
    console.error('[Optimize Images] Failed to fetch recipes:', error.message);
    process.exit(1);
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let updated = 0;
  const cache = new Map(); // same source URL reused across recipes -> one new file

  for (const recipe of recipes) {
    const images = Array.isArray(recipe.images) ? recipe.images : [];
    const targets = images.filter(isOurUnoptimizedImage);
    if (targets.length === 0) continue;

    const newImages = [];
    for (const img of images) {
      if (!isOurUnoptimizedImage(img)) { newImages.push(img); continue; }
      try {
        if (!cache.has(img)) cache.set(img, await reencode(img, recipe.tenant_id || 'shared'));
        const r = cache.get(img);
        totalBefore += r.before;
        totalAfter += r.after;
        newImages.push(r.url);
        console.log(`  ${recipe.name.slice(0, 40).padEnd(40)} ${Math.round(r.before / 1024)}KB -> ${Math.round(r.after / 1024)}KB`);
      } catch (e) {
        console.warn(`  ${recipe.name}: keeping original (${e.message})`);
        newImages.push(img);
      }
    }

    if (dryRun) { updated++; continue; }
    const { error: updateError } = await supabase.from('bakery_recipes').update({ images: newImages }).eq('id', recipe.id);
    if (updateError) console.error(`[Optimize Images] Failed to update ${recipe.name}:`, updateError.message);
    else updated++;
  }

  console.log(`\n[Optimize Images] ${dryRun ? '(dry run) ' : ''}Recipes updated: ${updated}. Bytes: ${Math.round(totalBefore / 1024)}KB -> ${Math.round(totalAfter / 1024)}KB`);
}

main();
