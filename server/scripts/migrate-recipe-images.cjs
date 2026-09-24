#!/usr/bin/env node
/**
 * One-off migration: finds bakery_recipes rows with inline base64 image data
 * (stored directly as text) and uploads them to Supabase Storage, replacing
 * the base64 blob with a hosted public URL. Run once after deploying the
 * server change that stops writing new base64 images.
 *
 * Usage: node server/scripts/migrate-recipe-images.cjs [--dry-run]
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { externalizeRecipeImages } = require('../utils/image-storage.cjs');

const dryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const hasInlineImage = (recipe) => {
  const images = Array.isArray(recipe.images) ? recipe.images : [];
  const inlineInArray = images.some((img) => typeof img === 'string' && img.startsWith('data:image'));
  const inlineImageUrl = typeof recipe.imageUrl === 'string' && recipe.imageUrl.startsWith('data:image');
  return inlineInArray || inlineImageUrl;
};

async function main() {
  console.log(`[Migration] Fetching recipes${dryRun ? ' (dry run)' : ''}...`);
  const { data: recipes, error } = await supabase.from('bakery_recipes').select('*');

  if (error) {
    console.error('[Migration] Failed to fetch recipes:', error.message);
    process.exit(1);
  }

  const toMigrate = (recipes || []).filter(hasInlineImage);
  console.log(`[Migration] Found ${toMigrate.length} of ${recipes.length} recipes with inline base64 images.`);

  let migrated = 0;
  let failed = 0;

  for (const recipe of toMigrate) {
    try {
      const updated = await externalizeRecipeImages(supabase, recipe, {
        tenantId: recipe.tenant_id || 'shared'
      });

      const stillInline = hasInlineImage(updated);
      if (stillInline) {
        console.warn(`[Migration] Recipe ${recipe.id} (${recipe.name}) still has inline data after upload attempt - skipping DB update.`);
        failed++;
        continue;
      }

      if (dryRun) {
        console.log(`[Migration] (dry run) Would update recipe ${recipe.id} (${recipe.name}).`);
        migrated++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('bakery_recipes')
        .update({ images: updated.images })
        .eq('id', recipe.id);

      if (updateError) {
        console.error(`[Migration] Failed to update recipe ${recipe.id}:`, updateError.message);
        failed++;
        continue;
      }

      console.log(`[Migration] Migrated recipe ${recipe.id} (${recipe.name}).`);
      migrated++;
    } catch (e) {
      console.error(`[Migration] Unexpected error on recipe ${recipe.id}:`, e.message);
      failed++;
    }
  }

  console.log(`\n[Migration] Done. Migrated: ${migrated}, Failed: ${failed}, Skipped (no inline images): ${recipes.length - toMigrate.length}`);
  if (failed > 0) process.exit(1);
}

main();
