import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SettingsForm } from '@/components/SettingsForm';
import { db } from '@/lib/db';
import { getGuest, getWedding } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function WeddingSettings({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) notFound();
  const guest = await getGuest(wedding);
  if (guest?.role !== 'creator') redirect(`/w/${code}`);
  const { data: functions } = await db().from('functions').select('id,kind,custom_name').eq('wedding_id', wedding.id).order('sort');
  return (
    <div className="space-y-4 pt-2">
      <Link href={`/w/${code}`} className="text-sm text-muted">‹ Back</Link>
      <h1 className="text-3xl font-semibold">Wedding settings</h1>
      <SettingsForm code={code} colourMap={wedding.colour_map_enabled} functions={functions ?? []} />
    </div>
  );
}
