import { CreateForm } from '@/components/CreateForm';
import { SignIn, SignedInAs } from '@/components/SignIn';
import { googleEnabled } from '@/lib/google';
import { otpEnabled } from '@/lib/otp';
import { maskPhone } from '@/lib/phone';
import { getIdentity, signInEnabled } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function CreateWedding({ searchParams }: { searchParams: Promise<{ signin?: string }> }) {
  const id = await getIdentity();
  if (signInEnabled() && !id) {
    return (
      <div className="space-y-5 pt-2">
        <h1 className="text-3xl font-semibold">Create a wedding</h1>
        <p className="text-muted">Sign in first, so you can always get back to your wedding and manage the guest list.</p>
        <SignIn next="/create" phone={otpEnabled()} google={googleEnabled()} failed={(await searchParams).signin === 'failed'} />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <CreateForm name={id?.name ?? ''} guestList={signInEnabled()} />
      {id && <SignedInAs label={id.phone ? maskPhone(id.phone) : id.email || 'Google'} />}
    </div>
  );
}
