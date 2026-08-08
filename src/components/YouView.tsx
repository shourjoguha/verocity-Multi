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
import {
  DISCIPLINES,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  PLAN_LENGTH,
  type ExperienceKey,
} from '@/app.config';
import type { UserStats } from '@/lib/types';
import { Tag, TickProgress } from '@/components/ui/primitives';
import { getStoredPref, THEME_EVENT, type ThemePref } from '@/lib/theme';
import {
  BACKGROUNDS,
  BACKGROUND_EVENT,
  BACKGROUND_STORAGE_KEY,
  isBackgroundKey,
  pickDeviceDefault,
  type BackgroundKey,
} from '@/lib/background';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
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

// The eight fields that feed buildPlanAiPrompt. Readiness is the share of them
// that are filled: blanks become questions the AI asks you later, so this is a
// real completeness measure rather than a progress-bar-for-its-own-sake.
// `injuries` is deliberately NOT counted — an empty list is indistinguishable
// from "never told us", so counting it would punish people with no injuries.
function readinessOf(s: UserStats | null): { filled: number; total: number; pct: number } {
  const checks = [
    s?.body_weight_kg != null,
    s?.height_cm != null,
    s?.birth_year != null,
    s?.gender != null,
    s?.experience != null,
    s?.days_per_week != null,
    (s?.equipment?.length ?? 0) > 0,
    (s?.disciplines?.length ?? 0) > 0,
  ];
  const filled = checks.filter(Boolean).length;
  return { filled, total: checks.length, pct: Math.round((filled / checks.length) * 100) };
}

const labelOf = <T extends string>(list: readonly { key: T; label: string }[], key: T) =>
  list.find((i) => i.key === key)?.label ?? key;

export default function YouView() {
  const [email, setEmail] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [name, setName] = useState<string | null>(null);
  // Read once for the summary card. UserStatsPanel fetches its own copy for the
  // form; duplicating one small row is cheaper than lifting its whole form
  // state up here, and `statsVersion` is what re-syncs the card after a save
  // without either component owning the other's data.
  const [statsVersion, setStatsVersion] = useState(0);

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
      const [s, prof] = await Promise.all([getUserStats(), getCurrentProfile()]);
      if (!active) return;
      setStats(s);
      setName(prof?.display_name ?? null);
    })();
    return () => {
      active = false;
    };
  }, [statsVersion]);

  const readiness = readinessOf(stats);

  // "Dark · Dotted" on the collapsed Appearance row. It has to be LIVE: the two
  // controls that change it live inside this very section, so a value read once
  // at mount would contradict the toggle sitting under it the moment you used
  // one. Both libs already dispatch an event for exactly this.
  const [appearance, setAppearance] = useState<{ theme: ThemePref; bg: BackgroundKey } | null>(
    null,
  );
  useEffect(() => {
    const read = () => {
      const raw = localStorage.getItem(BACKGROUND_STORAGE_KEY);
      setAppearance({
        theme: getStoredPref(),
        bg: isBackgroundKey(raw) ? raw : pickDeviceDefault(),
      });
    };
    read();
    window.addEventListener(THEME_EVENT, read);
    window.addEventListener(BACKGROUND_EVENT, read);
    return () => {
      window.removeEventListener(THEME_EVENT, read);
      window.removeEventListener(BACKGROUND_EVENT, read);
    };
  }, []);
  const appearanceSummary = appearance
    ? `${appearance.theme[0].toUpperCase()}${appearance.theme.slice(1)} · ${
        BACKGROUNDS[appearance.bg].label
      }`
    : undefined;

  // Opening the Profile section by id rather than lifting `open` into state:
  // <details> is browser-driven and works before hydration, and a controlled
  // version would buy nothing here. scrollIntoView because on a phone the
  // section is below the fold once the summary card is above it.
  function openProfile() {
    const el = document.getElementById('you-profile') as HTMLDetailsElement | null;
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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
          className={`mb-6 ${ECHO_APP_TITLE}`}
        />
      </Item>

      {/* Read before you write. The page used to open on a fully expanded form;
          it now opens on what the form CONTAINS, with one Edit button. Every
          field is still one tap away in the Profile section below — this is a
          summary of it, not a replacement for it. */}
      <Item>
        <section className="lift mb-3 rounded-card border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="t-label text-muted">Profile · private</div>
              <h2 className="mt-1 truncate font-display text-xl uppercase tracking-[-0.02em] text-fg">
                {name ?? 'Athlete'}
              </h2>
            </div>
            <button
              type="button"
              onClick={openProfile}
              className="hill-btn flex min-h-11 shrink-0 items-center rounded-control border border-border bg-surface px-3 t-control text-fg"
            >
              Edit
            </button>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4">
            {[
              ['Bodyweight', stats?.body_weight_kg != null ? `${stats.body_weight_kg} kg` : '—'],
              ['Height', stats?.height_cm != null ? `${stats.height_cm} cm` : '—'],
              [
                'Age',
                stats?.birth_year != null
                  ? String(new Date().getFullYear() - stats.birth_year)
                  : '—',
              ],
              [
                'Experience',
                EXPERIENCE_LEVELS[stats?.experience as ExperienceKey]?.label ?? '—',
              ],
              ['Days / week', stats?.days_per_week != null ? String(stats.days_per_week) : '—'],
              [
                'Plan length',
                stats?.preferred_plan_weeks != null
                  ? `${stats.preferred_plan_weeks} weeks`
                  : `${PLAN_LENGTH.defaultWeeks} weeks`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="t-label text-muted">{label}</dt>
                <dd className="mt-1 truncate font-display text-sm tabular-nums text-fg">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {stats && (stats.equipment?.length ?? 0) > 0 ? (
            <div className="mt-4 border-t border-border-soft pt-4">
              <div className="t-label mb-2 text-muted">
                Equipment · {stats.equipment.length} of {EQUIPMENT.length}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {stats.equipment.slice(0, 6).map((e) => (
                  <Tag key={e} label={labelOf(EQUIPMENT, e)} />
                ))}
                {stats.equipment.length > 6 ? (
                  <span className="t-label self-center text-faint">
                    +{stats.equipment.length - 6} more
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {stats && (stats.disciplines?.length ?? 0) > 0 ? (
            <div className="mt-4">
              <div className="t-label mb-2 text-muted">Disciplines</div>
              <div className="flex flex-wrap gap-1.5">
                {stats.disciplines.map((d) => (
                  <Tag key={d} label={labelOf(DISCIPLINES, d)} selected />
                ))}
              </div>
            </div>
          ) : null}

          {/* Says what is missing and why it matters, in place of the four
              paragraphs of helper text this page used to open with. */}
          {readiness.pct < 100 ? (
            <div className="mt-4 border-t border-border-soft pt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-label text-muted">Plan readiness</span>
                <span className="font-display text-sm tabular-nums text-fg">{readiness.pct}%</span>
              </div>
              <div className="mt-2">
                <TickProgress
                  value={readiness.filled}
                  total={readiness.total}
                  label={`${readiness.filled} of ${readiness.total} profile fields filled`}
                />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {readiness.total - readiness.filled} field
                {readiness.total - readiness.filled === 1 ? '' : 's'} left. Blanks become questions
                the AI asks before it can write you a plan.
              </p>
            </div>
          ) : null}
        </section>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure
            id="you-profile"
            title={sectionTitle(
              'Profile',
              'Private to you. These never appear on your public showcase or in a share link.',
            )}
            headerRight={readiness.pct < 100 ? `${readiness.pct}% complete` : undefined}
          >
            {/* onSaved re-reads the one row the summary card above renders. */}
            <UserStatsPanel onSaved={() => setStatsVersion((v) => v + 1)} />
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
            headerRight={
              stats && (stats.goals?.length ?? 0) > 0
                ? stats.goals
                    .slice(0, 2)
                    .map((g) => g.label)
                    .join(' · ')
                : 'Not set'
            }
          >
            <GoalsEditor />
          </Disclosure>
        </div>
      </Item>

      <Item>
        <div className="mb-3">
          <Disclosure title={sectionTitle('Appearance')} headerRight={appearanceSummary}>
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
            headerRight="Export & delete"
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
          <Disclosure title={sectionTitle('Account')} headerRight={email ?? undefined}>
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
