import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { adoptPlan, createPlan } from '@/lib/queries';
import { parsePlanMarkdown, PLAN_FORMAT_HELP } from '@/lib/planParser';
import {
  buildPlanAiPrompt,
  buildPlanCsvTemplate,
  buildPlanTsvTemplate,
  parsePlanTabular,
  validateParsedPlan,
} from '@/lib/planTemplate';
import type { ParsedPlan } from '@/lib/types';
import { Button, EmptyState, SectionHeader } from '@/components/ui/primitives';
import { EchoText } from '@/components/EchoText';
import { Item, PageStagger } from '@/components/anim';

type Source = 'markdown' | 'csv';

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
  const [parsed, setParsed] = useState<ParsedPlan | null>(null);
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

  if (!ready) return <div className="px-6 py-16 text-sm text-muted">Loading…</div>;

  const weeks = parsed
    ? Math.max(
        1,
        ...parsed.blocks.map((b) => b.endWeek),
        ...parsed.days.flatMap((d) =>
          d.exercises.flatMap((e) => Object.keys(e.plannedByWeek).map(Number)),
        ),
      )
    : 0;

  function parse() {
    setError(null);
    if (source === 'csv') {
      const result = parsePlanTabular(csvText);
      setParsed(result.plan);
      setIssues(result.issues);
    } else {
      const plan = parsePlanMarkdown(markdown);
      setParsed(plan);
      setIssues(validateParsedPlan(plan));
    }
  }

  async function save() {
    if (!parsed) return;
    const blockingIssues = issues;
    if (blockingIssues.length > 0) {
      setError(`Resolve ${blockingIssues.length} compatibility issue${blockingIssues.length === 1 ? '' : 's'} before saving.`);
      return;
    }
    setSaving(true);
    setError(null);
    const sourceText = source === 'csv' ? csvText : markdown;
    const result = await createPlan(parsed, sourceText);
    setSaving(false);
    if (!result) {
      setError('Could not save the plan. Check your connection and try again.');
      return;
    }
    window.location.href = '/app/plan';
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildPlanAiPrompt());
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — select and copy the prompt manually.');
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setSource('csv');
      setCsvText(text);
      const result = parsePlanTabular(text);
      setParsed(result.plan);
      setIssues(result.issues);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <PageStagger className="mx-auto max-w-3xl px-6 py-10">
      <Item>
        <EchoText
          text="NEW PLAN"
          as="h1"
          className="mb-8 font-display text-5xl font-bold uppercase leading-[0.9] tracking-[-0.04em] text-fg md:text-7xl"
        />
      </Item>

      <Item>
        <div className="mb-6 border border-border bg-surface p-4">
          <SectionHeader>Generate a plan with AI</SectionHeader>
          <p className="mt-2 text-sm text-muted">
            Download the CSV (or TSV) wireframe, attach it to your AI of choice
            along with the copied prompt, then upload the AI&rsquo;s output below.
            Compatibility is checked before save.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => downloadFile('verocity-plan-template.csv', buildPlanCsvTemplate(), 'text/csv')}
            >
              Download CSV
            </Button>
            <Button
              variant="ghost"
              onClick={() => downloadFile('verocity-plan-template.tsv', buildPlanTsvTemplate(), 'text/tab-separated-values')}
            >
              Download TSV
            </Button>
            <Button variant="ghost" onClick={copyPrompt}>
              {promptCopied ? 'Prompt copied' : 'Copy AI prompt'}
            </Button>
            <Button variant="ghost" onClick={() => fileInput.current?.click()}>
              Upload CSV/TSV
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              onChange={onFile}
              className="hidden"
            />
          </div>
        </div>
      </Item>

      <Item>
        <div className="mb-3 flex gap-2 text-xs uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setSource('markdown')}
            className={`border px-3 py-1 ${source === 'markdown' ? 'border-fg text-fg' : 'border-border text-muted'}`}
          >
            Markdown
          </button>
          <button
            type="button"
            onClick={() => setSource('csv')}
            className={`border px-3 py-1 ${source === 'csv' ? 'border-fg text-fg' : 'border-border text-muted'}`}
          >
            CSV / TSV
          </button>
        </div>

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
            placeholder={buildPlanCsvTemplate()}
            spellCheck={false}
            rows={14}
            className="w-full border border-border bg-surface p-3 font-mono text-sm text-fg outline-none placeholder:text-muted focus:border-subtle"
          />
        )}

        <div className="mt-4 flex gap-3">
          <Button variant="ghost" onClick={parse}>
            Parse
          </Button>
          {parsed ? (
            <Button onClick={save} disabled={saving || issues.length > 0}>
              {saving ? 'Saving…' : 'Save & activate'}
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

      {parsed ? (
        <Item>
          <div className="mt-8">
            <SectionHeader>
              Preview · {parsed.title} · {weeks} weeks · {parsed.days.length} days
            </SectionHeader>
            {parsed.days.length === 0 ? (
              <EmptyState>No days parsed — check the format.</EmptyState>
            ) : (
              parsed.days.map((day) => (
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
    </PageStagger>
  );
}
