import { useEffect, useState } from 'react';
import { getSession, signIn, signUpWithInvite } from '@/lib/auth';
import { Button } from '@/components/ui/primitives';
import { Item, PageStagger } from '@/components/anim';

const MESSAGES: Record<string, string> = {
  invalid_invite: 'That invite code is invalid, already used, or expired.',
  cap_reached: 'Signups are full right now — try again later.',
  missing_fields: 'Please fill in every field.',
  create_user_failed: "Couldn't create the account — that email may already be registered.",
  network_error: 'Network error — check your connection and try again.',
  not_configured: 'Signup is unavailable right now.',
};
const messageFor = (code: string) => MESSAGES[code] ?? 'Signup failed — please try again.';

export default function SignupForm() {
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSession().then((s) => {
      if (s) window.location.href = '/app';
    });
  }, []);

  const inputClass =
    'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';
  const labelClass = 'mt-2 t-label text-muted';

  return (
    <PageStagger>
      <Item>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = await signUpWithInvite({ email, password, displayName, inviteCode });
            if (!res.ok) {
              setBusy(false);
              setError(messageFor(res.error ?? ''));
              return;
            }
            // Account created + email pre-confirmed; sign straight in.
            const { error: signInErr } = await signIn(email, password);
            setBusy(false);
            window.location.href = signInErr ? '/login' : '/app';
          }}
          className="flex flex-col gap-3"
        >
          <label className="t-label text-muted">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            autoComplete="nickname"
            required
            className={inputClass}
          />
          <label className={labelClass}>Invite code</label>
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            autoComplete="off"
            required
            className={inputClass}
          />
          <label className={labelClass}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className={inputClass}
          />
          <label className={labelClass}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClass}
          />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" disabled={busy} className="mt-4 w-full">
            {busy ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </Item>
    </PageStagger>
  );
}
