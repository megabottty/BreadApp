const crypto = require('crypto');

const BUCKET = 'recipe-images';
const DATA_URL_REGEX = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/;

// Product photos render in a ~400x250 card (up to ~800px on high-DPI phones),
// so anything larger is wasted bytes. WebP at this quality is typically a
// third the size of the JPEGs the app used to store.
const MAX_IMAGE_WIDTH = 800;
// A second, smaller rendition for phones (served via srcset as "<name>-400.webp").
const SMALL_IMAGE_WIDTH = 400;
const SMALL_SUFFIX = `-${SMALL_IMAGE_WIDTH}`;
const WEBP_QUALITY = 75;

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[Image Storage] sharp unavailable, images will be stored unoptimized:', e.message);
}

/**
 * Resize to at most MAX_IMAGE_WIDTH wide and convert to WebP. Returns the
 * original buffer/extension if sharp is missing or the image can't be decoded.
 */
async function optimizeImageBuffer(buffer, extension) {
  if (!sharp) return { buffer, extension, contentType: `image/${extension}` };
  try {
    const optimized = await sharp(buffer)
      .rotate() // honor EXIF orientation from phone cameras
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { buffer: optimized, extension: 'webp', contentType: 'image/webp' };
  } catch (e) {
    console.warn('[Image Storage] Optimization failed, storing original:', e.message);
    return { buffer, extension, contentType: `image/${extension}` };
  }
}

/**
 * Uploads a base64 data: URL image to Supabase Storage and returns its public URL.
 * Non-data-URL strings (already-hosted URLs) are returned unchanged.
 */
async function uploadInlineImage(supabase, dataUrl, { tenantId = 'shared' } = {}) {
  if (!supabase || typeof dataUrl !== 'string') return dataUrl;

  const match = dataUrl.match(DATA_URL_REGEX);
  if (!match) return dataUrl; // Not a base64 image (already a hosted URL) - leave as-is.

  const [, ext, base64Payload] = match;
  const original = Buffer.from(base64Payload, 'base64');
  const { buffer, extension, contentType } = await optimizeImageBuffer(original, ext === 'jpg' ? 'jpeg' : ext);
  const filename = `${tenantId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, {
      contentType,
      cacheControl: '31536000',
      upsert: false
    });

  if (uploadError) {
    console.error('[Image Storage] Upload failed, falling back to inline image:', uploadError.message);
    return dataUrl; // Fail safe: keep the original base64 rather than losing the image.
  }

  // Phone-sized sibling; the storefront's srcset points at it by naming convention.
  if (extension === 'webp') {
    const small = await makeSmallVariant(buffer);
    if (small) {
      const { error: smallError } = await supabase.storage
        .from(BUCKET)
        .upload(smallVariantPath(filename), small, { contentType, cacheControl: '31536000', upsert: true });
      if (smallError) console.warn('[Image Storage] Small variant upload failed:', smallError.message);
    }
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

/**
 * Builds the phone-sized rendition of an already-optimized WebP. Returns null
 * if sharp is unavailable or the image can't be decoded.
 */
async function makeSmallVariant(buffer) {
  if (!sharp) return null;
  try {
    return await sharp(buffer)
      .resize({ width: SMALL_IMAGE_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (e) {
    console.warn('[Image Storage] Small variant failed:', e.message);
    return null;
  }
}

/** "<path>/<name>.webp" -> "<path>/<name>-400.webp" */
function smallVariantPath(filename) {
  return filename.replace(/\.webp$/i, `${SMALL_SUFFIX}.webp`);
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

module.exports = { uploadInlineImage, externalizeRecipeImages, optimizeImageBuffer, makeSmallVariant, smallVariantPath, BUCKET, SMALL_SUFFIX };
