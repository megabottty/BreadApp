#!/usr/bin/env node
/**
 * Marks an account as the baker of a bakery, in Supabase `app_metadata`
 * (which only the server/service key can change -- unlike user_metadata,
 * which any signed-in user can edit about themselves).
 *
 * The server's requireBaker check reads ONLY app_metadata, so run this once
 * for the owner's account before deploying that check.
 *
 *   node server/scripts/set-baker.cjs <email> <bakery-slug>
 *   node server/scripts/set-baker.cjs meganmuirhead@gmail.com thedailydough
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (from .env).
 */
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');

const [email, slug] = process.argv.slice(2);
if (!email || !slug) {
  console.error('Usage: node server/scripts/set-baker.cjs <email> <bakery-slug>');
  process.exit(1);
}
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (check .env).');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const findUserByEmail = async (target) => {
  const wanted = target.trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find(u => (u.email || '').toLowerCase() === wanted);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
  return null;
};

(async () => {
  const { data: tenant, error: tenantErr } = await supabase
    .from('bakery_tenants').select('id, name, slug').eq('slug', slug).maybeSingle();
  if (tenantErr) throw tenantErr;
  if (!tenant) {
    console.error(`No bakery with slug "${slug}".`);
    process.exit(1);
  }

  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`No account with email ${email}.`);
    process.exit(1);
  }

  const appMetadata = { ...(user.app_metadata || {}), role: 'BAKER', tenant_id: tenant.id };
  // Keep user_metadata in step too, so older screens that still read it agree.
  const userMetadata = { ...(user.user_metadata || {}), role: 'BAKER', tenant_id: tenant.id, bakery_slug: tenant.slug };
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: appMetadata,
    user_metadata: userMetadata
  });
  if (error) throw error;

  console.log(`Done: ${email} is now the baker of "${tenant.name}" (${tenant.slug}, ${tenant.id}).`);
  console.log('Log out of the site and back in so your browser picks up the change.');
})().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
