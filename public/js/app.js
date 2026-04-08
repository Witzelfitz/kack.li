// ── State ─────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 24;
let currentPage  = 0;
let currentQuery = '';
let currentGuest = '';
let currentTopic = '';
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
  document.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => event.stopPropagation());
});

function handleSetFilterClick(event) {
  const button = event.target.closest('button[data-action="set-filter"]');
  if (!button) return;
  const type = button.dataset.type;
  if (type !== 'guest' && type !== 'topic') return;
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
async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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
    const [guests, topics] = await Promise.all([api('/api/guests'), api('/api/topics')]);
    if (!guests.length && !topics.length) return;
    document.getElementById('filterToggle').style.display = '';
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
  if (type !== 'guest' && type !== 'topic') return;
  if (type === 'guest') {
    currentGuest = currentGuest === value ? '' : value;
    currentTopic = '';
  } else {
    currentTopic = currentTopic === value ? '' : value;
    currentGuest = '';
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
                || (btn.dataset.type === 'topic' && btn.dataset.value === currentTopic);
    btn.classList.toggle('active', active);
  });
  // Show/hide active filter chip in toolbar
  const active = currentGuest || currentTopic;
  const chip   = document.getElementById('filterChip');
  const toggle = document.getElementById('filterToggle');
  chip.style.display   = active ? '' : 'none';
  toggle.style.display = active ? 'none' : '';
  if (active) chip.textContent = '✕ ' + (currentGuest || currentTopic);
}

function clearFilters() {
  currentGuest = '';
  currentTopic = '';
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
    const guests = tryJson(ep.guests_json).slice(0, 2);
    const episodeId = Number.parseInt(ep.id, 10) || 0;
    return `
    <div class="episode-card" data-episode-id="${episodeId}">
      <div class="card-meta">
        ${ep.episode_num ? `<span class="card-num">#${String(ep.episode_num).padStart(3,'0')}</span>` : ''}
        <span class="card-date">${formatDate(ep.pub_date)}</span>
        ${ep.duration ? `<span class="card-dot">·</span><span class="card-duration">${formatDuration(ep.duration)}</span>` : ''}
      </div>
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
async function openModal(id) {
  const backdrop = document.getElementById('modalBackdrop');
  const body     = document.getElementById('modalBody');
  backdrop.classList.add('open');
  body.innerHTML = `<div class="loading-state" style="padding:40px"><div class="spinner"></div></div>`;
  document.body.style.overflow = 'hidden';

  try {
    const ep   = await api(`/api/episodes/${id}`);
    const desc = (ep.description || ep.summary || '').slice(0, 2000);
    const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent((ep.title || '') + ' Kack Sachgeschichten')}/episodes`;
    const websiteUrl = sanitizeHttpUrl(ep.link);

    body.innerHTML = `
      ${ep.episode_num ? `<div class="modal-num">Episode #${String(ep.episode_num).padStart(3,'0')}</div>` : ''}
      <h2 class="modal-title">${escHtml(ep.title)}</h2>
      ${ep.film_title ? `<div class="modal-film">↳ ${escHtml(ep.film_title)}</div>` : ''}
      <div class="modal-meta">
        <span>📅 ${formatDate(ep.pub_date, true)}</span>
        ${ep.duration ? `<span>⏱ ${formatDuration(ep.duration)}</span>` : ''}
      </div>
      ${desc ? `<div class="modal-desc">${escHtml(desc)}${(ep.description || '').length > 2000 ? '\n\n[…]' : ''}</div>` : ''}
      ${renderParsedData(ep)}
      <div class="modal-actions">
        <a class="btn-spotify" href="${escAttr(spotifyUrl)}" target="_blank" rel="noopener">▶ AUF SPOTIFY ÖFFNEN</a>
        ${websiteUrl ? `<a class="btn-link" href="${escAttr(websiteUrl)}" target="_blank" rel="noopener">↗ WEBSEITE</a>` : ''}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--accent);padding:20px">Fehler: ${err.message}</p>`;
  }
}

function renderParsedData(ep) {
  const guests   = tryJson(ep.guests_json);
  const chapters = tryJson(ep.chapters_json);
  const topics   = tryJson(ep.topics_json);
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

function sanitizeHttpUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}
