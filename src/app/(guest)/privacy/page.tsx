export const metadata = { title: 'Privacy | Outfit Clash' };

export default function Privacy() {
  const items: [string, string][] = [
    ['What we ask for', 'Your mobile number or Google account to sign in, your first name, and two or more photos of your outfit. No password.'],
    ['Why we ask for your number', 'The host gives us the guest list as mobile numbers, so only invited people can get in. We text you a one-time code to check the number is yours. We never send anything else to it.'],
    ['Who sees your number', 'Only the host, who already has it or is deciding whether to let you in. Other guests never see it. If you sign in with Google we also keep your Google email; nobody else sees that.'],
    ['If you are not on the guest list', 'You can ask to join. The host sees the name you typed and your number, and decides.'],
    ['Your face is not needed', 'Please crop your face out, or photograph the outfit on a hanger. We also crop every photo to the outfit automatically and throw the original away straight after.'],
    ['Nobody else sees your photos', 'Other guests and the host never see your photo or your name next to an outfit. A guest is only told that a similar outfit exists, never whose it is.'],
    ['How the check works', 'An AI model reads the outfit (garment, colour, work) and compares it with other outfits for the same function at the same wedding. Photos are sent to our AI provider for this and nothing else.'],
    ['Hidden details are removed', 'Location, date and phone details stored inside a photo file are stripped before we save it.'],
    ['Delete any time', 'You can delete an outfit whenever you like. The photos, the attributes and the match data go with it.'],
    ['Automatic deletion', 'Seven days after the wedding date we delete all photos, names, phone numbers, the guest list and outfit details. Only anonymous counts remain.'],
    ['One optional exception', 'If you tick the box on the upload screen, we keep the cropped outfit photo (never your name or the wedding) to help improve matching. Leave it unticked and nothing is kept.'],
  ];
  return (
    <div className="space-y-4 pt-2">
      <h1 className="text-3xl font-semibold">Privacy, in plain words</h1>
      {items.map(([t, d]) => (
        <div key={t} className="card"><p className="font-medium">{t}</p><p className="mt-1 text-sm text-muted">{d}</p></div>
      ))}
    </div>
  );
}
