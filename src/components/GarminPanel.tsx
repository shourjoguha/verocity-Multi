// Garmin panel for ProfileView (plan §6, §7). Two things today: the live-sync
// connection status (read-only, from the safe garmin_connection_status view) and
// the GDPR-ZIP file import (the one data path that needs no account linking).
// Connect / disconnect (live sync) lands with the connection Edge Function.
import { useEffect, useRef, useState } from 'react';
import { getGarminConnection } from '@/lib/queries';
import { importGarminExport } from '@/lib/garmin/importClient';
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

export function GarminPanel() {
  const [connection, setConnection] = useState<GarminConnectionInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    getGarminConnection().then((c) => {
      if (active) setConnection(c);
    });
    return () => {
      active = false;
    };
  }, []);

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
    const summary = c
      ? `Imported ${c.activities} ${c.activities === 1 ? 'activity' : 'activities'}, ${c.health} ${c.health === 1 ? 'day' : 'days'} of health data`
      : 'Import complete';
    setResult(summary);
    toast('Garmin export imported', 'success');
    // last_sync_at may have moved; refresh the status line.
    getGarminConnection().then(setConnection);
  }

  const statusText = connection
    ? STATUS_LABEL[connection.status]
    : 'Not linked for live sync';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <span className="text-sm text-fg">{statusText}</span>
        {connection?.last_sync_at ? (
          <span className="text-[0.65rem] uppercase tracking-wider text-muted">
            Synced {formatDate(connection.last_sync_at)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
        Upload your Garmin “Export All Data” ZIP to bring in activities, sleep, and
        daily health. Imported activities appear on your calendar; re-importing is
        safe — duplicates merge.
      </p>
    </div>
  );
}
