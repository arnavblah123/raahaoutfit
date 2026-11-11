import Link from 'next/link';

export default async function Landing({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  const { recovery } = await searchParams;
  return (
    <div className="space-y-8 pt-6">
      {recovery === 'invalid' && <p className="err">That recovery link is not valid any more. Ask the host for the wedding link and join again.</p>}
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold leading-tight">Nobody wants to turn up in the same outfit.</h1>
        <p className="text-lg text-muted">
          Guests add what they plan to wear to each function. Each guest is told, privately, if someone else is wearing the same or a very similar outfit.
        </p>
      </div>
      <Link href="/create" className="btn-primary w-full">Create a wedding</Link>
      <ol className="space-y-3">
        {[
          ['Create the wedding', 'Add the couple, the date and the functions. You get one link to share on WhatsApp.'],
          ['Guests add their outfits', 'Two photos per outfit. No account, no password.'],
          ['Each guest sees her own result', 'Same outfit, similar look, or no clash. Never who, and never the other photo.'],
        ].map(([t, d], i) => (
          <li key={t} className="card flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white">{i + 1}</span>
            <div><p className="font-medium">{t}</p><p className="text-sm text-muted">{d}</p></div>
          </li>
        ))}
      </ol>
      <p className="text-center text-sm text-muted">Got a link from the host? Open it to join.</p>
    </div>
  );
}
