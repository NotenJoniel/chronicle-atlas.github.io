/**
 * Chronicle Atlas — 共通タイムラインエンジン
 * 全サブプロジェクト共通。タイムラインごとの差異はすべて data/timelines/<id>.json の
 * meta/factions[].color 等から読み取る。このファイルにタイムラインIDでの分岐を書かないこと。
 */
document.addEventListener('DOMContentLoaded', () => {
  const timelineId = document.body.dataset.timeline;
  if (!timelineId) { console.error('body[data-timeline] がありません'); return; }

  fetch(`../data/timelines/${timelineId}.json?t=${Date.now()}`)
    .then(r => r.json())
    .then(raw => bootstrap(timelineId, raw))
    .catch(err => {
      console.error('データの読み込みに失敗しました:', err);
      const el = document.getElementById('timeline');
      if (el) el.innerHTML = '<div class="no-results">データの読み込みに失敗しました。ページを再読み込みしてください。</div>';
    });

  function bootstrap(timelineId, raw) {
  const DEFAULT_MAP_COLUMN_RULES = [{ maxCount: 4, cols: 2 }, { maxCount: 9, cols: 3 }, { cols: 4 }];
  // characters[].field の表示名。全時代共通の固定8分類のため、データ層ではなくここで定義する
  // （判断基準: .agents/FIELD_TAXONOMY.md）。otherは「公的機能を持たない人物」の受け皿であり
  // 表示上は分野行を出さない（ラベルなし=undefined）。
  const FIELD_LABELS = {
    governance: '統治', military: '軍事', administration: '行政・法',
    thought: '思想・信仰', scholarship: '学術・技術', arts: '芸術', commerce: '経済・交易'
  };

  const D = {
    TIMELINE_ID: timelineId,
    META: raw.meta || {},
    ERA_PHASES: raw.eraPhases,
    FACTIONS: raw.factions,
    CATEGORIES: raw.categories,
    CHARACTERS: raw.characters,
    EVENTS: raw.events,
    MAP_SNAPSHOTS: raw.mapSnapshots,
    TERRITORY_SNAPSHOTS: raw.mapSnapshots,
    WIKI_LINKS: raw.wikiLinks
  };
  window.appData = D;

  // meta既定値
  const META = D.META;
  const mapTitleLabel = META.mapTitleLabel || '勢力図';
  const characterTitleLabel = META.characterTitleLabel || '別名';
  const descLabel = META.descLabel || '概要';
  const charDescLabel = META.charDescLabel || '人物紹介';
  const relatedCharsLabel = META.relatedCharsLabel || '関連人物';
  const relatedEventsLabel = META.relatedEventsLabel || '関連する出来事';
  const triviaLabel = META.triviaLabel || '📖 エピソード';
  const historyDiffLabel = META.historyDiffLabel || '📜 差分・豆知識';
  const historyOnlyBadgeLabel = META.historyOnlyBadgeLabel || '正史';
  const mapColumnRules = Array.isArray(META.mapColumnRules) && META.mapColumnRules.length
    ? META.mapColumnRules : DEFAULT_MAP_COLUMN_RULES;

  if (META.layoutStyle && document.body.dataset.layout && META.layoutStyle !== document.body.dataset.layout) {
    console.warn(`meta.layoutStyle ("${META.layoutStyle}") と body[data-layout] ("${document.body.dataset.layout}") が一致していません`);
  }

  const state = { era: null, faction: 'all', category: 'all', query: '', mapVisible: false, sidebarVisible: true, activeEventYear: null, prevMapKey: null, selectedChars: new Set() };

  const $ = id => document.getElementById(id);
  const eraNav = $('era-nav');
  const timeline = $('timeline');
  const sidebar = $('sidebar');
  const mapGrid = $('map-grid');
  const mapLegend = $('map-legend');
  const mapYearBadge = $('map-year-badge');
  const searchInput = $('search');

  function fmtYearJa(y) { return y < 0 ? `紀元前${-y}年` : `${y}年`; }

  // ─── Color helpers ───
  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [90, 90, 90];
  }
  function pickTextColor(hex) {
    const [r, g, b] = hexToRgb(hex);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
  }
  function applyFactionSwatch(el, fid) {
    const f = D.FACTIONS[fid];
    const color = f?.color || '#5a5a5a';
    el.style.background = color;
    el.style.color = pickTextColor(color);
  }

  function init() {
    if (META.headerIcon || META.headerTitle) {
      const h1 = $('page-h1');
      if (h1) {
        h1.innerHTML = '';
        if (META.headerIcon) h1.appendChild(document.createTextNode(META.headerIcon + ' '));
        h1.appendChild(document.createTextNode(META.headerTitle || ''));
        if (META.headerSubtitle) {
          const span = document.createElement('span');
          span.textContent = META.headerSubtitle;
          h1.appendChild(span);
        }
      }
    }
    if (searchInput && META.searchPlaceholder) searchInput.placeholder = META.searchPlaceholder;
    const mapTitleTextEl = $('map-title-text');
    if (mapTitleTextEl) mapTitleTextEl.textContent = [META.mapTitleIcon, mapTitleLabel].filter(Boolean).join(' ');
    setModalLabels();

    renderEraNav();
    renderFactionFilters();
    renderCategoryFilters();
    renderSidebar();
    renderTimeline();
    renderMap(D.MAP_SNAPSHOTS[0].year);
    bindEvents();
    if (window.matchMedia('(max-width:900px)').matches) {
      state.sidebarVisible = false;
      $('btn-toggle-sidebar').classList.remove('active');
    }
    handleDeepLink();
  }

  // ─── Deep link (#e_xxx / #c_xxx) ───
  // 比較ビュー等の外部ページから特定の出来事/人物へ直接リンクするためのオプトイン機能。
  // ハッシュが無ければ何もしないため、通常アクセスには一切影響しない。
  function handleDeepLink() {
    const hash = location.hash.slice(1);
    if (!hash) return;
    if (hash.startsWith('e_') && D.EVENTS.some(e => e.id === hash)) {
      openEventModal(hash);
    } else if (hash.startsWith('c_') && D.CHARACTERS.some(c => c.id === hash)) {
      openCharModal(hash);
    }
  }

  function setModalLabels() {
    const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
    set('em-desc-label', descLabel);
    set('em-trivia-label', triviaLabel);
    set('em-diff-label', historyDiffLabel);
    set('em-chars-label', relatedCharsLabel);
    set('cm-desc-label', charDescLabel);
    set('cm-trivia-label', triviaLabel);
    set('cm-events-label', relatedEventsLabel);
  }

  // ─── Era Navigation ───
  function renderEraNav() {
    eraNav.innerHTML = '';
    const allTab = mkEl('div', 'era-tab active', '全時代');
    allTab.dataset.era = 'all';
    allTab.onclick = () => selectEra(null, allTab);
    eraNav.appendChild(allTab);
    D.ERA_PHASES.forEach(p => {
      const tab = mkEl('div', 'era-tab', p.name);
      tab.dataset.era = p.id;
      tab.onclick = () => selectEra(p.id, tab);
      eraNav.appendChild(tab);
    });
  }

  function selectEra(eraId, tab) {
    eraNav.querySelectorAll('.era-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    state.era = eraId;
    renderTimeline();
  }

  // ─── Faction Filters ───
  function renderFactionFilters() {
    const container = $('faction-filters');
    container.innerHTML = '';
    const allBtn = mkEl('button', 'filter-btn active', '全勢力');
    allBtn.dataset.faction = 'all';
    container.appendChild(allBtn);
    Object.values(D.FACTIONS).filter(f => !f.mapOnly).forEach(f => {
      const btn = mkEl('button', 'filter-btn', f.name);
      btn.dataset.faction = f.id;
      container.appendChild(btn);
    });
  }

  // ─── Category Filters ───
  function renderCategoryFilters() {
    const container = $('category-filters');
    container.innerHTML = '';
    const allBtn = mkEl('button', 'filter-btn active', '全カテゴリ');
    allBtn.dataset.cat = 'all';
    container.appendChild(allBtn);
    Object.values(D.CATEGORIES).forEach(c => {
      const btn = mkEl('button', 'filter-btn', `${c.icon} ${c.name}`);
      btn.dataset.cat = c.id;
      container.appendChild(btn);
    });
  }

  // ─── Sidebar ───
  function renderSidebar() {
    sidebar.innerHTML = '';
    const clearBar = mkEl('div', 'sidebar-clear-bar');
    clearBar.id = 'char-filter-clear';
    clearBar.innerHTML = '<span>🔍 人物フィルタ中</span><button class="clear-char-filter">✕ 解除</button>';
    clearBar.style.display = state.selectedChars.size ? 'flex' : 'none';
    clearBar.querySelector('button').onclick = () => {
      state.selectedChars.clear();
      updateSidebarSelection();
      renderTimeline();
    };
    sidebar.appendChild(clearBar);

    const factionOrder = Object.keys(D.FACTIONS);
    factionOrder.forEach(fid => {
      const chars = D.CHARACTERS.filter(c => c.faction === fid);
      if (!chars.length) return;
      const section = mkEl('div', 'sidebar-section');
      const header = mkEl('div', 'sidebar-header');
      const fName = D.FACTIONS[fid]?.name || fid;
      header.innerHTML = `<span>${fName}（${chars.length}）</span><span class="arrow">▼</span>`;
      let collapsed = false;
      const list = mkEl('div', 'sidebar-list');
      header.onclick = () => { collapsed = !collapsed; list.classList.toggle('hidden', collapsed); header.classList.toggle('collapsed', collapsed); };
      chars.forEach(c => {
        const item = mkEl('div', 'sidebar-char');
        item.dataset.charId = c.id;
        const dot = mkEl('span', 'dot');
        applyFactionSwatch(dot, fid);
        const r = c.reading ? `<span class="reading">${c.reading}</span>` : '';
        item.appendChild(dot);
        item.appendChild(document.createTextNode(' ' + c.name + ' '));
        if (r) item.insertAdjacentHTML('beforeend', r);
        if (state.selectedChars.has(c.id)) item.classList.add('selected');
        item.onclick = (e) => {
          if (e.ctrlKey || e.metaKey) {
            openCharModal(c.id);
            return;
          }
          if (state.selectedChars.has(c.id)) {
            state.selectedChars.delete(c.id);
          } else {
            state.selectedChars.add(c.id);
          }
          updateSidebarSelection();
          renderTimeline();
          if (window.matchMedia('(max-width:900px)').matches) {
            sidebar.classList.remove('mobile-open');
            $('sidebar-overlay').classList.remove('active');
            $('btn-toggle-sidebar').classList.remove('active');
            document.body.style.overflow = '';
          }
        };
        item.oncontextmenu = (e) => {
          e.preventDefault();
          openCharModal(c.id);
        };
        list.appendChild(item);
      });
      section.appendChild(header);
      section.appendChild(list);
      sidebar.appendChild(section);
    });
  }

  function updateSidebarSelection() {
    const clearBar = document.getElementById('char-filter-clear');
    if (clearBar) clearBar.style.display = state.selectedChars.size ? 'flex' : 'none';
    sidebar.querySelectorAll('.sidebar-char').forEach(el => {
      el.classList.toggle('selected', state.selectedChars.has(el.dataset.charId));
    });
  }

  // ─── Territory Map ───
  function getSnapshotForYear(year) {
    if (!D.MAP_SNAPSHOTS) return null;
    let best = null;
    for (const snap of D.MAP_SNAPSHOTS) {
      if (snap.year <= year) best = snap;
      else break;
    }
    return best || D.MAP_SNAPSHOTS[0];
  }

  function computeColumns(count) {
    for (const rule of mapColumnRules) {
      if (rule.maxCount === undefined || count <= rule.maxCount) return rule.cols;
    }
    return mapColumnRules[mapColumnRules.length - 1].cols;
  }

  // タイムラインの存在を知らない: メタに mapLayout があれば固定グリッド、無ければ動的列数計算
  function getMapCells(snap) {
    if (Array.isArray(META.mapLayout) && META.mapLayout.length) {
      const cells = [];
      META.mapLayout.forEach(row => {
        row.forEach(provId => {
          cells.push({ provId, territory: provId ? snap.territories[provId] : null });
        });
      });
      return { cells, cols: META.mapLayout[0]?.length || 1, rows: META.mapLayout.length, fixed: true };
    }
    const entries = Object.entries(snap.territories).map(([provId, territory]) => ({ provId, territory }));
    return { cells: entries, cols: computeColumns(entries.length), rows: null, fixed: false };
  }

  function renderMap(year) {
    const snap = getSnapshotForYear(year);
    if (!snap) return;
    const mapKey = snap.year;
    const prevKey = state.prevMapKey;
    state.prevMapKey = mapKey;

    if (mapYearBadge) mapYearBadge.textContent = `${snap.label}（${fmtYearJa(snap.year)}〜）`;

    const prevSnap = prevKey !== null ? getSnapshotForYear(prevKey) : null;

    mapGrid.innerHTML = '';
    const { cells, cols, rows } = getMapCells(snap);
    mapGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    mapGrid.style.gridTemplateRows = rows ? `repeat(${rows}, auto)` : '';

    cells.forEach(({ provId, territory: prov }) => {
      const cell = mkEl('div', 'map-cell');
      if (!prov || prov.faction === 'empty') {
        cell.classList.add('map-empty');
        mapGrid.appendChild(cell);
        return;
      }
      applyFactionSwatch(cell, prov.faction);
      cell.innerHTML = `<div class="cell-name">${prov.name}</div><div class="cell-lord">${prov.lord}</div>`;
      cell.title = `${prov.name}：${prov.lord}`;

      if (prevSnap && prevKey !== mapKey) {
        const prevProv = prevSnap.territories[provId];
        if (prevProv && prevProv.faction !== prov.faction) {
          cell.classList.add('changed');
        }
      }
      mapGrid.appendChild(cell);
    });

    renderMapLegend(snap);
  }

  function renderMapLegend(snap) {
    mapLegend.innerHTML = '';
    const activeFactions = new Set();
    if (snap && snap.territories) {
      Object.values(snap.territories).forEach(t => { if (t.faction !== 'empty') activeFactions.add(t.faction); });
    }
    Object.keys(D.FACTIONS).filter(fid => activeFactions.has(fid)).forEach(fid => {
      const item = mkEl('div', 'map-legend-item');
      const swatch = mkEl('div', 'map-legend-swatch');
      swatch.style.background = D.FACTIONS[fid]?.color || '#5a5a5a';
      const label = mkEl('span', '', D.FACTIONS[fid]?.name || fid);
      item.appendChild(swatch);
      item.appendChild(label);
      mapLegend.appendChild(item);
    });
  }

  // ─── Scroll-based event tracking ───
  let scrollTicking = false;
  let activeCardEl = null;
  const timelineCol = document.querySelector('.timeline-column');

  function getScrollTarget() {
    const style = getComputedStyle(timelineCol);
    const ov = style.overflowY;
    return (ov === 'visible' || ov === '') ? window : timelineCol;
  }
  let currentScrollTarget = null;

  function setupObserver() {
    if (currentScrollTarget) {
      currentScrollTarget.removeEventListener('scroll', onScroll);
      currentScrollTarget = null;
    }
    if (!state.mapVisible) return;
    currentScrollTarget = getScrollTarget();
    currentScrollTarget.addEventListener('scroll', onScroll, { passive: true });
    requestAnimationFrame(syncActiveEvent);
  }

  function onScroll() {
    if (!scrollTicking) {
      scrollTicking = true;
      requestAnimationFrame(() => {
        syncActiveEvent();
        scrollTicking = false;
      });
    }
  }

  function syncActiveEvent() {
    if (!state.mapVisible) return;
    const cards = timeline.querySelectorAll('.event-card');
    if (!cards.length) return;

    const isWindowScroll = (currentScrollTarget === window);
    const viewportH = isWindowScroll ? window.innerHeight : timelineCol.clientHeight;
    const scrollTop = isWindowScroll ? window.scrollY : timelineCol.scrollTop;
    const scrollMax = isWindowScroll
      ? document.documentElement.scrollHeight - window.innerHeight
      : timelineCol.scrollHeight - timelineCol.clientHeight;

    const scrollProgress = scrollMax > 0 ? scrollTop / scrollMax : 0;

    const refTop = isWindowScroll ? 0 : timelineCol.getBoundingClientRect().top;
    const margin = 40;
    const targetY = refTop + margin + (viewportH - margin * 2) * scrollProgress;

    let closest = null;
    let closestDist = Infinity;

    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.top + rect.height / 2;
      const dist = Math.abs(cardCenter - targetY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = card;
      }
    });

    if (closest && closest !== activeCardEl) {
      activeCardEl = closest;
      cards.forEach(c => c.classList.remove('active-event'));
      closest.classList.add('active-event');
      const year = parseInt(closest.dataset.year, 10);
      if (!isNaN(year)) {
        state.activeEventYear = year;
        renderMap(year);
      }
    }
  }

  // ─── Timeline ───
  function renderTimeline() {
    timeline.innerHTML = '';
    let events = D.EVENTS.filter(ev => {
      if (state.era && ev.phaseId !== state.era) return false;
      if (state.faction !== 'all') {
        const has = ev.characters.some(cid => {
          const ch = D.CHARACTERS.find(c => c.id === cid);
          return ch && ch.faction === state.faction;
        });
        if (!has) return false;
      }
      if (state.category !== 'all' && ev.category !== state.category) return false;
      if (state.selectedChars.size > 0) {
        const hasChar = ev.characters.some(cid => state.selectedChars.has(cid));
        if (!hasChar) return false;
      }
      if (state.query) {
        const keywords = state.query.toLowerCase().split(/\s+/).filter(k => k);
        const matchesAny = keywords.some(q => {
          const inTitle = ev.title.toLowerCase().includes(q);
          const inDesc = ev.description.toLowerCase().includes(q);
          const inLoc = ev.location.toLowerCase().includes(q);
          const inChar = ev.characters.some(cid => {
            const ch = D.CHARACTERS.find(c => c.id === cid);
            return ch && (ch.name.includes(q) || (ch.title && ch.title.includes(q)) || (ch.reading && ch.reading.toLowerCase().includes(q)));
          });
          return inTitle || inDesc || inLoc || inChar;
        });
        if (!matchesAny) return false;
      }
      return true;
    });

    events.sort((a, b) => a.year - b.year);

    if (!events.length) {
      timeline.innerHTML = '<div class="no-results">該当する出来事が見つかりません</div>';
      return;
    }

    events.forEach((ev) => {
      const card = mkEl('div', 'event-card');
      card.dataset.year = ev.year;
      card.dataset.eventId = ev.id;
      card.onclick = () => {
        if (state.mapVisible) {
          state.activeEventYear = ev.year;
          renderMap(ev.year);
          timeline.querySelectorAll('.event-card').forEach(c => c.classList.remove('active-event'));
          card.classList.add('active-event');
          activeCardEl = card;
        }
        openEventModal(ev.id);
      };

      const yearEl = mkEl('div', 'event-year', fmtYearJa(ev.year));
      const top = mkEl('div', 'event-top');
      const icon = mkEl('span', 'event-icon', D.CATEGORIES[ev.category]?.icon || '📜');
      const title = mkEl('span', 'event-title', ev.title);
      const cat = mkEl('span', 'event-cat', D.CATEGORIES[ev.category]?.name || '');
      top.append(icon, title, cat);
      if (ev.historyOnly) {
        top.appendChild(mkEl('span', 'event-source history-only', historyOnlyBadgeLabel));
      }

      const desc = mkEl('p', 'event-desc', ev.description);
      const bottom = mkEl('div', 'event-bottom');
      const loc = mkEl('span', 'event-location', '📍 ' + ev.location);
      const chars = mkEl('div', 'event-chars');
      ev.characters.slice(0, 4).forEach(cid => {
        const ch = D.CHARACTERS.find(c => c.id === cid);
        if (ch) {
          const t = mkEl('span', 'tag', ch.name);
          applyFactionSwatch(t, ch.faction);
          t.onclick = e => { e.stopPropagation(); openCharModal(ch.id); };
          chars.appendChild(t);
        }
      });
      if (ev.characters.length > 4) chars.appendChild(mkEl('span', 'tag', `+${ev.characters.length - 4}`));
      bottom.append(loc, chars);
      card.append(yearEl, top, desc, bottom);
      timeline.appendChild(card);
    });

    requestAnimationFrame(() => setupObserver());
  }

  // ─── Wikipedia Link Helper ───
  const WIKI_ICON_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.407 0 .2.11.566.329 1.124.665 1.606 2.716 6.378 3.713 8.69l.061-.006c.875-1.842 2.189-4.625 2.189-4.625s-.684-1.406-1.867-4.039c-.289-.637-.557-1.076-.804-1.315-.248-.24-.63-.371-1.146-.392-.127-.007-.19-.064-.19-.17v-.453l.049-.044h4.455l.051.044v.442c0 .128-.074.186-.222.186-.693.024-.856.143-.856.392 0 .119.078.357.236.714l1.72 3.695.063.009 1.72-3.591c.157-.353.236-.597.236-.733 0-.287-.269-.439-.806-.456-.158-.006-.237-.066-.237-.182v-.445l.049-.043s2.397-.007 3.498 0l.049.043v.457c0 .104-.074.161-.222.167-.741.049-1.218.395-1.89 1.665l-2.076 4.073 2.375 5.067.063.006c1.07-2.519 2.873-6.728 3.57-8.488.233-.578.35-.972.35-1.182 0-.322-.334-.49-1-.504-.128-.006-.192-.063-.192-.17v-.457l.049-.043s2.456-.005 3.41 0l.051.043v.457c0 .113-.072.17-.216.17-.471.02-.845.112-1.122.279-.278.164-.553.495-.826.99-.834 1.703-4.632 9.677-5.834 12.296-.59 1.018-1.108 1.078-1.533.045-.633-1.388-2.267-4.792-2.267-4.792z"/></svg>';

  function renderWikiLink(containerEl, wikiTitle) {
    containerEl.innerHTML = '';
    if (!wikiTitle) return;
    const url = 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(wikiTitle);
    const a = document.createElement('a');
    a.className = 'wiki-link';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = WIKI_ICON_SVG + ' Wikipedia';
    a.title = `Wikipedia: ${wikiTitle}`;
    a.onclick = e => e.stopPropagation();
    containerEl.appendChild(a);
  }

  // ─── Event Modal ───
  function openEventModal(eventId) {
    const ev = D.EVENTS.find(e => e.id === eventId);
    if (!ev) return;
    $('em-title').textContent = ev.title + (ev.historyOnly ? `【${historyOnlyBadgeLabel}】` : '');
    $('em-year').textContent = fmtYearJa(ev.year);
    $('em-location').textContent = ev.location;
    $('em-desc').textContent = ev.description;

    const trivSec = $('em-trivia-section');
    if (ev.historyTrivia) { $('em-trivia').textContent = ev.historyTrivia; trivSec.style.display = ''; }
    else { trivSec.style.display = 'none'; }

    const diffSec = $('em-diff-section');
    if (diffSec) {
      if (ev.historyDiff) { $('em-diff').textContent = ev.historyDiff; diffSec.style.display = ''; }
      else { diffSec.style.display = 'none'; }
    }

    renderWikiLink($('em-wiki-link'), D.WIKI_LINKS?.events?.[ev.id]);
    const charsEl = $('em-chars');
    charsEl.innerHTML = '';
    ev.characters.forEach(cid => {
      const ch = D.CHARACTERS.find(c => c.id === cid);
      if (!ch) return;
      const label = ch.reading ? `${ch.name}（${ch.reading}）` : `${ch.name}（${ch.title || ''}）`;
      const t = mkEl('span', 'tag', label);
      applyFactionSwatch(t, ch.faction);
      t.onclick = () => { closeModal('event-modal'); openCharModal(ch.id); };
      charsEl.appendChild(t);
    });
    showModal('event-modal');
  }

  // ─── Character Modal ───
  function openCharModal(charId) {
    const ch = D.CHARACTERS.find(c => c.id === charId);
    if (!ch) return;
    $('cm-name').textContent = ch.name;
    const rl = $('cm-reading');
    if (ch.reading) { rl.textContent = ch.reading + (ch.title ? `　${characterTitleLabel}: ${ch.title}` : ''); rl.style.display = ''; }
    else { rl.style.display = 'none'; }
    const ftag = $('cm-faction-tag');
    const factionName = D.FACTIONS[ch.faction]?.name || ch.faction;
    const fieldLabel = FIELD_LABELS[ch.field];
    ftag.textContent = fieldLabel ? `${factionName} ／ ${fieldLabel}` : factionName;
    ftag.className = 'tag';
    applyFactionSwatch(ftag, ch.faction);
    $('cm-role').textContent = ch.role;
    $('cm-life').textContent = ch.life ? `（${ch.life}）` : '';
    $('cm-desc').textContent = ch.description;
    renderWikiLink($('cm-wiki-link'), D.WIKI_LINKS?.characters?.[ch.id]);
    const trivSec = $('cm-trivia-section');
    if (ch.historyTrivia) { $('cm-trivia').textContent = ch.historyTrivia; trivSec.style.display = ''; }
    else { trivSec.style.display = 'none'; }
    const eventsEl = $('cm-events');
    eventsEl.innerHTML = '';
    const related = D.EVENTS.filter(ev => ev.characters.includes(charId));
    if (related.length) {
      const label = mkEl('div', ''); label.style.cssText = 'font-size:.82rem;color:var(--text-dim);margin-bottom:6px;width:100%';
      label.textContent = `${relatedEventsLabel}（${related.length}件）`; eventsEl.appendChild(label);
      related.forEach(ev => {
        const hb = ev.historyOnly ? `　【${historyOnlyBadgeLabel}】` : '';
        const t = mkEl('span', 'tag tag-event', `${fmtYearJa(ev.year)}　${ev.title}${hb}`);
        t.onclick = () => { closeModal('char-modal'); openEventModal(ev.id); };
        eventsEl.appendChild(t);
      });
    } else {
      eventsEl.innerHTML = `<span style="color:var(--text-dim);font-size:.85rem">${relatedEventsLabel}はまだ登録されていません</span>`;
    }
    showModal('char-modal');
  }

  function showModal(id) { $(id).classList.add('active'); document.body.style.overflow = 'hidden'; }
  function closeModal(id) { $(id).classList.remove('active'); document.body.style.overflow = ''; }

  // ─── Events ───
  function bindEvents() {
    document.querySelectorAll('#faction-filters .filter-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#faction-filters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.faction = btn.dataset.faction; renderTimeline();
      };
    });
    document.querySelectorAll('#category-filters .filter-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#category-filters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); state.category = btn.dataset.cat; renderTimeline();
      };
    });
    let searchTimer;
    searchInput.addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = e.target.value.trim(); renderTimeline(); }, 250);
    });
    $('btn-toggle-map').onclick = () => {
      state.mapVisible = !state.mapVisible;
      $('map-column').style.display = state.mapVisible ? '' : 'none';
      $('btn-toggle-map').classList.toggle('active', state.mapVisible);
      if (state.mapVisible) { requestAnimationFrame(syncActiveEvent); }
      setupObserver();
    };
    $('btn-toggle-sidebar').onclick = () => {
      const isMobile = window.matchMedia('(max-width:900px)').matches;
      if (isMobile) {
        const open = sidebar.classList.toggle('mobile-open');
        $('sidebar-overlay').classList.toggle('active', open);
        $('btn-toggle-sidebar').classList.toggle('active', open);
        document.body.style.overflow = open ? 'hidden' : '';
      } else {
        state.sidebarVisible = !state.sidebarVisible;
        sidebar.style.display = state.sidebarVisible ? '' : 'none';
        $('btn-toggle-sidebar').classList.toggle('active', state.sidebarVisible);
      }
    };
    $('sidebar-overlay').onclick = () => {
      sidebar.classList.remove('mobile-open');
      $('sidebar-overlay').classList.remove('active');
      $('btn-toggle-sidebar').classList.remove('active');
      document.body.style.overflow = '';
    };
    $('em-close').onclick = () => closeModal('event-modal');
    $('cm-close').onclick = () => closeModal('char-modal');
    $('event-modal').onclick = e => { if (e.target === $('event-modal')) closeModal('event-modal'); };
    $('char-modal').onclick = e => { if (e.target === $('char-modal')) closeModal('char-modal'); };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeModal('event-modal'); closeModal('char-modal'); }
    });
  }

  function mkEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  init();
  }
});
