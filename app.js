/**
 * 三国志データベース v3.2
 * スティッキー勢力図（スクロール連動） / 群雄別色 / 相互リンク
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


  function init() {
    renderEraNav();
    renderSidebar();
    renderTimeline();
    renderMap(184);
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

    const factionOrder = ['wei', 'shu', 'wu', 'other', 'han', 'jin'];
    const factionNames = { wei: '魏', shu: '蜀', wu: '呉', other: '群雄・その他', han: '漢', jin: '晋' };
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
  const MAP_LAYOUT = [
    ['liangzhou', 'bingzhou', null,      'youzhou',  null],
    [null,        'sili',     'jizhou',  'qingzhou', null],
    ['yizhou',    null,       'jingzhou','yanzhou',   'xuzhou'],
    [null,        'jiaozhou', 'yuzhou',  'yangzhou',  null],
  ];

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

    mapEraLabel.innerHTML = `${snap.label} <span class="map-year-badge">${snap.year}年〜</span>`;

    const prevSnap = prevKey !== null ? getSnapshotForYear(prevKey) : null;

    mapGrid.innerHTML = '';
    mapGrid.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
    mapGrid.style.gridTemplateRows = 'repeat(4, auto)';

    MAP_LAYOUT.forEach(row => {
      row.forEach(provId => {
        const cell = mkEl('div', 'map-cell');
        if (!provId || !snap.territories[provId]) {
          cell.classList.add('map-empty');
          mapGrid.appendChild(cell);
          return;
        }
        const prov = snap.territories[provId];
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
    });

    // Update legend to show only active factions
    renderMapLegend(snap);
  }

  function renderMapLegend(snap) {
    mapLegend.innerHTML = '';
    const ALL_FACTIONS = [
      { faction: 'han', cls: 'map-han', label: '漢（朝廷）' },
      { faction: 'wei', cls: 'map-wei', label: '魏（曹操）' },
      { faction: 'shu', cls: 'map-shu', label: '蜀（劉備）' },
      { faction: 'wu', cls: 'map-wu', label: '呉（孫権）' },
      { faction: 'ensho', cls: 'map-ensho', label: '袁紹' },
      { faction: 'dongzhuo', cls: 'map-dongzhuo', label: '董卓' },
      { faction: 'liubiao', cls: 'map-liubiao', label: '劉表' },
      { faction: 'liuzhang', cls: 'map-liuzhang', label: '劉璋' },
      { faction: 'other', cls: 'map-other', label: '群雄' },
      { faction: 'jin', cls: 'map-jin', label: '晋（司馬氏）' },
      { faction: 'contested', cls: 'map-contested', label: '係争地' },
    ];
    // Collect factions present in this snapshot
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

  function setupObserver() {
    if (!state.mapVisible) {
      timelineCol.removeEventListener('scroll', onScroll);
      return;
    }
    timelineCol.addEventListener('scroll', onScroll, { passive: true });
    // Initial sync
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

    const colRect = timelineCol.getBoundingClientRect();
    const scrollTop = timelineCol.scrollTop;
    const scrollMax = timelineCol.scrollHeight - timelineCol.clientHeight;

    // Dynamic target line: starts at top, eases to 40% as user scrolls
    // When scrollTop=0, target = colRect.top + small offset (pick first card)
    // As scrollTop increases, target eases toward colRect.top + 40% of column height
    const maxTargetOffset = colRect.height * 0.40;
    const minTargetOffset = 40; // small offset from top
    const scrollRatio = scrollMax > 0 ? Math.min(scrollTop / (colRect.height * 0.6), 1) : 0;
    const targetOffset = minTargetOffset + (maxTargetOffset - minTargetOffset) * scrollRatio;
    const targetY = colRect.top + targetOffset;

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
      if (year) {
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
      // OR search: space-separated keywords, match if ANY keyword matches
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

    if (!events.length) {
      timeline.innerHTML = '<div class="no-results">該当する出来事が見つかりません</div>';
      return;
    }

    events.forEach((ev, i) => {
      const card = mkEl('div', 'event-card');
      card.dataset.year = ev.year;
      card.dataset.eventId = ev.id;
      card.onclick = () => openEventModal(ev.id);

      const yearEl = mkEl('div', 'event-year', ev.year + '年');
      const top = mkEl('div', 'event-top');
      const icon = mkEl('span', 'event-icon', D.CATEGORIES[ev.category]?.icon || '📜');
      const title = mkEl('span', 'event-title', ev.title);
      const cat = mkEl('span', 'event-cat', D.CATEGORIES[ev.category]?.name || '');
      top.append(icon, title, cat);
      if (ev.historyOnly) {
        const badge = mkEl('span', 'event-source history-only', '正史');
        top.appendChild(badge);
      }

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
    $('em-title').textContent = ev.title + (ev.historyOnly ? '【正史】' : '');
    $('em-year').textContent = ev.year;
    $('em-location').textContent = ev.location;
    $('em-desc').textContent = ev.description;
    const trivSec = $('em-trivia-section');
    if (ev.historyDiff) { $('em-trivia').textContent = ev.historyDiff; trivSec.style.display = ''; }
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
        const hb = ev.historyOnly ? ' 【正史】' : '';
        const t = mkEl('span', 'tag tag-event', `${ev.year}年　${ev.title}${hb}`);
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
      if (state.mapVisible) { requestAnimationFrame(syncActiveEvent); setupObserver(); }
      else { timelineCol.removeEventListener('scroll', onScroll); }
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
