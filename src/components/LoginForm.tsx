import { useEffect, useState } from 'react';
import { getSession, requestPasswordReset, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/primitives';
import { Item, PageStagger } from '@/components/anim';

type Mode = 'signin' | 'reset';

export default function LoginForm() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSession().then((s) => {
      if (s) window.location.href = '/app';
    });
  }, []);

  const inputClass =
    'min-h-11 w-full border border-border bg-surface px-3 text-base text-fg outline-none focus:border-subtle';

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
    setPassword('');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (mode === 'signin') {
      const { error } = await signIn(email, password);
      setBusy(false);
      if (error) {
        setError(error.message);
        return;
      }
      window.location.href = '/app';
    } else {
      const { error } = await requestPasswordReset(email);
      setBusy(false);
      if (error) {
        setError(error.message);
        return;
      }
      setInfo(`If an account exists for ${email}, a reset link is on its way.`);
    }
  }

  return (
    <PageStagger>
      <Item>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="text-[0.7rem] uppercase tracking-[0.2em] text-muted">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className={inputClass}
          />

          {mode === 'signin' ? (
            <>
              <div className="mt-2 flex items-baseline justify-between">
                <label className="text-[0.7rem] uppercase tracking-[0.2em] text-muted">Password</label>
                <button
                  type="button"
                  onClick={() => switchMode('reset')}
                  className="text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className={inputClass}
              />
            </>
          ) : (
            <p className="mt-1 text-[0.75rem] text-muted">
              Enter your email and we&rsquo;ll send a reset link.
            </p>
          )}

          {error ? <p className="text-sm text-accent">{error}</p> : null}
          {info ? <p className="text-sm text-fg">{info}</p> : null}

          <Button type="submit" disabled={busy} className="mt-4 w-full">
            {busy
              ? mode === 'signin'
                ? 'Signing in…'
                : 'Sending…'
              : mode === 'signin'
                ? 'Sign in'
                : 'Send reset link'}
          </Button>

          {mode === 'reset' ? (
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className="mt-1 text-[0.7rem] uppercase tracking-wider text-muted transition-colors hover:text-fg"
            >
              ← Back to sign in
            </button>
          ) : null}
        </form>
      </Item>
    </PageStagger>
  );
}
