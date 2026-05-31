import { useEffect, useState } from 'react';
import { getSession, resetPasswordForEmail, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/primitives';
import { Item, PageStagger } from '@/components/anim';

export default function LoginForm() {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    getSession().then((s) => {
      if (s) window.location.href = '/app';
    });
  }, []);

  const inputClass =
    'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';
  const linkClass = 'self-start text-[0.7rem] uppercase tracking-wider text-muted underline hover:text-fg';

  function switchMode(next: 'signin' | 'forgot') {
    setMode(next);
    setError(null);
    setSent(false);
  }

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.href = '/app';
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await resetPasswordForEmail(email);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (mode === 'forgot') {
    return (
      <PageStagger>
        <Item>
          {sent ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-fg">
                If an account exists for <span className="text-fg">{email}</span>, a password reset
                link is on its way. The link expires shortly.
              </p>
              <button type="button" onClick={() => switchMode('signin')} className={linkClass}>
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={onForgot} className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                Enter your email and we’ll send you a link to reset your password.
              </p>
              <label className="text-[0.7rem] uppercase tracking-[0.2em] text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={inputClass}
              />
              {error ? <p className="text-sm text-accent">{error}</p> : null}
              <Button type="submit" disabled={busy} className="mt-4 w-full">
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
              <button type="button" onClick={() => switchMode('signin')} className={linkClass}>
                Back to sign in
              </button>
            </form>
          )}
        </Item>
      </PageStagger>
    );
  }

  return (
    <PageStagger>
      <Item>
        <form onSubmit={onSignIn} className="flex flex-col gap-3">
          <label className="text-[0.7rem] uppercase tracking-[0.2em] text-muted">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className={inputClass}
          />
          <label className="mt-2 text-[0.7rem] uppercase tracking-[0.2em] text-muted">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className={inputClass}
          />
          <button type="button" onClick={() => switchMode('forgot')} className={linkClass}>
            Forgot password?
          </button>
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <Button type="submit" disabled={busy} className="mt-4 w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Item>
    </PageStagger>
  );
}
