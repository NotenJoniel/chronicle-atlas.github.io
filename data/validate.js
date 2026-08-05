/**
 * Chronicle Atlas — データバリデーションスクリプト
 * 
 * schema.json に基づく全タイムラインJSONの型チェック・整合性検証。
 * 使い方: node data/validate.js
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const TIMELINES_DIR = path.join(DATA_DIR, 'timelines');

let totalErrors = 0;
let totalWarnings = 0;

function error(file, msg) { totalErrors++; console.error(`  ❌ ${file}: ${msg}`); }
function warn(file, msg) { totalWarnings++; console.warn(`  ⚠️  ${file}: ${msg}`); }
function ok(msg) { console.log(`  ✅ ${msg}`); }

// ── Cross-file ID uniqueness registries ──
const eventIdRegistry = new Map();  // id -> [filename, ...]
const charIdRegistry = new Map();
function registerId(registry, id, filename) {
  if (!registry.has(id)) registry.set(id, []);
  registry.get(id).push(filename);
}

// ── Validate a single timeline JSON ──
function validateTimeline(filename) {
  const filePath = path.join(TIMELINES_DIR, filename);
  console.log(`\n📋 ${filename}`);

  let data;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(raw);
  } catch (e) {
    error(filename, `JSON parse error: ${e.message}`);
    return;
  }

  // ── 1. Required top-level keys ──
  const requiredKeys = ['eraPhases', 'factions', 'categories', 'characters', 'events', 'mapSnapshots', 'wikiLinks'];
  for (const key of requiredKeys) {
    if (!(key in data)) {
      error(filename, `Missing required key: "${key}"`);
    }
  }

  // ── 2. eraPhases ──
  if (Array.isArray(data.eraPhases)) {
    const phaseIds = new Set();
    for (const phase of data.eraPhases) {
      if (typeof phase.id !== 'number') error(filename, `eraPhases: id must be number, got ${typeof phase.id}`);
      if (typeof phase.name !== 'string') error(filename, `eraPhases: name must be string`);
      if (typeof phase.startYear !== 'number') error(filename, `eraPhases[${phase.id}]: startYear must be number`);
      if (typeof phase.endYear !== 'number') error(filename, `eraPhases[${phase.id}]: endYear must be number`);
      if (phaseIds.has(phase.id)) error(filename, `eraPhases: duplicate id ${phase.id}`);
      phaseIds.add(phase.id);
    }
    ok(`eraPhases: ${data.eraPhases.length} phases`);
  }

  // ── 3. factions ──
  const factionIds = new Set();
  if (data.factions && typeof data.factions === 'object') {
    for (const [key, val] of Object.entries(data.factions)) {
      factionIds.add(key);
      if (typeof val.name !== 'string') error(filename, `factions["${key}"]: name must be string`);
    }
    ok(`factions: ${factionIds.size} factions`);
  }

  // ── 4. categories ──
  const categoryIds = new Set();
  const UNIFIED_CATEGORIES = ['battle', 'politics', 'episode', 'death'];
  if (data.categories && typeof data.categories === 'object') {
    for (const [key, val] of Object.entries(data.categories)) {
      categoryIds.add(key);
      if (typeof val.name !== 'string') error(filename, `categories["${key}"]: name must be string`);
      if (typeof val.icon !== 'string') error(filename, `categories["${key}"]: icon must be string`);
    }
    // Check unified categories
    for (const uc of UNIFIED_CATEGORIES) {
      if (!categoryIds.has(uc)) {
        error(filename, `categories: missing unified category "${uc}"`);
      }
    }
    for (const key of categoryIds) {
      if (!UNIFIED_CATEGORIES.includes(key)) {
        error(filename, `categories: non-standard category "${key}" (allowed: ${UNIFIED_CATEGORIES.join(', ')})`);
      }
    }
    ok(`categories: ${categoryIds.size} categories`);
  }

  // ── 5. characters ──
  const charIds = new Set();
  if (Array.isArray(data.characters)) {
    for (const ch of data.characters) {
      if (typeof ch.id !== 'string') { error(filename, `characters: id must be string`); continue; }
      if (charIds.has(ch.id)) error(filename, `characters: duplicate id "${ch.id}"`);
      charIds.add(ch.id);
      registerId(charIdRegistry, ch.id, filename);

      if (typeof ch.name !== 'string') error(filename, `characters["${ch.id}"]: name must be string`);
      if (typeof ch.faction !== 'string') error(filename, `characters["${ch.id}"]: faction must be string`);
      if (ch.faction && !factionIds.has(ch.faction)) {
        error(filename, `characters["${ch.id}"]: faction "${ch.faction}" not in factions`);
      }
      if (typeof ch.role !== 'string') error(filename, `characters["${ch.id}"]: role must be string`);
      if (typeof ch.description !== 'string') error(filename, `characters["${ch.id}"]: description must be string`);
    }
    ok(`characters: ${data.characters.length} characters`);
  }

  // ── 6. events ──
  const eventIds = new Set();
  const phaseIdSet = new Set((data.eraPhases || []).map(p => p.id));
  if (Array.isArray(data.events)) {
    for (const ev of data.events) {
      if (typeof ev.id !== 'string') { error(filename, `events: id must be string`); continue; }
      if (eventIds.has(ev.id)) error(filename, `events: duplicate id "${ev.id}"`);
      eventIds.add(ev.id);
      registerId(eventIdRegistry, ev.id, filename);

      if (typeof ev.year !== 'number') error(filename, `events["${ev.id}"]: year must be number`);
      if (typeof ev.title !== 'string') error(filename, `events["${ev.id}"]: title must be string`);
      if (typeof ev.phaseId !== 'number') error(filename, `events["${ev.id}"]: phaseId must be number`);
      if (!phaseIdSet.has(ev.phaseId)) error(filename, `events["${ev.id}"]: phaseId ${ev.phaseId} not in eraPhases`);
      if (typeof ev.category !== 'string') error(filename, `events["${ev.id}"]: category must be string`);
      if (ev.category && !categoryIds.has(ev.category)) {
        error(filename, `events["${ev.id}"]: category "${ev.category}" not in categories`);
      }
      if (!Array.isArray(ev.characters)) {
        error(filename, `events["${ev.id}"]: characters must be array`);
      } else {
        for (const cid of ev.characters) {
          if (!charIds.has(cid)) {
            warn(filename, `events["${ev.id}"]: character "${cid}" not in characters`);
          }
        }
      }
      if (typeof ev.description !== 'string') error(filename, `events["${ev.id}"]: description must be string`);
    }
    ok(`events: ${data.events.length} events`);
  }

  // ── 7. mapSnapshots ──
  if (Array.isArray(data.mapSnapshots)) {
    for (const snap of data.mapSnapshots) {
      if (typeof snap.year !== 'number') error(filename, `mapSnapshots: year must be number`);
      if (typeof snap.label !== 'string') error(filename, `mapSnapshots: label must be string`);
      if (typeof snap.territories !== 'object') error(filename, `mapSnapshots[${snap.year}]: territories must be object`);
    }
    ok(`mapSnapshots: ${data.mapSnapshots.length} snapshots`);
  }

  // ── 8. wikiLinks ──
  if (data.wikiLinks && typeof data.wikiLinks === 'object') {
    const wChars = Object.keys(data.wikiLinks.characters || {}).length;
    const wEvents = Object.keys(data.wikiLinks.events || {}).length;
    ok(`wikiLinks: ${wChars} characters, ${wEvents} events`);
  }
}

// ── Main ──
console.log('═══════════════════════════════════════');
console.log(' Chronicle Atlas — Data Validation');
console.log('═══════════════════════════════════════');

// Validate index.json
const indexPath = path.join(DATA_DIR, 'index.json');
if (fs.existsSync(indexPath)) {
  console.log('\n📋 index.json');
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    if (Array.isArray(index.timelines)) {
      ok(`index.json: ${index.timelines.length} timelines registered`);
      for (const tl of index.timelines) {
        const fp = path.join(DATA_DIR, tl.dataFile);
        if (!fs.existsSync(fp)) {
          error('index.json', `dataFile "${tl.dataFile}" does not exist`);
        }
      }
    }
  } catch (e) {
    error('index.json', `Parse error: ${e.message}`);
  }
}

// Validate version.json
const versionPath = path.join(DATA_DIR, 'version.json');
if (fs.existsSync(versionPath)) {
  console.log('\n📋 version.json');
  try {
    const v = JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
    if (!/^\d+\.\d+\.\d+$/.test(v.version || '')) {
      error('version.json', `version "${v.version}" は "x.y.z" 形式（例: 1.2.0）で書くこと`);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(v.updatedAt || '')) {
      error('version.json', `updatedAt "${v.updatedAt}" は "YYYY-MM-DD" 形式で書くこと`);
    } else {
      ok(`version.json: v${v.version} (${v.updatedAt})`);
    }
  } catch (e) {
    error('version.json', `Parse error: ${e.message}`);
  }
}

// Validate all timeline files
const files = fs.readdirSync(TIMELINES_DIR).filter(f => f.endsWith('.json'));
for (const file of files) {
  validateTimeline(file);
}

// ── Cross-file ID uniqueness ──
console.log('\n📋 Cross-file ID uniqueness');
for (const [id, fs_] of eventIdRegistry) {
  if (fs_.length > 1) warn('cross-file', `event "${id}": ${fs_.join(' と ')} で重複`);
}
for (const [id, fs_] of charIdRegistry) {
  if (fs_.length > 1) warn('cross-file', `character "${id}": ${fs_.join(' と ')} で重複`);
}

// ── Summary ──
console.log('\n═══════════════════════════════════════');
if (totalErrors === 0) {
  console.log(`✅ ALL PASSED (${files.length} files, ${totalWarnings} warnings)`);
} else {
  console.log(`❌ FAILED: ${totalErrors} errors, ${totalWarnings} warnings`);
  process.exit(1);
}
