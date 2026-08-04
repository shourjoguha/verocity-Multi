import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { adoptPlan, createPlan, createSession } from '@/lib/queries';
import type { SessionInput } from '@/lib/queries';
import { parsePlanMarkdown, PLAN_FORMAT_HELP } from '@/lib/planParser';
import {
  buildPlanAiPrompt,
  buildPlanCsvTemplate,
  buildPlanTsvTemplate,
  parsePlanTabular,
  parsePlanWorkbook,
  validateParsedPlan,
} from '@/lib/planTemplate';
import {
  buildSessionAiPrompt,
  buildSessionCsvTemplate,
  buildSessionTsvTemplate,
  parseSessionTabular,
  parseSessionWorkbook,
} from '@/lib/sessionTemplate';
import type { ParsedPlan } from '@/lib/types';
import { track } from '@/lib/analytics';
import { Button, EmptyState, LoadingScreen, SectionHeader } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

type Source = 'markdown' | 'csv';
type Target = 'plan' | 'session';

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
      setReady(true);
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
      await navigator.clipboard.writeText(target === 'session' ? buildSessionAiPrompt() : buildPlanAiPrompt());
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — select and copy the prompt manually.');
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

  return (
    <PageStagger className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
      <Item>
        <EchoText
          text="NEW PLAN"
          as="h1"
          className="mb-8 font-display text-3xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg sm:text-5xl md:text-7xl"
        />
      </Item>

      <Item>
        <div className="mb-6 border border-border bg-surface p-4">
          <SectionHeader>Generate a plan or sessions with AI</SectionHeader>
          <p className="mt-2 text-sm text-muted">
            {target === 'session'
              ? "Download the CSV (or TSV) wireframe, attach it to your AI of choice along with the copied prompt, then upload the AI's output below — every session in the file is saved standalone. Compatibility is checked before save."
              : "Download the CSV (or TSV) wireframe, attach it to your AI of choice along with the copied prompt, then upload the AI's output below. Compatibility is checked before save."}
          </p>

          <div className="mt-3 flex gap-2 text-xs uppercase tracking-wider">
            <button
              type="button"
              onClick={() => selectTarget('plan')}
              aria-pressed={target === 'plan'}
              className={`hill-btn border bg-surface px-3 py-1 ${target === 'plan' ? 'border-fg text-fg' : 'border-border text-muted'}`}
            >
              Plan
            </button>
            <button
              type="button"
              onClick={() => selectTarget('session')}
              aria-pressed={target === 'session'}
              className={`hill-btn border bg-surface px-3 py-1 ${target === 'session' ? 'border-fg text-fg' : 'border-border text-muted'}`}
            >
              Sessions
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() =>
                target === 'session'
                  ? downloadFile('verocity-sessions-template.csv', buildSessionCsvTemplate(), 'text/csv')
                  : downloadFile('verocity-plan-template.csv', buildPlanCsvTemplate(), 'text/csv')
              }
            >
              Download CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                target === 'session'
                  ? downloadFile('verocity-sessions-template.tsv', buildSessionTsvTemplate(), 'text/tab-separated-values')
                  : downloadFile('verocity-plan-template.tsv', buildPlanTsvTemplate(), 'text/tab-separated-values')
              }
            >
              Download TSV
            </Button>
            <Button variant="ghost" onClick={copyPrompt}>
              {promptCopied ? 'Prompt copied' : 'Copy AI prompt'}
            </Button>
            <Button variant="ghost" onClick={() => fileInput.current?.click()}>
              Upload CSV / TSV / XLSX
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFile}
              className="hidden"
            />
          </div>
        </div>
      </Item>

      <Item>
        {target === 'plan' ? (
          <div className="mb-3 flex gap-2 text-xs uppercase tracking-wider">
            <button
              type="button"
              onClick={() => setSource('markdown')}
              aria-pressed={source === 'markdown'}
              className={`hill-btn border bg-surface px-3 py-1 ${source === 'markdown' ? 'border-fg text-fg' : 'border-border text-muted'}`}
            >
              Markdown
            </button>
            <button
              type="button"
              onClick={() => setSource('csv')}
              aria-pressed={source === 'csv'}
              className={`hill-btn border bg-surface px-3 py-1 ${source === 'csv' ? 'border-fg text-fg' : 'border-border text-muted'}`}
            >
              CSV / TSV
            </button>
          </div>
        ) : null}

        {source === 'markdown' ? (
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={PLAN_FORMAT_HELP}
            spellCheck={false}
            rows={14}
            className="w-full border border-border bg-surface p-3 font-mono text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
          />
        ) : (
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={target === 'session' ? buildSessionCsvTemplate() : buildPlanCsvTemplate()}
            spellCheck={false}
            rows={14}
            className="w-full border border-border bg-surface p-3 font-mono text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
          />
        )}

        <div className="mt-4 flex gap-3">
          <Button variant="ghost" onClick={parse}>
            Parse
          </Button>
          {hasParsed ? (
            <Button onClick={save} disabled={saving || issues.length > 0}>
              {saving ? 'Saving…' : target === 'session' ? 'Save sessions' : 'Save & activate'}
            </Button>
          ) : null}
        </div>

        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </Item>

      {issues.length > 0 ? (
        <Item>
          <div className="mt-6 border border-accent/60 bg-surface p-4">
            <SectionHeader>Compatibility · {issues.length} issue{issues.length === 1 ? '' : 's'}</SectionHeader>
            <ul className="mt-2 list-disc pl-5 text-sm text-accent">
              {issues.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
          </div>
        </Item>
      ) : null}

      {target === 'plan' && parsedPlan ? (
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

      {target === 'session' && parsedSessions ? (
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
