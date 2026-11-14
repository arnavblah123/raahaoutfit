import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SettingsForm } from '@/components/SettingsForm';
import { sql } from '@/lib/db';
import { getGuest, getWedding, signInEnabled } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function WeddingSettings({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const wedding = await getWedding(code);
  if (!wedding || wedding.purged_at) notFound();
  const guest = await getGuest(wedding);
  if (guest?.role !== 'creator') redirect(`/w/${code}`);
  const requests = await sql(`select id, display_name, status, google_sub is not null as google, phone, phone_verified from guests
                              where wedding_id = $1 and status in ('pending', 'rejected') order by status, created_at`, [wedding.id]);
  const list = await sql(
    `select l.phone, l.name, exists (select 1 from guests g where g.wedding_id = l.wedding_id and g.phone = l.phone) as joined
     from guest_list l where l.wedding_id = $1 order by l.created_at, l.name nulls last, l.phone`, [wedding.id]);
  const functions = await sql('select id, kind, custom_name from functions where wedding_id = $1 order by sort', [wedding.id]);
  return (
    <div className="space-y-4 pt-2">
      <Link href={`/w/${code}`} className="text-sm text-muted">‹ Back</Link>
      <h1 className="text-3xl font-semibold">Wedding settings</h1>
      <SettingsForm code={code} colourMap={wedding.colour_map_enabled} functions={functions} requireApproval={wedding.require_approval}
        signIn={signInEnabled()} requests={requests} list={list} />
    </div>
  );
}
