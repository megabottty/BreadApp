#!/usr/bin/env node
/**
 * One-off: creates the 400px "<name>-400.webp" sibling for every recipe photo
 * already stored as WebP, so the storefront srcset can serve phones a smaller
 * file. New uploads get the sibling automatically (see utils/image-storage.cjs).
 *
 * Usage: node server/scripts/make-small-image-variants.cjs
 */
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { makeSmallVariant, smallVariantPath, BUCKET } = require('../utils/image-storage.cjs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const marker = `/${BUCKET}/`;

async function main() {
  const { data: recipes, error } = await supabase.from('bakery_recipes').select('name,images');
  if (error) { console.error(error.message); process.exit(1); }

  const urls = new Set(recipes.flatMap((r) => r.images || []).filter((u) => typeof u === 'string' && u.includes(marker) && /\.webp$/i.test(u)));
  let made = 0;
  for (const url of urls) {
    const objectPath = url.slice(url.indexOf(marker) + marker.length);
    const res = await fetch(url);
    if (!res.ok) { console.warn('download failed', url); continue; }
    const small = await makeSmallVariant(Buffer.from(await res.arrayBuffer()));
    if (!small) continue;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(smallVariantPath(objectPath), small, {
      contentType: 'image/webp', cacheControl: '31536000', upsert: true
    });
    if (upErr) { console.warn('upload failed', objectPath, upErr.message); continue; }
    made++;
    console.log(`  ${objectPath.split('/').pop()} -> ${Math.round(small.length / 1024)}KB`);
  }
  console.log(`\nSmall variants created: ${made} of ${urls.size}`);
}

main();
