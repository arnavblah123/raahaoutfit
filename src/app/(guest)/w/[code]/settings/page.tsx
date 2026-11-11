import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SettingsForm } from '@/components/SettingsForm';
import { sql } from '@/lib/db';
import { getGuest, getWedding } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function WeddingSettings({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) notFound();
  const guest = await getGuest(wedding);
  if (guest?.role !== 'creator') redirect(`/w/${code}`);
  const functions = await sql('select id, kind, custom_name from functions where wedding_id = $1 order by sort', [wedding.id]);
  return (
    <div className="space-y-4 pt-2">
      <Link href={`/w/${code}`} className="text-sm text-muted">‹ Back</Link>
      <h1 className="text-3xl font-semibold">Wedding settings</h1>
      <SettingsForm code={code} colourMap={wedding.colour_map_enabled} functions={functions} />
    </div>
  );
}
