import { SettingsEditor } from '@/components/admin/Buttons';
import { models } from '@/lib/ai';
import { env } from '@/lib/env';
import { getSettings } from '@/lib/settings';

export default async function AdminSettings() {
  const s = await getSettings(true);
  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="card"><SettingsEditor values={s} /></div>
      <div className="card space-y-1 text-sm">
        <p className="font-medium">Models (set in environment variables)</p>
        <p className="text-muted">Read: {models.read} · Judge: {models.judge} · Vocabulary: {models.vocab}</p>
        <p className="text-muted">Embeddings: {env.embedModel} ({env.embedDtype}), {process.env.NEXT_PUBLIC_EMBED_MODE || 'browser'} mode{env.embedUrl ? ', embedding server configured' : ''}</p>
      </div>
    </div>
  );
}
