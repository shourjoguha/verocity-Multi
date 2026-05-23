import { useEffect, useState } from 'react';
import { getSession, signIn } from '@/lib/auth';
import { Button } from '@/components/ui/primitives';

export default function LoginForm() {
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

  return (
    <form
      onSubmit={async (e) => {
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
      }}
      className="flex flex-col gap-3"
    >
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
      {error ? <p className="text-sm text-accent">{error}</p> : null}
      <Button type="submit" disabled={busy} className="mt-4 w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
