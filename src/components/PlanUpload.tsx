import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { adoptPlan, createPlan, createSession, getMovements, getPlanTemplates, getUserStats } from '@/lib/queries';
import type { SessionInput } from '@/lib/queries';
import { parsePlanMarkdown, PLAN_FORMAT_HELP } from '@/lib/planParser';
import {
  buildPlanAiPrompt,
  buildPlanContextFile,
  buildPlanCsvTemplate,
  buildPlanFixPrompt,
  buildPlanTsvTemplate,
  parsePlanTabular,
  parsePlanWorkbook,
  validateParsedPlan,
} from '@/lib/planTemplate';
import {
  buildSessionAiPrompt,
  buildSessionCsvTemplate,
  buildSessionFixPrompt,
  buildSessionTsvTemplate,
  parseSessionTabular,
  parseSessionWorkbook,
} from '@/lib/sessionTemplate';
import type { Movement, ParsedPlan, PlanTemplate, UserStats } from '@/lib/types';
import { track } from '@/lib/analytics';
import { Button, EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import { ECHO_APP_TITLE, EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';
import SegmentedTabs from '@/components/ui/SegmentedTabs';
import PlanTemplatePicker from '@/components/PlanTemplatePicker';

type Source = 'markdown' | 'csv';
type Target = 'plan' | 'session';
type Mode = 'ready' | 'build';
type Method = 'ai' | 'sheet' | 'markdown';

// One authoring method row: a flat, full-width toggle with its panel below.
// Controlled rather than ui/Disclosure because opening a method also picks the
// editor's source (Markdown vs CSV), and only one is open at a time.
function MethodRow({
  open,
  onToggle,
  title,
  sub,
  icon,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  sub: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left text-fg"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-border">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            {icon}
          </svg>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[0.9375rem] font-semibold">{title}</span>
          <span className="text-xs text-muted">{sub}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </button>
      {open ? <div className="border-t border-border-soft px-4 pb-4 pt-3">{children}</div> : null}
    </section>
  );
}

function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PlanUpload() {
  const [ready, setReady] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [csvText, setCsvText] = useState('');
  const [source, setSource] = useState<Source>('markdown');
  const [target, setTarget] = useState<Target>('plan');
  const [parsedPlan, setParsedPlan] = useState<ParsedPlan | null>(null);
  const [parsedSessions, setParsedSessions] = useState<SessionInput[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [fixCopied, setFixCopied] = useState(false);
  // The athlete's own profile, rendered into the copied prompt. Fetched once on
  // mount rather than inside the copy handler so the click stays instant. The
  // movement library rides along: the "Download context" buttons need both and
  // fetching in parallel avoids a second round-trip when the user clicks.
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);
  const [mode, setMode] = useState<Mode>('build');
  const [method, setMethod] = useState<Method | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = '/login';
        return;
      }
      const adopt = new URLSearchParams(window.location.search).get('adopt');
      if (adopt) {
        const result = await adoptPlan(adopt);
        window.location.href = result ? '/app/plan' : '/app/plan/upload';
        return;
      }
      // Ready does NOT wait on the profile. It is optional decoration on the
      // prompt, and gating the page on it meant a slow or failed read left
      // /app/plan/upload stuck on LoadingScreen with no way to author a plan at
      // all. Authoring works without a profile; the prompt just asks more
      // questions.
      // The catalogue decides which tab opens, so it is the one read the page
      // waits on — opening on Build and jumping to Ready would be a flash.
      // A failed read just means no Ready tab.
      const list = await getPlanTemplates().catch(() => [] as PlanTemplate[]);
      setTemplates(list);
      setMode(list.length > 0 ? 'ready' : 'build');
      setReady(true);
      getUserStats()
        .then(setStats)
        .catch(() => setStats(null));
      getMovements()
        .then(setMovements)
        .catch(() => setMovements([]));
    })();
  }, []);

  if (!ready) return <LoadingScreen />;

  const weeks = parsedPlan
    ? Math.max(
        1,
        ...parsedPlan.blocks.map((b) => b.endWeek),
        ...parsedPlan.days.flatMap((d) =>
          d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number)),
        ),
      )
    : 0;

  function selectTarget(t: Target) {
    setTarget(t);
    if (t === 'session') setSource('csv');
    setIssues([]);
    setError(null);
  }

  function openMethod(m: Method) {
    const next = method === m ? null : m;
    setMethod(next);
    if (next) setSource(next === 'markdown' ? 'markdown' : 'csv');
    setIssues([]);
    setError(null);
  }

  function parse() {
    setError(null);
    if (target === 'session') {
      const result = parseSessionTabular(csvText);
      setParsedSessions(result.sessions);
      setIssues(result.issues);
      return;
    }
    if (source === 'csv') {
      const result = parsePlanTabular(csvText);
      setParsedPlan(result.plan);
      setIssues(result.issues);
    } else {
      const plan = parsePlanMarkdown(markdown);
      setParsedPlan(plan);
      setIssues(validateParsedPlan(plan));
    }
  }

  async function save() {
    const blockingIssues = issues;
    if (blockingIssues.length > 0) {
      setError(`Resolve ${blockingIssues.length} compatibility issue${blockingIssues.length === 1 ? '' : 's'} before saving.`);
      return;
    }

    if (target === 'session') {
      if (!parsedSessions || parsedSessions.length === 0) return;
      setSaving(true);
      setError(null);
      const results = await Promise.all(parsedSessions.map((s) => createSession(s)));
      setSaving(false);
      if (results.some((r) => !r)) {
        setError('Some sessions could not be saved. Check your connection and try again.');
        return;
      }
      track('sessions_created', { count: parsedSessions.length, source: 'csv' });
      window.location.href = '/app/sessions';
      return;
    }

    if (!parsedPlan) return;
    setSaving(true);
    setError(null);
    const sourceText = source === 'csv' ? csvText : markdown;
    const result = await createPlan(parsedPlan, sourceText);
    setSaving(false);
    if (!result) {
      setError('Could not save the plan. Check your connection and try again.');
      return;
    }
    track('plan_created', { weeks, days: parsedPlan.days.length, source });
    window.location.href = '/app/plan';
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(
        target === 'session' ? buildSessionAiPrompt() : buildPlanAiPrompt({ stats }),
      );
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — select and copy the prompt manually.');
    }
  }

  /**
   * Hand the compatibility errors back to the AI that produced the file. The
   * user was otherwise relaying validator messages by hand into a chat where
   * the original prompt had often scrolled away.
   */
  async function copyFixRequest() {
    try {
      await navigator.clipboard.writeText(
        target === 'session' ? buildSessionFixPrompt(issues, csvText) : buildPlanFixPrompt(issues, csvText),
      );
      setFixCopied(true);
      setTimeout(() => setFixCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — select and copy the issues manually.');
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setSource('csv');
    const isWorkbook = /\.xlsx?$/i.test(file.name) || file.type.includes('spreadsheet');
    try {
      if (target === 'session') {
        if (isWorkbook) {
          const buf = await file.arrayBuffer();
          const result = await parseSessionWorkbook(buf);
          setCsvText('');
          setParsedSessions(result.sessions);
          setIssues(result.issues);
        } else {
          const text = await file.text();
          setCsvText(text);
          const result = parseSessionTabular(text);
          setParsedSessions(result.sessions);
          setIssues(result.issues);
        }
      } else if (isWorkbook) {
        const buf = await file.arrayBuffer();
        const result = await parsePlanWorkbook(buf);
        setCsvText('');
        setParsedPlan(result.plan);
        setIssues(result.issues);
      } else {
        const text = await file.text();
        setCsvText(text);
        const result = parsePlanTabular(text);
        setParsedPlan(result.plan);
        setIssues(result.issues);
      }
    } catch (err) {
      setError(`Could not read "${file.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const hasParsed = target === 'session' ? parsedSessions !== null : parsedPlan !== null;
  // Enough to personalise with. Goals drive every rep range in the rubric, so a
  // row that only has a bodyweight in it is not worth calling a profile.
  const profileIsUsable = (stats?.goals?.length ?? 0) > 0 || stats?.experience != null;
  // The repair prompt talks CSV rows and echoes `csvText`, so it only makes
  // sense for the tabular path. On the Markdown path it would hand a user
  // CSV-format instructions and an empty echo for a file they wrote by hand.
  const canRepair = target === 'session' || source === 'csv';

  // The authoring editor, shared by whichever method is open (only one is).
  const editor = (
    <div className="mt-3">
      {source === 'markdown' && target === 'plan' ? (
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          placeholder={PLAN_FORMAT_HELP}
          spellCheck={false}
          rows={12}
          aria-label="Plan in Markdown"
          className="w-full rounded-control border border-border bg-bg p-3 font-mono text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
        />
      ) : (
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={target === 'session' ? buildSessionCsvTemplate() : buildPlanCsvTemplate()}
          spellCheck={false}
          rows={10}
          aria-label="Paste CSV or TSV"
          className="w-full rounded-control border border-border bg-bg p-3 font-mono text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={parse}>
          Parse
        </Button>
        {hasParsed ? (
          <Button onClick={save} disabled={saving || issues.length > 0}>
            {saving ? 'Saving…' : target === 'session' ? 'Save sessions' : 'Save & activate'}
          </Button>
        ) : null}
      </div>
    </div>
  );

  const uploadButton = (
    <Button variant="ghost" onClick={() => fileInput.current?.click()}>
      Upload file
    </Button>
  );

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 pt-5">
      <Item>
        <EchoText text="NEW PLAN" as="h1" className={`mb-6 ${ECHO_APP_TITLE}`} />
      </Item>

      <input
        ref={fileInput}
        type="file"
        accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onFile}
        className="hidden"
      />

      {templates.length > 0 ? (
        <Item>
          <SegmentedTabs
            tabs={[
              { key: 'ready', label: 'Ready plan' },
              { key: 'build', label: 'Build my own' },
            ]}
            active={mode}
            onChange={(k) => setMode(k as Mode)}
            ariaLabel="How to start"
            className="mb-5"
          />
        </Item>
      ) : null}

      {mode === 'ready' && templates.length > 0 ? (
        <Item>
          <PlanTemplatePicker templates={templates} onBuild={() => setMode('build')} />
        </Item>
      ) : target === 'session' ? (
        <Item>
          <div className="pb-10">
            <SectionHeader
              action={
                <button
                  type="button"
                  onClick={() => selectTarget('plan')}
                  className="-my-3 inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-4 hover:text-fg"
                >
                  Back to plans
                </button>
              }
            >
              Import sessions
            </SectionHeader>
            <div className="rounded-card border border-border bg-surface p-4">
              <p className="text-sm text-muted">
                Copy the prompt into an outside AI chat (Claude, ChatGPT, Gemini), attach the CSV wireframe if it takes
                files, then paste its CSV back here or upload the file. Every session is saved standalone.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" onClick={copyPrompt}>
                  {promptCopied ? 'Prompt copied' : 'Copy AI prompt'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => downloadFile('verocity-sessions-template.csv', buildSessionCsvTemplate(), 'text/csv')}
                >
                  Template (CSV)
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadFile('verocity-sessions-template.tsv', buildSessionTsvTemplate(), 'text/tab-separated-values')
                  }
                >
                  Template (TSV)
                </Button>
                {uploadButton}
              </div>
              {editor}
            </div>
            {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
          </div>
        </Item>
      ) : (
        <Item>
          <div className="flex flex-col gap-2 pb-4">
            <span className="t-label text-muted">Pick a method</span>

            <MethodRow
              open={method === 'ai'}
              onToggle={() => openMethod('ai')}
              title="Generate with an AI"
              sub="Claude, ChatGPT or Gemini writes it for you"
              icon={<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />}
            >
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-subtle">
                <li>
                  Download your <strong className="font-semibold text-fg">context file</strong>: your profile and every
                  movement in your library.
                </li>
                <li>
                  Copy the <strong className="font-semibold text-fg">prompt</strong> into an AI chat with the file
                  attached.
                </li>
                <li>Paste the CSV it sends back below, or upload it.</li>
              </ol>
              {!profileIsUsable ? (
                <p className="mt-2 text-sm text-muted">
                  Nothing is on file about you yet, so the AI will ask for all of it. Filling in{' '}
                  <a href="/app/you" className="underline">
                    your profile and goals
                  </a>{' '}
                  first makes the plan specific to you.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadFile(
                      'verocity-context.csv',
                      buildPlanContextFile({ stats, movements, delimiter: ',' }),
                      'text/csv',
                    )
                  }
                >
                  Context file
                </Button>
                <Button variant="ghost" onClick={copyPrompt}>
                  {promptCopied ? 'Prompt copied' : 'Copy prompt'}
                </Button>
                {uploadButton}
              </div>
              {editor}
            </MethodRow>

            <MethodRow
              open={method === 'sheet'}
              onToggle={() => openMethod('sheet')}
              title="Upload a spreadsheet"
              sub="CSV, TSV or XLSX from our template"
              icon={
                <>
                  <rect x="4" y="4" width="16" height="16" rx="1" />
                  <path d="M4 10h16M10 4v16" />
                </>
              }
            >
              <p className="text-sm text-subtle">Fill in the template, then upload it or paste its rows below.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => downloadFile('verocity-plan-template.csv', buildPlanCsvTemplate(), 'text/csv')}
                >
                  Template (CSV)
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    downloadFile('verocity-plan-template.tsv', buildPlanTsvTemplate(), 'text/tab-separated-values')
                  }
                >
                  Template (TSV)
                </Button>
                {uploadButton}
              </div>
              {editor}
            </MethodRow>

            <MethodRow
              open={method === 'markdown'}
              onToggle={() => openMethod('markdown')}
              title="Write it in Markdown"
              sub="Type or paste the plan by hand"
              icon={<path d="M5 19h14M7 15l8.5-8.5 2 2L9 17H7z" />}
            >
              {editor}
            </MethodRow>

            {error ? <p className="mt-1 text-sm text-accent">{error}</p> : null}

            <button
              type="button"
              onClick={() => selectTarget('session')}
              className="mt-1 inline-flex min-h-11 items-center self-start text-sm text-subtle underline underline-offset-4 hover:text-fg"
            >
              Importing single sessions instead?
            </button>
          </div>
        </Item>
      )}

      {mode === 'build' && issues.length > 0 ? (
        <Item>
          <div className="mt-6 border border-accent/60 bg-surface p-4">
            <SectionHeader>Compatibility · {issues.length} issue{issues.length === 1 ? '' : 's'}</SectionHeader>
            <ul className="mt-2 list-disc pl-5 text-sm text-accent">
              {issues.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
            {canRepair ? (
              <>
                <p className="mt-3 text-sm text-muted">
                  Paste this back into the same AI conversation and it will re-send a corrected
                  file.
                </p>
                <div className="mt-2">
                  <Button variant="ghost" onClick={copyFixRequest}>
                    {fixCopied ? 'Fix request copied' : 'Copy fix request'}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </Item>
      ) : null}

      {mode === 'build' && target === 'plan' && parsedPlan ? (
        <Item>
          <div className="mt-8">
            <SectionHeader>
              Preview · {parsedPlan.title} · {weeks} weeks · {parsedPlan.days.length} days
            </SectionHeader>
            {parsedPlan.days.length === 0 ? (
              <EmptyState>No days parsed — check the format.</EmptyState>
            ) : (
              parsedPlan.days.map((day) => (
                <div key={day.dayKey} className="mb-4 border border-border p-4">
                  <div className="mb-2 font-display text-lg text-fg">{day.label}</div>
                  <ul className="flex flex-col gap-1 text-sm">
                    {day.exercises.map((ex, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="capitalize text-subtle">{ex.movement}</span>
                        <span className="tabular-nums text-muted">
                          {Object.values(ex.plannedByWeek)[0] ?? '—'}
                          {Object.keys(ex.plannedByWeek).length > 1 ? ' …' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </Item>
      ) : null}

      {mode === 'build' && target === 'session' && parsedSessions ? (
        <Item>
          <div className="mt-8">
            <SectionHeader>
              Preview · {parsedSessions.length} session{parsedSessions.length === 1 ? '' : 's'}
            </SectionHeader>
            {parsedSessions.length === 0 ? (
              <EmptyState>No sessions parsed — check the format.</EmptyState>
            ) : (
              parsedSessions.map((s, i) => {
                const groupCount = s.frame.groups?.length ?? 0;
                const variantCount = s.frame.variants?.length ?? 0;
                return (
                  <div key={i} className="mb-4 border border-border p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-display text-lg text-fg">{s.name || 'Untitled session'}</span>
                      {s.session_type ? (
                        <span className="border border-border px-2 py-0.5 text-xs uppercase tracking-wider text-muted">
                          {s.session_type}
                        </span>
                      ) : null}
                    </div>
                    {s.tags.length > 0 ? (
                      <div className="mb-2 text-xs uppercase tracking-wider text-subtle">{s.tags.join(' · ')}</div>
                    ) : null}
                    <div className="mb-2 text-xs text-muted">
                      {groupCount} group{groupCount === 1 ? '' : 's'}
                      {variantCount > 0 ? ` · ${variantCount} variant${variantCount === 1 ? '' : 's'}` : ''}
                    </div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {s.frame.exercises.map((ex, k) => (
                        <li key={k} className="flex justify-between">
                          <span className="capitalize text-subtle">{ex.movement}</span>
                          <span className="tabular-nums text-muted">{ex.planned || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        </Item>
      ) : null}
    </PageStagger>
  );
}
