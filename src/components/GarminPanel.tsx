// Garmin panel for ProfileView (plan §6, §7). Live-sync connection (connect /
// disconnect via the garmin-connect Edge Function, status from the safe
// garmin_connection_status view) plus the GDPR-ZIP file import (the path that
// needs no account linking). Tokens never reach the browser.
import { useEffect, useRef, useState } from 'react';
import { getGarminConnection } from '@/lib/queries';
import { importGarminExport } from '@/lib/garmin/importClient';
import { connectGarmin, disconnectGarmin } from '@/lib/garmin/connectClient';
import type { GarminConnectionInfo } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/primitives';

const STATUS_LABEL: Record<GarminConnectionInfo['status'], string> = {
  connected: 'Connected',
  pending: 'Pending',
  needs_reconnect: 'Needs reconnect',
  revoked: 'Disconnected',
  error: 'Error',
};

const IMPORT_ERROR: Record<string, string> = {
  unreadable_zip: "Couldn't read that file — is it the Garmin export ZIP?",
  no_summaries: 'No activities or health data found in that export.',
  not_authenticated: 'Session expired — sign in again.',
};

const CONNECT_ERROR: Record<string, string> = {
  bad_credentials: 'Login rejected — check your Garmin email and password.',
  mfa_required: 'Two-factor Garmin accounts aren’t supported yet.',
  missing_credentials: 'Enter your Garmin email and password.',
  not_configured: 'Live sync isn’t configured on the server yet.',
};

export function GarminPanel() {
  const [connection, setConnection] = useState<GarminConnectionInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [showConnect, setShowConnect] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function refresh() {
    return getGarminConnection().then(setConnection);
  }

  useEffect(() => {
    let active = true;
    getGarminConnection().then((c) => {
      if (active) setConnection(c);
    });
    return () => {
      active = false;
    };
  }, []);

  const isConnected = connection?.status === 'connected';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || importing) return;

    setImporting(true);
    setResult(null);
    const res = await importGarminExport(file);
    setImporting(false);

    if (!res.ok) {
      toast(IMPORT_ERROR[res.error ?? ''] ?? 'Import failed — try again', 'error');
      return;
    }
    const c = res.counts;
    setResult(
      c
        ? `Imported ${c.activities} ${c.activities === 1 ? 'activity' : 'activities'}, ${c.health} ${c.health === 1 ? 'day' : 'days'} of health data`
        : 'Import complete',
    );
    toast('Garmin export imported', 'success');
    refresh();
  }

  async function onConnect(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const res = await connectGarmin(email.trim(), password);
    setBusy(false);
    if (!res.ok) {
      toast(CONNECT_ERROR[res.error ?? ''] ?? 'Couldn’t connect — try again', 'error');
      return;
    }
    setPassword('');
    setEmail('');
    setShowConnect(false);
    toast('Garmin connected', 'success');
    refresh();
  }

  async function onDisconnect() {
    if (busy) return;
    setBusy(true);
    const res = await disconnectGarmin();
    setBusy(false);
    if (!res.ok) {
      toast('Couldn’t disconnect — try again', 'error');
      return;
    }
    toast('Garmin disconnected', 'success');
    refresh();
  }

  const statusText = connection ? STATUS_LABEL[connection.status] : 'Not linked for live sync';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <span className="text-sm text-fg">{statusText}</span>
        {connection?.last_sync_at ? (
          <span className="t-control text-muted">
            Synced {formatDate(connection.last_sync_at)}
          </span>
        ) : null}
      </div>

      {/* Live sync (connect / disconnect) */}
      {isConnected ? (
        <Button variant="ghost" onClick={onDisconnect} disabled={busy}>
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </Button>
      ) : showConnect ? (
        <form onSubmit={onConnect} className="flex flex-col gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Garmin email"
            autoComplete="username"
            className="min-h-11 border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-fg"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Garmin password"
            autoComplete="current-password"
            className="min-h-11 border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-fg"
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
            <button
              type="button"
              onClick={() => setShowConnect(false)}
              className="t-control text-muted transition-colors hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setShowConnect(true)} disabled={busy}>
          Connect live sync
        </Button>
      )}

      {/* File import (no account linking needed) */}
      <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          onChange={onFile}
          className="hidden"
        />
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? 'Importing…' : 'Import export ZIP'}
        </Button>
        {result ? <span className="text-[0.7rem] text-muted">{result}</span> : null}
      </div>

      <p className="text-[0.7rem] text-muted">
        Connect for automatic sync, or upload your Garmin “Export All Data” ZIP to
        bring in activities, sleep, and daily health. Imported activities appear on
        your calendar; re-importing is safe — duplicates merge.
      </p>
    </div>
  );
}
