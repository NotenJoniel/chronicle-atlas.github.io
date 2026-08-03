/**
 * 楚漢戦争 史実クロニクルタイムライン v1.0
 * 史実ベース — 秦末の反乱から項羽vs劉邦、前漢成立まで
 */
document.addEventListener('DOMContentLoaded', () => {
  const D = window.appData;
  const state = { era: null, faction: 'all', category: 'all', query: '', mapVisible: false, sidebarVisible: true, activeEventYear: null, prevMapKey: null, selectedChars: new Set() };

  const $ = id => document.getElementById(id);
  const eraNav = $('era-nav');
  const timeline = $('timeline');
  const sidebar = $('sidebar');
  const mapGrid = $('map-grid');
  const mapLegend = $('map-legend');
  const mapEraLabel = $('map-era-label');
  const searchInput = $('search-input');

  function fmtYear(y) { return y < 0 ? `BC${-y}` : `${y}`; }
  function fmtYearJa(y) { return y < 0 ? `紀元前${-y}年` : `${y}年`; }

  function init() {
    renderEraNav();
    renderSidebar();
    renderTimeline();
    renderMap(-475);
    bindEvents();
    // Mobile: sidebar starts hidden (slid off-screen by CSS transform)
    if (window.matchMedia('(max-width:900px)').matches) {
      state.sidebarVisible = false;
      $('btn-toggle-sidebar').classList.remove('active');
    }
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

  // ─── Sidebar ───
  function renderSidebar() {
    sidebar.innerHTML = '';
    // Clear-all bar (shown when chars are selected)
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

    const factionOrder = ['qin', 'chu', 'qi', 'yan', 'zhao', 'wei', 'han', 'other'];
    const factionNames = { qin: '秦', chu: '楚', qi: '斉', yan: '燕', zhao: '趙', wei: '魏', han: '韓', other: '周・その他' };
    factionOrder.forEach(fid => {
      const chars = D.CHARACTERS.filter(c => c.faction === fid);
      if (!chars.length) return;
      const section = mkEl('div', 'sidebar-section');
      const header = mkEl('div', 'sidebar-header');
      header.innerHTML = `<span>${factionNames[fid] || fid}（${chars.length}）</span><span class="arrow">▼</span>`;
      let collapsed = false;
      const list = mkEl('div', 'sidebar-list');
      header.onclick = () => { collapsed = !collapsed; list.classList.toggle('hidden', collapsed); header.classList.toggle('collapsed', collapsed); };
      chars.forEach(c => {
        const item = mkEl('div', 'sidebar-char');
        item.dataset.charId = c.id;
        const r = c.reading ? `<span class="reading">${c.reading}</span>` : '';
        item.innerHTML = `<span class="dot" style="background:var(--${fid}-light,var(--other-light))"></span>${c.name} ${r}`;
        if (state.selectedChars.has(c.id)) item.classList.add('selected');
        // Left-click: toggle filter, right-click: open detail
        item.onclick = (e) => {
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+click opens character modal
            openCharModal(c.id);
            return;
          }
          // Toggle character selection
          if (state.selectedChars.has(c.id)) {
            state.selectedChars.delete(c.id);
          } else {
            state.selectedChars.add(c.id);
          }
          updateSidebarSelection();
          renderTimeline();
          // Auto-close sidebar on mobile after selection
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
  // Dynamic grid layout based on number of territories in snapshot
  function getSnapshotForYear(year) {
    if (!D.TERRITORY_SNAPSHOTS) return null;
    let best = null;
    for (const snap of D.TERRITORY_SNAPSHOTS) {
      if (snap.year <= year) best = snap;
      else break;
    }
    return best || D.TERRITORY_SNAPSHOTS[0];
  }

  function renderMap(year) {
    const snap = getSnapshotForYear(year);
    if (!snap) return;
    const mapKey = snap.year;
    const prevKey = state.prevMapKey;
    state.prevMapKey = mapKey;

    mapEraLabel.innerHTML = `${snap.label} <span class="map-year-badge">${fmtYearJa(snap.year)}〜</span>`;

    const prevSnap = prevKey !== null ? getSnapshotForYear(prevKey) : null;

    mapGrid.innerHTML = '';
    const territories = Object.entries(snap.territories);
    const count = territories.length;
    // Dynamic column count
    const cols = count <= 4 ? 2 : count <= 6 ? 3 : 4;
    mapGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    territories.forEach(([provId, prov]) => {
      const cell = mkEl('div', 'map-cell');
      cell.classList.add('map-' + prov.faction);
      cell.innerHTML = `<div class="cell-name">${prov.name}</div><div class="cell-lord">${prov.lord}</div>`;
      cell.title = `${prov.name}：${prov.lord}`;

      // Pulse animation if faction changed
      if (prevSnap && prevKey !== mapKey) {
        const prevProv = prevSnap.territories[provId];
        if (prevProv && prevProv.faction !== prov.faction) {
          cell.classList.add('changed');
        }
      }
      mapGrid.appendChild(cell);
    });

    // Update legend to show only active factions
    renderMapLegend(snap);
  }

  function renderMapLegend(snap) {
    mapLegend.innerHTML = '';
    const ALL_FACTIONS = [
      { faction: 'qin', cls: 'map-qin', label: '秦' },
      { faction: 'chu', cls: 'map-chu', label: '楚' },
      { faction: 'qi', cls: 'map-qi', label: '斉' },
      { faction: 'yan', cls: 'map-yan', label: '燕' },
      { faction: 'zhao', cls: 'map-zhao', label: '趙' },
      { faction: 'wei', cls: 'map-wei', label: '魏' },
      { faction: 'han', cls: 'map-han', label: '韓' },
      { faction: 'other', cls: 'map-other', label: '周・その他' },
    ];
    const activeFactions = new Set();
    if (snap && snap.territories) {
      Object.values(snap.territories).forEach(t => activeFactions.add(t.faction));
    }
    ALL_FACTIONS.filter(f => activeFactions.has(f.faction)).forEach(l => {
      const item = mkEl('div', 'map-legend-item');
      item.innerHTML = `<div class="map-legend-swatch ${l.cls}"></div><span>${l.label}</span>`;
      mapLegend.appendChild(item);
    });
  }

  // ─── Scroll-based event tracking (stable) ───
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

    const refTop = isWindowScroll ? 0 : timelineCol.getBoundingClientRect().top;
    const maxTargetOffset = viewportH * 0.40;
    const minTargetOffset = 40;
    const scrollRatio = scrollMax > 0 ? Math.min(scrollTop / (viewportH * 0.6), 1) : 0;
    const targetOffset = minTargetOffset + (maxTargetOffset - minTargetOffset) * scrollRatio;
    const targetY = refTop + targetOffset;

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
      // Character filter: show events involving ANY selected character
      if (state.selectedChars.size > 0) {
        const hasChar = ev.characters.some(cid => state.selectedChars.has(cid));
        if (!hasChar) return false;
      }
      // OR search: space-separated keywords
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

    // Sort events chronologically (ascending year: -475 → -221)
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

      const desc = mkEl('p', 'event-desc', ev.description);
      const bottom = mkEl('div', 'event-bottom');
      const loc = mkEl('span', 'event-location', '📍 ' + ev.location);
      const chars = mkEl('div', 'event-chars');
      ev.characters.slice(0, 4).forEach(cid => {
        const ch = D.CHARACTERS.find(c => c.id === cid);
        if (ch) {
          const t = mkEl('span', `tag tag-${ch.faction}`, ch.name);
          t.onclick = e => { e.stopPropagation(); openCharModal(ch.id); };
          chars.appendChild(t);
        }
      });
      if (ev.characters.length > 4) chars.appendChild(mkEl('span', 'tag', `+${ev.characters.length - 4}`));
      bottom.append(loc, chars);
      card.append(yearEl, top, desc, bottom);
      timeline.appendChild(card);
    });

    // Re-setup observer after re-render
    requestAnimationFrame(() => setupObserver());
  }

  // ─── Event Modal ───
  function openEventModal(eventId) {
    const ev = D.EVENTS.find(e => e.id === eventId);
    if (!ev) return;
    $('em-title').textContent = ev.title;
    $('em-year').textContent = fmtYearJa(ev.year);
    $('em-location').textContent = ev.location;
    $('em-desc').textContent = ev.description;
    const trivSec = $('em-trivia-section');
    if (ev.historyTrivia) { $('em-trivia').textContent = ev.historyTrivia; trivSec.style.display = ''; }
    else { trivSec.style.display = 'none'; }
    const charsEl = $('em-chars');
    charsEl.innerHTML = '';
    ev.characters.forEach(cid => {
      const ch = D.CHARACTERS.find(c => c.id === cid);
      if (!ch) return;
      const label = ch.reading ? `${ch.name}（${ch.reading}）` : `${ch.name}（${ch.title || ''}）`;
      const t = mkEl('span', `tag tag-${ch.faction}`, label);
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
    if (ch.reading) { rl.textContent = ch.reading + (ch.title ? `　字: ${ch.title}` : ''); rl.style.display = ''; }
    else { rl.style.display = 'none'; }
    const ftag = $('cm-faction-tag');
    ftag.textContent = D.FACTIONS[ch.faction]?.name || ch.faction;
    ftag.className = `tag tag-${ch.faction}`;
    $('cm-role').textContent = ch.role;
    $('cm-life').textContent = ch.life ? `（${ch.life}）` : '';
    $('cm-desc').textContent = ch.description;
    const trivSec = $('cm-trivia-section');
    if (ch.historyTrivia) { $('cm-trivia').textContent = ch.historyTrivia; trivSec.style.display = ''; }
    else { trivSec.style.display = 'none'; }
    const eventsEl = $('cm-events');
    eventsEl.innerHTML = '';
    const related = D.EVENTS.filter(ev => ev.characters.includes(charId));
    if (related.length) {
      const label = mkEl('div', ''); label.style.cssText = 'font-size:.82rem;color:var(--text-dim);margin-bottom:6px;width:100%';
      label.textContent = `関連する出来事（${related.length}件）`; eventsEl.appendChild(label);
      related.forEach(ev => {
        const t = mkEl('span', 'tag tag-event', `${fmtYearJa(ev.year)}　${ev.title}`);
        t.onclick = () => { closeModal('char-modal'); openEventModal(ev.id); };
        eventsEl.appendChild(t);
      });
    } else {
      eventsEl.innerHTML = '<span style="color:var(--text-dim);font-size:.85rem">関連する出来事はまだ登録されていません</span>';
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
    // Overlay click closes sidebar on mobile
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
});
