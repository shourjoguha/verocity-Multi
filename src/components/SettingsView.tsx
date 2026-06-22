// Dedicated settings surface (IA reorg). Gathers the settings-class controls
// that used to be scattered on the Home dashboard into one grouped page:
// Appearance (theme + backdrop), Integrations (Garmin), Data (export + share),
// Account (email + sign out). Controls are RELOCATED, not rewritten — each group
// composes an existing component / helper.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/lib/auth';
import { getAllLogs, getAllPlans, getCurrentProfile, getSessions } from '@/lib/queries';
import {
  bundleToJson,
  buildExportBundle,
  downloadFile,
  exportFilename,
  logsToCsv,
} from '@/lib/exportData';
import { toast } from '@/lib/toast';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { SectionHeader } from '@/components/ui/primitives';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BackgroundPicker } from '@/components/BackgroundPicker';
import { GarminPanel } from '@/components/GarminPanel';

const exportBtn =
  'hill-btn min-h-11 border border-border bg-surface px-4 t-control text-fg transition-colors hover:border-fg disabled:opacity-40';

export default function SettingsView() {
  const [email, setEmail] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const { data: u } = await supabase.auth.getUser();
      if (active) setEmail(u.user?.email ?? null);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleExport(format: 'json' | 'csv') {
    if (exporting) return;
    setExporting(format);
    try {
      const [prof, plans, allLogs, sessions] = await Promise.all([
        getCurrentProfile(),
        getAllPlans(),
        getAllLogs(),
        getSessions(),
      ]);
      if (format === 'json') {
        const json = bundleToJson(buildExportBundle(prof, plans, allLogs, sessions));
        downloadFile(exportFilename('json'), json, 'application/json');
      } else {
        downloadFile(exportFilename('csv'), logsToCsv(allLogs), 'text/csv');
      }
      toast(`${format.toUpperCase()} export ready`, 'success');
    } catch {
      toast('Export failed — try again', 'error');
    } finally {
      setExporting(null);
    }
  }

  return (
    <PageStagger className="mx-auto max-w-3xl px-6 py-8">
      <Item>
        <EchoText
          text="SETTINGS"
          as="h1"
          className="mb-6 font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
        />
      </Item>

      <Item>
        <section className="mb-6">
          <SectionHeader>Appearance</SectionHeader>
          <div className="mb-2 t-label text-muted">Theme</div>
          <ThemeToggle />
          <div className="mt-6 mb-2 t-label text-muted">Backdrop</div>
          <BackgroundPicker />
        </section>
      </Item>

      <Item>
        <section className="mb-6">
          <SectionHeader>Integrations</SectionHeader>
          <GarminPanel />
        </section>
      </Item>

      <Item>
        <section className="mb-6">
          <SectionHeader>Data</SectionHeader>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleExport('json')}
              disabled={!!exporting}
              className={exportBtn}
            >
              {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
            </button>
            <button
              type="button"
              onClick={() => handleExport('csv')}
              disabled={!!exporting}
              className={exportBtn}
            >
              {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
            </button>
            <a
              href="/app/shares"
              className="t-control text-muted transition-colors hover:text-fg"
            >
              Share links →
            </a>
          </div>
          <p className="mt-2 text-[0.7rem] text-muted">
            JSON is the complete backup. CSV is a flattened per-set view for spreadsheets.
          </p>
        </section>
      </Item>

      <Item>
        <section className="mb-6">
          <SectionHeader>Account</SectionHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-fg">{email ?? '—'}</span>
            <button
              type="button"
              onClick={() => signOut().then(() => (window.location.href = '/login'))}
              className={exportBtn}
            >
              Sign out
            </button>
          </div>
        </section>
      </Item>
    </PageStagger>
  );
}
