const crypto = require('crypto');

const BUCKET = 'recipe-images';
const DATA_URL_REGEX = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/;

/**
 * Uploads a base64 data: URL image to Supabase Storage and returns its public URL.
 * Non-data-URL strings (already-hosted URLs) are returned unchanged.
 */
async function uploadInlineImage(supabase, dataUrl, { tenantId = 'shared' } = {}) {
  if (!supabase || typeof dataUrl !== 'string') return dataUrl;

  const match = dataUrl.match(DATA_URL_REGEX);
  if (!match) return dataUrl; // Not a base64 image (already a hosted URL) - leave as-is.

  const [, ext, base64Payload] = match;
  const buffer = Buffer.from(base64Payload, 'base64');
  const extension = ext === 'jpg' ? 'jpeg' : ext;
  const filename = `${tenantId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, {
      contentType: `image/${extension}`,
      cacheControl: '31536000',
      upsert: false
    });

  if (uploadError) {
    console.error('[Image Storage] Upload failed, falling back to inline image:', uploadError.message);
    return dataUrl; // Fail safe: keep the original base64 rather than losing the image.
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

/**
 * Walks a recipe payload's image fields (images[] and imageUrl) and replaces any
 * inline base64 data with uploaded Supabase Storage URLs.
 */
async function externalizeRecipeImages(supabase, recipe, { tenantId } = {}) {
  const result = { ...recipe };

  if (Array.isArray(result.images) && result.images.length > 0) {
    result.images = await Promise.all(
      result.images.map((img) => uploadInlineImage(supabase, img, { tenantId }))
    );
  }

  if (result.imageUrl) {
    result.imageUrl = await uploadInlineImage(supabase, result.imageUrl, { tenantId });
  }

  return result;
}

module.exports = { uploadInlineImage, externalizeRecipeImages, BUCKET };
