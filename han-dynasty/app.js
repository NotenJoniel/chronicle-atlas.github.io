/**
 * 漢王朝 史実クロニクルタイムライン v1.0
 * 史実ベース — 劉邦の建国から後漢の滅亡まで (BC202–AD220)
 */
document.addEventListener('DOMContentLoaded', () => {
  // Load data from centralized JSON
  fetch(`../data/timelines/han-dynasty.json?t=${Date.now()}`)
    .then(r => r.json())
    .then(raw => {
  const D = {
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
  const state = { era: null, faction: 'all', category: 'all', query: '', mapVisible: false, sidebarVisible: true, activeEventYear: null, prevMapKey: null, selectedChars: new Set() };

  const $ = id => document.getElementById(id);
  const eraNav = $('era-nav');
  const timeline = $('timeline');
  const sidebar = $('sidebar');
  const mapGrid = $('map-grid');
  const mapLegend = $('map-legend');
  const mapYearBadge = $('map-year-badge');
  const searchInput = $('search');

  function fmtYear(y) { return y < 0 ? `BC${-y}` : `AD${y}`; }
  function fmtYearJa(y) { return y < 0 ? `紀元前${-y}年` : `${y}年`; }

  function init() {
    renderEraNav();
    renderFactionFilters();
    renderCategoryFilters();
    renderSidebar();
    renderTimeline();
    renderMap(-200);
    bindEvents();
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

  // ─── Faction Filters ───
  function renderFactionFilters() {
    const container = $('faction-filters');
    container.innerHTML = '';
    const allBtn = mkEl('button', 'filter-btn active', '全勢力');
    allBtn.dataset.faction = 'all';
    container.appendChild(allBtn);
    Object.values(D.FACTIONS).forEach(f => {
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

    const factionOrder = ['han', 'xiongnu', 'xin', 'rebels', 'warlords', 'foreign', 'vassal', 'other'];
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
        const r = c.reading ? `<span class="reading">${c.reading}</span>` : '';
        item.innerHTML = `<span class="dot" style="background:var(--${fid}-light,var(--other-light))"></span>${c.name} ${r}`;
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

  function renderMap(year) {
    const snap = getSnapshotForYear(year);
    if (!snap) return;
    const mapKey = snap.year;
    const prevKey = state.prevMapKey;
    state.prevMapKey = mapKey;

    mapYearBadge.textContent = `${snap.label}（${fmtYearJa(snap.year)}〜）`;

    const prevSnap = prevKey !== null ? getSnapshotForYear(prevKey) : null;

    mapGrid.innerHTML = '';
    const territories = Object.entries(snap.territories);
    const count = territories.length;
    // 4 columns for Roman Empire geography
    const cols = count <= 4 ? 2 : count <= 9 ? 3 : 4;
    mapGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

    territories.forEach(([provId, prov]) => {
      const cell = mkEl('div', 'map-cell');
      // 空セル（海・空白）
      if (prov.faction === 'empty') {
        cell.classList.add('map-empty');
        mapGrid.appendChild(cell);
        return;
      }
      cell.classList.add('map-' + prov.faction);
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
    const ALL_FACTIONS = [
      { faction: 'han', cls: 'map-han', label: '漢（皇室）' },
      { faction: 'xiongnu', cls: 'map-xiongnu', label: '匈奴' },
      { faction: 'xin', cls: 'map-xin', label: '新' },
      { faction: 'rebels', cls: 'map-rebels', label: '反乱勢力' },
      { faction: 'warlords', cls: 'map-warlords', label: '群雄' },
      { faction: 'foreign', cls: 'map-foreign', label: '外国・西域' },
      { faction: 'vassal', cls: 'map-vassal', label: '諸侯王' },
      { faction: 'other', cls: 'map-other', label: 'その他' },
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
    $('em-title').textContent = ev.title;
    $('em-year').textContent = fmtYearJa(ev.year);
    $('em-location').textContent = ev.location;
    $('em-desc').textContent = ev.description;
    const trivSec = $('em-trivia-section');
    if (ev.historyTrivia) { $('em-trivia').textContent = ev.historyTrivia; trivSec.style.display = ''; }
    else { trivSec.style.display = 'none'; }
    renderWikiLink($('em-wiki-link'), D.WIKI_LINKS?.events?.[ev.id]);
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
    if (ch.reading) { rl.textContent = ch.reading + (ch.title ? `　別名: ${ch.title}` : ''); rl.style.display = ''; }
    else { rl.style.display = 'none'; }
    const ftag = $('cm-faction-tag');
    ftag.textContent = D.FACTIONS[ch.faction]?.name || ch.faction;
    ftag.className = `tag tag-${ch.faction}`;
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
    }).catch(err => {
      console.error('データの読み込みに失敗しました:', err);
      document.getElementById('timeline').innerHTML = '<div class="no-results">データの読み込みに失敗しました。ページを再読み込みしてください。</div>';
    });
});
