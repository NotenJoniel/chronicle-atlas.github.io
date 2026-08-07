/**
 * Chronicle Atlas — 横串ビュー（地域別俯瞰）
 * data/index.json + data/digest.json（軽量ダイジェスト）で初期描画し、
 * カードクリック時だけ該当タイムラインの実JSONを遅延fetchしてモーダルに使う。
 * 「列＝地域」固定で、1列の中に複数タイムラインの出来事を年代でつなげて表示する点が
 * compare/compare.js（列＝選択タイムライン）と異なる。レーン衝突回避・フィルタ・
 * モーダル描画のロジックは compare/compare.js から複製・改変している
 * （G4の判断を踏襲し shared/ への抽出はしない）。
 */
document.addEventListener('DOMContentLoaded', () => {
  const REGIONS = [
    { id: 'japan', name: '日本', icon: '⛩️' },
    { id: 'china', name: '北・東アジア', icon: '🐉' },
    { id: 'europe', name: 'ヨーロッパ', icon: '🏛️' },
    { id: 'others', name: 'その他の地域', icon: '🌍' },
  ];

  // 人物一覧（勢力順/分野順トグル・分野フィルタ）は shared/timeline-core.js の
  // renderSidebar と同じ判断基準（.agents/FIELD_TAXONOMY.md）を用いる。全時代共通の
  // 固定8分類なので、そちらと同様にここでも定義する（データ層ではなく表示定義）。
  const FIELD_LABELS = {
    governance: '統治', military: '軍事', administration: '行政・法',
    thought: '思想・信仰', scholarship: '学術・技術', arts: '芸術', commerce: '経済・交易'
  };
  const FIELD_ORDER = ['governance', 'military', 'administration', 'thought', 'scholarship', 'arts', 'commerce', 'other'];
  function fieldGroupLabel(f) { return f === 'other' ? 'その他' : FIELD_LABELS[f]; }

  let allMetaList = [];
  let digest = null;
  let regionGroups = []; // { region, timelines: [meta,...], events: [{...digestEv, timelineId, timelineName}] }
  let axis = null;
  let activeCategory = 'all';
  let searchQuery = '';
  const hiddenTimelines = new Set(); // OR絞り込みで非表示にしたタイムラインID
  const loadedCache = {}; // timelineId -> full timeline JSON（モーダル用の遅延fetchキャッシュ）
  let peopleEntries = {}; // timelineId -> サイドバー内の該当<details>（時代を選択のチェックと連動）
  let openEraIds = new Set(); // サイドバー再描画をまたいで開閉状態を保つ時代ID
  // 人物一覧の勢力順/分野順トグルと分野フィルタは詳細タイムラインと同じくサイドバー全体で1つ
  // （時代ごとに個別設定はしない）。selectedCharsは`${timelineId}::${charId}`で名前空間化する
  // （DESIGN.md §7 G1の横串マージ規約に従う。人物IDがタイムラインをまたいで重複するケースがあるため）。
  const personState = { groupBy: 'faction', field: 'all' };
  const selectedChars = new Set();

  async function boot() {
    const [indexData, digestData] = await Promise.all([
      fetch(`../data/index.json?t=${Date.now()}`).then(r => r.json()),
      fetch(`../data/digest.json?t=${Date.now()}`).then(r => r.json()),
    ]);
    allMetaList = indexData.timelines;
    digest = digestData;

    regionGroups = REGIONS.map(region => {
      const timelines = allMetaList.filter(m => m.region === region.id).sort((a, b) => a.startYear - b.startYear);
      const events = [];
      timelines.forEach(t => {
        const evs = (digest.timelines[t.id] && digest.timelines[t.id].events) || [];
        evs.forEach(ev => events.push({ ...ev, timelineId: t.id, timelineName: t.name }));
      });
      events.sort((a, b) => a.year - b.year);
      return { region, timelines, events, labelLanes: assignLabelLanes(timelines) };
    });

    axis = computeAxis(regionGroups);
    applyZoomToDOM();
    renderZoomToggle();
    renderCategoryFilters();
    bindSearchBox();
    renderPeopleSidebar();
    bindSidebarToggle();
    renderGrid();
  }

  // 詳細タイムラインの btn-toggle-sidebar と同じ役割（表示/非表示の切替のみ。
  // この画面はモバイルでもサイドバーを通常フローで縦に積むため、ドロワー演出は不要）。
  function bindSidebarToggle() {
    const btn = document.getElementById('btn-toggle-sidebar');
    const sidebar = document.getElementById('sidebar');
    let visible = true;
    btn.onclick = () => {
      visible = !visible;
      sidebar.classList.toggle('hidden', !visible);
      btn.classList.toggle('active', visible);
    };
  }

  // ─── Axis / layout math ───
  // 密度連動の可変軸: 一律px/年ではなく、BUCKET_YEARS刻みのバケツごとに高さを変える。
  // バケツの高さは「時間経過を示す最低限の床(MIN_PX_PER_YEAR)」+「密度ボーナス」の2項。
  // 密度は「4地域の出来事数の合計」ではなく「最も出来事が多い地域列の件数(maxCount)」で測る
  // ——地域列は横に並ぶ（縦に積まれない）ため、ある時間帯に必要な高さは「その時間帯で
  // 最も混んでいる1列がどれだけ場所を必要とするか」で決まるべきで、他地域の件数を
  // 合算すると単独地域だけが密集している時代（例: 古代エジプト新王国時代）が
  // 逆に一律スケールより窮屈になってしまう（実装前にnode scriptで両方式を検証済み）。
  // 生の高さ合計をTARGET_TOTAL_PXへ正規化するため、絶対値ではなくMIN_PX_PER_YEARと
  // PX_PER_EVENTの相対的な比率が本質的なチューニング対象になり、タイムラインが増減しても
  // 総スクロール量が暴走しない。
  const BUCKET_YEARS = 25;
  const MIN_PX_PER_YEAR = 0.2;
  const PX_PER_EVENT = 28;
  const TARGET_TOTAL_PX = 26000;

  function computeAxis(groups) {
    const allYears = allMetaList.flatMap(m => [m.startYear, m.endYear]);
    const unionStart = Math.min(...allYears);
    const unionEnd = Math.max(...allYears);
    const spanYears = Math.max(1, unionEnd - unionStart);

    // 地域ごとの出来事の年だけを取り出しておく（バケツごとにフィルタする際に使う）
    const yearsByRegion = groups.map(g => g.events.map(e => e.year));

    const bucketCount = Math.ceil(spanYears / BUCKET_YEARS);
    const rawHeights = new Array(bucketCount);
    let rawTotal = 0;
    for (let i = 0; i < bucketCount; i++) {
      const bStart = unionStart + i * BUCKET_YEARS;
      const bEnd = Math.min(bStart + BUCKET_YEARS, unionEnd);
      const bYears = bEnd - bStart;
      let maxCount = 0;
      yearsByRegion.forEach(years => {
        const cnt = years.reduce((n, y) => (y >= bStart && y < bEnd ? n + 1 : n), 0);
        if (cnt > maxCount) maxCount = cnt;
      });
      const h = bYears * MIN_PX_PER_YEAR + maxCount * PX_PER_EVENT;
      rawHeights[i] = h;
      rawTotal += h;
    }
    const scale = rawTotal > 0 ? TARGET_TOTAL_PX / rawTotal : 1;

    // 累積Y座標（正規化後・ズーム倍率適用前）を前計算しておき、yearToYはO(1)で引く
    const cumY = new Array(bucketCount + 1);
    cumY[0] = 0;
    for (let i = 0; i < bucketCount; i++) cumY[i + 1] = cumY[i] + rawHeights[i] * scale;

    return { unionStart, unionEnd, spanYears, bucketCount, cumY };
  }

  function computeYearStep(spanYears) {
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (const s of steps) { if (spanYears / s <= 30) return s; }
    return 1000;
  }

  // 時代の枠のスティッキーラベル同士が衝突しないようにする横方向のレーン割当。
  // カードは全域幅のまま変更しない（帯の背景とラベルだけをこのレーンでずらす）。
  // 実データ上、同じ地域内でタイムラインの期間が重なるのは稀（中国=後漢末期と三国時代、
  // ヨーロッパ=古代ギリシア/ヘレニズムと共和政ローマ/ローマ帝国）だが、そのままだと
  // 両者のラベルが画面上部で完全に重なって読めなくなるため、「開始時点で空いている
  // レーンのうち、最も直近に終わったレーン」を選ぶ貪欲法で割り当てる。lineageのような
  // 時代固有のハードコードなしに、同一系統の時代が自然に同じレーンを引き継ぐ。
  function assignLabelLanes(timelines) {
    const sorted = [...timelines].sort((a, b) => a.startYear - b.startYear);
    const laneEnds = [];
    const laneOf = new Map();
    sorted.forEach(t => {
      let bestLane = -1, bestEnd = -Infinity;
      laneEnds.forEach((end, i) => { if (end <= t.startYear && end > bestEnd) { bestEnd = end; bestLane = i; } });
      if (bestLane === -1) { bestLane = laneEnds.length; laneEnds.push(t.endYear); }
      else { laneEnds[bestLane] = t.endYear; }
      laneOf.set(t.id, bestLane);
    });
    return laneOf;
  }

  // ─── Zoom levels（小/中/大）───
  // heightMul: yearToYの最終出力に掛ける倍率。cardHeight: レーン衝突判定・カードCSSの両方で
  // 揃える必要がある値。colWidth: 地域列の幅（CSS変数 --cx-col-width 経由でCSSに渡す）。
  const ZOOM_LEVELS = {
    small: { heightMul: 0.6, cardHeight: 34, colWidth: 420 },
    medium: { heightMul: 1.0, cardHeight: 42, colWidth: 600 },
    large: { heightMul: 1.7, cardHeight: 58, colWidth: 780 },
  };
  let zoomLevel = 'medium';
  function currentZoom() { return ZOOM_LEVELS[zoomLevel]; }

  const CARD_GAP = 4, MAX_LANES = 6;

  // 同時期に重なる出来事はレーンで横に並べる（compare/compare.js の layoutCards と同一ロジック）。
  function layoutCards(events, yearToY) {
    const cardHeight = currentZoom().cardHeight;
    const laneBottoms = [];
    const laid = [];
    const clusters = [];
    let clusterStart = 0;

    events.forEach(ev => {
      const idealTop = yearToY(ev.year);
      if (laneBottoms.length > 0 && Math.max(...laneBottoms) + CARD_GAP <= idealTop) {
        clusters.push({ start: clusterStart, end: laid.length, laneCount: laneBottoms.length });
        laneBottoms.length = 0;
        clusterStart = laid.length;
      }
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
      laneBottoms[lane] = top + cardHeight;
      laid.push({ ev, top, idealTop, lane });
    });
    if (laneBottoms.length > 0) clusters.push({ start: clusterStart, end: laid.length, laneCount: laneBottoms.length });

    clusters.forEach(c => {
      for (let i = c.start; i < c.end; i++) laid[i].clusterLaneCount = c.laneCount;
    });

    const laneCount = Math.max(1, ...clusters.map(c => c.laneCount));
    return { laid, laneCount };
  }

  function fmtYear(y) { return y < 0 ? `BC${-y}` : `AD${y}`; }
  function fmtYearJa(y) { return y < 0 ? `紀元前${-y}年` : `${y}年`; }

  // バケツ内を線形補間してO(1)で年→Yを求める。ズーム倍率はここで最後に掛けるので、
  // ズーム切り替え時にバケツを再計算する必要はない（renderGrid()の再実行だけで済む）。
  function yearToY(year) {
    const { unionStart, bucketCount, cumY } = axis;
    let i = Math.floor((year - unionStart) / BUCKET_YEARS);
    if (i < 0) i = 0;
    if (i >= bucketCount) i = bucketCount - 1;
    const bStart = unionStart + i * BUCKET_YEARS;
    const bEnd = Math.min(bStart + BUCKET_YEARS, axis.unionEnd);
    const frac = bEnd > bStart ? Math.min(1, Math.max(0, (year - bStart) / (bEnd - bStart))) : 0;
    const y = cumY[i] + (cumY[i + 1] - cumY[i]) * frac;
    return y * currentZoom().heightMul;
  }

  // ─── Zoom toggle（小/中/大）───
  // カード幅（.cx-region-name / .cx-col）はCSS変数 --cx-col-width 経由でCSS側に渡す。
  // 縦軸のスケール（heightMul）とカード高さ（cardHeight、レーン判定用）は yearToY /
  // layoutCards が currentZoom() を都度参照するので、renderGrid() を呼び直すだけで反映される。
  function applyZoomToDOM() {
    document.body.style.setProperty('--cx-col-width', currentZoom().colWidth + 'px');
    document.body.dataset.cxZoom = zoomLevel;
  }

  function setZoom(level) {
    if (zoomLevel === level) return;
    zoomLevel = level;
    applyZoomToDOM();
    renderZoomToggle();
    renderGrid();
  }

  function renderZoomToggle() {
    const container = document.getElementById('zoom-toggle');
    if (!container) return;
    container.innerHTML = '';
    [['small', '小'], ['medium', '中'], ['large', '大']].forEach(([key, label]) => {
      const btn = mkEl('button', 'filter-btn' + (zoomLevel === key ? ' active' : ''), label);
      btn.title = `表示サイズ: ${label}`;
      btn.onclick = () => setZoom(key);
      container.appendChild(btn);
    });
  }

  // ─── Filters ───
  function renderCategoryFilters() {
    const container = document.getElementById('category-filters');
    container.innerHTML = '';
    const allBtn = mkEl('button', 'filter-btn active', '全カテゴリ');
    allBtn.onclick = () => setCategory('all', allBtn);
    container.appendChild(allBtn);
    Object.values(digest.categories).forEach(c => {
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
    const input = document.getElementById('cx-search');
    let timer;
    input.oninput = (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { searchQuery = e.target.value.trim().toLowerCase(); applyFilters(); }, 250);
    };
  }

  function matchesQuery(ev) {
    if (!searchQuery) return true;
    return ev.title.toLowerCase().includes(searchQuery) || (ev.location || '').toLowerCase().includes(searchQuery);
  }

  // サイドバーで人物を選択した場合、その人物が関わる出来事だけに絞り込む
  // （詳細タイムラインの selectedChars と同じ動作）。timelineId::charId で
  // 名前空間化しているため、同名/同ID人物が別タイムラインに存在しても混同しない。
  function matchesChars(ev) {
    if (!selectedChars.size) return true;
    return (ev.characters || []).some(cid => selectedChars.has(`${ev.timelineId}::${cid}`));
  }

  function toggleTimeline(timelineId, checked) {
    if (checked) hiddenTimelines.delete(timelineId); else hiddenTimelines.add(timelineId);
    applyFilters();
  }

  // フィルタは軸・レーン配置を一切再計算しない（`.dimmed` の付け外しのみ）。
  // これにより地域列をまたいだ年軸の位置ズレ＝横串ビューの意義そのものが、
  // フィルタ操作中も絶対に崩れない（compare/compare.js の applyFilters と同じ方式）。
  function applyFilters() {
    document.querySelectorAll('.cx-card').forEach(card => {
      const matchCat = activeCategory === 'all' || card.dataset.category === activeCategory;
      const matchTimeline = !hiddenTimelines.has(card.dataset.timeline);
      const matchQuery = matchesQuery(card._event);
      const matchChar = matchesChars(card._event);
      card.classList.toggle('dimmed', !(matchCat && matchTimeline && matchQuery && matchChar));
    });
  }

  // ─── Render ───
  function renderGrid() {
    const header = document.getElementById('cx-header');
    const grid = document.getElementById('cx-grid');
    header.innerHTML = '';
    grid.innerHTML = '';

    header.appendChild(mkEl('div', 'cx-year-label', '年代'));

    const cardHeight = currentZoom().cardHeight;
    let maxBottom = yearToY(axis.unionEnd);
    const columnLayouts = regionGroups.map(g => {
      const { laid } = layoutCards(g.events, yearToY);
      const localBottom = laid.length ? Math.max(...laid.map(l => l.top + cardHeight)) : 0;
      maxBottom = Math.max(maxBottom, localBottom);
      return { g, laid };
    });

    const totalPx = maxBottom + 20;
    grid.style.height = totalPx + 'px';

    // header cells
    regionGroups.forEach(g => renderRegionHeader(header, g));

    // year column
    const yearCol = mkEl('div', 'cx-year-col');
    yearCol.style.height = totalPx + 'px';
    const step = computeYearStep(axis.spanYears);
    for (let y = Math.ceil(axis.unionStart / step) * step; y <= axis.unionEnd; y += step) {
      const mark = mkEl('div', y % (step * 5) === 0 ? 'cx-year-mark century' : 'cx-year-mark', fmtYear(y));
      mark.style.top = yearToY(y) + 'px';
      yearCol.appendChild(mark);
    }
    grid.appendChild(yearCol);

    // grid lines
    for (let y = Math.ceil(axis.unionStart / step) * step; y <= axis.unionEnd; y += step) {
      const line = mkEl('div', 'cx-grid-line' + (y % (step * 5) === 0 ? ' major' : ''));
      line.style.top = yearToY(y) + 'px';
      line.style.left = '70px';
      grid.appendChild(line);
    }

    // region columns
    columnLayouts.forEach(({ g, laid }) => {
      const col = mkEl('div', 'cx-col' + (g.timelines.length === 0 ? ' placeholder' : ''));
      col.style.height = totalPx + 'px';

      if (g.timelines.length === 0) {
        const msg = mkEl('div', 'placeholder-msg', '準備中...');
        col.appendChild(msg);
        grid.appendChild(col);
        return;
      }

      // 時代の枠（トップページのera-blockと同じ「どこからどこまでがその時代か」を示す
      // 背景の帯 + スクロール追従ラベル）。色は時代固有のハードコードをせず、交互の
      // 濃淡だけで隣接する時代を視覚的に区切る。ヨーロッパ（古代ギリシア/ヘレニズムと
      // 共和政ローマ/ローマ帝国が並行）や中国（三国時代が後漢の末期と重なる）のように
      // 実データ上タイムラインの期間が重なる場合は、帯を素直に重ねて描く（半透明同士が
      // 重なることで「ここは2つの時代の期間が重なっている」がむしろ視覚的に伝わる）。
      g.timelines.forEach((t, i) => {
        const lane = g.labelLanes.get(t.id) || 0;
        const band = mkEl('div', 'cx-era-band' + (lane % 2 === 1 ? ' alt' : ''));
        const top = yearToY(t.startYear);
        const bottom = yearToY(t.endYear);
        band.style.top = top + 'px';
        band.style.height = Math.max(bottom - top, 0) + 'px';
        const label = mkEl('div', 'cx-era-label', `${t.name}（${fmtYear(t.startYear)}〜${fmtYear(t.endYear)}）`);
        // 同じ地域内でタイムラインの期間が重なる場合（後述のassignLabelLanes参照）、
        // スクロール追従ラベル同士が同じ位置に重なって読めなくならないよう、
        // レーンごとに横位置をずらす（帯の背景・カードの幅は一切変えない）。
        if (lane > 0) label.style.marginLeft = (lane * 200) + 'px';
        band.appendChild(label);
        col.appendChild(band);
      });

      laid.forEach(({ ev, top, lane, clusterLaneCount }) => {
        const card = mkEl('div', 'cx-card');
        const laneWidthPct = 100 / clusterLaneCount;
        card.style.top = top + 'px';
        card.style.left = `calc(${lane * laneWidthPct}% + 4px)`;
        card.style.width = `calc(${laneWidthPct}% - 8px)`;
        if (ev.color) card.style.borderLeftColor = ev.color;
        card.dataset.timeline = ev.timelineId;
        card.dataset.category = ev.category;
        card._event = ev;

        const cat = digest.categories[ev.category];
        const top1 = mkEl('div', 'cc-top');
        top1.innerHTML = `<span class="cc-year">${fmtYearJa(ev.year)}</span><span>${cat ? cat.icon : ''}</span>`;
        const titleEl = mkEl('div', 'cc-title', ev.title);
        card.append(top1, titleEl);
        card.title = ev.title;

        card.onclick = () => openEventModalFor(ev);
        col.appendChild(card);
      });

      grid.appendChild(col);
    });

    bindHeaderScrollSync();
    applyFilters();
  }

  function renderRegionHeader(header, g) {
    const rn = mkEl('div', 'cx-region-name' + (g.timelines.length === 0 ? ' placeholder' : ''));
    const title = mkEl('div', 'rn-title');
    title.innerHTML = `<span>${g.region.icon}</span> ${g.region.name}`;
    rn.appendChild(title);

    if (g.timelines.length > 0) {
      const rangeStart = Math.min(...g.timelines.map(t => t.startYear));
      const rangeEnd = Math.max(...g.timelines.map(t => t.endYear));
      rn.appendChild(mkEl('div', 'rn-sub', `${g.timelines.length}件のタイムライン ・ ${fmtYear(rangeStart)}〜${fmtYear(rangeEnd)}`));
      rn.appendChild(renderTimelineToggle(g));
    } else {
      rn.appendChild(mkEl('div', 'rn-sub', '準備中'));
    }
    header.appendChild(rn);
  }

  function renderTimelineToggle(g) {
    const details = document.createElement('details');
    details.className = 'cx-timeline-toggle';
    const summary = document.createElement('summary');
    const shownCount = g.timelines.filter(t => !hiddenTimelines.has(t.id)).length;
    summary.textContent = `時代を選択（${shownCount}/${g.timelines.length}）`;
    details.appendChild(summary);

    const list = mkEl('div', 'tt-list');
    g.timelines.forEach(t => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !hiddenTimelines.has(t.id);
      cb.onchange = () => {
        toggleTimeline(t.id, cb.checked);
        // 選択した時代の人物のみ表示: チェックを外した時代の人物一覧（サイドバー側の
        // 該当エントリ）を隠す。要素自体は残すので、開閉状態を保ったままチェックを
        // 戻せば復活する。
        if (peopleEntries[t.id]) peopleEntries[t.id].style.display = cb.checked ? '' : 'none';
        summary.textContent = `時代を選択（${g.timelines.filter(tt => !hiddenTimelines.has(tt.id)).length}/${g.timelines.length}）`;
      };
      label.append(cb, document.createTextNode(`${t.name}（${fmtYear(t.startYear)}〜${fmtYear(t.endYear)}）`));
      list.appendChild(label);
    });
    details.appendChild(list);
    return details;
  }

  // 人物一覧は詳細タイムラインと同じ「画面左に1つだけ」のサイドバーに統一する
  // （地域ごとの列内には作らない）。勢力順/分野順トグルと分野フィルタは詳細タイムライン
  // と同じくサイドバー全体で1つ（時代ごとには置かない — 時代ごとに切り替える場面は
  // 想定しにくいため）。フィルタ状態が変わったら地域→時代の階層ごとサイドバー全体を
  // 再描画するが、時代の開閉状態（openEraIds）だけは再描画をまたいで保持する。
  function renderPeopleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.innerHTML = '';
    peopleEntries = {};

    // 全タイムライン分の人物をタイムラインIDつきでまとめる（分野フィルタの選択肢集計・
    // 「分野で絞り込み」選択時の一括選択に使う）。
    const allChars = [];
    regionGroups.forEach(g => g.timelines.forEach(t => {
      const dTimeline = digest.timelines[t.id];
      (dTimeline?.characters || []).forEach(c => allChars.push({ ...c, _timelineId: t.id }));
    }));

    // 人物フィルタ中バー（詳細タイムラインの sidebar-clear-bar と同じ）
    const clearBar = mkEl('div', 'sidebar-clear-bar');
    clearBar.innerHTML = '<span>🔍 人物フィルタ中</span><button class="clear-char-filter">✕ 解除</button>';
    clearBar.style.display = selectedChars.size ? 'flex' : 'none';
    clearBar.querySelector('button').onclick = () => {
      selectedChars.clear();
      updateSidebarSelectionUI();
      applyFilters();
    };
    sidebar.appendChild(clearBar);

    // 勢力順/分野順トグル（サイドバー全体で1つ）
    const groupToggle = mkEl('div', 'sidebar-group-toggle');
    [['faction', '勢力順'], ['field', '分野順']].forEach(([key, lbl]) => {
      const btn = mkEl('button', 'filter-btn' + (personState.groupBy === key ? ' active' : ''), lbl);
      btn.onclick = () => { personState.groupBy = key; renderPeopleSidebar(); };
      groupToggle.appendChild(btn);
    });
    sidebar.appendChild(groupToggle);

    // 分野フィルタ（サイドバー全体で1つ）。選択すると、既存の人物選択を解除したうえで、
    // 全タイムラインを横断してその分野の人物を一括選択し、出来事カードを絞り込む
    // （詳細タイムラインの分野フィルタと同じ挙動）。
    const presentFields = Object.keys(FIELD_LABELS).filter(f => allChars.some(c => c.field === f));
    if (presentFields.length > 1) {
      const fieldFilter = mkEl('div', 'sidebar-field-filter');
      const select = document.createElement('select');
      select.appendChild(new Option('全分野', 'all'));
      presentFields.forEach(f => select.appendChild(new Option(FIELD_LABELS[f], f)));
      select.value = personState.field;
      select.onchange = () => {
        personState.field = select.value;
        selectedChars.clear();
        if (personState.field !== 'all') {
          allChars.filter(c => c.field === personState.field).forEach(c => selectedChars.add(`${c._timelineId}::${c.id}`));
        }
        renderPeopleSidebar();
        applyFilters();
      };
      fieldFilter.appendChild(mkEl('label', '', '人物を分野で絞り込み'));
      fieldFilter.appendChild(select);
      sidebar.appendChild(fieldFilter);
    }

    regionGroups.forEach(g => {
      if (!g.timelines.length) return;
      const regionHeading = mkEl('div', 'cx-sidebar-region');
      regionHeading.innerHTML = `<span>${g.region.icon}</span> ${g.region.name}`;
      sidebar.appendChild(regionHeading);

      g.timelines.forEach(t => {
        const dTimeline = digest.timelines[t.id] || { characters: [], factions: {} };
        const chars = dTimeline.characters || [];
        const shownCount = chars.filter(c => personState.field === 'all' || c.field === personState.field).length;

        const era = document.createElement('details');
        era.className = 'cx-people-era';
        era.open = openEraIds.has(t.id);
        era.addEventListener('toggle', () => { if (era.open) openEraIds.add(t.id); else openEraIds.delete(t.id); });
        const eraSummary = document.createElement('summary');
        eraSummary.textContent = `${t.name}（${shownCount}人）`;
        era.appendChild(eraSummary);
        era.appendChild(buildPersonList(t, dTimeline));
        era.style.display = hiddenTimelines.has(t.id) ? 'none' : '';

        peopleEntries[t.id] = era;
        sidebar.appendChild(era);
      });
    });
  }

  // 詳細タイムラインのサイドバー（shared/timeline-core.js の renderSidebar）と同じ
  // 見た目・操作感で、1時代分の人物一覧を描く（グルーピング軸・分野フィルタは
  // renderPeopleSidebar側の共有state）。クリックで選択トグル、Ctrl+クリック/右クリックで
  // 人物モーダルを開く点も詳細タイムラインと同じ。
  function buildPersonList(t, dTimeline) {
    const chars = dTimeline.characters || [];
    const wrap = mkEl('div', 'cx-people-era-body');
    if (!chars.length) return wrap;

    const byField = personState.groupBy === 'field';
    const groupIds = byField ? FIELD_ORDER : Object.keys(dTimeline.factions);
    const groupKey = byField ? (c => c.field) : (c => c.faction);
    const groupLabel = byField ? fieldGroupLabel : (gid => dTimeline.factions[gid]?.name || gid);
    const axisLabel = byField ? (c => dTimeline.factions[c.faction]?.name || c.faction) : (c => FIELD_LABELS[c.field] || '');

    groupIds.forEach(gid => {
      const groupChars = chars.filter(c => groupKey(c) === gid && (personState.field === 'all' || c.field === personState.field));
      if (!groupChars.length) return;
      const section = mkEl('div', 'sidebar-section');
      const header = mkEl('div', 'sidebar-header');
      header.innerHTML = `<span>${groupLabel(gid)}（${groupChars.length}）</span><span class="arrow">▼</span>`;
      let collapsed = false;
      const listEl = mkEl('div', 'sidebar-list');
      header.onclick = () => { collapsed = !collapsed; listEl.classList.toggle('hidden', collapsed); header.classList.toggle('collapsed', collapsed); };
      groupChars.forEach(c => {
        const key = `${t.id}::${c.id}`;
        const item = mkEl('div', 'sidebar-char');
        item.dataset.selKey = key;
        if (selectedChars.has(key)) item.classList.add('selected');
        const dot = mkEl('span', 'dot');
        const f = dTimeline.factions[c.faction];
        dot.style.background = (f && f.color) || '#5a5a5a';
        item.appendChild(dot);
        const nameBlock = mkEl('span', 'name-block');
        nameBlock.appendChild(document.createTextNode(c.name));
        if (c.reading && c.reading !== c.name) nameBlock.appendChild(mkEl('span', 'reading', ' ' + c.reading));
        nameBlock.title = c.reading && c.reading !== c.name ? `${c.name}（${c.reading}）` : c.name;
        item.appendChild(nameBlock);
        const axis = axisLabel(c);
        if (axis) { const axisEl = mkEl('span', 'axis-label', axis); axisEl.title = axis; item.appendChild(axisEl); }
        item.onclick = (e) => {
          if (e.ctrlKey || e.metaKey) { openCharModalFor(t.id, c.id); return; }
          if (selectedChars.has(key)) selectedChars.delete(key); else selectedChars.add(key);
          updateSidebarSelectionUI();
          applyFilters();
        };
        item.oncontextmenu = (e) => { e.preventDefault(); openCharModalFor(t.id, c.id); };
        listEl.appendChild(item);
      });
      section.append(header, listEl);
      wrap.appendChild(section);
    });
    return wrap;
  }

  function updateSidebarSelectionUI() {
    const clearBar = document.querySelector('.sidebar-clear-bar');
    if (clearBar) clearBar.style.display = selectedChars.size ? 'flex' : 'none';
    document.querySelectorAll('.sidebar-char').forEach(el => {
      el.classList.toggle('selected', selectedChars.has(el.dataset.selKey));
    });
  }

  // cx-header は横スクロールを持てないので、実際に横スクロールする cx-grid-scroll の
  // scrollLeft をヘッダーへ同期させる（compare/compare.js の bindHeaderScrollSync と同じ）。
  function bindHeaderScrollSync() {
    const scrollEl = document.getElementById('cx-grid-scroll');
    const header = document.getElementById('cx-header');
    scrollEl.onscroll = () => { header.scrollLeft = scrollEl.scrollLeft; };
  }

  // ─── Data loading（モーダル用の遅延fetch） ───
  async function loadOneTimeline(id) {
    if (loadedCache[id]) return loadedCache[id];
    const meta = allMetaList.find(m => m.id === id);
    const raw = await fetch(`../data/${meta.dataFile}?t=${Date.now()}`).then(r => r.json());
    const events = [...raw.events].sort((a, b) => a.year - b.year);
    const obj = { id, meta, raw, events, characters: raw.characters, factions: raw.factions, categories: raw.categories };
    loadedCache[id] = obj;
    return obj;
  }

  async function openEventModalFor(digestEv) {
    const t = await loadOneTimeline(digestEv.timelineId);
    const ev = t.events.find(e => e.id === digestEv.id);
    if (ev) openEventModal(t, ev);
  }

  async function openCharModalFor(timelineId, charId) {
    const t = await loadOneTimeline(timelineId);
    const ch = t.characters.find(c => c.id === charId);
    if (ch) openCharModal(t, ch);
  }

  // ─── Modal（compare/compare.js の openEventModal/openCharModal をほぼそのまま複製） ───
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
