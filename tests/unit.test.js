import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));

function setLocale(languages, timeZone) {
  Object.defineProperty(globalThis, 'navigator', { value: { languages, language: languages[0] }, configurable: true });
  const original = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (...args) {
    const format = new original(...args);
    return { resolvedOptions: () => ({ ...format.resolvedOptions(), timeZone }) };
  };
  return () => { Intl.DateTimeFormat = original; };
}

const { countries, countryByCode, detectCountry } = await import('../data.js');

test('country list has unique codes and ISO ids', () => {
  assert.equal(new Set(countries.map(c => c.code)).size, countries.length);
  assert.equal(new Set(countries.map(c => c.id)).size, countries.length);
});

test('device region in the locale tag wins', () => {
  const restore = setLocale(['ko-KR', 'en-US'], 'America/New_York');
  try { assert.deepEqual([detectCountry().country.code, detectCountry().via], ['kr', 'locale']); } finally { restore(); }
});

test('a locale without region falls back to the time zone', () => {
  const restore = setLocale(['ja'], 'Asia/Tokyo');
  try { assert.deepEqual([detectCountry().country.code, detectCountry().via], ['jp', 'timezone']); } finally { restore(); }
});

test('an unknown zone uses the language, then the US', () => {
  let restore = setLocale(['ko'], 'Etc/UTC');
  try { assert.deepEqual([detectCountry().country.code, detectCountry().via], ['kr', 'language']); } finally { restore(); }
  restore = setLocale(['xx'], 'Etc/UTC');
  try { assert.deepEqual([detectCountry().country.code, detectCountry().via], ['us', 'default']); } finally { restore(); }
});

const services = [
  { name: 'netflix', dir: 'ranks', method: 'netflix-top10' },
  { name: 'disney', dir: 'ranks/disney', method: 'tmdb-popularity' }
];

test('every country a service publishes exists in the country list', () => {
  for (const { dir } of services) {
    for (const code of Object.keys(read(`${dir}/index.json`).countries)) assert.ok(countryByCode(code), `missing ${code}`);
  }
});

function checkEntry(entry, kind, service, where) {
  assert.equal(entry.type, kind, where);
  assert.ok(entry.listing.title, `${where}: title`);
  if (service === 'netflix') assert.ok(Number.isInteger(entry.listing.weeksInTop10), `${where}: weeks`);
  assert.ok(Array.isArray(entry.availability.countries), `${where}: availability`);
  assert.ok(entry.availability.countries.every(c => /^[a-z]{2}$/.test(c)), `${where}: country codes`);
  if (entry.tmdb) {
    const { tmdb } = entry;
    assert.ok(Number.isInteger(tmdb.id) && tmdb.title && Array.isArray(tmdb.genreIds), `${where}: tmdb shape`);
    assert.ok(tmdb.rating === null || (tmdb.rating >= 0 && tmdb.rating <= 10), `${where}: rating`);
    assert.ok(tmdb.posterPath === null || /^\/[\w.-]+$/.test(tmdb.posterPath), `${where}: poster path`);
    assert.equal(typeof tmdb.overview, 'object');
    assert.ok(Object.values(tmdb.trailers ?? {}).every(id => /^[\w-]{11}$/.test(id)), `${where}: trailer ids`);
  }
}

for (const { name, dir, method } of services) {
  test(`every ${dir}/*.json follows the schema`, () => {
    const files = readdirSync(join(root, dir)).filter(f => f.endsWith('.json') && f !== 'index.json');
    assert.ok(files.length > 30);
    for (const file of files) {
      const doc = read(`${dir}/${file}`);
      const where = `${name}/${file}`;
      assert.equal(doc.schema, 1, where);
      assert.equal(doc.service, name, where);
      assert.equal(doc.basis.method, method, where);
      assert.equal(doc.scope, file === 'world.json' ? 'world' : 'country', where);
      assert.equal(doc.country, doc.scope === 'world' ? null : file.replace('.json', ''), where);
      assert.match(doc.week, /^\d{4}-\d{2}-\d{2}$/, where);
      assert.ok(!Number.isNaN(Date.parse(doc.updatedAt)), where);
      assert.ok(doc.sources[name] && doc.sources.tmdb, where);
      for (const kind of ['tv', 'film']) {
        const rows = doc.lists[kind];
        assert.ok(rows.length <= 10, where);
        assert.deepEqual(rows.map(r => r.rank), rows.map((_, i) => i + 1), `${where}: ranks`);
        rows.forEach(entry => checkEntry(entry, kind, name, `${where} ${kind} #${entry.rank}`));
        // A spot in a country's list is itself proof that the service carries the title there.
        if (doc.scope === 'country') rows.forEach(entry => assert.ok(entry.availability.countries.includes(doc.country), `${where}: ${entry.listing.title} should be available in its own ranking country`));
        if (method === 'tmdb-popularity') assert.ok(Number.isInteger(doc.basis.windowDays[kind]), `${where}: window`);
      }
    }
  });

  test(`the ${dir} index lists every country file as available`, () => {
    const index = read(`${dir}/index.json`);
    const files = new Set(readdirSync(join(root, dir)));
    assert.equal(index.service, name);
    for (const [code, status] of Object.entries(index.countries)) {
      assert.equal(files.has(`${code}.json`), status === 'available', `${name} ${code}`);
    }
  });
}
