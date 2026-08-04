// The consolidated "You" surface. Groups every personal / config control
// (profile stats, goals, appearance, integrations, data, sharing, account)
// under collapsible sections, and demotes every inline description to a `!`
// popover so the page reads as controls, not tutorial text.
import { useEffect, useState } from 'react';
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
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { Disclosure } from '@/components/ui/Disclosure';
import { InfoPopover } from '@/components/ui/InfoPopover';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BackgroundPicker } from '@/components/BackgroundPicker';
import { GarminPanel } from '@/components/GarminPanel';
import { UserStatsPanel } from '@/components/UserStatsPanel';
import { GoalsEditor } from '@/components/GoalsEditor';
import ShareManager from '@/components/ShareManager';

const exportBtn =
  'hill-btn min-h-11 border border-border bg-surface px-4 t-control text-fg transition-colors hover:border-fg disabled:opacity-40';

export default function YouView() {
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

  const sectionTitle = (label: string, info?: React.ReactNode) => (
    <span className="inline-flex items-center gap-2">
      {label}
      {info ? <InfoPopover>{info}</InfoPopover> : null}
    </span>
  );

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <Item>
        <EchoText
          text="YOU"
          as="h1"
          className="mb-6 font-display text-3xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg sm:text-5xl md:text-7xl"
        />
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure
            title={sectionTitle(
              'Profile',
              'Private to you. These never appear on your public showcase or in a share link.',
            )}
            defaultOpen
          >
            <UserStatsPanel />
          </Disclosure>
        </div>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure
            title={sectionTitle(
              'Goals',
              'Rank and weight what you want out of training. Order is priority. These drive the rep ranges and section emphasis the AI proposes when you generate a plan.',
            )}
          >
            <GoalsEditor />
          </Disclosure>
        </div>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure title={sectionTitle('Appearance')}>
            <div className="flex flex-col gap-6">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="t-label text-muted">Theme</span>
                </div>
                <ThemeToggle />
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="t-label text-muted">Backdrop</span>
                  <InfoPopover>
                    The full-viewport texture behind the app. Depth is device-gated — touch and
                    reduced-motion devices default to a flatter preset.
                  </InfoPopover>
                </div>
                <BackgroundPicker />
              </div>
            </div>
          </Disclosure>
        </div>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure
            title={sectionTitle(
              'Integrations',
              'Connect Garmin for automatic sync, or upload your "Export All Data" ZIP to bring in activities, sleep, and daily health. Imported activities appear on your calendar; re-importing is safe — duplicates merge.',
            )}
          >
            <GarminPanel />
          </Disclosure>
        </div>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure
            title={sectionTitle(
              'Data',
              'JSON is the complete backup. CSV is a flattened per-set view for spreadsheets.',
            )}
          >
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
            </div>
          </Disclosure>
        </div>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure
            title={sectionTitle(
              'Sharing',
              'Mint a read-only link to your profile, a plan, or a single workout. Holders can view but never edit. The full link is shown once on creation; revoke any time.',
            )}
          >
            <ShareManager embedded />
          </Disclosure>
        </div>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure title={sectionTitle('Account')}>
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
          </Disclosure>
        </div>
      </Item>
    </PageStagger>
  );
}
