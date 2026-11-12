import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const episode = { id: 1, title: 'Zeitreisen', pub_date: '2026-01-01', format_name: 'Hauptfolge', description: 'Eine Reise durch die Zeit.', guests: [], topics: ['Zeitreisen'] };
const second = { ...episode, id: 2, title: 'Zurück in die Zukunft' };
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('UI did not settle'); await new Promise((resolve) => setTimeout(resolve, 10)); }
}
test('episode UI: canonical filter, search, related navigation and share URL work together', async () => {
  const dom = new JSDOM(fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://localhost:3108', runScripts: 'outside-only' });
  const { window } = dom;
  const calls = [];
  window.fetch = async (url) => {
    calls.push(url);
    let data;
    if (url === '/api/status') data = { episodes: 2, last_sync: '2026-01-01' };
    else if (url === '/api/formats') data = [{ name: 'Hauptfolge', count: 2 }];
    else if (url === '/api/guests') data = [];
    else if (url === '/api/topics') data = [{ id: 'community-feedback', name: 'Community-Feedback', count: 2 }];
    else if (url.includes('/suggestions')) data = { suggestions: [], flow: {} };
    else if (url.endsWith('/related')) data = { episodes: [second] };
    else if (url === '/api/episodes/1') data = episode;
    else if (url === '/api/episodes/2') data = second;
    else data = { episodes: [episode], total: 1 };
    return { ok: true, json: async () => data };
  };
  window.eval(fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await until(() => window.document.querySelector('.episode-card'));
  window.document.querySelector('#filterToggle').click();
  window.document.querySelector('#topicTags button').click();
  await until(() => calls.some((url) => url.includes('topic=Community-Feedback')));
  assert.ok(window.location.search.includes('topic=community-feedback'));
  const input = window.document.querySelector('#searchInput');
  input.value = 'Zeitsprünge'; input.dispatchEvent(new window.Event('input'));
  await until(() => calls.some((url) => url.includes('sort=relevance')));
  await until(() => window.document.querySelector('.episode-card'));
  window.document.querySelector('.episode-card').click();
  await until(() => window.document.querySelector('[data-related-episode]'));
  window.document.querySelector('[data-related-episode]').click();
  await until(() => window.document.querySelector('.modal-title')?.textContent === second.title);
  assert.ok(window.location.search.includes('title=zuruck-in-die-zukunft'));
  window.document.querySelector('.modal-close').click();
  assert.ok(!window.document.querySelector('#modalBackdrop').classList.contains('open'));
  dom.window.close();
});

test('admin UI: review, rationale, history and undo keep the token out of storage', async () => {
  const dom = new JSDOM(fs.readFileSync(new URL('../public/admin/clusters.html', import.meta.url), 'utf8'), { url: 'http://localhost:3108/admin/clusters.html', runScripts: 'outside-only' });
  const { window } = dom; const calls = [];
  const candidate = { id: 'c1', type: 'topic', source: { name: 'Worldbuilding', count: 1, examples: [] }, target: { name: 'World Building', count: 4, examples: [] }, similarity: .99 };
  let decision = null;
  window.fetch = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    let data;
    if (url === '/api/search/reindex') data = { ok: true };
    else if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      decision = { ...candidate, ...body, reviewed_at: 'now' };
      data = { ok: true };
    } else if (url.endsWith('/history')) data = { decisions: decision ? [decision] : [] };
    else data = { total: decision ? 0 : 1, candidates: decision ? [] : [candidate] };
    return { ok: true, json: async () => data };
  };
  window.eval(fs.readFileSync(new URL('../public/js/clusters.js', import.meta.url), 'utf8'));
  window.document.querySelector('#token').value = 'fixture-token';
  window.document.querySelector('#login').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await until(() => window.document.querySelector('[data-action="merge"]'));
  window.document.querySelector('#reindex').click();
  await until(() => calls.some((call) => call.url === '/api/search/reindex') && !window.document.querySelector('#reindex').disabled);
  window.document.querySelector('textarea').value = 'Schreibvarianten geprüft.';
  window.document.querySelector('[data-action="merge"]').click();
  await until(() => decision);
  assert.equal(decision.action, 'merge'); assert.equal(decision.note, 'Schreibvarianten geprüft.');
  assert.equal(window.localStorage.length, 0); assert.equal(window.document.querySelector('#token').value, '');
  window.document.querySelector('#history').click();
  await until(() => window.document.querySelector('[data-action="undo"]'));
  window.document.querySelector('[data-action="undo"]').click();
  await until(() => calls.some((call) => call.body && JSON.parse(call.body).action === 'undo'));
  dom.window.close();
});
