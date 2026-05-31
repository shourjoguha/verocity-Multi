import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const inputCls =
  'border border-border bg-surface px-3 py-2 text-fg focus:border-fg focus:outline-none';
const submitCls =
  'mt-2 bg-fg px-4 py-2 font-medium uppercase tracking-wider text-bg transition-opacity hover:opacity-90 disabled:opacity-50';

const MIN_LENGTH = 8;

// Lands here from the password-recovery email link. Supabase (detectSessionInUrl)
// turns the link's token into a recovery session; we let the user set a new
// password via updateUser, then send them into the app.
export function ResetPasswordForm() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setStatus('ready');
    });
    supabase.auth.getSession().then(({ data }) => {
      setStatus((s) => (s === 'ready' ? s : data.session ? 'ready' : 'invalid'));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
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

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setDone(true);
    setTimeout(() => {
      window.location.href = '/app';
    }, 1200);
  }

  if (status === 'checking') {
    return <p className="text-sm text-muted">Verifying reset link…</p>;
  }

  if (status === 'invalid') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-fg">
          Link expired
        </h1>
        <p className="text-sm text-muted">
          This password reset link is invalid or has expired. Request a new one from the sign-in
          page.
        </p>
        <a href="/login" className="text-sm text-fg underline hover:no-underline">
          Back to sign in
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-fg">
          Password updated
        </h1>
        <p className="text-sm text-muted">Taking you to the app…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-fg">
          New password
        </h1>
        <p className="mt-2 text-sm text-muted">Choose a new password for your account.</p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[0.7rem] uppercase tracking-wider text-muted">New password</span>
        <input
          type="password"
          required
          minLength={MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          autoComplete="new-password"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[0.7rem] uppercase tracking-wider text-muted">Confirm password</span>
        <input
          type="password"
          required
          minLength={MIN_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
          autoComplete="new-password"
        />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button type="submit" disabled={loading} className={submitCls}>
        {loading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
