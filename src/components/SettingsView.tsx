// Dedicated settings surface (IA reorg). Gathers the settings-class controls
// that used to be scattered on the Home dashboard into one grouped page:
// You (owner stats), Appearance (theme + backdrop), Integrations (Garmin),
// Data (export + share), Account (email + sign out). Every group composes a
// component that owns its own state and writes — this file stays a layout.
// "You" is the one group that was new rather than relocated.
import { useEffect, useLayoutEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { signOut } from '@/lib/auth';
import { getAllLogs, getAllPlans, getCurrentProfile, getSessions, getUserStats } from '@/lib/queries';
import {
  bundleToJson,
  buildExportBundle,
  downloadFile,
  exportFilename,
  logsToCsv,
} from '@/lib/exportData';
import { toast } from '@/lib/toast';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { SectionHeader } from '@/components/ui/primitives';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BackgroundPicker } from '@/components/BackgroundPicker';
import { CoachSpritePicker } from '@/components/CoachSpritePicker';
import { BodyMapStylePicker } from '@/components/BodyMapStylePicker';
import { GarminPanel } from '@/components/GarminPanel';
import { UserStatsPanel } from '@/components/UserStatsPanel';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import { HolidaysSettings } from '@/components/HolidaysSettings';

// Two tabs. General is everything that was here before; Holidays has its own
// tab because it is a list you edit, not a preference. ?tab=holidays deep-links
// it (Log Activity's Holiday mode points here).
const TABS = [
  { key: 'general', label: 'General' },
  { key: 'holidays', label: 'Holidays' },
];
// Read in a layout effect, not in useState: the server renders General, and a
// first client render that differs is React #418 (see useAuthedQuery).
function tabFromUrl(): 'general' | 'holidays' {
  return new URLSearchParams(window.location.search).get('tab') === 'holidays' ? 'holidays' : 'general';
}

const exportBtn =
  'hill-btn min-h-11 border border-border bg-surface px-4 t-control text-fg transition-colors hover:border-fg disabled:opacity-40';

export default function SettingsView() {
  const [email, setEmail] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [tab, setTab] = useState<'general' | 'holidays'>('general');
  useLayoutEffect(() => setTab(tabFromUrl()), []);

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
      const [prof, plans, allLogs, sessions, stats] = await Promise.all([
        getCurrentProfile(),
        getAllPlans(),
        getAllLogs(),
        getSessions(),
        getUserStats(),
      ]);
      if (format === 'json') {
        const json = bundleToJson(buildExportBundle(prof, plans, allLogs, sessions, stats));
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
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <Item>
        <EchoText
          text="SETTINGS"
          as="h1"
          className={`mb-6 ${ECHO_APP_TITLE}`}
        />
      </Item>

      <Item>
        <SegmentedTabs
          tabs={TABS}
          active={tab}
          onChange={(k) => {
            const next = k as 'general' | 'holidays';
            setTab(next);
            const url = new URL(window.location.href);
            if (next === 'holidays') url.searchParams.set('tab', 'holidays');
            else url.searchParams.delete('tab');
            window.history.replaceState(null, '', url);
          }}
          ariaLabel="Settings sections"
          className="mb-6"
        />
      </Item>

      {tab === 'holidays' ? (
        <Item>
          <HolidaysSettings />
        </Item>
      ) : (
      <>
      <Item>
        <section className="mb-6">
          <SectionHeader>You</SectionHeader>
          <UserStatsPanel />
        </section>
      </Item>

      <Item>
        <section className="mb-6">
          <SectionHeader>Appearance</SectionHeader>
          <div className="mb-2 t-label text-muted">Theme</div>
          <ThemeToggle />
          <div className="mt-6 mb-2 t-label text-muted">Backdrop</div>
          <BackgroundPicker />
          <div className="mt-6 mb-2 t-label text-muted">Coach icon</div>
          <CoachSpritePicker />
          <div className="mt-6 mb-2 t-label text-muted">Body map</div>
          <BodyMapStylePicker />
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
              className="flex min-h-11 items-center t-control text-muted transition-colors hover:text-fg"
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
      </>
      )}
    </PageStagger>
  );
}
