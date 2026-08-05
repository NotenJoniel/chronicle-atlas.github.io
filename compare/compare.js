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

  const MIN_SEL = 2, MAX_SEL = 4;
  let selected = new Set();
  let allMetaList = [];
  const loadedCache = {}; // id -> loaded timeline object (avoids re-fetching on add/remove)

  function parseSelection() {
    const params = new URLSearchParams(location.search);
    return (params.get('t') || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  async function boot() {
    const indexData = await fetch(`../data/index.json?t=${Date.now()}`).then(r => r.json());
    allMetaList = indexData.timelines;
    const ids = parseSelection().filter(id => allMetaList.some(m => m.id === id));
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length < MIN_SEL || uniqueIds.length > MAX_SEL) {
      renderSelectionScreen(allMetaList, uniqueIds);
    } else {
      selectionScreen.style.display = 'none';
      compareView.style.display = '';
      enableGrabToPan(document.getElementById('cmp-grid-scroll'));
      const timelines = await loadTimelines(allMetaList, uniqueIds);
      renderCompareView(timelines);
    }
    window.addEventListener('popstate', () => location.reload());
  }

  // 左クリック長押し+ドラッグで画面をつかんで移動できるようにする(横スクロールバーが
  // 掴みにくいという指摘への追加対応)。実際にドラッグした場合のみ、直後のclickイベントを
  // 抑制してカードのモーダルが誤って開かないようにする。
  function enableGrabToPan(scrollEl) {
    let isDown = false, dragged = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const DRAG_THRESHOLD = 4;

    scrollEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // ドラッグ中にテキスト範囲選択が始まってしまうのを防ぐ
      isDown = true;
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = scrollEl.scrollLeft;
      startTop = scrollEl.scrollTop;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        dragged = true;
        scrollEl.classList.add('grabbing');
      }
      if (dragged) {
        scrollEl.scrollLeft = startLeft - dx;
        scrollEl.scrollTop = startTop - dy;
      }
    });

    window.addEventListener('mouseup', () => {
      if (dragged) {
        const suppressClick = (e) => { e.stopPropagation(); e.preventDefault(); };
        scrollEl.addEventListener('click', suppressClick, { capture: true, once: true });
        scrollEl.classList.remove('grabbing');
      }
      isDown = false;
      dragged = false;
    });
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
    return Promise.all(ids.map(id => loadOneTimeline(metaList, id)));
  }

  async function loadOneTimeline(metaList, id) {
    if (loadedCache[id]) return loadedCache[id];
    const meta = metaList.find(m => m.id === id);
    const raw = await fetch(`../data/${meta.dataFile}?t=${Date.now()}`).then(r => r.json());
    const events = [...raw.events].sort((a, b) => a.year - b.year);
    const obj = { id, meta, raw, events, characters: raw.characters, factions: raw.factions, categories: raw.categories };
    loadedCache[id] = obj;
    return obj;
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
    const MIN_PX = 0.8, MAX_PX = 22, TARGET_TOTAL_PX = 12000;
    return Math.min(MAX_PX, Math.max(MIN_PX, TARGET_TOTAL_PX / spanYears));
  }

  function computeYearStep(spanYears) {
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (const s of steps) { if (spanYears / s <= 30) return s; }
    return 1000;
  }

  const CARD_HEIGHT = 54, CARD_GAP = 6, MAX_LANES = 4;

  // 同時期に重なる出来事はカレンダーアプリの予定と同じ発想で「横に並べる」ことで
  // 縦位置のズレ(実際の年からどんどん下にずれていく現象)が起きないようにする。
  // 各レーンは「そのレーンで最後に置いたカードの下端」を覚えておき、置けるレーンが
  // 無ければ新しいレーンを増やす(上限MAX_LANESまで)。それでも足りない極端な密集は
  // 最も早く空くレーンに詰める(そのケースのみ真の年から多少ズレうる)。
  function layoutCards(events, yearToY) {
    const laneBottoms = [];
    const laid = events.map(ev => {
      const idealTop = yearToY(ev.year);
      let lane = laneBottoms.findIndex(bottom => bottom + CARD_GAP <= idealTop);
      if (lane === -1) {
        if (laneBottoms.length < MAX_LANES) {
          lane = laneBottoms.length;
          laneBottoms.push(-Infinity);
        } else {
          lane = laneBottoms.indexOf(Math.min(...laneBottoms));
        }
      }
      const top = Math.max(idealTop, laneBottoms[lane] + CARD_GAP);
      laneBottoms[lane] = top + CARD_HEIGHT;
      return { ev, top, idealTop, lane };
    });
    return { laid, laneCount: Math.max(1, laneBottoms.length) };
  }

  // ─── Render compare view ───
  let axis, timelinesData, activeCategory = 'all', searchQuery = '';
  const factionByTimeline = {};

  function renderCompareView(timelines) {
    timelinesData = timelines;
    axis = computeAxis(timelines);
    timelines.forEach(t => { factionByTimeline[t.id] = 'all'; });

    function yearToY(year) { return (year - axis.unionStart) * axis.pxPerYear; }

    renderSelectedChips();
    renderOverlapBanner();
    renderCategoryFilters(timelines);
    bindSearchBox();
    renderGrid(timelines, yearToY);

    if (axis.hasOverlap) {
      requestAnimationFrame(() => {
        const scrollEl = document.getElementById('cmp-grid-scroll');
        const midY = yearToY((axis.overlapStart + axis.overlapEnd) / 2);
        scrollEl.scrollTop = Math.max(0, midY - scrollEl.clientHeight / 2);
      });
    }
  }

  // ─── Dynamic timeline selection (add/remove without leaving the page) ───
  function updateUrl(ids) {
    history.pushState(null, '', `?t=${ids.join(',')}`);
  }

  async function removeTimelineFromView(id) {
    if (timelinesData.length <= MIN_SEL) return; // ボタン側でも無効化しているが二重防御
    const nextIds = timelinesData.filter(t => t.id !== id).map(t => t.id);
    updateUrl(nextIds);
    renderCompareView(timelinesData.filter(t => t.id !== id));
  }

  async function addTimelineToView(id) {
    if (timelinesData.length >= MAX_SEL) return;
    const added = await loadOneTimeline(allMetaList, id);
    const nextTimelines = [...timelinesData, added];
    updateUrl(nextTimelines.map(t => t.id));
    closeAddPicker();
    renderCompareView(nextTimelines);
  }

  function closeAddPicker() {
    const picker = document.getElementById('add-picker');
    picker.style.display = 'none';
    picker.innerHTML = '';
  }

  function toggleAddPicker() {
    const picker = document.getElementById('add-picker');
    if (picker.style.display !== 'none') { closeAddPicker(); return; }
    const selectedIds = new Set(timelinesData.map(t => t.id));
    const candidates = allMetaList.filter(m => !selectedIds.has(m.id));
    picker.innerHTML = '';
    candidates.forEach(m => {
      const item = mkEl('div', 'add-picker-item');
      item.innerHTML = `<span>${m.name}</span><span class="api-years">${fmtYear(m.startYear)}〜${fmtYear(m.endYear)}</span>`;
      item.onclick = () => addTimelineToView(m.id);
      picker.appendChild(item);
    });
    picker.style.display = '';
  }
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('add-picker');
    if (picker.style.display !== 'none' && !picker.contains(e.target) && e.target.id !== 'chip-add-btn') {
      closeAddPicker();
    }
  });

  function renderSelectedChips() {
    const container = document.getElementById('selected-chips');
    container.innerHTML = '';
    timelinesData.forEach(t => {
      const chip = mkEl('div', 'chip');
      const label = mkEl('span', '', t.meta.name);
      const removeBtn = mkEl('button', 'chip-remove', '✕');
      removeBtn.disabled = timelinesData.length <= MIN_SEL;
      removeBtn.title = removeBtn.disabled ? `最低${MIN_SEL}個は必要です` : `${t.meta.name}を比較から外す`;
      removeBtn.onclick = () => removeTimelineFromView(t.id);
      chip.append(label, removeBtn);
      container.appendChild(chip);
    });
    if (timelinesData.length < MAX_SEL) {
      const addBtn = mkEl('button', 'chip-add-btn', '+ 追加');
      addBtn.id = 'chip-add-btn';
      addBtn.onclick = (e) => { e.stopPropagation(); toggleAddPicker(); };
      container.appendChild(addBtn);
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

  function bindSearchBox() {
    const input = document.getElementById('compare-search');
    input.value = searchQuery;
    let timer;
    input.oninput = (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { searchQuery = e.target.value.trim(); applyFilters(); }, 250);
    };
  }

  function matchesQuery(t, ev, chars) {
    if (!searchQuery) return true;
    const keywords = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return keywords.some(q => {
      const inTitle = ev.title.toLowerCase().includes(q);
      const inDesc = ev.description.toLowerCase().includes(q);
      const inLoc = ev.location.toLowerCase().includes(q);
      const inChar = chars.some(ch => ch.name.includes(q) || (ch.title && ch.title.includes(q)) || (ch.reading && ch.reading.toLowerCase().includes(q)));
      return inTitle || inDesc || inLoc || inChar;
    });
  }

  function applyFilters() {
    document.querySelectorAll('.cmp-card').forEach(card => {
      const matchCat = activeCategory === 'all' || card.dataset.category === activeCategory;
      const tId = card.dataset.timeline;
      const fac = factionByTimeline[tId];
      const matchFaction = fac === 'all' || card.dataset.factions.split(',').includes(fac);
      const matchQuery = matchesQuery(card._timeline, card._event, card._chars);
      card.classList.toggle('dimmed', !(matchCat && matchFaction && matchQuery));
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

      // laid-out cards (レーン式: 同時期の重なりは横並びにするため縦のズレが生じない)
      const { laid, laneCount } = layoutCards(t.events, yearToY);
      const localBottom = laid.length ? Math.max(...laid.map(l => l.top + CARD_HEIGHT)) : 0;
      maxBottom = Math.max(maxBottom, localBottom);
      columnLayouts.push({ t, laid, laneCount });
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
    columnLayouts.forEach(({ t, laid, laneCount }) => {
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

      const laneWidthPct = 100 / laneCount;
      laid.forEach(({ ev, top, lane }) => {
        const card = mkEl('div', 'cmp-card');
        card.style.top = top + 'px';
        card.style.left = `calc(${lane * laneWidthPct}% + 4px)`;
        card.style.width = `calc(${laneWidthPct}% - 8px)`;
        card.dataset.timeline = t.id;
        card.dataset.category = ev.category;
        card.dataset.eventId = ev.id;
        const chars = (ev.characters || []).map(cid => t.characters.find(c => c.id === cid)).filter(Boolean);
        card.dataset.factions = chars.map(c => c.faction).join(',');
        card._timeline = t;
        card._event = ev;
        card._chars = chars;
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

    bindHeaderScrollSync();
    applyFilters();
  }

  // cmp-header は sticky にするため水平スクロールを持てない(overflow-x:hidden)。
  // 実際に横スクロールするのは cmp-grid-scroll 側なので、その scrollLeft を
  // ヘッダーへ同期させることで見た目上は一緒にスクロールしているように見せる。
  function bindHeaderScrollSync() {
    const scrollEl = document.getElementById('cmp-grid-scroll');
    const header = document.getElementById('cmp-header');
    scrollEl.onscroll = () => { header.scrollLeft = scrollEl.scrollLeft; };
  }

  // ─── Modal ───
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

    renderWikiLink(document.getElementById('em-wiki-link'), t.raw.wikiLinks?.events?.[ev.id]);

    const charsEl = document.getElementById('em-chars');
    charsEl.innerHTML = '';
    (ev.characters || []).forEach(cid => {
      const ch = t.characters.find(c => c.id === cid);
      if (!ch) return;
      const tag = mkEl('span', 'tag', ch.name);
      const f = t.factions[ch.faction];
      if (f && f.color) { tag.style.background = f.color; tag.style.color = pickTextColor(f.color); }
      tag.onclick = () => { closeModal('event-modal'); openCharModal(t, ch); };
      charsEl.appendChild(tag);
    });

    document.getElementById('event-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function openCharModal(t, ch) {
    document.getElementById('cm-name').textContent = ch.name;
    const rl = document.getElementById('cm-reading');
    if (ch.reading) { rl.textContent = ch.reading + (ch.title ? `　別名: ${ch.title}` : ''); rl.style.display = ''; }
    else { rl.style.display = 'none'; }
    const ftag = document.getElementById('cm-faction-tag');
    ftag.textContent = t.factions[ch.faction]?.name || ch.faction;
    ftag.className = 'tag';
    const f = t.factions[ch.faction];
    if (f && f.color) { ftag.style.background = f.color; ftag.style.color = pickTextColor(f.color); }
    document.getElementById('cm-role').textContent = ch.role;
    document.getElementById('cm-life').textContent = ch.life ? `（${ch.life}）` : '';
    document.getElementById('cm-desc').textContent = ch.description;
    renderWikiLink(document.getElementById('cm-wiki-link'), t.raw.wikiLinks?.characters?.[ch.id]);

    const trivSec = document.getElementById('cm-trivia-section');
    if (ch.historyTrivia) { document.getElementById('cm-trivia').textContent = ch.historyTrivia; trivSec.style.display = ''; }
    else { trivSec.style.display = 'none'; }

    const eventsEl = document.getElementById('cm-events');
    eventsEl.innerHTML = '';
    const related = t.events.filter(ev => (ev.characters || []).includes(ch.id));
    if (related.length) {
      related.forEach(ev => {
        const tag = mkEl('span', 'tag tag-event', `${fmtYearJa(ev.year)}　${ev.title}`);
        tag.onclick = () => { closeModal('char-modal'); openEventModal(t, ev); };
        eventsEl.appendChild(tag);
      });
    } else {
      eventsEl.innerHTML = '<span style="color:var(--text-dim);font-size:.85rem">関連する出来事はまだ登録されていません</span>';
    }

    document.getElementById('char-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    if (id) { document.getElementById(id).classList.remove('active'); }
    else { document.getElementById('event-modal').classList.remove('active'); document.getElementById('char-modal').classList.remove('active'); }
    document.body.style.overflow = '';
  }
  document.getElementById('em-close').onclick = () => closeModal('event-modal');
  document.getElementById('cm-close').onclick = () => closeModal('char-modal');
  document.getElementById('event-modal').onclick = e => { if (e.target.id === 'event-modal') closeModal('event-modal'); };
  document.getElementById('char-modal').onclick = e => { if (e.target.id === 'char-modal') closeModal('char-modal'); };
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
