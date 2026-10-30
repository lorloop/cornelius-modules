import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestModule } from '#cornelius/testing';
import addon from './index.js';
import search from './fixtures/search.json' with { type: 'json' };
import empty from './fixtures/empty.json' with { type: 'json' };
import legacyAnswer from './fixtures/legacy-answer.json' with { type: 'json' };

const setup = (t: { after(fn: () => void): void }, config: Record<string, unknown> = {}) =>
  createTestModule(t, addon, {
    at: '2026-10-30T10:00:00Z',
    config,
    routes: { '/search?': search },
  });

const params = (url: string | undefined) => new URL(url ?? 'http://invalide').searchParams;

test('définition, réglages et vérification de l’instance (Tester)', async (t) => {
  const f = setup(t);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  for (const baseUrl of ['ftp://h', 'http://moi:secret@h', 'http://h/?q=1'])
    assert.equal(
      f.runtime.validateConfig(addon.id, { ...addon.configDefaults, baseUrl }).ok,
      false,
      baseUrl,
    );
  assert.equal(
    f.runtime.validateConfig(addon.id, { ...addon.configDefaults, safesearch: 3 }).ok,
    false,
  );
  const result = await f.read();
  assert.deepEqual(f.contract(result), []);
  assert.equal(result.ok && result.card.primaryValue, '5 résultats');
  assert.equal(result.ok && result.card.subtitle, '3 moteurs ont répondu');
  assert.equal(params(f.calls[0]?.url).get('format'), 'json');
});

test('une question part à SearXNG et revient en carte, sans doublon ni adresse douteuse', async (t) => {
  const f = setup(t, { baseUrl: 'https://searx.maison.lan/searxng/', safesearch: 0 });
  const invoked = await f.invoke('ask', { query: '  date de sortie Dune deuxième partie  ' });
  const { outcome, tool } = invoked;
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(f.contract(outcome), []);
  const url = f.calls[0]?.url ?? '';
  assert.ok(url.startsWith('https://searx.maison.lan/searxng/search?'), url);
  const sent = params(url);
  assert.equal(sent.get('q'), 'date de sortie Dune deuxième partie');
  assert.equal(sent.get('language'), 'fr');
  assert.equal(sent.get('safesearch'), '0');
  assert.equal(sent.get('categories'), 'general');
  assert.equal(sent.get('time_range'), null);

  assert.equal(
    outcome.card.description,
    'Dune, deuxième partie est sorti en France le 28 février 2024.',
  );
  assert.deepEqual(
    outcome.card.items.map((item) => item.value),
    ['fr.wikipedia.org', 'allocine.fr · 28/02/2024', 'premiere.fr · 14/12/2023'],
  );
  const data = outcome.snapshot.data as { results: { snippet: string | null }[] };
  // Balises retirées et entités décodées : le modèle reçoit du texte.
  assert.match(data.results[0]?.snippet ?? '', /^Dune, deuxième partie \(Dune: Part Two\)/u);
  assert.match(data.results[2]?.snippet ?? '', /"28 février 2024"/u);
  assert.match(tool.summary, /^Réponse directe : Dune/u);
  assert.equal(tool.status, 'succeeded');
});

test('période et catégorie demandées à la voix', async (t) => {
  const f = setup(t);
  await f.invoke('ask', { query: 'grève SNCF', periode: 'semaine', categorie: 'actualites' });
  const sent = params(f.calls[0]?.url);
  assert.equal(sent.get('time_range'), 'week');
  assert.equal(sent.get('categories'), 'news');
});

test('le nombre de résultats suit le réglage', async (t) => {
  const f = setup(t, { results: 1 });
  const { outcome } = await f.invoke('ask', { query: 'Dune' });
  assert.equal(outcome.ok && outcome.card.items.length, 1);
});

test('aucun résultat se dit tel quel, sans rien inventer', async (t) => {
  const f = setup(t);
  f.route({ '/search?': empty });
  const { outcome, tool } = await f.invoke('ask', { query: 'zzqxv blorptangue' });
  assert.equal(outcome.ok, true);
  assert.equal(tool.status, 'empty');
  assert.equal(tool.summary, 'Aucun résultat pour « zzqxv blorptangue ».');
});

test('une réponse directe à l’ancien format (chaîne) est comprise', async (t) => {
  const f = setup(t);
  f.route({ '/search?': legacyAnswer });
  const { outcome } = await f.invoke('ask', { query: '12 * 7' });
  assert.equal(outcome.ok && outcome.card.description, '84');
});

test('chaque panne de SearXNG a son message, sans réponse resservie', async (t) => {
  const cases: [unknown, string, RegExp][] = [
    [{ status: 403 }, 'forbidden', /search\.formats/u],
    [{ status: 429 }, 'quota', /limiteur/u],
    [{ status: 502 }, 'unavailable', /erreur/u],
    [{ status: 200, body: '<!doctype html><title>Connexion</title>' }, 'malformed', /JSON/u],
    [{ status: 200, body: { results: 'non' } }, 'malformed', /incomplète/u],
  ];
  for (const [reply, code, message] of cases) {
    const f = setup(t);
    await f.invoke('ask', { query: 'Dune' });
    f.route({ '/search?': reply as never });
    const { outcome } = await f.invoke('ask', { query: 'Dune' });
    assert.equal(outcome.ok, false, code);
    if (outcome.ok) continue;
    assert.equal(outcome.error.code, code);
    assert.match(outcome.error.message, message);
  }
});

test('une question vide ou trop longue est refusée sans requête', async (t) => {
  const f = setup(t);
  for (const query of ['   ', 'x'.repeat(401)]) {
    const { outcome } = await f.invoke('ask', { query });
    assert.equal(outcome.ok, false);
  }
  assert.equal(f.calls.length, 0);
});
