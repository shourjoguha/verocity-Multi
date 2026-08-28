// One-off profiler for a Garmin "Export All Data" download (folder or ZIP).
//
// Runs LOCALLY and prints only STRUCTURE — filenames, record shapes, field
// names, numeric ranges. It never prints a free-text value: string fields are
// shown only when they have <= ENUM_MAX distinct values (so `activityType` is
// visible but a note or a place name is not), and identity/location-ish keys
// are dropped entirely. The point is to verify the shipped parser's shape
// predicates and unit assumptions (src/lib/garmin/parseExport.ts and
// normalize.ts both carry "UNVERIFIED AGAINST A REAL EXPORT" headers) without
// moving health data off the machine.
//
//   node scripts/garmin-profile.mjs "~/Downloads/Garmin data download 28_08_26"
//
// Review the output before sharing it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
// fflate is imported lazily so profiling a plain folder needs no dependencies
// installed — only a .zip in the path pulls it in.
let unzipSync;
async function loadUnzip() {
  if (!unzipSync) ({ unzipSync } = await import('fflate'));
  return unzipSync;
}

const ENUM_MAX = 12; // above this a string field is treated as free text

// Keys never printed, matched case-insensitively as substrings.
const REDACT = [
  'lat', 'lon', 'name', 'note', 'comment', 'email', 'address', 'serial',
  'phone', 'user', 'owner', 'device', 'token', 'password', 'location', 'place',
];
const redacted = (k) => REDACT.some((r) => k.toLowerCase().includes(r));

// ---- gather files -----------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, size: st.size, bytes: () => readFileSync(p) });
  }
  return out;
}

async function collect(target) {
  const st = statSync(target);
  if (st.isFile() && extname(target).toLowerCase() === '.zip') {
    const files = (await loadUnzip())(new Uint8Array(readFileSync(target)));
    return Object.entries(files).map(([path, b]) => ({
      path, size: b.length, bytes: () => Buffer.from(b),
    }));
  }
  if (!st.isDirectory()) return [{ path: target, size: st.size, bytes: () => readFileSync(target) }];
  // A folder may still contain nested ZIPs — expand them one level.
  const out = [];
  for (const f of walk(target)) {
    if (extname(f.path).toLowerCase() === '.zip') {
      const inner = (await loadUnzip())(new Uint8Array(f.bytes()));
      for (const [path, b] of Object.entries(inner)) {
        out.push({ path: `${basename(f.path)}!/${path}`, size: b.length, bytes: () => Buffer.from(b) });
      }
    } else out.push(f);
  }
  return out;
}

// ---- record extraction ------------------------------------------------------

const isRec = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Flatten a parsed JSON file to candidate records, unwrapping single-array
// wrappers (the export's common shape, e.g. `{summarizedActivitiesExport:[…]}`).
function records(parsed, out = []) {
  if (Array.isArray(parsed)) { for (const el of parsed) records(el, out); return out; }
  if (!isRec(parsed)) return out;
  const arrayKeys = Object.keys(parsed).filter((k) => Array.isArray(parsed[k]));
  if (arrayKeys.length && Object.keys(parsed).length <= 2) {
    for (const k of arrayKeys) records(parsed[k], out);
    return out;
  }
  out.push(parsed);
  return out;
}

// Group by filename with digits and date fragments stripped, which is how the
// export names its shards (…_2024-01-01_…json).
const groupKey = (path) =>
  basename(path).replace(/\d/g, '#').replace(/#+/g, '#').replace(/\.json$/i, '');

// ---- field profiling --------------------------------------------------------

function profile(recs) {
  const fields = new Map();
  for (const r of recs) {
    for (const [k, v] of Object.entries(r)) {
      if (redacted(k)) continue;
      let f = fields.get(k);
      if (!f) { f = { present: 0, types: new Set(), nums: [], strs: new Set(), overflow: false }; fields.set(k, f); }
      if (v === null || v === undefined) { f.types.add('null'); continue; }
      f.present++;
      if (typeof v === 'number') { f.types.add('number'); f.nums.push(v); }
      else if (typeof v === 'string') {
        f.types.add('string');
        // Date-shaped strings report a range rather than overflowing to
        // redacted — the export's coverage span is the point of the profile.
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
          f.dateMin = f.dateMin && f.dateMin < v ? f.dateMin : v;
          f.dateMax = f.dateMax && f.dateMax > v ? f.dateMax : v;
          continue;
        }
        if (!f.overflow) { f.strs.add(v); if (f.strs.size > ENUM_MAX) { f.overflow = true; f.strs.clear(); } }
      } else if (typeof v === 'boolean') f.types.add('boolean');
      else if (Array.isArray(v)) f.types.add(`array[${v.length ? typeof v[0] : ''}]`);
      else f.types.add(`object{${Object.keys(v).filter((x) => !redacted(x)).slice(0, 6).join(',')}}`);
    }
  }
  return fields;
}

const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function describe(name, f, total) {
  const pct = Math.round((f.present / total) * 100);
  const bits = [`${name}  ${pct}%  ${[...f.types].join('|')}`];
  if (f.nums.length) {
    const s = [...f.nums].sort((a, b) => a - b);
    bits.push(`min=${s[0]} p50=${q(s, 0.5)} max=${s[s.length - 1]}`);
  }
  if (f.dateMin) bits.push(`range=${f.dateMin.slice(0, 10)} \u2192 ${f.dateMax.slice(0, 10)}`);
  else if (f.strs.size && !f.overflow) bits.push(`values={${[...f.strs].join(', ')}}`);
  else if (f.overflow) bits.push('<free text, redacted>');
  return '    ' + bits.join('  ');
}

// ---- main -------------------------------------------------------------------

const target = process.argv[2];
if (!target) { console.error('usage: node scripts/garmin-profile.mjs <folder-or-zip>'); process.exit(1); }

const files = await collect(target);
const byExt = new Map();
for (const f of files) {
  const e = (extname(f.path) || '<none>').toLowerCase();
  const cur = byExt.get(e) ?? { n: 0, bytes: 0 };
  byExt.set(e, { n: cur.n + 1, bytes: cur.bytes + f.size });
}

console.log(`# Garmin export profile\n`);
console.log(`files: ${files.length}, total ${(files.reduce((a, f) => a + f.size, 0) / 1e6).toFixed(1)} MB\n`);
console.log('## by extension');
for (const [ext, v] of [...byExt].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${ext.padEnd(10)} ${String(v.n).padStart(5)} files  ${(v.bytes / 1e6).toFixed(1)} MB`);
}

console.log('\n## directory tree (depth 3, names only)');
const dirs = new Set();
for (const f of files) {
  const parts = f.path.split(/[/\\]/).slice(0, -1);
  for (let d = 1; d <= Math.min(3, parts.length); d++) dirs.add(parts.slice(0, d).join('/'));
}
for (const d of [...dirs].sort()) console.log(`  ${d}/`);

console.log('\n## non-JSON files (name shapes only)');
const nonJson = new Set(files.filter((f) => extname(f.path).toLowerCase() !== '.json').map((f) => groupKey(f.path)));
for (const g of [...nonJson].sort().slice(0, 40)) console.log(`  ${g}`);

// CSV headers, if this is the Connect web export rather than the GDPR ZIP.
const csvs = files.filter((f) => extname(f.path).toLowerCase() === '.csv');
if (csvs.length) {
  console.log('\n## CSV headers');
  const seen = new Set();
  for (const f of csvs) {
    const header = f.bytes().toString('utf8').split(/\r?\n/)[0];
    if (seen.has(header)) continue;
    seen.add(header);
    console.log(`  ${groupKey(f.path)}\n    ${header}`);
  }
}

console.log('\n## JSON record groups');
const groups = new Map();
for (const f of files) {
  if (extname(f.path).toLowerCase() !== '.json') continue;
  let parsed;
  try { parsed = JSON.parse(f.bytes().toString('utf8')); } catch { console.log(`  (unparseable: ${groupKey(f.path)})`); continue; }
  const g = groupKey(f.path);
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(...records(parsed));
}

for (const [g, recs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n### ${g}  — ${recs.length} records`);
  const fields = profile(recs);
  for (const [name, f] of [...fields].sort((a, b) => b[1].present - a[1].present)) {
    console.log(describe(name, f, recs.length));
  }
}
