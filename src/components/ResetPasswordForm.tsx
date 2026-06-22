import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { updatePassword } from '@/lib/auth';
import { Button } from '@/components/ui/primitives';
import { Item, PageStagger } from '@/components/anim';

type State = 'checking' | 'ready' | 'no-session' | 'done';

const MIN_PASSWORD = 8;

export default function ResetPasswordForm() {
  const [state, setState] = useState<State>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // detectSessionInUrl in supabase.ts turns the email recovery link into a
    // session automatically. Wait for it, then check.
    let unsub = () => {};
    const settle = async () => {
      const { data } = await supabase.auth.getSession();
      setState(data.session ? 'ready' : 'no-session');
    };
    const sub = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setState('ready');
    });
    unsub = () => sub.data.subscription.unsubscribe();
    settle();
    return unsub;
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setState('done');
    setTimeout(() => {
      window.location.href = '/app';
    }, 1200);
  }

  if (state === 'checking') {
    return <p className="text-sm text-muted">Checking your reset link…</p>;
  }

  if (state === 'no-session') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg">This reset link is invalid or has expired.</p>
        <p className="text-[0.75rem] text-muted">
          Request a new one from the login page.
        </p>
        <a
          href="/login"
          className="hill-btn mt-2 inline-flex min-h-11 items-center justify-center border border-border bg-surface px-4 text-sm uppercase tracking-wider text-fg transition-colors hover:border-fg"
        >
          ← Back to sign in
        </a>
      </div>
    );
  }

  if (state === 'done') {
    return <p className="text-sm text-fg">Password updated. Taking you in…</p>;
  }

  const inputClass =
    'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';

  return (
    <PageStagger>
      <Item>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="t-label text-muted">New password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            className={inputClass}
          />
          <label className="mt-2 t-label text-muted">
            Confirm password
          </label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            className={inputClass}
          />
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" disabled={busy} className="mt-4 w-full">
            {busy ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </Item>
    </PageStagger>
  );
}
