#!/usr/bin/env node
// Mint one invite code and render the new-user welcome page for it.
//
//   node scripts/invites/new-invite.mjs --label "Alex (gym)" \
//     --plans "16-Week Program|Endurance & Cut Block|Cooking the Base" \
//     [--days 30] [--site lift.shourjoguha.com] [--out path/to/welcome.html]
//
// Prints JSON: the plaintext code, the SQL to register it, and where the page
// was written. Nothing touches the database here: there is no service-role key
// on this side, so the SQL is run through the Supabase MCP (execute_sql).
// The plaintext code exists only in this output and the rendered page, never
// in the database (invites stores a sha-256 hash plus the last 4 characters).
//
// Steps and the ledger queries: .claude/skills/invite-user/SKILL.md

import { createHash, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const label = arg('label');
const plans = arg('plans');
const days = Number(arg('days', '30'));
const site = arg('site', 'lift.shourjoguha.com');
const out = arg('out', 'verocity-welcome.html');

if (!label || !plans || !Number.isInteger(days) || days < 1) {
  console.error('usage: --label "<who it is for>" --plans "A|B|C" [--days 30] [--site host] [--out file]');
  process.exit(1);
}

// No O/0/I/1, so a code read aloud or retyped cannot be misread.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const chunk = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const code = `VERO-${chunk()}-${chunk()}`;
const hash = createHash('sha256').update(code).digest('hex');

const expires = new Date(Date.now() + days * 86_400_000);
const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(expires);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const names = plans.split('|').map((p) => `<i>${esc(p.trim())}</i>`);
const readyPlans = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];

const html = readFileSync(join(here, 'welcome.template.html'), 'utf8')
  .replaceAll('{{CODE}}', code)
  .replaceAll('{{EXPIRES_LONG}}', fmt({ day: 'numeric', month: 'long', year: 'numeric' }))
  .replaceAll('{{EXPIRES_SHORT}}', fmt({ day: 'numeric', month: 'short', year: 'numeric' }))
  .replaceAll('{{READY_PLANS}}', readyPlans)
  .replaceAll('{{SITE}}', site);

if (/\{\{[A-Z_]+\}\}/.test(html)) {
  console.error('template still has an unfilled {{PLACEHOLDER}}');
  process.exit(1);
}
writeFileSync(out, html);

const sqlText = (s) => `'${s.replace(/'/g, "''")}'`;
console.log(JSON.stringify({
  code,
  expires_at: expires.toISOString(),
  page: out,
  sql: `insert into public.invites (code_hash, code_hint, label, expires_at) values (${sqlText(hash)}, ${sqlText(code.slice(-4))}, ${sqlText(label)}, ${sqlText(expires.toISOString())}) returning id;`,
}, null, 2));
