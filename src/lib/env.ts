function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
export const env = {
  get supabaseUrl() { return req('NEXT_PUBLIC_SUPABASE_URL'); },
  get supabaseAnonKey() { return req('NEXT_PUBLIC_SUPABASE_ANON_KEY'); },
  get supabaseServiceKey() { return req('SUPABASE_SERVICE_ROLE_KEY'); },
  get supabaseJwtSecret() { return req('SUPABASE_JWT_SECRET'); },
  get appUrl() { return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, ''); },
  get adminEmails() { return (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); },
  get cronSecret() { return req('CRON_SECRET'); },
  get embedModel() { return process.env.NEXT_PUBLIC_EMBED_MODEL || 'Marqo/marqo-fashionSigLIP'; },
  get embedDtype() { return process.env.NEXT_PUBLIC_EMBED_DTYPE || 'q8'; },
  get embedUrl() { return process.env.EMBED_URL || ''; },
};
export const EMBED_DIM = 768;
