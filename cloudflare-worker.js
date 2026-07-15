import seedTargets from "./seed-targets.json";

const CATEGORIES = ["Drink Now", "Cellar", "Business", "Discovery"];
const COLORS = ["red", "white", "sparkling", "sweet", "fortified"];
const FULFILLMENT_STATUSES = ["ordered", "delivered"];
let seedPromise;
let schemaPromise;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS portfolio_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, producer TEXT NOT NULL, wine_name TEXT NOT NULL,
    region TEXT, country TEXT, color TEXT NOT NULL, recommended_vintages TEXT, avoid_vintages TEXT,
    ideal_price_sgd REAL, max_price_sgd REAL, role TEXT NOT NULL DEFAULT 'Discovery',
    stage TEXT NOT NULL DEFAULT 'Ready', status TEXT NOT NULL DEFAULT 'Wishlist', personal_score REAL,
    would_buy_again TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (producer, wine_name))`,
  `CREATE TABLE IF NOT EXISTS wines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, producer TEXT NOT NULL, wine_name TEXT NOT NULL,
    region TEXT, country TEXT, appellation TEXT, vineyard_or_climat TEXT, classification TEXT,
    grape_variety TEXT, color TEXT NOT NULL DEFAULT 'red', vintage INTEGER, drinking_window_start INTEGER,
    drinking_window_end INTEGER, ideal_price_sgd REAL, max_price_sgd REAL, current_market_price_sgd REAL,
    current_inventory INTEGER NOT NULL DEFAULT 0, on_order_inventory INTEGER NOT NULL DEFAULT 0,
    target_inventory INTEGER NOT NULL DEFAULT 1,
    storage_unit TEXT, storage_shelf INTEGER, storage_row TEXT, storage_stack TEXT, storage_slot INTEGER, storage_positions TEXT,
    personal_score REAL, portfolio_role_reason TEXT, wine_introduction TEXT,
    current_drinking_advice TEXT, decanting_advice TEXT,
    category_tags TEXT NOT NULL DEFAULT '[]', style_tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT, wine_id INTEGER NOT NULL, purchase_date TEXT NOT NULL,
    merchant TEXT, price_sgd REAL NOT NULL, quantity INTEGER NOT NULL, delivery_fee REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL, fulfillment_status TEXT NOT NULL DEFAULT 'delivered',
    estimated_delivery_date TEXT, delivered_date TEXT, purchase_reason TEXT, source_file_or_link TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
];

const SCHEMA_UPDATES = [
  "ALTER TABLE wines ADD COLUMN portfolio_role_reason TEXT",
  "ALTER TABLE wines ADD COLUMN wine_introduction TEXT",
  "ALTER TABLE wines ADD COLUMN current_drinking_advice TEXT",
  "ALTER TABLE wines ADD COLUMN decanting_advice TEXT",
  "ALTER TABLE wines ADD COLUMN on_order_inventory INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE purchases ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'delivered'",
  "ALTER TABLE purchases ADD COLUMN estimated_delivery_date TEXT",
  "ALTER TABLE purchases ADD COLUMN delivered_date TEXT",
  "ALTER TABLE wines ADD COLUMN storage_unit TEXT",
  "ALTER TABLE wines ADD COLUMN storage_shelf INTEGER",
  "ALTER TABLE wines ADD COLUMN storage_row TEXT",
  "ALTER TABLE wines ADD COLUMN storage_stack TEXT",
  "ALTER TABLE wines ADD COLUMN storage_slot INTEGER",
  "ALTER TABLE wines ADD COLUMN current_market_price_sgd REAL",
  "ALTER TABLE wines ADD COLUMN storage_positions TEXT"
];

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" }
});

const parseTags = (value) => {
  try { return JSON.parse(value || "[]"); } catch { return []; }
};

function wineFromRow(row) {
  return { ...row, category_tags: parseTags(row.category_tags), style_tags: parseTags(row.style_tags) };
}

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB.batch(SCHEMA_STATEMENTS.map(sql => env.DB.prepare(sql)));
      for (const sql of SCHEMA_UPDATES) {
        try { await env.DB.prepare(sql).run(); }
        catch (error) { if (!String(error.message).includes("duplicate column name")) throw error; }
      }
    })();
  }
  await schemaPromise;
}

async function ensureTargets(env) {
  if (!seedPromise) {
    seedPromise = (async () => {
      const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM portfolio_targets").first();
      if (existing.count) return;
      const sql = `INSERT OR IGNORE INTO portfolio_targets
        (producer, wine_name, region, country, color, recommended_vintages, avoid_vintages, ideal_price_sgd, max_price_sgd, role, stage, status, personal_score, would_buy_again, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const statements = seedTargets.map(target => env.DB.prepare(sql).bind(
        target.producer, target.wine_name, target.region, target.country, target.color,
        target.recommended_vintages, target.avoid_vintages, target.ideal_price_sgd, target.max_price_sgd,
        target.role, target.stage, target.status, target.personal_score, target.would_buy_again, target.notes
      ));
      for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80));
    })();
  }
  await seedPromise;
}

async function requestBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function dashboard(env) {
  const wines = (await env.DB.prepare("SELECT * FROM wines ORDER BY producer, wine_name, vintage DESC").all()).results.map(wineFromRow);
  const purchases = await env.DB.prepare("SELECT COALESCE(SUM(total_cost), 0) AS total, COALESCE(SUM(quantity), 0) AS qty FROM purchases").first();
  const referenceValuation = await env.DB.prepare(`SELECT
      COALESCE(SUM(w.current_market_price_sgd * w.current_inventory), 0) AS total,
      COALESCE(SUM(w.current_inventory), 0) AS qty
    FROM wines w
    WHERE w.current_inventory > 0
      AND w.current_market_price_sgd IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.wine_id = w.id)`).first();
  const totalBottles = wines.reduce((sum, wine) => sum + Number(wine.current_inventory || 0), 0);
  const orderedBottles = wines.reduce((sum, wine) => sum + Number(wine.on_order_inventory || 0), 0);
  const colorCounts = Object.fromEntries(COLORS.map(color => [color, 0]));
  const categoryCounts = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
  for (const wine of wines) {
    colorCounts[wine.color] = (colorCounts[wine.color] || 0) + Number(wine.current_inventory || 0);
    wine.category_tags.forEach(category => categoryCounts[category] = (categoryCounts[category] || 0) + Number(wine.current_inventory || 0));
  }
  const categoryTargets = { "Drink Now": 0.3, Cellar: 0.3, Business: 0.2, Discovery: 0.2 };
  const colorTargets = { red: 0.7, white: 0.3 };
  const year = new Date().getFullYear();
  return {
    total_bottles: totalBottles,
    ordered_bottles: orderedBottles,
    purchase_cost: Number(purchases.total || 0),
    reference_valuation_cost: Number(referenceValuation.total || 0),
    total_cost: Number(purchases.total || 0) + Number(referenceValuation.total || 0),
    average_bottle_cost: (Number(purchases.qty || 0) + Number(referenceValuation.qty || 0))
      ? (Number(purchases.total || 0) + Number(referenceValuation.total || 0)) / (Number(purchases.qty || 0) + Number(referenceValuation.qty || 0))
      : 0,
    color_counts: colorCounts,
    color_percentages: Object.fromEntries(COLORS.map(color => [color, totalBottles ? colorCounts[color] / totalBottles : 0])),
    category_counts: categoryCounts,
    category_percentages: Object.fromEntries(CATEGORIES.map(category => [category, totalBottles ? categoryCounts[category] / totalBottles : 0])),
    replenish: Object.entries(categoryTargets).filter(([category, target]) => totalBottles && (categoryCounts[category] / totalBottles) + 0.03 < target).map(([category, target]) => ({ category, target })),
    entering_window: wines
      .filter(wine => wine.current_inventory && wine.drinking_window_start && wine.drinking_window_end && wine.drinking_window_end >= year && wine.drinking_window_start <= year + 2)
      .map(wine => ({
        ...wine,
        window_status: wine.drinking_window_start <= year ? "现在适饮" : `${wine.drinking_window_start} 起适饮`
      }))
      .sort((a, b) => {
        const aReady = a.drinking_window_start <= year;
        const bReady = b.drinking_window_start <= year;
        if (aReady !== bReady) return aReady ? -1 : 1;
        return aReady
          ? Number(a.drinking_window_end) - Number(b.drinking_window_end)
          : Number(a.drinking_window_start) - Number(b.drinking_window_start);
      }),
    targets: { color_targets: colorTargets, category_targets: categoryTargets }
  };
}

async function api(request, env, pathname) {
  if (pathname === "/api/lookups" && request.method === "GET") return json({ categories: CATEGORIES, colors: COLORS, watchlist: [] });
  if (pathname === "/api/dashboard" && request.method === "GET") return json(await dashboard(env));
  if (pathname === "/api/portfolio-targets" && request.method === "GET") {
    await ensureTargets(env);
    return json((await env.DB.prepare("SELECT * FROM portfolio_targets ORDER BY region, color, producer, wine_name").all()).results);
  }
  if (pathname === "/api/portfolio-targets" && request.method === "POST") {
    const body = await requestBody(request);
    const fields = ["producer", "wine_name", "region", "country", "color", "recommended_vintages", "avoid_vintages", "ideal_price_sgd", "max_price_sgd", "role", "stage", "status", "personal_score", "would_buy_again", "notes"];
    const inventoryDefaults = { current_inventory: 0, on_order_inventory: 0, target_inventory: 1 };
    const values = fields.map(field => body[field] ?? inventoryDefaults[field] ?? null);
    const result = await env.DB.prepare(`INSERT INTO portfolio_targets (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`).bind(...values).run();
    return json(await env.DB.prepare("SELECT * FROM portfolio_targets WHERE id = ?").bind(result.meta.last_row_id).first(), 201);
  }
  const targetMatch = pathname.match(/^\/api\/portfolio-targets\/(\d+)$/);
  if (targetMatch && request.method === "PATCH") {
    const body = await requestBody(request);
    const allowed = ["producer", "wine_name", "region", "country", "color", "recommended_vintages", "avoid_vintages", "ideal_price_sgd", "max_price_sgd", "role", "stage", "status", "personal_score", "would_buy_again", "notes"];
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key));
    if (!entries.length) return json({ error: "No editable fields supplied" }, 400);
    const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
    await env.DB.prepare(`UPDATE portfolio_targets SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...entries.map(([, value]) => value), Number(targetMatch[1])).run();
    return json(await env.DB.prepare("SELECT * FROM portfolio_targets WHERE id = ?").bind(Number(targetMatch[1])).first());
  }
  if (pathname === "/api/wines" && request.method === "GET") return json((await env.DB.prepare("SELECT * FROM wines ORDER BY producer, wine_name, vintage DESC").all()).results.map(wineFromRow));
  if (pathname === "/api/wines" && request.method === "POST") {
    const body = await requestBody(request);
    const fields = ["producer", "wine_name", "region", "country", "appellation", "vineyard_or_climat", "classification", "grape_variety", "color", "vintage", "drinking_window_start", "drinking_window_end", "ideal_price_sgd", "max_price_sgd", "current_market_price_sgd", "current_inventory", "on_order_inventory", "target_inventory", "storage_unit", "storage_shelf", "storage_row", "storage_stack", "storage_slot", "storage_positions", "personal_score", "portfolio_role_reason", "wine_introduction", "current_drinking_advice", "decanting_advice", "notes"];
    const values = fields.map(field => body[field] ?? null);
    values[0] ||= "Unknown"; values[1] ||= "Unnamed wine"; values[8] ||= "red";
    const result = await env.DB.prepare(`INSERT INTO wines (${fields.join(",")}, category_tags, style_tags) VALUES (${fields.map(() => "?").join(",")}, ?, ?)`)
      .bind(...values, JSON.stringify(body.category_tags || ["Discovery"]), JSON.stringify(body.style_tags || [])).run();
    return json(wineFromRow(await env.DB.prepare("SELECT * FROM wines WHERE id = ?").bind(result.meta.last_row_id).first()), 201);
  }
  const wineMatch = pathname.match(/^\/api\/wines\/(\d+)$/);
  if (wineMatch && request.method === "PATCH") {
    const body = await requestBody(request);
    const allowed = ["producer", "wine_name", "region", "country", "appellation", "vineyard_or_climat", "classification", "grape_variety", "color", "vintage", "drinking_window_start", "drinking_window_end", "ideal_price_sgd", "max_price_sgd", "current_market_price_sgd", "current_inventory", "on_order_inventory", "target_inventory", "storage_unit", "storage_shelf", "storage_row", "storage_stack", "storage_slot", "storage_positions", "personal_score", "portfolio_role_reason", "wine_introduction", "current_drinking_advice", "decanting_advice", "notes"];
    const entries = Object.entries(body).filter(([key]) => allowed.includes(key));
    if (body.category_tags) entries.push(["category_tags", JSON.stringify(body.category_tags)]);
    if (body.style_tags) entries.push(["style_tags", JSON.stringify(body.style_tags)]);
    if (!entries.length) return json({ error: "No editable fields supplied" }, 400);
    await env.DB.prepare(`UPDATE wines SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...entries.map(([, value]) => value), Number(wineMatch[1])).run();
    return json(wineFromRow(await env.DB.prepare("SELECT * FROM wines WHERE id = ?").bind(Number(wineMatch[1])).first()));
  }
  if (pathname === "/api/purchases" && request.method === "GET") {
    return json((await env.DB.prepare("SELECT purchases.*, wines.producer, wines.wine_name, wines.vintage FROM purchases JOIN wines ON wines.id = purchases.wine_id ORDER BY purchase_date DESC, purchases.id DESC").all()).results);
  }
  if (pathname === "/api/purchases" && request.method === "POST") {
    const body = await requestBody(request);
    const quantity = Number(body.quantity || 1);
    const total = Number(body.total_cost || (Number(body.price_sgd || 0) * quantity + Number(body.delivery_fee || 0)));
    const fulfillmentStatus = FULFILLMENT_STATUSES.includes(body.fulfillment_status) ? body.fulfillment_status : "ordered";
    const inventoryColumn = fulfillmentStatus === "delivered" ? "current_inventory" : "on_order_inventory";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO purchases (wine_id, purchase_date, merchant, price_sgd, quantity, delivery_fee, total_cost, fulfillment_status, estimated_delivery_date, delivered_date, purchase_reason, source_file_or_link) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(body.wine_id, body.purchase_date, body.merchant || null, body.price_sgd, quantity, body.delivery_fee || 0, total, fulfillmentStatus, body.estimated_delivery_date || null, body.delivered_date || null, body.purchase_reason || null, body.source_file_or_link || null),
      env.DB.prepare(`UPDATE wines SET ${inventoryColumn} = ${inventoryColumn} + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(quantity, body.wine_id)
    ]);
    return json({ ok: true }, 201);
  }
  const purchaseMatch = pathname.match(/^\/api\/purchases\/(\d+)$/);
  if (purchaseMatch && request.method === "PATCH") {
    const existing = await env.DB.prepare("SELECT * FROM purchases WHERE id = ?").bind(Number(purchaseMatch[1])).first();
    if (!existing) return json({ error: "Purchase not found" }, 404);
    const body = await requestBody(request);
    const nextStatus = body.fulfillment_status && FULFILLMENT_STATUSES.includes(body.fulfillment_status)
      ? body.fulfillment_status
      : existing.fulfillment_status;
    const entries = Object.entries(body).filter(([key]) => ["merchant", "estimated_delivery_date", "delivered_date", "purchase_reason", "source_file_or_link"].includes(key));
    if (nextStatus !== existing.fulfillment_status) entries.push(["fulfillment_status", nextStatus]);
    if (!entries.length) return json({ error: "No editable fields supplied" }, 400);
    const statements = [
      env.DB.prepare(`UPDATE purchases SET ${entries.map(([key]) => `${key} = ?`).join(", ")} WHERE id = ?`).bind(...entries.map(([, value]) => value), existing.id)
    ];
    if (nextStatus !== existing.fulfillment_status) {
      const fromColumn = existing.fulfillment_status === "delivered" ? "current_inventory" : "on_order_inventory";
      const toColumn = nextStatus === "delivered" ? "current_inventory" : "on_order_inventory";
      statements.push(env.DB.prepare(`UPDATE wines SET ${fromColumn} = MAX(0, ${fromColumn} - ?), ${toColumn} = ${toColumn} + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(existing.quantity, existing.quantity, existing.wine_id));
    }
    await env.DB.batch(statements);
    return json(await env.DB.prepare("SELECT purchases.*, wines.producer, wines.wine_name, wines.vintage FROM purchases JOIN wines ON wines.id = purchases.wine_id WHERE purchases.id = ?").bind(existing.id).first());
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (!env.DB) return json({ error: "D1 database binding DB is not configured" }, 503);
        await ensureSchema(env);
        return await api(request, env, url.pathname);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message || "Unexpected error" }, 500);
    }
  }
};
