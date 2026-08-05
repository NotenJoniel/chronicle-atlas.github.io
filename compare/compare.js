/**
 * Chronicle Atlas — 同時代比較ビュー
 * data/index.json のメタ情報 + 選択した2〜3個の data/timelines/<id>.json を直接fetchして
 * 「列=タイムライン、縦軸=年」の共通軸上に出来事カードを並べる。
 */
document.addEventListener('DOMContentLoaded', () => {
  const selectionScreen = document.getElementById('selection-screen');
  const compareView = document.getElementById('compare-view');
  const selectionList = document.getElementById('selection-list');
  const btnStart = document.getElementById('btn-start-compare');

  const MIN_SEL = 2, MAX_SEL = 3;
  let selected = new Set();

  function parseSelection() {
    const params = new URLSearchParams(location.search);
    return (params.get('t') || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  async function boot() {
    const indexData = await fetch(`../data/index.json?t=${Date.now()}`).then(r => r.json());
    const metaList = indexData.timelines;
    const ids = parseSelection().filter(id => metaList.some(m => m.id === id));
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length < MIN_SEL || uniqueIds.length > MAX_SEL) {
      renderSelectionScreen(metaList, uniqueIds);
    } else {
      selectionScreen.style.display = 'none';
      compareView.style.display = '';
      const timelines = await loadTimelines(metaList, uniqueIds);
      renderCompareView(timelines);
    }
  }

  // ─── Selection screen ───
  function renderSelectionScreen(metaList, preSelected) {
    selectionScreen.style.display = '';
    compareView.style.display = 'none';
    selected = new Set(preSelected.slice(0, MAX_SEL));

    const countEl = document.createElement('div');
    countEl.className = 'selection-count';
    selectionScreen.insertBefore(countEl, selectionList);

    function fmtYear(y) { return y < 0 ? `BC${-y}` : `AD${y}`; }
    const REGION_LABEL = { china: '中国', japan: '日本', europe: 'ヨーロッパ' };

    function redraw() {
      selectionList.innerHTML = '';
      metaList.forEach(m => {
        const item = document.createElement('label');
        item.className = 'selection-item' + (selected.has(m.id) ? ' checked' : '');
        const atLimit = selected.size >= MAX_SEL && !selected.has(m.id);
        if (atLimit) item.classList.add('disabled');
        item.innerHTML = `
          <input type="checkbox" ${selected.has(m.id) ? 'checked' : ''} ${atLimit ? 'disabled' : ''}>
          <span class="si-name">${m.name}</span>
          <span class="si-region">${REGION_LABEL[m.region] || m.region}</span>
          <span class="si-years">${fmtYear(m.startYear)}〜${fmtYear(m.endYear)}</span>
        `;
        item.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) selected.add(m.id);
          else selected.delete(m.id);
          redraw();
        });
        selectionList.appendChild(item);
      });
      countEl.textContent = `${selected.size} / ${MAX_SEL} 個選択中（最低${MIN_SEL}個）`;
      btnStart.disabled = selected.size < MIN_SEL || selected.size > MAX_SEL;
    }
    redraw();

    btnStart.onclick = () => {
      const ids = [...selected];
      location.search = `?t=${ids.join(',')}`;
    };
  }

  // ─── Data loading ───
  async function loadTimelines(metaList, ids) {
    return Promise.all(ids.map(async id => {
      const meta = metaList.find(m => m.id === id);
      const raw = await fetch(`../data/${meta.dataFile}?t=${Date.now()}`).then(r => r.json());
      const events = [...raw.events].sort((a, b) => a.year - b.year);
      return { id, meta, raw, events, characters: raw.characters, factions: raw.factions, categories: raw.categories };
    }));
  }

  // ─── Axis / layout math ───
  function computeAxis(timelines) {
    const unionStart = Math.min(...timelines.map(t => t.meta.startYear));
    const unionEnd = Math.max(...timelines.map(t => t.meta.endYear));
    const overlapStart = Math.max(...timelines.map(t => t.meta.startYear));
    const overlapEnd = Math.min(...timelines.map(t => t.meta.endYear));
    const hasOverlap = overlapStart < overlapEnd;
    const spanYears = Math.max(1, unionEnd - unionStart);
    const pxPerYear = computePxPerYear(spanYears);
    return { unionStart, unionEnd, overlapStart, overlapEnd, hasOverlap, spanYears, pxPerYear };
  }

  function computePxPerYear(spanYears) {
    const MIN_PX = 0.6, MAX_PX = 12, TARGET_TOTAL_PX = 6000;
    return Math.min(MAX_PX, Math.max(MIN_PX, TARGET_TOTAL_PX / spanYears));
  }

  function computeYearStep(spanYears) {
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (const s of steps) { if (spanYears / s <= 30) return s; }
    return 1000;
  }

  const CARD_HEIGHT = 50, CARD_GAP = 6;

  function layoutCards(events, yearToY) {
    let cursorBottom = -Infinity;
    return events.map(ev => {
      const idealTop = yearToY(ev.year);
      const top = Math.max(idealTop, cursorBottom + CARD_GAP);
      cursorBottom = top + CARD_HEIGHT;
      return { ev, top, idealTop, offset: top - idealTop };
    });
  }

  // ─── Render compare view ───
  let axis, timelinesData, activeCategory = 'all';
  const factionByTimeline = {};

  function renderCompareView(timelines) {
    timelinesData = timelines;
    axis = computeAxis(timelines);
    timelines.forEach(t => { factionByTimeline[t.id] = 'all'; });

    function yearToY(year) { return (year - axis.unionStart) * axis.pxPerYear; }

    renderOverlapBanner();
    renderCategoryFilters(timelines);
    renderGrid(timelines, yearToY);

    if (axis.hasOverlap) {
      requestAnimationFrame(() => {
        const wrapper = document.getElementById('compare-wrapper');
        const midY = yearToY((axis.overlapStart + axis.overlapEnd) / 2);
        const headerH = document.getElementById('cmp-header').offsetHeight;
        wrapper.scrollTop = 0;
        window.scrollTo({ top: wrapper.getBoundingClientRect().top + window.scrollY + midY - 200, behavior: 'instant' });
      });
    }
  }

  function fmtYearJa(y) { return y < 0 ? `紀元前${-y}年` : `${y}年`; }
  function fmtYear(y) { return y < 0 ? `BC${-y}` : `AD${y}`; }

  function renderOverlapBanner() {
    const el = document.getElementById('overlap-banner');
    if (!axis.hasOverlap) {
      el.style.display = '';
      el.className = 'overlap-banner warn';
      el.textContent = `⚠️ 選択した時代は重なっていません（${timelinesData.map(t => `${t.meta.name}: ${fmtYear(t.meta.startYear)}〜${fmtYear(t.meta.endYear)}`).join(' / ')}）。年表全体は表示されますが、同時代比較の対象期間はありません。`;
    } else {
      el.style.display = '';
      el.className = 'overlap-banner info';
      el.textContent = `重なっている期間: ${fmtYear(axis.overlapStart)}〜${fmtYear(axis.overlapEnd)}（年軸上に帯で示しています）`;
    }
  }

  function renderCategoryFilters(timelines) {
    const container = document.getElementById('category-filters');
    container.innerHTML = '';
    const categories = timelines[0].categories;
    const allBtn = mkEl('button', 'filter-btn active', '全カテゴリ');
    allBtn.onclick = () => setCategory('all', allBtn);
    container.appendChild(allBtn);
    Object.values(categories).forEach(c => {
      const btn = mkEl('button', 'filter-btn', `${c.icon} ${c.name}`);
      btn.onclick = () => setCategory(c.id, btn);
      container.appendChild(btn);
    });
  }

  function setCategory(catId, btn) {
    activeCategory = catId;
    btn.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
  }

  function applyFilters() {
    document.querySelectorAll('.cmp-card').forEach(card => {
      const matchCat = activeCategory === 'all' || card.dataset.category === activeCategory;
      const tId = card.dataset.timeline;
      const fac = factionByTimeline[tId];
      const matchFaction = fac === 'all' || card.dataset.factions.split(',').includes(fac);
      card.classList.toggle('dimmed', !(matchCat && matchFaction));
    });
  }

  function renderGrid(timelines, yearToY) {
    const header = document.getElementById('cmp-header');
    const grid = document.getElementById('cmp-grid');
    header.innerHTML = '';
    grid.innerHTML = '';

    header.appendChild(mkEl('div', 'cmp-year-label', '年代'));

    let maxBottom = (axis.unionEnd - axis.unionStart) * axis.pxPerYear;
    const columnLayouts = [];

    timelines.forEach(t => {
      // header cell with faction filter
      const rn = mkEl('div', 'cmp-region-name');
      const title = mkEl('div', 'rn-title', t.meta.name);
      const sub = mkEl('div', 'rn-sub', `${fmtYear(t.meta.startYear)}〜${fmtYear(t.meta.endYear)}`);
      rn.append(title, sub);
      const sel = document.createElement('select');
      const allOpt = document.createElement('option');
      allOpt.value = 'all'; allOpt.textContent = '全勢力';
      sel.appendChild(allOpt);
      Object.values(t.factions).filter(f => !f.mapOnly).forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id; opt.textContent = f.name;
        sel.appendChild(opt);
      });
      sel.onchange = () => { factionByTimeline[t.id] = sel.value; applyFilters(); };
      rn.appendChild(sel);
      header.appendChild(rn);

      // laid-out cards
      const laid = layoutCards(t.events, yearToY);
      const localBottom = laid.length ? Math.max(...laid.map(l => l.top + CARD_HEIGHT)) : 0;
      maxBottom = Math.max(maxBottom, localBottom);
      columnLayouts.push({ t, laid });
    });

    const totalPx = maxBottom + 20;
    grid.style.height = totalPx + 'px';

    // year column
    const yearCol = mkEl('div', 'cmp-year-col');
    yearCol.style.height = totalPx + 'px';
    const step = computeYearStep(axis.spanYears);
    for (let y = Math.ceil(axis.unionStart / step) * step; y <= axis.unionEnd; y += step) {
      const mark = mkEl('div', y % (step * 5) === 0 ? 'cmp-year-mark century' : 'cmp-year-mark', fmtYear(y));
      mark.style.top = yearToY(y) + 'px';
      yearCol.appendChild(mark);
    }
    grid.appendChild(yearCol);

    // grid lines (span full width, behind columns)
    for (let y = Math.ceil(axis.unionStart / step) * step; y <= axis.unionEnd; y += step) {
      const line = mkEl('div', 'cmp-grid-line' + (y % (step * 5) === 0 ? ' major' : ''));
      line.style.top = yearToY(y) + 'px';
      line.style.left = '70px';
      grid.appendChild(line);
    }

    // columns
    columnLayouts.forEach(({ t, laid }) => {
      const col = mkEl('div', 'cmp-col');
      col.style.height = totalPx + 'px';

      // out-of-range shading
      const rangeStartY = yearToY(t.meta.startYear);
      const rangeEndY = yearToY(t.meta.endYear);
      if (rangeStartY > 0) {
        const band = mkEl('div', 'cmp-out-of-range');
        band.style.top = '0'; band.style.height = rangeStartY + 'px';
        col.appendChild(band);
      }
      if (rangeEndY < totalPx) {
        const band = mkEl('div', 'cmp-out-of-range');
        band.style.top = rangeEndY + 'px'; band.style.height = (totalPx - rangeEndY) + 'px';
        col.appendChild(band);
      }

      laid.forEach(({ ev, top, offset }) => {
        const card = mkEl('div', 'cmp-card');
        card.style.top = top + 'px';
        card.dataset.timeline = t.id;
        card.dataset.category = ev.category;
        card.dataset.eventId = ev.id;
        const chars = (ev.characters || []).map(cid => t.characters.find(c => c.id === cid)).filter(Boolean);
        card.dataset.factions = chars.map(c => c.faction).join(',');
        const firstFaction = chars.length ? t.factions[chars[0].faction] : null;
        if (firstFaction && firstFaction.color) card.style.borderLeftColor = firstFaction.color;

        const cat = t.categories[ev.category];
        const top1 = mkEl('div', 'cc-top');
        top1.innerHTML = `<span class="cc-year">${fmtYearJa(ev.year)}</span><span>${cat ? cat.icon : ''}</span>`;
        const titleEl = mkEl('div', 'cc-title', ev.title);
        card.append(top1, titleEl);
        card.title = ev.title;

        card.onclick = () => openEventModal(t, ev);
        col.appendChild(card);

        if (Math.abs(offset) > 8) {
          const conn = mkEl('div', 'cmp-connector');
          const connTop = Math.min(top, top - offset);
          conn.style.top = connTop + 'px';
          conn.style.height = Math.abs(offset) + 'px';
          col.appendChild(conn);
        }
      });

      grid.appendChild(col);
    });

    // overlap band across all columns (excluding year col)
    if (axis.hasOverlap) {
      const band = mkEl('div', 'cmp-overlap-band');
      band.style.left = '70px';
      band.style.top = yearToY(axis.overlapStart) + 'px';
      band.style.height = ((axis.overlapEnd - axis.overlapStart) * axis.pxPerYear) + 'px';
      grid.appendChild(band);
    }

    applyFilters();
  }

  // ─── Modal ───
  function openEventModal(t, ev) {
    document.getElementById('em-title').textContent = ev.title;
    document.getElementById('em-timeline-badge').textContent = t.meta.name;
    document.getElementById('em-year').textContent = fmtYearJa(ev.year);
    document.getElementById('em-location').textContent = ev.location;
    document.getElementById('em-desc').textContent = ev.description;

    const trivSec = document.getElementById('em-trivia-section');
    if (ev.historyTrivia) { document.getElementById('em-trivia').textContent = ev.historyTrivia; trivSec.style.display = ''; }
    else { trivSec.style.display = 'none'; }

    const link = document.getElementById('em-view-link');
    link.href = `../${t.meta.subProjectDir}/index.html#${ev.id}`;

    const charsEl = document.getElementById('em-chars');
    charsEl.innerHTML = '';
    (ev.characters || []).forEach(cid => {
      const ch = t.characters.find(c => c.id === cid);
      if (!ch) return;
      const tag = mkEl('span', 'tag', ch.name);
      const f = t.factions[ch.faction];
      if (f && f.color) { tag.style.background = f.color; tag.style.color = pickTextColor(f.color); }
      charsEl.appendChild(tag);
    });

    document.getElementById('event-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    document.getElementById('event-modal').classList.remove('active');
    document.body.style.overflow = '';
  }
  document.getElementById('em-close').onclick = closeModal;
  document.getElementById('event-modal').onclick = e => { if (e.target.id === 'event-modal') closeModal(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function pickTextColor(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return '#fff';
    const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#1a1a1a' : '#ffffff';
  }

  function mkEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  boot();
});
