let token = '';
let viewRequest = 0;
const el = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
async function request(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function load() {
  const view = ++viewRequest;
  el('status').textContent = 'Lade Vorschläge…';
  try {
    const data = await request(`/api/clusters?type=${el('type').value}`);
    if (view !== viewRequest) return;
    el('status').textContent = data.total ? `${data.total} Vorschläge. Es wird nichts automatisch zusammengeführt.` : 'Keine aktuellen Vorschläge. Nach neuen Daten oder Zusammenführungen den Index neu erstellen.';
    el('candidates').innerHTML = data.candidates.map((item) => `<article data-id="${esc(item.id)}"><h2>${esc(item.source.name)} → ${esc(item.target.name)}</h2>
      <p>Modellähnlichkeit: ${Math.round(item.similarity * 100)} % · kein Vertrauenswert</p><div class="pair">${[item.source, item.target].map((entity) => `<div><strong>${esc(entity.name)}</strong> · ${entity.count} Folgen<ul>${entity.examples.map((ep) => `<li>${esc(ep.title)}</li>`).join('')}</ul></div>`).join('')}</div>
      <textarea aria-label="Begründung" placeholder="Begründung (für Zusammenführungen erforderlich)"></textarea><div class="actions">${item.type !== 'work' && item.merge_allowed !== false ? '<button data-action="merge">Zusammenführen</button>' : ''}<button data-action="related">Nur verwandt</button><button data-action="reject">Getrennt lassen</button></div></article>`).join('');
  } catch (error) { if (view !== viewRequest) return; el('status').textContent = error.message; el('candidates').replaceChildren(); }
}
el('login').addEventListener('submit', (event) => { event.preventDefault(); token = el('token').value; el('token').value = ''; load(); });
el('type').addEventListener('change', () => { if (token) load(); });
el('reindex').addEventListener('click', async () => {
  const button = el('reindex'); button.disabled = true;
  el('status').textContent = 'Index wird aktualisiert. Das kann einige Minuten dauern.';
  try { await request('/api/search/reindex', {}); await load(); }
  catch (error) { el('status').textContent = error.message; }
  finally { button.disabled = false; }
});
el('candidates').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const article = button.closest('article');
  const view = viewRequest;
  article.querySelectorAll('button').forEach((item) => { item.disabled = true; });
  try {
    await request(`/api/clusters/${encodeURIComponent(article.dataset.id)}/review`, { action: button.dataset.action, note: article.querySelector('textarea')?.value || '' });
    if (view !== viewRequest) return;
    if (button.dataset.action === 'undo') el('history').click(); else await load();
  } catch (error) { el('status').textContent = error.message; article.querySelectorAll('button').forEach((item) => { item.disabled = false; }); }
});
el('history').addEventListener('click', async () => {
  const view = ++viewRequest;
  try {
    const data = await request('/api/clusters/history');
    if (view !== viewRequest) return;
    el('status').textContent = `${data.decisions.length} Entscheidungen. Zusammenführungen lassen sich rückgängig machen.`;
    el('candidates').innerHTML = [...data.decisions].reverse().map((item) => `<article data-id="${esc(item.id)}"><h2>${esc(item.source.name)} → ${esc(item.target.name)}</h2><p>${esc(item.action)} · ${esc(item.note)} · ${esc(item.reviewed_at)}</p>${item.undone_at ? '<p>Rückgängig gemacht</p>' : '<button data-action="undo">Rückgängig machen</button>'}</article>`).join('');
  } catch (error) { el('status').textContent = error.message; }
});
