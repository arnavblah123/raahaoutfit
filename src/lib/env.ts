function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
export const env = {
  get appUrl() { return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, ''); },
  get adminPassword() { return req('ADMIN_PASSWORD'); },
  get sessionSecret() { return req('SESSION_SECRET'); },
  get embedModel() { return process.env.NEXT_PUBLIC_EMBED_MODEL || 'Marqo/marqo-fashionSigLIP'; },
  get embedDtype() { return process.env.NEXT_PUBLIC_EMBED_DTYPE || 'q8'; },
  get embedUrl() { return process.env.EMBED_URL || ''; },
};
export const EMBED_DIM = 768;
