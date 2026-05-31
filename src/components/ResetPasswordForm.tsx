import { useEffect, useState } from 'react';
import { getSession, updatePassword } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/primitives';
import { Item, PageStagger } from '@/components/anim';

const MIN_LENGTH = 8;

// Lands here from the password-recovery email link. Supabase (detectSessionInUrl)
// turns the link's token into a recovery session; we let the user set a new
// password via updateUser, then send them into the app.
export default function ResetPasswordForm() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setStatus('ready');
    });
    getSession().then((session) => {
      setStatus((s) => (s === 'ready' ? s : session ? 'ready' : 'invalid'));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const { error } = await updatePassword(password);
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setDone(true);
    setTimeout(() => {
      window.location.href = '/app';
    }, 1200);
  }

  const inputClass =
    'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';
  const labelClass = 'text-[0.7rem] uppercase tracking-[0.2em] text-muted';

  if (status === 'checking') {
    return <p className="text-sm text-muted">Verifying reset link…</p>;
  }

  if (status === 'invalid') {
    return (
      <p className="text-sm text-accent">
        This reset link is invalid or has expired. Request a new one from the{' '}
        <a href="/login" className="text-fg underline hover:text-subtle">
          sign-in page
        </a>
        .
      </p>
    );
  }

  if (done) {
    return <p className="text-sm text-fg">Password updated. Taking you to the app…</p>;
  }

  return (
    <PageStagger>
      <Item>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className={labelClass}>New password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
            className={inputClass}
          />
          <label className={`mt-2 ${labelClass}`}>Confirm password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
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
