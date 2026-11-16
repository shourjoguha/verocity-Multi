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
  getStoredBackground,
  pickDeviceDefault,
  type BackgroundKey,
} from '@/lib/background';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Modal } from '@/components/ui/Modal';
import { InfoPopover } from '@/components/ui/InfoPopover';
import { ThemeToggle } from '@/components/ThemeToggle';
import { BackgroundPicker } from '@/components/BackgroundPicker';
import { CoachSpritePicker } from '@/components/CoachSpritePicker';
import { BodyMapStylePicker } from '@/components/BodyMapStylePicker';
import { HolidaysSettings } from '@/components/HolidaysSettings';
import { GarminPanel } from '@/components/GarminPanel';
import { UserStatsPanel } from '@/components/UserStatsPanel';
import { GoalsEditor } from '@/components/GoalsEditor';
import ShareManager from '@/components/ShareManager';
import { FriendsPanel } from '@/components/friends/FriendsPanel';

const exportBtn =
  'hill-btn min-h-11 border border-transparent bg-tappable px-4 t-control text-fg transition-colors hover:bg-tappable-hover disabled:opacity-40';

type SectionKey = 'goals' | 'holidays' | 'friends' | 'sharing' | 'appearance' | 'integrations' | 'data' | 'account';

// Grouped by what you came to do, not listed in build order.
const YOU_GROUPS: { label: string; keys: SectionKey[] }[] = [
  { label: 'Training', keys: ['goals', 'holidays'] },
  { label: 'People', keys: ['friends', 'sharing'] },
  { label: 'App', keys: ['appearance', 'integrations'] },
  { label: 'Account', keys: ['data', 'account'] },
];

const SECTION_META: Record<SectionKey, { title: string; intro?: string }> = {
  goals: {
    title: 'Goals',
    intro:
      'Rank and weight what you want out of training. Order is priority. These drive the rep ranges and section emphasis the AI proposes when you generate a plan.',
  },
  holidays: { title: 'Holidays' },
  friends: {
    title: 'Friends',
    intro: 'Pair up by code, then send each other workouts. A friend can send to you; nobody can read your logs.',
  },
  sharing: {
    title: 'Sharing',
    intro:
      'Mint a read-only link to your profile, a plan, or a single workout. Holders can view but never edit. The full link is shown once on creation; revoke any time.',
  },
  appearance: { title: 'Appearance' },
  integrations: {
    title: 'Integrations',
    intro:
      'Connect Garmin for automatic sync, or upload your "Export All Data" ZIP to bring in activities, sleep, and daily health. Imported activities appear on your calendar; re-importing is safe — duplicates merge.',
  },
  data: { title: 'Data', intro: 'JSON is the complete backup. CSV is a flattened per-set view for spreadsheets.' },
  account: { title: 'Account' },
};

// A URL hash names a section, or a row nested in one: `/app/you#holidays` is
// where Log Activity's Holiday mode and the retired /app/settings?tab=holidays
// land, and `#coach-icon` / `#body-map` are rows inside Appearance.
const HASH_TO_SECTION: Record<string, SectionKey> = {
  goals: 'goals',
  holidays: 'holidays',
  friends: 'friends',
  sharing: 'sharing',
  appearance: 'appearance',
  'coach-icon': 'appearance',
  'body-map': 'appearance',
  integrations: 'integrations',
  data: 'data',
  account: 'account',
};

// After the sheet renders, open any <details> the hash names (a nested row)
// and bring it into view inside the sheet. Sets the DOM `open` directly:
// Disclosure stays browser-driven.
function openNestedFromHash() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id || HASH_TO_SECTION[id] === id) return;
  const target = document.getElementById(id);
  if (!target) return;
  let node: Element | null = target;
  while (node) {
    if (node instanceof HTMLDetailsElement) node.open = true;
    node = node.parentElement?.closest('details') ?? null;
  }
  target.scrollIntoView({ block: 'start' });
}

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

// Wrapped, and this page in particular needs it. `<details>` renders its
// children whether or not it is open, so /app/you MOUNTS all seven of its
// sections on arrival — GoalsEditor, HolidaysSettings, ThemeToggle,
// BackgroundPicker, CoachSpritePicker, BodyMapStylePicker, GarminPanel,
// ShareManager, FriendsPanel and the export block — each with
// its own fetch and its own render. It is the widest crash surface in the app,
// and it was the one heavy island with no boundary above it, so a single throw
// anywhere in that set left a blank page with nothing on screen to act on.
export default function YouView() {
  return (
    <ErrorBoundary>
      <YouSurface />
    </ErrorBoundary>
  );
}

function YouSurface() {
  const [email, setEmail] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [name, setName] = useState<string | null>(null);
  // Read once for the summary card. UserStatsPanel fetches its own copy for the
  // form; duplicating one small row is cheaper than lifting its whole form
  // state up here, and `statsVersion` is what re-syncs the card after a save
  // without either component owning the other's data.
  const [statsVersion, setStatsVersion] = useState(0);
  // The card IS the profile: Edit opens the form inside it. A separate
  // collapsible Profile row below used to hold the form, and read as a second
  // copy of the card.
  const [editing, setEditing] = useState(false);

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

  const [openKey, setOpenKey] = useState<SectionKey | null>(null);
  const openSection = (k: SectionKey) => setOpenKey(k);
  useEffect(() => {
    const fromHash = () => {
      const k = HASH_TO_SECTION[decodeURIComponent(window.location.hash.slice(1))];
      if (k) setOpenKey(k);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);
  // A nested row (#coach-icon) opens once its sheet has mounted.
  useEffect(() => {
    if (openKey) openNestedFromHash();
  }, [openKey]);

  // "Dark · Dotted" on the collapsed Appearance row. It has to be LIVE: the two
  // controls that change it live inside this very section, so a value read once
  // at mount would contradict the toggle sitting under it the moment you used
  // one. Both libs already dispatch an event for exactly this.
  const [appearance, setAppearance] = useState<{ theme: ThemePref; bg: BackgroundKey } | null>(
    null,
  );
  useEffect(() => {
    const read = () => {
      // Both reads swallow a blocked-storage SecurityError. A bare
      // `localStorage.getItem` here threw inside this effect and unmounted the
      // whole island, which is what left the page blank a beat after it
      // painted — see docs/LESSONS.md.
      setAppearance({
        theme: getStoredPref(),
        bg: getStoredBackground() ?? pickDeviceDefault(),
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

  const summaryFor = (k: SectionKey): string | undefined => {
    if (k === 'goals')
      return stats && (stats.goals?.length ?? 0) > 0
        ? stats.goals
            .slice(0, 2)
            .map((g) => g.label)
            .join(' · ')
        : 'Not set';
    if (k === 'appearance') return appearanceSummary;
    if (k === 'data') return 'Export & delete';
    if (k === 'account') return email ?? undefined;
    return undefined;
  };

  const sectionBody = (k: SectionKey) => {
    switch (k) {
      case 'goals':
        return <GoalsEditor />;
      case 'holidays':
        return <HolidaysSettings />;
      case 'friends':
        return <FriendsPanel />;
      case 'sharing':
        return <ShareManager embedded />;
      case 'integrations':
        return <GarminPanel />;
      case 'appearance':
        return (
          <div className="-mx-4 -mt-4 [&>*+*]:border-t [&>*+*]:border-border-soft">
            <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
              <span className="t-label shrink-0 text-muted">Theme</span>
              <ThemeToggle className="min-w-0 max-w-60 flex-1" />
            </div>
            <div className="px-3 pb-3 pt-1">
              <BackgroundPicker />
            </div>
            <CoachSpritePicker
              id="coach-icon"
              title={sectionTitle('Coach icon', "The character on Home's Active plan card. Tap it to open Coach.")}
            />
            <BodyMapStylePicker
              id="body-map"
              title={sectionTitle(
                'Body map',
                'How the Body page draws muscles: seven shades, untrained to busiest. Plates ink in grey or colour. Saved on this device.',
              )}
            />
          </div>
        );
      case 'data':
        return (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => handleExport('json')} disabled={!!exporting} className={exportBtn}>
              {exporting === 'json' ? 'Exporting…' : 'Export JSON'}
            </button>
            <button type="button" onClick={() => handleExport('csv')} disabled={!!exporting} className={exportBtn}>
              {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        );
      case 'account':
        return (
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
        );
    }
  };

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
          className={`mb-4 ${ECHO_APP_TITLE}`}
        />
      </Item>

      {/* Read before you write. The page opens on what the form CONTAINS, with
          one Edit button that opens the form in this card. */}
      <Item>
        <section className="lift mb-4 rounded-card border border-outline bg-surface p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="t-label text-muted">Profile · private</div>
              <h2 className="mt-0.5 truncate text-base font-medium text-fg">
                {name ?? 'Athlete'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
              aria-controls="you-profile-form"
              className="hill-btn flex min-h-11 shrink-0 items-center border border-transparent bg-tappable px-3 t-control text-fg hover:bg-tappable-hover"
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5">
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
                <dd className="mt-0.5 truncate text-sm tabular-nums text-fg">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {stats && (stats.equipment?.length ?? 0) > 0 ? (
            <div className="mt-3 border-t border-border-soft pt-3">
              <div className="t-label mb-1.5 text-muted">
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
            <div className="mt-3">
              <div className="t-label mb-1.5 text-muted">Disciplines</div>
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

          {/* onSaved re-reads the one row this card renders, then folds the
              form away so the saved values are what you see. */}
          {editing ? (
            <div id="you-profile-form" className="mt-4 border-t border-border-soft pt-4">
              <UserStatsPanel
                onSaved={() => {
                  setStatsVersion((v) => v + 1);
                  setEditing(false);
                }}
              />
            </div>
          ) : null}
        </section>
      </Item>

      {/* Every section below the profile is one row in a themed group, and
          opens in a bottom sheet. They used to be eight full-height cards in
          no particular order, each with its own "!" caption. The caption is
          now the sheet's first line. */}
      {YOU_GROUPS.map((g) => (
        <Item key={g.label}>
          <section className="mb-4">
            <h2 className="t-label mb-1.5 text-muted">{g.label}</h2>
            <ul className="divide-y divide-border-soft rounded-card border border-outline bg-surface">
              {g.keys.map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => openSection(k)}
                    className="flex min-h-11 w-full items-center gap-3 px-3 text-left"
                  >
                    <span className="flex-1 text-sm text-fg">{SECTION_META[k].title}</span>
                    {summaryFor(k) ? (
                      <span className="min-w-0 shrink truncate text-xs text-muted">{summaryFor(k)}</span>
                    ) : null}
                    <span aria-hidden className="shrink-0 text-muted">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </Item>
      ))}

      <Modal
        open={openKey != null}
        onClose={() => setOpenKey(null)}
        title={openKey ? SECTION_META[openKey].title : undefined}
        maxHeight="max-h-[80dvh]"
      >
        {openKey ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {SECTION_META[openKey].intro ? (
              <p className="mb-3 text-xs text-muted">{SECTION_META[openKey].intro}</p>
            ) : null}
            {sectionBody(openKey)}
          </div>
        ) : null}
      </Modal>
    </PageStagger>
  );
}
