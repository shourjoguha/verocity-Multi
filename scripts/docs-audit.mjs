// Docs audit — the standing check for the guidance documents themselves.
//
// This repo had standing checks for mobile layout and for sheet flicker, and
// none for its own instructions. The instructions rotted accordingly: a
// five-round bug hunt was steered by a doc that told the reader to use `.lift`
// on modal panels (the thing that caused the stutter), by five entries
// prescribing code that had been deleted, and by six documents claiming a
// shipped feature did not exist yet. Every one of those is a code identifier
// that stopped resolving, so every one of them is mechanically catchable.
//
// What it does: pulls every backtick-quoted code identifier out of the docs and
// checks that it still resolves against the source tree. Unresolved identifiers
// fail the run.
//
// WHAT IT CANNOT SEE — read this before trusting a green run:
//   - Whether a rule is TRUE. `.lift` resolves fine; that it is the wrong
//     advice for a modal panel is not something this can know.
//   - Prose that contradicts other prose, in the same doc or across docs.
//   - Anything not written as a `backticked` identifier.
//   - Whether a documented npm script does what its description claims.
// A green run means "the docs name things that exist", nothing more.
//
// Usage:  npm run audit:docs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DOCS = ['CLAUDE.md', 'docs/SPEC.md', 'docs/LESSONS.md', 'docs/HANDOVER.md', 'docs/ROADMAP.md'];
// `.claude` holds the ui-change / db-change / docs-upkeep skills and the agent
// definitions. The docs route to them by path, so those paths are claims like
// any other and get checked like any other.
const SEARCH_ROOTS = ['src', 'scripts', 'supabase', 'public', '.claude'];
// Config files live at the repo root, outside the search roots.
const ROOT_FILES = ['package.json', 'astro.config.mjs', 'postcss.config.mjs', 'tsconfig.json', 'vitest.config.ts'];

// Browser and platform APIs the docs name while explaining a mechanism. They
// are not this repo's code, so their absence from src/ says nothing.
const PLATFORM = new Set([
  'elementFromPoint', 'visualViewport', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getAnimations',
  'matchMedia', 'querySelector', 'querySelectorAll', 'scrollTo', 'preventScroll',
  'scrollIntoView', 'AbortController', 'localStorage', 'sessionStorage',
  'skipWaiting', 'waitUntil', 'respondWith', 'createPortal', 'autoFocus',
  'prefers-reduced-motion', 'backdrop-filter', 'overscroll-behavior', 'scrollbar-gutter',
  'touch-action', 'animation-fill-mode', 'transform-style', 'will-change',
]);

// Deliberate references to things that do not exist. Every entry carries its
// reason — same convention as the 44px exceptions in scripts/mobile-audit.mjs.
//
// `section` SCOPES the exemption. A dead identifier is allowed inside the
// Superseded block, where naming it is the point, and still fails everywhere
// else — so this cannot become the trap docs/LESSONS.md already warns about,
// where a guard passes because its allowlist swallowed the finding.
const ALLOW = [
  // Named in the Superseded record so what was tried survives. Dead on purpose.
  { id: 'SHEET_EXIT_MS', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'the sheet exit constant, removed with the JS animation' },
  { id: 'AnimatePresence', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'sheets no longer defer unmount' },
  { id: 'motion/react', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'sheets are CSS-driven now' },
  { id: 'MotionConfig', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'removed with Motion' },
  { id: 'clampScore', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'the radar’s absolute clamp, replaced by the relative logistic in scoreAgainstBaseline' },
  { id: 'ASPECT_ABSOLUTE_ANCHORS', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'the radar’s invented reference values; a thin baseline now yields no score at all' },
  { id: 'completedMonthEnds', doc: 'docs/LESSONS.md', section: 'Superseded', why: 'monthly snapshot anchors, replaced by weekly completedWeekEnds' },
  { id: 'public/sw.js', doc: 'docs/LESSONS.md', why: 'the Caching entry names the old path to explain why it moved' },
  { id: '/sw.test', doc: 'docs/LESSONS.md', why: 'names the route that must NOT exist — that is the lesson' },
  // Not this repo's code.
  { id: 'three.js', why: 'library name, not a local module' },
  { id: 'ANTHROPIC_API_KEY', why: 'env var, set in the Supabase dashboard' },
  { id: 'SHOWCASE_PROFILE_ID', why: 'env var' },
];

function isAllowed(id, doc, section) {
  return ALLOW.some(
    (a) => a.id === id && (!a.doc || a.doc === doc) && (!a.section || a.section === section),
  );
}

// ---- collect what actually exists -------------------------------------------

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// This file is excluded from its own corpus. Without that, every identifier in
// the allowlist below "resolves" — because the allowlist mentions it — and the
// check vouches for exactly the things it is supposed to catch.
const SELF = 'scripts/docs-audit.mjs';
const files = [...SEARCH_ROOTS.flatMap((r) => walk(r)), ...ROOT_FILES.filter((f) => existsSync(f))].filter(
  (f) => f !== SELF,
);
const sourceText = files
  .filter((f) => ['.ts', '.tsx', '.astro', '.css', '.js', '.mjs', '.sql'].includes(extname(f)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts ?? {}));
const deps = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);

// A path is real if it exists, or if some file's path ends with it (docs often
// use a shorthand like `logger/SetEntrySheet.tsx` or `ui/Modal.tsx`).
const pathExists = (p) => {
  const clean = p.replace(/^\.\//, '').replace(/\/$/, '');
  if (existsSync(clean)) return true;
  return files.some((f) => f === clean || f.endsWith('/' + clean));
};

// ---- classify and resolve ----------------------------------------------------

// Only claims we can actually adjudicate. Prose in backticks is skipped.
function classify(raw) {
  const t = raw.trim();
  if (!t || t.length > 80) return null;
  if (PLATFORM.has(t)) return null;
  if (/^npm run [a-z:]+$/.test(t)) return { kind: 'script', key: t.replace('npm run ', '') };
  if (/^npm (test|install|ci)$/.test(t)) return null;
  // A URL route (`/sw.js`, `/app/coach`) — resolved against src/pages, not disk.
  if (/^\/[\w./-]*$/.test(t)) return { kind: 'route', key: t };
  // A path: has a slash and a known extension. `md` is here so a route to a
  // skill (`.claude/skills/ui-change/SKILL.md`) or a sibling doc is checked
  // rather than silently skipped; the bare-filename rule below deliberately
  // does NOT take `md`, since `CLAUDE.md` and friends live outside the search
  // roots and a bare name is ambiguous anyway.
  if (/^[\w./@-]+\.(tsx?|astro|css|mjs|js|sql|json|webmanifest|svg|md)$/.test(t) && t.includes('/')) {
    return { kind: 'path', key: t };
  }
  // A bare filename. Must start with a word char — `.test.ts` is a suffix
  // pattern, not a file.
  if (/^\w[\w.-]*\.(tsx?|astro|css|mjs|js|sql)$/.test(t)) return { kind: 'basename', key: t };
  // A CSS class.
  if (/^\.[a-z][\w-]*$/.test(t)) return { kind: 'symbol', key: t.slice(1) };
  // snake_case is a DB table, a Postgres role, or an MCP tool name — none of
  // which live in src/, so their absence proves nothing.
  if (/_/.test(t) && t === t.toLowerCase()) return null;
  // An exported identifier: Component, Type, SCREAMING_CONST, or a module name.
  // Requires a capital — an all-lowercase word is prose or an opaque ID (a
  // Supabase project ref, a slug), not something we can adjudicate.
  if (/^[A-Za-z_$][\w$]*$/.test(t) && t.length > 3 && /[A-Z]/.test(t)) {
    return { kind: 'symbol', key: t };
  }
  return null;
}

function resolves(c) {
  switch (c.kind) {
    case 'script':
      return scripts.has(c.key);
    case 'path':
      return pathExists(c.key) || deps.has(c.key);
    case 'basename':
      return files.some((f) => f.endsWith('/' + c.key) || f === c.key);
    case 'route': {
      // `/app/coach` -> src/pages/app/coach.astro; `/sw.js` -> src/pages/sw.js.ts
      const stem = c.key.replace(/^\//, '').replace(/\/$/, '') || 'index';
      // A route resolves as a file (`app/coach.astro`, `sw.js.ts`) or as a
      // directory index (`/app` -> src/pages/app/index.astro).
      return (
        files.some(
          (f) =>
            f.startsWith('src/pages/') &&
            (f.includes('/' + stem + '.') || f.startsWith('src/pages/' + stem + '/')),
        ) || pathExists('public/' + stem)
      );
    }
    case 'symbol':
      // Word-boundary match so `EASE` doesn't match `RELEASE`.
      return new RegExp(`\\b${c.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(sourceText);
    default:
      return true;
  }
}

// ---- run ---------------------------------------------------------------------

const findings = [];
for (const doc of DOCS) {
  if (!existsSync(doc)) {
    findings.push({ doc, line: 0, id: doc, kind: 'path', note: 'document listed in the audit does not exist' });
    continue;
  }
  const lines = readFileSync(doc, 'utf8').split('\n');
  let fenced = false;
  let section = '';
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return; // code blocks are illustrative, not claims
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) section = h[1];
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const c = classify(m[1]);
      if (!c) continue;
      if (isAllowed(m[1].trim(), doc, section)) continue;
      if (resolves(c)) continue;
      findings.push({ doc, line: i + 1, id: m[1].trim(), kind: c.kind });
    }
  });
}

// De-duplicate: the same dead identifier repeated in one doc is one problem.
const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.doc}|${f.id}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

for (const f of unique) {
  console.log(`[FAIL] ${f.doc}:${f.line}  ${f.kind.padEnd(8)} \`${f.id}\`${f.note ? '  — ' + f.note : ''}`);
}
console.log(
  unique.length === 0
    ? `\nAll ${DOCS.length} documents name only things that exist. (${ALLOW.length} allowlisted.)`
    : `\n${unique.length} identifier(s) in the docs no longer resolve.`,
);
process.exit(unique.length === 0 ? 0 : 1);
