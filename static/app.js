const state = {
  wines: [],
  lookups: { categories: [], colors: [] },
  portfolioTargets: [],
  tastingEvents: [],
  cellarLog: [],
  tastingNotes: [],
  wineMap: { map: null, layers: null, records: [], publicWineries: [], publicQueryKey: "", publicLoading: false, publicTimer: null }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function money(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `SGD ${Number(value).toFixed(0)}`;
}

function pct(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function formDataToJson(form) {
  const data = new FormData(form);
  const obj = {};
  for (const [key, value] of data.entries()) {
    if (obj[key] !== undefined) {
      obj[key] = Array.isArray(obj[key]) ? [...obj[key], value] : [obj[key], value];
    } else {
      obj[key] = value;
    }
  }
  for (const key of Object.keys(obj)) {
    if (obj[key] === "") obj[key] = null;
    if (["vintage", "drinking_window_start", "drinking_window_end", "target_inventory", "current_inventory", "quantity", "wine_id"].includes(key) && obj[key] !== null) {
      obj[key] = Number.parseInt(obj[key], 10);
    }
    if (["ideal_price_sgd", "max_price_sgd", "current_market_price_sgd", "price_sgd", "delivery_fee", "total_cost", "personal_score", "alcohol"].includes(key) && obj[key] !== null) {
      obj[key] = Number.parseFloat(obj[key]);
    }
  }
  return obj;
}

function gradeBadge(grade) {
  return `<span class="pill grade-${grade}">${grade}</span>`;
}

function renderTable(container, columns, rows) {
  if (!rows.length) {
    container.innerHTML = `<p class="hint">暂无数据</p>`;
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr>${columns.map(c => `<th>${c.label}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map(row => `<tr>${columns.map(c => `<td data-label="${escapeHtml(c.label)}">${c.render ? c.render(row) : (row[c.key] ?? "-")}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function loadLookups() {
  state.lookups = await api("/api/lookups");
  for (const select of $$('select[name="color"], #filter-color')) {
    const first = select.id === "filter-color" ? '<option value="">全部颜色</option>' : "";
    select.innerHTML = first + state.lookups.colors.map(c => `<option value="${c}">${c}</option>`).join("");
  }
  $("#filter-category").innerHTML = '<option value="">全部用途</option>' + state.lookups.categories.map(c => `<option value="${c}">${c}</option>`).join("");
  const categoryCheckboxes = $("#category-checkboxes");
  if (categoryCheckboxes) {
    categoryCheckboxes.innerHTML = state.lookups.categories.map(c => `<label><input type="checkbox" name="category_tags" value="${c}" ${c === "Discovery" ? "checked" : ""}> ${c}</label>`).join("");
  }
}

async function loadWines() {
  state.wines = await api("/api/wines");
  renderInventory();
  renderWineMap();
}

async function loadTastingEvents() {
  state.tastingEvents = await api("/api/tasting-events");
  const select = $("#filter-tasting-event");
  if (!select) return;
  const selected = select.value;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = state.tastingEvents.filter(event => event.event_date >= today);
  select.innerHTML = '<option value="">全部酒局</option><option value="planned">已排入近期酒局</option>'
    + upcoming.map(event => `<option value="${event.id}">${escapeHtml(eventLabel(event))}</option>`).join("");
  select.value = [...select.options].some(option => option.value === selected) ? selected : "";
}

async function renderDashboard() {
  const data = await api("/api/dashboard");
  const colorTargets = data.targets.color_targets;
  const catTargets = data.targets.category_targets;
  $("#dashboard-content").innerHTML = `
    <div class="metric-grid">
      <div class="metric">在库酒款<strong>${data.total_bottles}</strong></div>
      <div class="metric">运输中<strong>${data.ordered_bottles}</strong></div>
      <div class="metric">库存估值<strong>${money(data.total_market_value)}</strong><span class="hint">按参考市场价计算</span></div>
      <div class="metric">平均单瓶估值<strong>${money(data.average_market_value)}</strong><span class="hint">已估值 ${data.valued_bottles} 瓶${data.unvalued_bottles ? `；${data.unvalued_bottles} 瓶待补市价` : ""}</span></div>
      <div class="metric">补货类别<strong>${data.replenish.map(r => r.category).join(", ") || "结构健康"}</strong></div>
    </div>
    <div class="bars">
      <div class="panel">
        <h3>红白比例</h3>
        ${Object.entries(colorTargets).map(([color, target]) => bar(color, data.color_percentages[color], target, data.color_counts[color])).join("")}
      </div>
      <div class="panel">
        <h3>用途分类</h3>
        ${Object.entries(catTargets).map(([cat, target]) => bar(cat, data.category_percentages[cat], target, data.category_counts[cat])).join("")}
      </div>
    </div>
    <div class="panel" style="margin-top:16px">
      <h3>优先开瓶</h3>
      <div class="table-wrap" id="window-table"></div>
    </div>
    <div class="panel" style="margin-top:16px">
      <h3>近期酒局</h3>
      <div id="tasting-events"></div>
    </div>
  `;
  renderTable($("#window-table"), [
    { label: "Producer", key: "producer" },
    { label: "Wine", key: "wine_name" },
    { label: "Vintage", key: "vintage" },
    { label: "Window", render: r => `${r.drinking_window_start || "-"}-${r.drinking_window_end || "-"}` },
    { label: "Status", key: "window_status" },
    { label: "Stock", render: r => inventoryStatus(r) }
  ], data.priority_to_open);
  renderTastingEvents();
}

function eventDateLabel(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

function eventLabel(event) {
  return `${eventDateLabel(event.event_date)} ${event.title}`;
}

function renderTastingEvents() {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = state.tastingEvents.filter(event => event.event_date >= today);
  const container = $("#tasting-events");
  if (!upcoming.length) {
    container.innerHTML = '<p class="hint">暂无已安排酒局</p>';
    return;
  }
  container.innerHTML = upcoming.map(event => `
    <article class="tasting-event">
      <div class="tasting-event-head"><strong>${escapeHtml(eventLabel(event))}</strong><span>${event.wines.length} 支</span></div>
      <ol>${event.wines.map(wine => `<li><strong>${wine.serving_order}. ${escapeHtml(wine.producer)} · ${escapeHtml(wine.wine_name)} ${wine.vintage || ""}</strong><span>${wine.bottle_code ? `瓶号 ${escapeHtml(wine.bottle_code)} · ` : ""}${escapeHtml(wine.service_note || "")}</span></li>`).join("")}</ol>
      ${event.notes ? `<p>${escapeHtml(event.notes)}</p>` : ""}
    </article>
  `).join("");
}

function bar(label, current, target, count) {
  return `
    <div class="bar-row">
      <div class="bar-label"><span>${label} (${count || 0})</span><span>${pct(current)} / target ${pct(target)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.round((current || 0) * 100))}%"></div></div>
    </div>
  `;
}

function renderInventory() {
  const q = normalize($("#inventory-search").value);
  const cabinet = $("#filter-cabinet").value;
  const color = $("#filter-color").value;
  const category = $("#filter-category").value;
  const tastingEvent = $("#filter-tasting-event").value;
  const sort = $("#inventory-sort").value;
  const plannedWineIds = new Set(state.tastingEvents.flatMap(event => event.wines.map(wine => Number(wine.wine_id))));
  const rows = state.wines.filter(w => {
    const text = normalize(`${w.producer} ${w.wine_name} ${w.region} ${w.country} ${w.appellation}`);
    const inStockBottles = (w.bottles || []).filter(bottle => bottle.status === "in_stock");
    const hasUnassignedBottle = inStockBottles.some(bottle => !bottle.location_text);
    const isInCabinet = cabinet => inStockBottles.some(bottle =>
      String(bottle.location_text || "").startsWith(cabinet)
    );
    return (Number(w.current_inventory || 0) > 0 || Number(w.on_order_inventory || 0) > 0)
      && (!q || text.includes(q))
      && (!cabinet || (cabinet === "unassigned"
        ? hasUnassignedBottle
        : isInCabinet(cabinet)))
      && (!color || w.color === color)
      && (!category || w.category_tags.includes(category))
      && (!tastingEvent || (tastingEvent === "planned"
        ? plannedWineIds.has(Number(w.id))
        : state.tastingEvents.some(event => String(event.id) === tastingEvent && event.wines.some(wine => Number(wine.wine_id) === Number(w.id)))));
  });
  if (sort !== "default") {
    const direction = sort === "window-asc" ? 1 : -1;
    rows.sort((a, b) => {
      const aHasWindow = Boolean(a.drinking_window_start);
      const bHasWindow = Boolean(b.drinking_window_start);
      if (aHasWindow !== bHasWindow) return aHasWindow ? -1 : 1;
      const aStart = Number(a.drinking_window_start || 0);
      const bStart = Number(b.drinking_window_start || 0);
      const aEnd = Number(a.drinking_window_end || 0);
      const bEnd = Number(b.drinking_window_end || 0);
      return direction * (aStart - bStart || aEnd - bEnd || String(a.producer).localeCompare(String(b.producer)));
    });
  }
  renderTable($("#inventory-table"), [
    { label: "Producer", key: "producer" },
    { label: "Wine", render: r => `${r.wine_name}<br><span class="hint">${r.appellation || r.region || ""}</span>` },
    { label: "Color", key: "color" },
    { label: "Vintage", key: "vintage" },
    { label: "Use", render: r => r.category_tags.map(t => `<span class="tag">${t}</span>`).join("") },
    { label: "Profile", render: r => `<span class="hint">${escapeHtml(r.portfolio_role_reason || "")}<br>${escapeHtml(r.wine_introduction || "")}</span>` },
    { label: "Rating", render: r => scoreDisplay(r.personal_score) },
    { label: "瓶号", render: r => bottleCodes(r) },
    { label: "Status", render: r => inventoryStatus(r) },
    { label: "Location", render: r => storageLocation(r) },
    { label: "Target", key: "target_inventory" },
    { label: "Best Window", render: r => `${r.drinking_window_start || "-"}-${r.drinking_window_end || "-"}` },
    { label: "酒局", render: r => tastingEventLabel(r.id) },
    { label: "Now / Decant", render: r => `<span class="hint">${escapeHtml(r.current_drinking_advice || "-")}<br>${escapeHtml(r.decanting_advice || "")}</span>` },
    { label: "参考市价", render: r => money(r.current_market_price_sgd) },
    { label: "参考理想价", render: r => money(r.ideal_price_sgd) },
    { label: "最高可接受价", render: r => money(r.max_price_sgd) }
  ], rows);
  renderMobileInventory(rows);
}

function tastingEventLabel(wineId) {
  const matches = state.tastingEvents.flatMap(event => event.wines
    .filter(wine => Number(wine.wine_id) === Number(wineId))
    .map(wine => ({ event, wine })));
  if (!matches.length) return '<span class="hint">-</span>';
  return matches.map(({ event, wine }) => `<span class="tasting-plan-tag">${eventDateLabel(event.event_date)} · 第 ${wine.serving_order} 支${wine.bottle_code ? ` · ${escapeHtml(wine.bottle_code)}` : ""}</span>`).join(" ");
}

function renderMobileInventory(rows) {
  const year = new Date().getFullYear();
  $("#inventory-mobile-list").innerHTML = rows.map(wine => {
    const window = `${wine.drinking_window_start || "-"}-${wine.drinking_window_end || "-"}`;
    const drinkingStatus = !wine.drinking_window_start || !wine.drinking_window_end
      ? "适饮期待补充"
      : wine.drinking_window_start > year
        ? `${wine.drinking_window_start} 起适饮`
        : wine.drinking_window_end < year
          ? "已过主要适饮期"
          : "现在适饮";
    return `
      <details class="inventory-mobile-card">
        <summary>
          <span class="mobile-wine-producer">${escapeHtml(wine.producer)}</span>
          <span class="mobile-wine-name">${escapeHtml(wine.wine_name)}</span>
          <span class="mobile-wine-meta">${wine.vintage || "-"} · ${escapeHtml(wine.appellation || wine.region || "")}</span>
          <span class="mobile-wine-tags">${wine.category_tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</span>
          <span class="mobile-window-status">${drinkingStatus}</span>
        </summary>
        <div class="mobile-wine-details">
          <div class="mobile-detail-row"><span>最佳适饮期</span><strong>${window}</strong></div>
          <div class="mobile-detail-row"><span>酒局计划</span><span>${tastingEventLabel(wine.id)}</span></div>
          <div class="mobile-detail-row"><span>状态 / 目标</span><span>${inventoryStatus(wine)} / ${wine.target_inventory || 0}</span></div>
          <div class="mobile-detail-row"><span>酒柜位置</span><strong>${storageLocation(wine)}</strong></div>
          <div class="mobile-detail-row"><span>独立编号</span><strong>${bottleCodes(wine)}</strong></div>
          <div class="mobile-detail-row"><span>评分</span>${scoreDisplay(wine.personal_score)}</div>
          <div class="mobile-detail-block"><span>酒款定位</span><p>${escapeHtml(wine.portfolio_role_reason || "-")}</p></div>
          <div class="mobile-detail-block"><span>酒款介绍</span><p>${escapeHtml(wine.wine_introduction || "-")}</p></div>
          <div class="mobile-detail-block"><span>现在怎么喝</span><p>${escapeHtml(wine.current_drinking_advice || "-")}</p></div>
          <div class="mobile-detail-block"><span>醒酒建议</span><p>${escapeHtml(wine.decanting_advice || "-")}</p></div>
          <div class="mobile-detail-row"><span>参考市价</span><strong>${money(wine.current_market_price_sgd)}</strong></div>
          <div class="mobile-detail-row"><span>参考理想价</span><strong>${money(wine.ideal_price_sgd)}</strong></div>
          <div class="mobile-detail-row"><span>最高可接受价</span><strong>${money(wine.max_price_sgd)}</strong></div>
        </div>
      </details>
    `;
  }).join("");
}

function scoreDisplay(score) {
  if (score === null || score === undefined || score === "") return '<span class="hint">未评分</span>';
  return `<strong class="score">${Number(score).toFixed(1)} / 10</strong>`;
}

function inventoryStatus(wine) {
  const delivered = Number(wine.current_inventory || 0);
  const ordered = Number(wine.on_order_inventory || 0);
  const parts = [];
  if (delivered) parts.push(`<span class="stock-status stock-delivered">已到货 ${delivered}</span>`);
  if (ordered) parts.push(`<span class="stock-status stock-ordered">运输中 ${ordered}</span>`);
  return parts.join(" ") || '<span class="hint">无库存</span>';
}

function bottleCodes(wine) {
  const bottles = wine.bottles || [];
  if (!bottles.length) return '<span class="hint">生成中</span>';
  return bottles.map(bottle => `<span class="bottle-code" title="${escapeHtml(bottle.location_text || bottle.status)}">${escapeHtml(bottle.bottle_code)}</span>`).join(" ");
}

function storageLocation(wine) {
  const storedBottles = (wine.bottles || [])
    .filter(bottle => bottle.status === "in_stock" && bottle.location_text);
  if (storedBottles.length) {
    return `<span class="bottle-location-list">${storedBottles.map(bottle => `
      <span class="bottle-location-item"><code>${escapeHtml(bottle.bottle_code)}</code><span>${escapeHtml(bottle.location_text)}</span></span>
    `).join("")}</span>`;
  }
  if (!wine.storage_unit || !wine.storage_shelf) {
    return Number(wine.on_order_inventory || 0) ? '<span class="hint">到货后记录</span>' : '<span class="hint">待记录</span>';
  }
  const row = { front: "前排", back: "后排" }[wine.storage_row] || wine.storage_row;
  const stack = { top: "上层", upper: "上层", bottom: "下层", lower: "下层" }[wine.storage_stack] || wine.storage_stack;
  const parts = [escapeHtml(wine.storage_unit), `第 ${wine.storage_shelf} 层`];
  if (stack) parts.push(escapeHtml(stack));
  if (row) parts.push(escapeHtml(row));
  if (wine.storage_positions) parts.push(`位置 ${escapeHtml(wine.storage_positions)}`);
  else if (wine.storage_slot) parts.push(`位置 ${wine.storage_slot}`);
  return `<span class="storage-location">${parts.join(" · ")}</span>`;
}

const cellarEventLabel = type => ({
  purchased: "购买 / 下单",
  received: "到货 / 入库",
  moved: "位置变更",
  consumed: "开瓶 / 出库"
}[type] || type);

async function loadCellarLog() {
  state.cellarLog = await api("/api/cellar-log");
  renderCellarLog();
}

function renderCellarLog() {
  const query = normalize($("#cellar-log-search").value);
  const type = $("#cellar-log-type").value;
  const rows = state.cellarLog.filter(record => {
    const text = normalize(`${record.producer} ${record.wine_name} ${record.vintage} ${record.bottle_code} ${record.details}`);
    return (!query || text.includes(query)) && (!type || record.event_type === type);
  });
  renderTable($("#cellar-log-table"), [
    { label: "Date", render: r => eventDateLabel(r.event_date) || "-" },
    { label: "Event", render: r => `<span class="log-event log-${escapeHtml(r.event_type)}">${cellarEventLabel(r.event_type)}</span>` },
    { label: "Producer", key: "producer" },
    { label: "Wine", render: r => `${escapeHtml(r.wine_name || "-")}<br><span class="hint">${r.vintage || ""}</span>` },
    { label: "Qty", render: r => r.quantity || 1 },
    { label: "Bottle", render: r => r.bottle_code ? `<span class="bottle-code">${escapeHtml(r.bottle_code)}</span>` : '<span class="hint">-</span>' },
    { label: "Details", render: r => `<span class="history-note">${escapeHtml(r.details || "-")}</span>` }
  ], rows);
}

const tastingSourceLabel = source => ({ home: "家里开瓶", external: "外出品饮" }[source] || source || "外出品饮");

async function loadTastingNotes() {
  state.tastingNotes = await api("/api/tasting-notes");
  renderTastingNotes();
  renderWineMap();
  if (state.portfolioTargets.length) renderPortfolioTargets();
}

function renderTastingNotes() {
  const query = normalize($("#tasting-note-search").value);
  const rows = state.tastingNotes.filter(note => {
    const text = normalize(`${note.producer} ${note.wine_name} ${note.vintage} ${note.region} ${note.venue} ${note.notes}`);
    return !query || text.includes(query);
  });
  renderTable($("#tasting-note-table"), [
    { label: "Date", render: r => eventDateLabel(r.tasting_date) || '<span class="hint">此前记录</span>' },
    { label: "Context", render: r => `<span class="log-event log-${escapeHtml(r.source || 'external')}">${tastingSourceLabel(r.source)}</span>${r.venue ? `<br><span class="hint">${escapeHtml(r.venue)}</span>` : ""}` },
    { label: "Producer", key: "producer" },
    { label: "Wine", render: r => `${escapeHtml(r.wine_name)}<br><span class="hint">${escapeHtml(r.region || "")} ${r.vintage || ""}</span>` },
    { label: "Rating", render: r => scoreDisplay(r.score) },
    { label: "Tasting Note", render: r => `<span class="history-note">${escapeHtml(r.notes || "-")}</span>` },
    { label: "Again", render: r => r.would_drink_again || '<span class="hint">-</span>' }
  ], rows);
}

async function loadPortfolioTargets() {
  state.portfolioTargets = await api("/api/portfolio-targets");
  const regionSelect = $("#recommendation-region");
  const selectedRegion = regionSelect.value;
  const regions = [...new Set(state.portfolioTargets.map(target => target.region).filter(Boolean))].sort();
  regionSelect.innerHTML = '<option value="">全部产区</option>' + regions.map(region => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join("");
  regionSelect.value = regions.includes(selectedRegion) ? selectedRegion : "";
  renderPortfolioTargets();
}

function targetStatusLabel(status) {
  return { Wishlist: "待尝试", Purchased: "已购买", Tasted: "已喝", Approved: "会回购", Archived: "不再关注" }[status] || status;
}

function targetHasTastingNote(target) {
  const producer = normalize(target.producer);
  const wine = normalize(target.wine_name);
  return state.tastingNotes.some(note => normalize(note.producer) === producer && normalize(note.wine_name) === wine);
}

function renderPortfolioTargets() {
  const query = normalize($("#recommendation-search").value);
  const region = $("#recommendation-region").value;
  const color = $("#recommendation-color").value;
  const activeTargets = state.portfolioTargets.filter(target => target.status === "Wishlist" && !targetHasTastingNote(target));
  const rows = activeTargets.filter(target => {
    const text = normalize(`${target.producer} ${target.wine_name} ${target.region} ${target.country}`);
    return (!query || text.includes(query)) && (!region || target.region === region) && (!color || target.color === color);
  });
  $("#recommendation-summary").innerHTML = `<span>${activeTargets.length} 个待购买推荐</span><span>${new Set(activeTargets.map(target => target.region)).size} 个产区</span><span>已购酒看 Inventory；已喝酒看 Tasting Notes</span>`;
  renderTable($("#recommendation-table"), [
    { label: "Producer", key: "producer" },
    { label: "Wine", render: target => `${target.wine_name}<br><span class="hint">${target.region || ""}</span>` },
    { label: "Region", key: "region" },
    { label: "Color", render: target => target.color === "red" ? "红" : target.color === "white" ? "白" : target.color },
    { label: "Recommended", render: target => target.recommended_vintages || "-" },
    { label: "Target Price", render: target => `${money(target.ideal_price_sgd)}-${money(target.max_price_sgd)}` },
    { label: "Role", key: "role" },
    { label: "Status", render: target => `<select class="target-status" data-id="${target.id}">${["Wishlist", "Purchased", "Tasted", "Approved", "Archived"].map(value => `<option value="${value}" ${value === target.status ? "selected" : ""}>${targetStatusLabel(value)}</option>`).join("")}</select>` },
    { label: "Score", render: target => `<input class="target-score" data-id="${target.id}" type="number" min="0" max="10" step="0.5" value="${target.personal_score ?? ""}" placeholder="-" />` },
    { label: "Notes", render: target => `<textarea class="target-notes" data-id="${target.id}" rows="2" placeholder="品饮笔记">${escapeHtml(target.notes || "")}</textarea>` }
  ], rows);
  $$(".target-status").forEach(input => input.addEventListener("change", () => updatePortfolioTarget(input.dataset.id, { status: input.value }, "状态已更新")));
  $$(".target-score").forEach(input => input.addEventListener("change", () => updatePortfolioTarget(input.dataset.id, { personal_score: input.value === "" ? null : Number.parseFloat(input.value) }, "评分已更新")));
  $$(".target-notes").forEach(input => input.addEventListener("change", () => updatePortfolioTarget(input.dataset.id, { notes: input.value }, "笔记已更新")));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

async function updatePortfolioTarget(id, payload, message) {
  try {
    await api(`/api/portfolio-targets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    toast(message);
    await loadPortfolioTargets();
  } catch (error) {
    toast(error.message);
  }
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

const MAP_COUNTRIES = {
  France: [46.68, 2.55], Italy: [42.83, 12.83], Spain: [40.32, -3.72],
  USA: [38.65, -98.32], "New Zealand": [-41.18, 174.55], Australia: [-25.27, 133.78],
  Argentina: [-38.42, -63.62], "South Africa": [-30.56, 22.94], Germany: [51.17, 10.45],
  Portugal: [39.4, -8.22], Romania: [45.94, 24.97], Chile: [-35.68, -71.54],
  Austria: [47.52, 14.55], Hungary: [47.16, 19.5], Greece: [39.07, 21.82]
};

const MAP_REGION_CENTERS = [
  ["gevrey-chambertin", "热夫雷-香贝丹", 47.226, 4.973, "Burgundy"],
  ["morey-saint-denis", "莫雷-圣但尼", 47.202, 4.985, "Burgundy"],
  ["chambolle-musigny", "香波-慕西尼", 47.19, 4.949, "Burgundy"],
  ["vosne-romanee", "沃恩-罗曼尼", 47.16, 4.955, "Burgundy"],
  ["nuits-saint-georges", "夜圣乔治", 47.137, 4.95, "Burgundy"],
  ["pommard", "波玛", 46.93, 4.79, "Burgundy"],
  ["volnay", "沃尔奈", 46.95, 4.78, "Burgundy"],
  ["meursault", "默尔索", 46.98, 4.77, "Burgundy"],
  ["beaune", "博恩", 47.02, 4.84, "Burgundy"],
  ["burgundy", "勃艮第", 47.15, 4.85, "Burgundy"],
  ["saint-emilion", "圣埃美隆", 44.89, -0.16, "Bordeaux"],
  ["pessac", "佩萨克", 44.78, -0.68, "Bordeaux"],
  ["pauillac", "波亚克", 45.2, -0.77, "Bordeaux"],
  ["bordeaux", "波尔多", 44.84, -0.58, "Bordeaux"],
  ["rhone", "罗讷", 45.07, 4.83, "Rhone"],
  ["saint-joseph", "圣约瑟夫", 45.12, 4.76, "Rhone"],
  ["chateauneuf", "教皇新堡", 44.06, 4.83, "Rhone"],
  ["tuscany", "托斯卡纳", 43.39, 11.16, "Tuscany"],
  ["brunello", "蒙塔奇诺", 43.06, 11.49, "Tuscany"],
  ["veneto", "威尼托", 45.44, 11.01, "Veneto"],
  ["rioja", "里奥哈", 42.46, -2.45, "Rioja"],
  ["ribera", "杜埃罗河岸", 41.63, -3.69, "Ribera del Duero"],
  ["napa", "纳帕谷", 38.5, -122.27, "California"],
  ["sonoma", "索诺玛", 38.44, -122.71, "California"],
  ["california", "加州", 37.25, -119.75, "California"],
  ["waiheke", "怀赫科岛", -36.8, 175.1, "New Zealand"],
  ["hawke", "霍克斯湾", -39.62, 176.82, "New Zealand"],
  ["marlborough", "马尔堡", -41.51, 173.96, "New Zealand"],
  ["new zealand", "新西兰", -41.18, 174.55, "New Zealand"],
  ["barossa", "巴罗萨谷", -34.5, 139.05, "Australia"],
  ["margaret river", "玛格丽特河", -33.95, 115.07, "Australia"],
  ["australia", "澳大利亚", -25.27, 133.78, "Australia"],
  ["mendoza", "门多萨", -33.0, -69.18, "Argentina"],
  ["mosel", "摩泽尔", 49.91, 6.94, "Germany"],
  ["alsace", "阿尔萨斯", 48.25, 7.35, "France"],
  ["dao", "道河", 40.42, -7.93, "Portugal"],
  ["transylvania", "特兰西瓦尼亚", 46.77, 24.7, "Romania"],
  ["stellenbosch", "斯泰伦博斯", -33.93, 18.86, "South Africa"]
];

function mapCountryFor(wine) {
  const known = String(wine.country || "").trim();
  const suppliedCountry = normalize(known);
  if (/^(usa|united states|u s a|u s)$/.test(suppliedCountry)) return "USA";
  if (/^(new zealand|nz)$/.test(suppliedCountry)) return "New Zealand";
  if (/^(south africa|rsa)$/.test(suppliedCountry)) return "South Africa";
  const canonicalCountry = Object.keys(MAP_COUNTRIES).find(country => normalize(country) === suppliedCountry);
  if (canonicalCountry) return canonicalCountry;
  const text = normalize(`${wine.country} ${wine.region} ${wine.appellation} ${wine.producer} ${wine.wine_name}`);
  if (/burgundy|gevrey|morey|chambolle|vosne|nuits|pommard|volnay|meursault|beaune|bordeaux|pauillac|saint emilion|pessac|rhone|chateauneuf|alsace/.test(text)) return "France";
  if (/tuscany|brunello|veneto|amarone|sangiovese|montevertine/.test(text)) return "Italy";
  if (/rioja|ribera|contador|muga|vega sicilia|cvne/.test(text)) return "Spain";
  if (/napa|sonoma|california|mount veeder|realm|caymus|cakebread/.test(text)) return "USA";
  if (/waiheke|hawke|new zealand|stonyridge|bell hill/.test(text)) return "New Zealand";
  if (/barossa|margaret river|australia|penfolds|deep woods|leeuwin|standish/.test(text)) return "Australia";
  if (/mendoza|catena/.test(text)) return "Argentina";
  if (/mosel/.test(text)) return "Germany";
  if (/transylvania|liliac/.test(text)) return "Romania";
  if (/dao|portugal|kemper/.test(text)) return "Portugal";
  if (/stellenbosch|de toren/.test(text)) return "South Africa";
  return known || "Other";
}

function mapLocationFor(wine) {
  const text = normalize(`${wine.region} ${wine.appellation} ${wine.vineyard_or_climat} ${wine.wine_name} ${wine.producer}`);
  const match = MAP_REGION_CENTERS.find(([needle]) => text.includes(needle));
  const country = mapCountryFor(wine);
  if (match) return { lat: match[2], lng: match[3], region: match[4], country };
  const coordinates = MAP_COUNTRIES[country] || [20, 0];
  return { lat: coordinates[0], lng: coordinates[1], region: wine.region || country, country };
}

function mapHash(value) {
  return [...String(value)].reduce((total, char) => ((total << 5) - total) + char.charCodeAt(0), 0) >>> 0;
}

function mapOffset(record) {
  const hash = mapHash(record.producer);
  return [((hash % 17) - 8) * 0.007, (((hash / 17) % 17) - 8) * 0.01];
}

function mapBubbleIcon(value, type) {
  return L.divIcon({
    className: "",
    html: `<span class="map-bubble ${type}">${value}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function publicWineryIcon() {
  return L.divIcon({
    className: "",
    html: '<span class="public-winery-marker"></span>',
    iconSize: [11, 11],
    iconAnchor: [6, 6]
  });
}

function mapRecords() {
  const records = new Map();
  state.wines.forEach(wine => {
    const key = normalize(wine.producer);
    if (!key) return;
    if (!records.has(key)) records.set(key, { producer: wine.producer, wines: [], notes: [] });
    records.get(key).wines.push(wine);
  });
  state.tastingNotes.forEach(note => {
    const key = normalize(note.producer);
    if (!key) return;
    if (!records.has(key)) records.set(key, { producer: note.producer, wines: [], notes: [] });
    records.get(key).notes.push(note);
  });
  return [...records.values()].map(record => {
    const anchor = record.wines[0] || record.notes[0];
    const location = mapLocationFor(anchor);
    const inStock = record.wines.reduce((total, wine) => total + Number(wine.current_inventory || 0), 0);
    const onOrder = record.wines.reduce((total, wine) => total + Number(wine.on_order_inventory || 0), 0);
    return { ...record, ...location, inStock, onOrder, wines: record.wines.sort((a, b) => Number(b.vintage || 0) - Number(a.vintage || 0)) };
  });
}

function filteredMapRecords() {
  const query = normalize($("#wine-map-search").value);
  const country = $("#wine-map-country").value;
  return state.wineMap.records.filter(record => {
    const text = normalize(`${record.producer} ${record.country} ${record.region} ${record.wines.map(wine => `${wine.wine_name} ${wine.appellation}`).join(" ")}`);
    return (!country || record.country === country) && (!query || text.includes(query));
  });
}

function renderMapDetails(record) {
  const container = $("#wine-map-details");
  if (!record) {
    container.innerHTML = `<div class="map-details-empty"><h3>从一杯酒找到一个地方</h3><p>缩放地图：世界视图显示国家和产区；继续放大，可加载地图范围内的公开酒庄。</p><p>酒红色点位是你的酒窖与品鉴足迹，蓝灰色点位来自 OpenStreetMap 的公开酒庄资料。</p></div>`;
    return;
  }
  const noteScores = record.notes.map(note => note.score).filter(score => score !== null && score !== undefined);
  const averageScore = noteScores.length ? (noteScores.reduce((total, score) => total + Number(score), 0) / noteScores.length).toFixed(1) : "-";
  const wineRows = record.wines.slice(0, 8).map(wine => {
    const stock = Number(wine.current_inventory || 0);
    const ordered = Number(wine.on_order_inventory || 0);
    return `<div class="map-wine-row"><strong>${escapeHtml(wine.wine_name)} ${wine.vintage || ""}</strong><span>${escapeHtml(wine.appellation || wine.region || "")} · 在库 ${stock}${ordered ? ` · 运输中 ${ordered}` : ""}</span></div>`;
  }).join("") || '<p class="hint">这家酒庄目前只在品鉴记录中出现。</p>';
  container.innerHTML = `
    <h3>${escapeHtml(record.producer)}</h3>
    <p class="map-subtitle">${escapeHtml(record.region)} · ${escapeHtml(record.country)}</p>
    <div class="map-stat-grid">
      <div class="map-stat"><span>在库</span><strong>${record.inStock}</strong></div>
      <div class="map-stat"><span>运输中</span><strong>${record.onOrder}</strong></div>
      <div class="map-stat"><span>喝过</span><strong>${record.notes.length || "-"}</strong></div>
    </div>
    ${noteScores.length ? `<p class="hint">已记录品鉴平均分：${averageScore}</p>` : ""}
    <div class="map-wine-list">${wineRows}</div>
    <button class="map-detail-link" type="button" data-map-producer="${escapeHtml(record.producer)}">在 Inventory 查看这家酒庄</button>
  `;
  $("[data-map-producer]", container)?.addEventListener("click", () => {
    $("#inventory-search").value = record.producer;
    $("[data-view='inventory']").click();
  });
}

function renderPublicWineryDetails(winery) {
  const container = $("#wine-map-details");
  const personal = state.wineMap.records.find(record => normalize(record.producer) === normalize(winery.name));
  container.innerHTML = `
    <h3>${escapeHtml(winery.name)}</h3>
    <p class="map-subtitle">公开酒庄资料 · OpenStreetMap</p>
    <p class="hint">这个点位来自公开地图资料，代表酒庄或酿造地点，不等同于其拥有的全部葡萄园地块。</p>
    ${personal ? `<button class="map-detail-link" type="button" data-map-personal-producer="${escapeHtml(personal.producer)}">查看我的酒窖记录</button>` : ""}
    <a class="map-detail-link" href="https://www.openstreetmap.org/${encodeURIComponent(winery.id)}" target="_blank" rel="noreferrer">在 OpenStreetMap 查看位置</a>
  `;
  $("[data-map-personal-producer]", container)?.addEventListener("click", () => renderMapDetails(personal));
}

function renderPublicWineryLayer() {
  const { layers } = state.wineMap;
  if (!layers) return;
  layers.public.clearLayers();
  if (!$("#wine-map-all-wineries")?.checked) return;
  const personalProducers = new Set(state.wineMap.records.map(record => normalize(record.producer)));
  state.wineMap.publicWineries
    .filter(winery => !personalProducers.has(normalize(winery.name)))
    .forEach(winery => {
      L.marker([winery.lat, winery.lng], { icon: publicWineryIcon(), keyboard: true })
        .bindTooltip(escapeHtml(winery.name), { direction: "top", offset: [0, -8] })
        .on("click", () => renderPublicWineryDetails(winery))
        .addTo(layers.public);
    });
}

function publicWineryBounds() {
  const bounds = state.wineMap.map?.getBounds();
  if (!bounds) return null;
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const north = bounds.getNorth();
  const east = bounds.getEast();
  if (north - south > 5 || east - west > 5) return null;
  return [south, west, north, east];
}

async function loadPublicWineries() {
  const { map } = state.wineMap;
  if (!map || map.getZoom() < 8 || !$("#wine-map-all-wineries")?.checked) return;
  const bounds = publicWineryBounds();
  if (!bounds) return;
  const queryKey = bounds.map(value => value.toFixed(2)).join(",");
  if (queryKey === state.wineMap.publicQueryKey || state.wineMap.publicLoading) return;
  state.wineMap.publicLoading = true;
  try {
    const data = await api(`/api/world-wineries?bbox=${encodeURIComponent(bounds.join(","))}`);
    state.wineMap.publicWineries = Array.isArray(data.wineries) ? data.wineries : [];
    state.wineMap.publicQueryKey = queryKey;
    renderPublicWineryLayer();
    updateWineMapLayerVisibility();
    renderWineMapSummary();
  } catch (error) {
    toast("公开酒庄资料暂时无法加载");
  } finally {
    state.wineMap.publicLoading = false;
  }
}

function schedulePublicWineryLoad() {
  clearTimeout(state.wineMap.publicTimer);
  state.wineMap.publicTimer = setTimeout(loadPublicWineries, 500);
}

function renderWineMapSummary(records = filteredMapRecords()) {
  const publicCount = state.wineMap.publicWineries.length;
  const publicText = publicCount
    ? ` · 当前范围 ${publicCount} 家公开酒庄`
    : " · 放大地图加载公开酒庄";
  $("#wine-map-summary").textContent = `我的 ${records.length} 家酒庄 · ${new Set(records.map(record => record.region)).size} 个产区${publicText}`;
}

function ensureWineMap() {
  if (state.wineMap.map || !window.L) return;
  const map = L.map("wine-world-map", { scrollWheelZoom: true, minZoom: 2 }).setView([25, 8], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  state.wineMap.map = map;
  state.wineMap.layers = { country: L.layerGroup(), region: L.layerGroup(), producer: L.layerGroup(), public: L.layerGroup() };
  map.on("zoomend", updateWineMapLayerVisibility);
  map.on("moveend", schedulePublicWineryLoad);
  renderMapDetails();
}

function updateWineMapLayerVisibility() {
  const { map, layers } = state.wineMap;
  if (!map || !layers) return;
  Object.values(layers).forEach(layer => map.removeLayer(layer));
  const zoom = map.getZoom();
  if (zoom < 4) layers.country.addTo(map);
  else if (zoom < 7) layers.region.addTo(map);
  else {
    layers.producer.addTo(map);
    if ($("#wine-map-all-wineries")?.checked) layers.public.addTo(map);
  }
}

function rebuildWineMapLayers(records) {
  const { map, layers } = state.wineMap;
  if (!map || !layers) return;
  Object.values(layers).forEach(layer => layer.clearLayers());
  const countryGroups = new Map();
  const regionGroups = new Map();
  records.forEach(record => {
    if (!countryGroups.has(record.country)) countryGroups.set(record.country, []);
    countryGroups.get(record.country).push(record);
    const regionKey = `${record.country}|${record.region}`;
    if (!regionGroups.has(regionKey)) regionGroups.set(regionKey, []);
    regionGroups.get(regionKey).push(record);
    const [latOffset, lngOffset] = mapOffset(record);
    L.marker([record.lat + latOffset, record.lng + lngOffset], { icon: mapBubbleIcon(record.inStock || record.notes.length || 1, "producer") })
      .bindTooltip(escapeHtml(record.producer), { direction: "top", offset: [0, -18] })
      .on("click", () => renderMapDetails(record))
      .addTo(layers.producer);
  });
  countryGroups.forEach((group, country) => {
    const coords = MAP_COUNTRIES[country] || [group[0].lat, group[0].lng];
    L.marker(coords, { icon: mapBubbleIcon(group.length, "country") })
      .bindTooltip(`${escapeHtml(country)} · ${group.length} 家酒庄`, { direction: "top" })
      .on("click", () => map.flyTo(coords, 5, { duration: 0.6 }))
      .addTo(layers.country);
  });
  regionGroups.forEach(group => {
    const first = group[0];
    L.marker([first.lat, first.lng], { icon: mapBubbleIcon(group.length, "region") })
      .bindTooltip(`${escapeHtml(first.region)} · ${group.length} 家酒庄`, { direction: "top" })
      .on("click", () => map.flyTo([first.lat, first.lng], 8, { duration: 0.6 }))
      .addTo(layers.region);
  });
  renderPublicWineryLayer();
  updateWineMapLayerVisibility();
}

function renderWineMap({ fit = false } = {}) {
  if (!$("#wine-world-map")) return;
  ensureWineMap();
  if (!state.wineMap.map) return;
  state.wineMap.records = mapRecords();
  const countrySelect = $("#wine-map-country");
  const selected = countrySelect.value;
  const countries = [...new Set(state.wineMap.records.map(record => record.country))].sort();
  countrySelect.innerHTML = '<option value="">全部国家</option>' + countries.map(country => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join("");
  countrySelect.value = countries.includes(selected) ? selected : "";
  const records = filteredMapRecords();
  renderWineMapSummary(records);
  rebuildWineMapLayers(records);
  if (fit && records.length) {
    const bounds = L.latLngBounds(records.map(record => [record.lat, record.lng]));
    state.wineMap.map.fitBounds(bounds.pad(0.2), { maxZoom: 5 });
  }
}

function resetWineMap() {
  $("#wine-map-search").value = "";
  $("#wine-map-country").value = "";
  renderWineMap();
  state.wineMap.map.setView([25, 8], 2);
  renderMapDetails();
}

async function refreshAll() {
  await loadTastingEvents();
  await Promise.all([renderDashboard(), loadWines(), loadCellarLog()]);
  await loadTastingNotes();
  await loadPortfolioTargets();
}

function wireEvents() {
  $$(".tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".view").forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.view}`).classList.add("active");
    if (tab.dataset.view === "wine-map") {
      setTimeout(() => {
        renderWineMap();
        state.wineMap.map?.invalidateSize();
        schedulePublicWineryLoad();
      }, 0);
    }
  }));
  $('[data-action="refresh"]').addEventListener("click", refreshAll);
  $("#inventory-search").addEventListener("input", renderInventory);
  $("#filter-cabinet").addEventListener("change", renderInventory);
  $("#filter-color").addEventListener("change", renderInventory);
  $("#filter-category").addEventListener("change", renderInventory);
  $("#filter-tasting-event").addEventListener("change", renderInventory);
  $("#inventory-sort").addEventListener("change", renderInventory);
  $("#cellar-log-search").addEventListener("input", renderCellarLog);
  $("#cellar-log-type").addEventListener("change", renderCellarLog);
  $("#tasting-note-search").addEventListener("input", renderTastingNotes);
  $("#recommendation-search").addEventListener("input", renderPortfolioTargets);
  $("#recommendation-region").addEventListener("change", renderPortfolioTargets);
  $("#recommendation-color").addEventListener("change", renderPortfolioTargets);
  $("#wine-map-search").addEventListener("input", () => renderWineMap({ fit: true }));
  $("#wine-map-country").addEventListener("change", () => renderWineMap({ fit: true }));
  $("#wine-map-all-wineries").addEventListener("change", () => {
    renderPublicWineryLayer();
    updateWineMapLayerVisibility();
    schedulePublicWineryLoad();
  });
  $("#wine-map-reset").addEventListener("click", resetWineMap);

}

async function boot() {
  try {
    await loadLookups();
    wireEvents();
    await refreshAll();
  } catch (error) {
    toast(error.message);
    console.error(error);
  }
}

boot();
