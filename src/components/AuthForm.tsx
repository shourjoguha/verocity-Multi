import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type Mode = 'signin' | 'forgot';

const inputCls =
  'border border-border bg-surface px-3 py-2 text-fg focus:border-fg focus:outline-none';
const submitCls =
  'mt-2 bg-fg px-4 py-2 font-medium uppercase tracking-wider text-bg transition-opacity hover:opacity-90 disabled:opacity-50';

export function AuthForm() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    window.location.href = '/app';
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSent(true);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setSent(false);
    setPassword('');
  }

  if (mode === 'forgot' && sent) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-fg">
          Check your email
        </h1>
        <p className="text-sm text-muted">
          If an account exists for <strong className="text-fg">{email}</strong>, we sent a link to
          reset your password. The link expires shortly.
        </p>
        <button
          type="button"
          onClick={() => switchMode('signin')}
          className="text-left text-sm text-fg underline hover:no-underline"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <form onSubmit={handleForgot} className="flex flex-col gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-fg">
            Reset password
          </h1>
          <p className="mt-2 text-sm text-muted">
            Enter your email and we’ll send you a reset link.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[0.7rem] uppercase tracking-wider text-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputCls}
            autoComplete="email"
          />
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button type="submit" disabled={loading} className={submitCls}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <button
          type="button"
          onClick={() => switchMode('signin')}
          className="text-left text-sm text-muted underline hover:text-fg hover:no-underline"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSignIn} className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-fg">
          Sign in
        </h1>
        <p className="mt-2 text-sm text-muted">Welcome back. Log your work.</p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[0.7rem] uppercase tracking-wider text-muted">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
          autoComplete="email"
        />
      </label>

      <label className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] uppercase tracking-wider text-muted">Password</span>
          <button
            type="button"
            onClick={() => switchMode('forgot')}
            className="text-[0.7rem] uppercase tracking-wider text-muted underline transition-colors hover:text-fg hover:no-underline"
          >
            Forgot?
          </button>
        </div>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          autoComplete="current-password"
        />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button type="submit" disabled={loading} className={submitCls}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-sm text-muted">
        No account?{' '}
        <a href="/signup" className="text-fg underline hover:no-underline">
          Request an invite
        </a>
      </p>
    </form>
  );
}
