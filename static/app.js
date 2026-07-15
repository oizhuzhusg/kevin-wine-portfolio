const state = {
  wines: [],
  lookups: { categories: [], colors: [] },
  purchases: [],
  portfolioTargets: []
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
}

async function renderDashboard() {
  const data = await api("/api/dashboard");
  const colorTargets = data.targets.color_targets;
  const catTargets = data.targets.category_targets;
  $("#dashboard-content").innerHTML = `
    <div class="metric-grid">
      <div class="metric">在库酒款<strong>${data.total_bottles}</strong></div>
      <div class="metric">运输中<strong>${data.ordered_bottles}</strong></div>
      <div class="metric">库存总成本<strong>${money(data.total_cost)}</strong></div>
      <div class="metric">平均单瓶成本<strong>${money(data.average_bottle_cost)}</strong></div>
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
      <h3>近期饮用与即将进入适饮期</h3>
      <div class="table-wrap" id="window-table"></div>
    </div>
  `;
  renderTable($("#window-table"), [
    { label: "Producer", key: "producer" },
    { label: "Wine", key: "wine_name" },
    { label: "Vintage", key: "vintage" },
    { label: "Window", render: r => `${r.drinking_window_start || "-"}-${r.drinking_window_end || "-"}` },
    { label: "Status", key: "window_status" },
    { label: "Stock", render: r => inventoryStatus(r) }
  ], data.entering_window);
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
  const sort = $("#inventory-sort").value;
  const rows = state.wines.filter(w => {
    const text = normalize(`${w.producer} ${w.wine_name} ${w.region} ${w.country} ${w.appellation}`);
    const hasLocation = Boolean(w.storage_unit && w.storage_shelf);
    return (!q || text.includes(q))
      && (!cabinet || (cabinet === "unassigned" ? !hasLocation : w.storage_unit === cabinet))
      && (!color || w.color === color)
      && (!category || w.category_tags.includes(category));
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
    { label: "Rating", render: r => starRating(r.id, r.personal_score) },
    { label: "Status", render: r => inventoryStatus(r) },
    { label: "Location", render: r => storageLocation(r) },
    { label: "Target", key: "target_inventory" },
    { label: "Best Window", render: r => `${r.drinking_window_start || "-"}-${r.drinking_window_end || "-"}` },
    { label: "Now / Decant", render: r => `<span class="hint">${escapeHtml(r.current_drinking_advice || "-")}<br>${escapeHtml(r.decanting_advice || "")}</span>` },
    { label: "参考市价", render: r => money(r.current_market_price_sgd) },
    { label: "参考理想价", render: r => money(r.ideal_price_sgd) },
    { label: "最高可接受价", render: r => money(r.max_price_sgd) }
  ], rows);
  renderMobileInventory(rows);
  $$(".star").forEach(button => {
    button.addEventListener("click", async () => {
      await api(`/api/wines/${button.dataset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personal_score: Number.parseInt(button.dataset.value, 10) })
      });
      toast("评分已更新");
      await refreshAll();
    });
  });
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
          <div class="mobile-detail-row"><span>状态 / 目标</span><span>${inventoryStatus(wine)} / ${wine.target_inventory || 0}</span></div>
          <div class="mobile-detail-row"><span>酒柜位置</span><strong>${storageLocation(wine)}</strong></div>
          <div class="mobile-detail-row"><span>评分</span>${starRating(wine.id, wine.personal_score)}</div>
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

function starRating(wineId, score) {
  const rating = Math.max(0, Math.min(5, Math.round(Number(score || 0))));
  return `
    <span class="star-rating" aria-label="${rating} of 5 stars">
      ${[1, 2, 3, 4, 5].map(value => `<button class="star ${value <= rating ? "filled" : ""}" data-id="${wineId}" data-value="${value}" title="${value} 星" type="button">★</button>`).join("")}
    </span>
  `;
}

function inventoryStatus(wine) {
  const delivered = Number(wine.current_inventory || 0);
  const ordered = Number(wine.on_order_inventory || 0);
  const parts = [];
  if (delivered) parts.push(`<span class="stock-status stock-delivered">已到货 ${delivered}</span>`);
  if (ordered) parts.push(`<span class="stock-status stock-ordered">运输中 ${ordered}</span>`);
  return parts.join(" ") || '<span class="hint">无库存</span>';
}

function storageLocation(wine) {
  if (!wine.storage_unit || !wine.storage_shelf) {
    return Number(wine.on_order_inventory || 0) ? '<span class="hint">到货后记录</span>' : '<span class="hint">待记录</span>';
  }
  const row = { front: "前排", back: "后排" }[wine.storage_row] || wine.storage_row;
  const stack = { top: "上层", bottom: "下层" }[wine.storage_stack] || wine.storage_stack;
  const parts = [escapeHtml(wine.storage_unit), `第 ${wine.storage_shelf} 层`];
  if (row) parts.push(escapeHtml(row));
  if (stack) parts.push(escapeHtml(stack));
  if (wine.storage_slot) parts.push(`位置 ${wine.storage_slot}`);
  return `<span class="storage-location">${parts.join(" · ")}</span>`;
}

async function renderPurchases() {
  state.purchases = await api("/api/purchases");
  renderPurchaseTable();
}

function renderPurchaseTable() {
  const query = normalize($("#purchase-search").value);
  const rows = state.purchases.filter(purchase => {
    const text = normalize(`${purchase.producer} ${purchase.wine_name} ${purchase.vintage} ${purchase.merchant}`);
    return !query || text.includes(query);
  });
  renderTable($("#purchase-table"), [
    { label: "Date", key: "purchase_date" },
    { label: "Wine", render: r => `${r.producer} - ${r.wine_name}<br><span class="hint">${r.vintage || ""}</span>` },
    { label: "Merchant", key: "merchant" },
    { label: "Price", render: r => money(r.price_sgd) },
    { label: "Qty", key: "quantity" },
    { label: "Status", render: r => purchaseStatus(r) },
    { label: "Total", render: r => money(r.total_cost) },
    { label: "Reason", key: "purchase_reason" }
  ], rows);
}

function purchaseStatus(purchase) {
  if (purchase.fulfillment_status === "delivered") {
    return '<span class="stock-status stock-delivered">已到货</span>';
  }
  const eta = purchase.estimated_delivery_date ? `预计 ${purchase.estimated_delivery_date}` : "待确认送达";
  return `<span class="stock-status stock-ordered">已下单</span><br><span class="hint">${eta}</span>`;
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

function renderPortfolioTargets() {
  const query = normalize($("#recommendation-search").value);
  const region = $("#recommendation-region").value;
  const color = $("#recommendation-color").value;
  const status = $("#recommendation-status").value;
  const rows = state.portfolioTargets.filter(target => {
    const text = normalize(`${target.producer} ${target.wine_name} ${target.region} ${target.country}`);
    return (!query || text.includes(query)) && (!region || target.region === region) && (!color || target.color === color) && (!status || target.status === status);
  });
  const tasted = state.portfolioTargets.filter(target => target.status === "Tasted").length;
  const approved = state.portfolioTargets.filter(target => target.status === "Approved").length;
  $("#recommendation-summary").innerHTML = `<span>${state.portfolioTargets.length} 推荐</span><span>${new Set(state.portfolioTargets.map(target => target.region)).size} 个产区</span><span>${tasted} 已喝</span><span>${approved} 会回购</span>`;
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

async function refreshAll() {
  await Promise.all([renderDashboard(), loadWines(), renderPurchases(), loadPortfolioTargets()]);
}

function wireEvents() {
  $$(".tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    $$(".view").forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    $(`#${tab.dataset.view}`).classList.add("active");
  }));
  $('[data-action="refresh"]').addEventListener("click", refreshAll);
  $("#inventory-search").addEventListener("input", renderInventory);
  $("#filter-cabinet").addEventListener("change", renderInventory);
  $("#filter-color").addEventListener("change", renderInventory);
  $("#filter-category").addEventListener("change", renderInventory);
  $("#inventory-sort").addEventListener("change", renderInventory);
  $("#purchase-search").addEventListener("input", renderPurchaseTable);
  $("#recommendation-search").addEventListener("input", renderPortfolioTargets);
  $("#recommendation-region").addEventListener("change", renderPortfolioTargets);
  $("#recommendation-color").addEventListener("change", renderPortfolioTargets);
  $("#recommendation-status").addEventListener("change", renderPortfolioTargets);

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
