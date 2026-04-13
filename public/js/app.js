// ── State ─────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 24;
let currentPage  = 0;
let currentQuery = '';
let currentGuest = '';
let currentTopic = '';
let currentFormat = '';
let searchTimer  = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  loadEpisodes();
  loadFilters();

  const input = document.getElementById('searchInput');
  const modal = document.getElementById('modal');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    document.getElementById('clearBtn').classList.toggle('visible', q.length > 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentQuery = q;
      currentPage  = 0;
      loadEpisodes();
    }, 320);
  });

  document.getElementById('clearBtn').addEventListener('click', clearSearch);
  document.getElementById('filterToggle').addEventListener('click', toggleFilterPanel);
  document.getElementById('filterChip').addEventListener('click', clearFilters);
  document.getElementById('filterBar').addEventListener('click', handleSetFilterClick);
  document.getElementById('episodeGrid').addEventListener('click', handleEpisodeCardClick);
  document.getElementById('pagination').addEventListener('click', handlePaginationClick);
  document.getElementById('modalBackdrop').addEventListener('click', closeModal);
  document.getElementById('modalBody').addEventListener('click', handleSetFilterClick);
  document.getElementById('modalBody').addEventListener('submit', handleSuggestionSubmit);
  document.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => event.stopPropagation());
});

function handleSetFilterClick(event) {
  const button = event.target.closest('button[data-action="set-filter"]');
  if (!button) return;
  const type = button.dataset.type;
  if (type !== 'guest' && type !== 'topic' && type !== 'format') return;
  event.preventDefault();
  if (button.dataset.closeModal === '1') closeModal();
  setFilter(type, button.dataset.value || '');
}

function handleEpisodeCardClick(event) {
  const card = event.target.closest('.episode-card[data-episode-id]');
  if (!card) return;
  const id = Number.parseInt(card.dataset.episodeId, 10);
  if (Number.isInteger(id) && id > 0) openModal(id);
}

function handlePaginationClick(event) {
  const button = event.target.closest('.page-btn[data-page]');
  if (!button || button.disabled) return;
  const page = Number.parseInt(button.dataset.page, 10);
  if (Number.isInteger(page) && page >= 0) goPage(page);
}

// ── API ───────────────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const init = { ...options };
  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
    init.headers = {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    };
    init.body = JSON.stringify(init.body);
  }
  const res = await fetch(path, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// ── Status ────────────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const s = await api('/api/status');
    const dot  = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    dot.className = 'status-dot ok';
    const d   = s.last_sync ? new Date(s.last_sync) : null;
    const fmt = d ? d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    text.textContent = `${s.episodes} EPS · ${fmt}`;
  } catch {
    document.querySelector('.status-dot').className = 'status-dot error';
    document.querySelector('.status-text').textContent = 'Fehler';
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────
let filterPanelOpen = false;

async function loadFilters() {
  try {
    const [formats, guests, topics] = await Promise.all([
      api('/api/formats'),
      api('/api/guests'),
      api('/api/topics'),
    ]);
    if (!formats.length && !guests.length && !topics.length) return;
    document.getElementById('filterToggle').style.display = '';
    renderFilterTags('formatTags', formats, 'format');
    renderFilterTags('guestTags', guests.slice(0, 30), 'guest');
    renderFilterTags('topicTags', topics.slice(0, 40), 'topic');
    updateFilterUI();
  } catch {}
}

function toggleFilterPanel() {
  filterPanelOpen = !filterPanelOpen;
  const panel  = document.getElementById('filterBar');
  const toggle = document.getElementById('filterToggle');
  panel.style.display  = filterPanelOpen ? '' : 'none';
  toggle.classList.toggle('open', filterPanelOpen);
}

function renderFilterTags(containerId, items, type) {
  const el = document.getElementById(containerId);
  el.innerHTML = items.map(item =>
    `<button class="filter-tag" data-action="set-filter" data-type="${escAttr(type)}" data-value="${escAttr(item.name)}">
      ${escHtml(item.name)} <span class="filter-count">${Number(item.count) || 0}</span></button>`
  ).join('');
}

function setFilter(type, value) {
  if (type !== 'guest' && type !== 'topic' && type !== 'format') return;
  if (type === 'guest') {
    currentGuest = currentGuest === value ? '' : value;
    currentTopic = '';
    currentFormat = '';
  } else if (type === 'topic') {
    currentTopic = currentTopic === value ? '' : value;
    currentGuest = '';
    currentFormat = '';
  } else {
    currentFormat = currentFormat === value ? '' : value;
    currentGuest = '';
    currentTopic = '';
  }
  currentPage = 0;
  // Close panel after selection
  filterPanelOpen = false;
  document.getElementById('filterBar').style.display = 'none';
  document.getElementById('filterToggle').classList.remove('open');
  updateFilterUI();
  loadEpisodes();
}

function updateFilterUI() {
  // Highlight active tags in panel
  document.querySelectorAll('.filter-tag').forEach(btn => {
    const active = (btn.dataset.type === 'guest' && btn.dataset.value === currentGuest)
                || (btn.dataset.type === 'topic' && btn.dataset.value === currentTopic)
                || (btn.dataset.type === 'format' && btn.dataset.value === currentFormat);
    btn.classList.toggle('active', active);
  });
  // Show/hide active filter chip in toolbar
  const active = currentGuest || currentTopic || currentFormat;
  const chip   = document.getElementById('filterChip');
  const toggle = document.getElementById('filterToggle');
  chip.style.display   = active ? '' : 'none';
  toggle.style.display = active ? 'none' : '';
  if (active) chip.textContent = '✕ ' + active;
}

function clearFilters() {
  currentGuest = '';
  currentTopic = '';
  currentFormat = '';
  currentPage  = 0;
  updateFilterUI();
  loadEpisodes();
}

// ── Load Episodes ─────────────────────────────────────────────────────────────
async function loadEpisodes() {
  const grid = document.getElementById('episodeGrid');
  grid.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>LADE EPISODEN…</p></div>`;

  const params = new URLSearchParams({
    limit:  PAGE_SIZE,
    offset: currentPage * PAGE_SIZE,
    ...(currentQuery ? { q: currentQuery } : {}),
    ...(currentGuest ? { guest: currentGuest } : {}),
    ...(currentTopic ? { topic: currentTopic } : {}),
    ...(currentFormat ? { format: currentFormat } : {}),
  });

  try {
    const data = await api(`/api/episodes?${params}`);
    renderEpisodes(data.episodes, data.total);
    renderPagination(data.total);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><p>⚠ Fehler beim Laden: ${err.message}</p></div>`;
  }
}

// ── Render Cards ──────────────────────────────────────────────────────────────
function renderEpisodes(episodes, total) {
  const grid  = document.getElementById('episodeGrid');
  const label = document.getElementById('countLabel');
  label.textContent = `${total} Episode${total !== 1 ? 'n' : ''}`;

  if (!episodes.length) {
    grid.innerHTML = `<div class="empty-state"><p>KEINE EPISODEN GEFUNDEN</p></div>`;
    return;
  }

  grid.innerHTML = episodes.map(ep => {
    const guests = getArrayField(ep.guests, ep.guests_json).slice(0, 2);
    const episodeId = Number.parseInt(ep.id, 10) || 0;
    return `
    <div class="episode-card" data-episode-id="${episodeId}">
      <div class="card-meta">
        <span class="card-date">${formatDate(ep.pub_date)}</span>
        ${ep.duration ? `<span class="card-dot">·</span><span class="card-duration">${formatDuration(ep.duration)}</span>` : ''}
      </div>
      ${ep.format_name ? `<div class="card-format">${escHtml(ep.format_name)}</div>` : ''}
      <div class="card-title">${escHtml(ep.title)}</div>
      ${ep.film_title ? `<div class="card-film">↳ ${escHtml(ep.film_title)}</div>` : ''}
      ${guests.length ? `<div class="card-guests">${guests.map(g => `<span class="card-guest-tag">${escHtml(g)}</span>`).join('')}</div>` : ''}
      <div class="card-desc">${escHtml(ep.description || ep.summary || '')}</div>
    </div>`;
  }).join('');
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const pg    = document.getElementById('pagination');
  if (pages <= 1) { pg.innerHTML = ''; return; }

  const makeBtn = (label, page, disabled = false, active = false) =>
    `<button class="page-btn${active ? ' active' : ''}" ${disabled ? 'disabled' : ''} data-page="${page}">${label}</button>`;

  let html = makeBtn('← ZURÜCK', currentPage - 1, currentPage === 0);
  const start = Math.max(0, currentPage - 3);
  const end   = Math.min(pages, start + 7);
  if (start > 0) html += `<span class="page-info">…</span>`;
  for (let i = start; i < end; i++)
    html += makeBtn(i + 1, i, false, i === currentPage);
  if (end < pages) html += `<span class="page-info">…</span>`;
  html += makeBtn('WEITER →', currentPage + 1, currentPage >= pages - 1);
  pg.innerHTML = html;
}

function goPage(page) {
  currentPage = Math.max(0, page);
  loadEpisodes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function renderModalDescription(text) {
  const desc = String(text || '').trim();
  if (!desc) return '';

  const separator = /(?:^|\r?\n)[ \t]*(?:---|-\s*-\s*-)[ \t]*(?:\r?\n|$)/m;
  const match = desc.match(separator);

  if (!match || typeof match.index !== 'number') {
    const preview = desc.length > 2000 ? `${desc.slice(0, 2000).trim()}\n\n[…]` : desc;
    return `<div class="modal-desc">${escHtml(preview)}</div>`;
  }

  const intro = desc.slice(0, match.index).trim();
  const rest = desc.slice(match.index + match[0].length).trim();

  if (!rest) return intro ? `<div class="modal-desc">${escHtml(intro)}</div>` : '';

  return `
    <div class="modal-desc">
      ${intro ? `<div class="modal-desc-preview">${escHtml(intro)}</div>` : ''}
      <details class="modal-desc-details">
        <summary class="modal-desc-toggle">
          <span class="modal-desc-more">Mehr anzeigen</span>
          <span class="modal-desc-less">Weniger anzeigen</span>
        </summary>
        <div class="modal-desc-rest">${escHtml(rest)}</div>
      </details>
    </div>
  `;
}

function renderSuggestionForm(episodeId) {
  return `
    <div class="suggestion-box">
      <div class="parsed-label">COMMUNITY-VORSCHLAG</div>
      <p class="suggestion-copy">Gäste, Themen oder Filme vorschlagen. Neue Einträge werden gesammelt und erst nach Prüfung übernommen.</p>
      <form class="suggestion-form" data-episode-id="${episodeId}">
        <div class="suggestion-row">
          <select class="suggestion-select" name="type" aria-label="Vorschlagstyp">
            <option value="guest">Gast</option>
            <option value="topic">Thema</option>
            <option value="film">Film</option>
          </select>
          <input class="suggestion-input" type="text" name="value" maxlength="120" placeholder="Vorschlag eingeben" required>
        </div>
        <textarea class="suggestion-note" name="note" rows="3" maxlength="500" placeholder="Optional: kurzer Hinweis oder Begründung"></textarea>
        <div class="suggestion-actions">
          <button class="btn-suggest" type="submit">Vorschlag senden</button>
          <div class="suggestion-status" aria-live="polite"></div>
        </div>
      </form>
    </div>
  `;
}

async function handleSuggestionSubmit(event) {
  const form = event.target.closest('.suggestion-form');
  if (!form) return;
  event.preventDefault();

  const episodeId = Number.parseInt(form.dataset.episodeId, 10);
  if (!Number.isInteger(episodeId) || episodeId <= 0) return;

  const submitButton = form.querySelector('.btn-suggest');
  const status = form.querySelector('.suggestion-status');
  const formData = new FormData(form);
  const type = String(formData.get('type') || '').trim();
  const value = String(formData.get('value') || '').trim();
  const note = String(formData.get('note') || '').trim();

  submitButton.disabled = true;
  status.textContent = 'Sende…';
  status.className = 'suggestion-status';

  try {
    await api(`/api/episodes/${episodeId}/suggestions`, {
      method: 'POST',
      body: { type, value, note },
    });
    form.reset();
    status.textContent = 'Gespeichert. Der Vorschlag wartet jetzt auf Prüfung.';
    status.classList.add('success');
  } catch (err) {
    status.textContent = err.message;
    status.classList.add('error');
  } finally {
    submitButton.disabled = false;
  }
}

async function openModal(id) {
  const backdrop = document.getElementById('modalBackdrop');
  const body     = document.getElementById('modalBody');
  backdrop.classList.add('open');
  body.innerHTML = `<div class="loading-state" style="padding:40px"><div class="spinner"></div></div>`;
  document.body.style.overflow = 'hidden';

  try {
    const ep   = await api(`/api/episodes/${id}`);
    const desc = ep.description || ep.summary || '';
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent((ep.title || '') + ' Kack Sachgeschichten')}/episodes`;

    body.innerHTML = `
      <h2 class="modal-title">${escHtml(ep.title)}</h2>
      ${ep.format_name ? `<div class="modal-format">${escHtml(ep.format_name)}</div>` : ''}
      ${ep.film_title ? `<div class="modal-film">↳ ${escHtml(ep.film_title)}</div>` : ''}
      <div class="modal-meta">
        <span>📅 ${formatDate(ep.pub_date, true)}</span>
        ${ep.duration ? `<span>⏱ ${formatDuration(ep.duration)}</span>` : ''}
      </div>
      ${renderModalDescription(desc)}
      ${renderParsedData(ep)}
      ${renderSuggestionForm(ep.id)}
      <div class="modal-actions">
        <a class="btn-spotify" href="${escAttr(spotifyUrl)}" target="_blank" rel="noopener">▶ AUF SPOTIFY ÖFFNEN</a>
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--accent);padding:20px">Fehler: ${err.message}</p>`;
  }
}

function renderParsedData(ep) {
  const guests   = getArrayField(ep.guests, ep.guests_json);
  const chapters = getArrayField(ep.chapters, ep.chapters_json);
  const topics   = getArrayField(ep.topics, ep.topics_json);
  if (!guests.length && !chapters.length && !topics.length) return '';

  let html = '<div class="parsed-data">';

  if (guests.length) {
    html += `<div class="parsed-section">
      <div class="parsed-label">GÄSTE</div>
      <div class="parsed-tags">${guests.map(g =>
        `<button class="tag tag-guest" data-action="set-filter" data-close-modal="1" data-type="guest" data-value="${escAttr(g)}">${escHtml(g)}</button>`
      ).join('')}</div>
    </div>`;
  }

  if (topics.length) {
    html += `<div class="parsed-section">
      <div class="parsed-label">THEMEN</div>
      <div class="parsed-tags">${topics.map(t =>
        `<button class="tag tag-topic" data-action="set-filter" data-close-modal="1" data-type="topic" data-value="${escAttr(t)}">${escHtml(t)}</button>`
      ).join('')}</div>
    </div>`;
  }

  if (chapters.length) {
    html += `<div class="parsed-section">
      <div class="parsed-label">KAPITEL</div>
      <ol class="chapter-list">${chapters.map(c =>
        `<li><span class="chapter-time">${escHtml(c.time || '')}</span><span class="chapter-title">${escHtml(c.title || '')}</span></li>`
      ).join('')}</ol>
    </div>`;
  }

  return html + '</div>';
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (filterPanelOpen) {
    filterPanelOpen = false;
    document.getElementById('filterBar').style.display = 'none';
    document.getElementById('filterToggle').classList.remove('open');
  }
  closeModal();
});

// ── Search helpers ────────────────────────────────────────────────────────────
function clearSearch() {
  const input = document.getElementById('searchInput');
  input.value = '';
  document.getElementById('clearBtn').classList.remove('visible');
  currentQuery = '';
  currentPage  = 0;
  loadEpisodes();
  input.focus();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function tryJson(str) {
  if (!str) return [];
  try { const v = JSON.parse(str); return Array.isArray(v) ? v : []; } catch { return []; }
}

function getArrayField(value, fallbackJson = null) {
  if (Array.isArray(value)) return value;
  return tryJson(fallbackJson);
}

function formatDate(str, long = false) {
  if (!str) return '—';
  try {
    const d = new Date(str);
    if (isNaN(d)) return str;
    return long
      ? d.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
      : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch { return str; }
}

function formatDuration(str) {
  if (!str) return '';
  if (/^\d+$/.test(str)) {
    const s = parseInt(str);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] ? `${parts[0]}h ${parts[1]}m` : `${parts[1]}m`;
  if (parts.length === 2) return `${parts[0]}m`;
  return str;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
