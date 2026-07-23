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
    created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS bottles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bottle_code TEXT UNIQUE,
    wine_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'in_stock',
    location_text TEXT, consumed_at TEXT, tasting_score REAL, tasting_notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS tasting_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_date TEXT NOT NULL,
    title TEXT NOT NULL, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS tasting_event_wines (
    event_id INTEGER NOT NULL, wine_id INTEGER NOT NULL, serving_order INTEGER NOT NULL,
    bottle_code TEXT, service_note TEXT, PRIMARY KEY (event_id, wine_id),
    FOREIGN KEY (event_id) REFERENCES tasting_events(id) ON DELETE CASCADE,
    FOREIGN KEY (wine_id) REFERENCES wines(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS cellar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_date TEXT NOT NULL,
    event_type TEXT NOT NULL, wine_id INTEGER, bottle_code TEXT, quantity INTEGER NOT NULL DEFAULT 1,
    details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS tasting_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tasting_date TEXT,
    source TEXT NOT NULL DEFAULT 'external', venue TEXT, wine_id INTEGER,
    producer TEXT NOT NULL, wine_name TEXT NOT NULL, vintage INTEGER,
    region TEXT, color TEXT, score REAL, notes TEXT, would_drink_again TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`
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
  "ALTER TABLE wines ADD COLUMN storage_positions TEXT",
  "ALTER TABLE tasting_event_wines ADD COLUMN bottle_code TEXT",
  "ALTER TABLE bottles ADD COLUMN consumed_at TEXT",
  "ALTER TABLE bottles ADD COLUMN tasting_score REAL",
  "ALTER TABLE bottles ADD COLUMN tasting_notes TEXT"
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

function wineLocationText(wine, position) {
  if (!wine.storage_unit || !wine.storage_shelf) return null;
  const row = { front: "前排", back: "后排" }[wine.storage_row] || wine.storage_row;
  const stack = { top: "上层", upper: "上层", bottom: "下层", lower: "下层" }[wine.storage_stack] || wine.storage_stack;
  const parts = [wine.storage_unit, `第${wine.storage_shelf}层`];
  if (stack) parts.push(stack);
  if (row) parts.push(row);
  if (position) parts.push(`位置${position}`);
  return parts.join(" · ");
}

function positionsForWine(wine, count) {
  const positions = String(wine.storage_positions || "").split("、").map(value => value.trim()).filter(Boolean);
  if (positions.length) return Array.from({ length: count }, (_, index) => positions[index] || null);
  if (wine.storage_slot && count === 1) return [wine.storage_slot];
  return Array.from({ length: count }, () => null);
}

async function ensureBottleRecords(env) {
  const wines = (await env.DB.prepare("SELECT * FROM wines WHERE current_inventory > 0 OR on_order_inventory > 0").all()).results;
  const existing = (await env.DB.prepare("SELECT wine_id, status, COUNT(*) AS count FROM bottles GROUP BY wine_id, status").all()).results;
  const counts = new Map(existing.map(row => [`${row.wine_id}:${row.status}`, Number(row.count)]));
  for (const wine of wines) {
    for (const [status, target] of [["in_stock", Number(wine.current_inventory || 0)], ["on_order", Number(wine.on_order_inventory || 0)]]) {
      const current = counts.get(`${wine.id}:${status}`) || 0;
      const needed = Math.max(0, target - current);
      const positions = status === "in_stock" ? positionsForWine(wine, target) : [];
      for (let index = 0; index < needed; index += 1) {
        const position = positions[current + index];
        const result = await env.DB.prepare("INSERT INTO bottles (wine_id, status, location_text) VALUES (?, ?, ?)")
          .bind(wine.id, status, status === "in_stock" ? wineLocationText(wine, position) : "运输中").run();
        const bottleCode = `B-${String(result.meta.last_row_id).padStart(4, "0")}`;
        await env.DB.prepare("UPDATE bottles SET bottle_code = ? WHERE id = ?").bind(bottleCode, result.meta.last_row_id).run();
      }
    }
  }
}

async function winesWithBottles(env) {
  const wines = (await env.DB.prepare("SELECT * FROM wines ORDER BY producer, wine_name, vintage DESC").all()).results.map(wineFromRow);
  const bottles = (await env.DB.prepare("SELECT wine_id, bottle_code, status, location_text, consumed_at, tasting_score, tasting_notes FROM bottles ORDER BY id").all()).results;
  const bottleMap = new Map();
  for (const bottle of bottles) {
    const list = bottleMap.get(bottle.wine_id) || [];
    list.push(bottle);
    bottleMap.set(bottle.wine_id, list);
  }
  return wines.map(wine => ({ ...wine, bottles: bottleMap.get(wine.id) || [] }));
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
  const referenceValuation = await env.DB.prepare(`SELECT
      COALESCE(SUM(w.current_market_price_sgd * w.current_inventory), 0) AS total,
      COALESCE(SUM(w.current_inventory), 0) AS qty
    FROM wines w
    WHERE w.current_inventory > 0
      AND w.current_market_price_sgd IS NOT NULL`).first();
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
    total_market_value: Number(referenceValuation.total || 0),
    valued_bottles: Number(referenceValuation.qty || 0),
    unvalued_bottles: Math.max(0, totalBottles - Number(referenceValuation.qty || 0)),
    average_market_value: Number(referenceValuation.qty || 0)
      ? Number(referenceValuation.total || 0) / Number(referenceValuation.qty || 0)
      : 0,
    color_counts: colorCounts,
    color_percentages: Object.fromEntries(COLORS.map(color => [color, totalBottles ? colorCounts[color] / totalBottles : 0])),
    category_counts: categoryCounts,
    category_percentages: Object.fromEntries(CATEGORIES.map(category => [category, totalBottles ? categoryCounts[category] / totalBottles : 0])),
    replenish: Object.entries(categoryTargets).filter(([category, target]) => totalBottles && (categoryCounts[category] / totalBottles) + 0.03 < target).map(([category, target]) => ({ category, target })),
    priority_to_open: wines
      .filter(wine => wine.current_inventory && wine.drinking_window_end && wine.drinking_window_end <= year + 3)
      .map(wine => ({
        ...wine,
        window_status: wine.drinking_window_end <= year
          ? "今年优先"
          : `${wine.drinking_window_end} 前优先`
      }))
      .sort((a, b) => Number(a.drinking_window_end) - Number(b.drinking_window_end)),
    targets: { color_targets: colorTargets, category_targets: categoryTargets }
  };
}

async function api(request, env, pathname) {
  if (pathname === "/api/lookups" && request.method === "GET") return json({ categories: CATEGORIES, colors: COLORS, watchlist: [] });
  if (pathname === "/api/dashboard" && request.method === "GET") return json(await dashboard(env));
  if (pathname === "/api/tasting-events" && request.method === "GET") {
    const events = (await env.DB.prepare("SELECT * FROM tasting_events ORDER BY event_date ASC, id ASC").all()).results;
    const items = (await env.DB.prepare(`SELECT tasting_event_wines.event_id, tasting_event_wines.wine_id,
      tasting_event_wines.serving_order, tasting_event_wines.bottle_code, tasting_event_wines.service_note,
      wines.producer, wines.wine_name, wines.vintage, wines.color
      FROM tasting_event_wines JOIN wines ON wines.id = tasting_event_wines.wine_id
      ORDER BY tasting_event_wines.serving_order ASC`).all()).results;
    return json(events.map(event => ({ ...event, wines: items.filter(item => item.event_id === event.id) })));
  }
  if (pathname === "/api/tasting-events" && request.method === "POST") {
    const body = await requestBody(request);
    const eventDate = String(body.event_date || "");
    const title = String(body.title || "").trim();
    const wines = Array.isArray(body.wines) ? body.wines : [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !title || !wines.length) {
      return json({ error: "Event date, title and at least one wine are required" }, 400);
    }
    const result = await env.DB.prepare("INSERT INTO tasting_events (event_date, title, notes) VALUES (?, ?, ?)")
      .bind(eventDate, title, body.notes || null).run();
    const eventId = result.meta.last_row_id;
    const statements = wines.map((wine, index) => env.DB.prepare(
      "INSERT INTO tasting_event_wines (event_id, wine_id, serving_order, bottle_code, service_note) VALUES (?, ?, ?, ?, ?)"
    ).bind(eventId, Number(wine.wine_id), Number(wine.serving_order || index + 1), wine.bottle_code || null, wine.service_note || null));
    await env.DB.batch(statements);
    return json({ ok: true, id: eventId }, 201);
  }
  const tastingEventMatch = pathname.match(/^\/api\/tasting-events\/(\d+)$/);
  if (tastingEventMatch && request.method === "PATCH") {
    const eventId = Number(tastingEventMatch[1]);
    const body = await requestBody(request);
    const title = String(body.title || "").trim();
    if (!title) return json({ error: "Event title is required" }, 400);
    await env.DB.prepare("UPDATE tasting_events SET title = ? WHERE id = ?").bind(title, eventId).run();
    return json(await env.DB.prepare("SELECT * FROM tasting_events WHERE id = ?").bind(eventId).first());
  }
  if (tastingEventMatch && request.method === "DELETE") {
    const eventId = Number(tastingEventMatch[1]);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM tasting_event_wines WHERE event_id = ?").bind(eventId),
      env.DB.prepare("DELETE FROM tasting_events WHERE id = ?").bind(eventId)
    ]);
    return json({ ok: true, id: eventId });
  }
  if (pathname === "/api/bottles" && request.method === "GET") {
    return json((await env.DB.prepare("SELECT bottles.*, wines.producer, wines.wine_name, wines.vintage FROM bottles JOIN wines ON wines.id = bottles.wine_id ORDER BY bottles.id").all()).results);
  }
  if (pathname === "/api/cellar-log" && request.method === "GET") {
    return json((await env.DB.prepare(`
      SELECT * FROM (
        SELECT purchases.purchase_date AS event_date, 'purchased' AS event_type, purchases.wine_id,
          NULL AS bottle_code, purchases.quantity, purchases.merchant AS details, purchases.created_at,
          wines.producer, wines.wine_name, wines.vintage
        FROM purchases JOIN wines ON wines.id = purchases.wine_id
        UNION ALL
        SELECT COALESCE(purchases.delivered_date, purchases.purchase_date), 'received', purchases.wine_id,
          NULL, purchases.quantity, purchases.merchant, purchases.created_at,
          wines.producer, wines.wine_name, wines.vintage
        FROM purchases JOIN wines ON wines.id = purchases.wine_id
        WHERE purchases.fulfillment_status = 'delivered'
        UNION ALL
        SELECT bottles.consumed_at, 'consumed', bottles.wine_id, bottles.bottle_code, 1,
          NULL, bottles.updated_at, wines.producer, wines.wine_name, wines.vintage
        FROM bottles JOIN wines ON wines.id = bottles.wine_id
        WHERE bottles.status = 'consumed'
        UNION ALL
        SELECT cellar_events.event_date, cellar_events.event_type, cellar_events.wine_id,
          cellar_events.bottle_code, cellar_events.quantity, cellar_events.details, cellar_events.created_at,
          wines.producer, wines.wine_name, wines.vintage
        FROM cellar_events LEFT JOIN wines ON wines.id = cellar_events.wine_id
      ) ORDER BY event_date DESC, created_at DESC
    `).all()).results);
  }
  if (pathname === "/api/tasting-notes" && request.method === "GET") {
    return json((await env.DB.prepare(`
      SELECT * FROM tasting_notes
      ORDER BY CASE WHEN tasting_date IS NULL THEN 1 ELSE 0 END, tasting_date DESC, created_at DESC
    `).all()).results);
  }
  if (pathname === "/api/tasting-notes" && request.method === "POST") {
    const body = await requestBody(request);
    const producer = String(body.producer || "").trim();
    const wineName = String(body.wine_name || "").trim();
    if (!producer || !wineName) return json({ error: "Producer and wine name are required" }, 400);
    const result = await env.DB.prepare(`INSERT INTO tasting_notes
      (tasting_date, source, venue, wine_id, producer, wine_name, vintage, region, color, score, notes, would_drink_again)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(body.tasting_date || null, body.source || 'external', body.venue || null, body.wine_id || null,
        producer, wineName, body.vintage || null, body.region || null, body.color || null,
        body.score ?? null, body.notes || null, body.would_drink_again || null).run();
    return json(await env.DB.prepare("SELECT * FROM tasting_notes WHERE id = ?").bind(result.meta.last_row_id).first(), 201);
  }
  if (pathname === "/api/history" && request.method === "GET") {
    return json((await env.DB.prepare(`
      SELECT bottles.bottle_code, bottles.consumed_at, bottles.tasting_score, bottles.tasting_notes,
        wines.id AS wine_id, wines.producer, wines.wine_name, wines.vintage, wines.appellation,
        wines.color, wines.personal_score
      FROM bottles JOIN wines ON wines.id = bottles.wine_id
      WHERE bottles.status = 'consumed'
      ORDER BY bottles.consumed_at DESC, bottles.updated_at DESC, bottles.id DESC
    `).all()).results);
  }
  const consumeMatch = pathname.match(/^\/api\/bottles\/(B-\d+)\/consume$/);
  if (consumeMatch && request.method === "POST") {
    const bottle = await env.DB.prepare("SELECT * FROM bottles WHERE bottle_code = ?").bind(consumeMatch[1]).first();
    if (!bottle) return json({ error: "Bottle not found" }, 404);
    const body = await requestBody(request);
    const consumedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.consumed_at || ""))
      ? String(body.consumed_at)
      : new Date().toISOString().slice(0, 10);
    const score = body.tasting_score === null || body.tasting_score === undefined || body.tasting_score === ""
      ? null
      : Number(body.tasting_score);
    const statements = [
      env.DB.prepare(`UPDATE bottles
        SET status = 'consumed', location_text = ?, consumed_at = ?, tasting_score = ?, tasting_notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE bottle_code = ?`)
        .bind(`已饮用 · ${consumedAt}`, consumedAt, score, body.tasting_notes || null, consumeMatch[1])
    ];
    if (bottle.status === "in_stock") {
      statements.push(env.DB.prepare(`UPDATE wines
        SET current_inventory = MAX(0, current_inventory - 1), personal_score = COALESCE(?, personal_score), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`).bind(score, bottle.wine_id));
    } else if (score !== null) {
      statements.push(env.DB.prepare("UPDATE wines SET personal_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(score, bottle.wine_id));
    }
    await env.DB.batch(statements);
    return json(await env.DB.prepare("SELECT * FROM bottles WHERE bottle_code = ?").bind(consumeMatch[1]).first());
  }
  const bottleMatch = pathname.match(/^\/api\/bottles\/(B-\d+)$/);
  if (bottleMatch && request.method === "DELETE") {
    const bottle = await env.DB.prepare(`
      SELECT bottles.*, wines.on_order_inventory
      FROM bottles JOIN wines ON wines.id = bottles.wine_id
      WHERE bottles.bottle_code = ?
    `).bind(bottleMatch[1]).first();
    if (!bottle) return json({ error: "Bottle not found" }, 404);
    if (bottle.status !== "on_order" || Number(bottle.on_order_inventory || 0) > 0) {
      return json({ error: "Only obsolete delivered-order placeholders can be removed" }, 400);
    }
    await env.DB.prepare("DELETE FROM bottles WHERE bottle_code = ?").bind(bottleMatch[1]).run();
    return json({ ok: true, bottle_code: bottleMatch[1] });
  }
  if (bottleMatch && request.method === "PATCH") {
    const existing = await env.DB.prepare("SELECT * FROM bottles WHERE bottle_code = ?").bind(bottleMatch[1]).first();
    if (!existing) return json({ error: "Bottle not found" }, 404);
    const body = await requestBody(request);
    const entries = Object.entries(body).filter(([key]) => ["status", "location_text", "consumed_at", "tasting_score", "tasting_notes"].includes(key));
    if (!entries.length) return json({ error: "No editable fields supplied" }, 400);
    await env.DB.prepare(`UPDATE bottles SET ${entries.map(([key]) => `${key} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE bottle_code = ?`)
      .bind(...entries.map(([, value]) => value), bottleMatch[1]).run();
    if (body.location_text !== undefined && body.location_text !== existing.location_text) {
      const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.event_date || ""))
        ? String(body.event_date)
        : new Date().toISOString().slice(0, 10);
      await env.DB.prepare(`INSERT INTO cellar_events (event_date, event_type, wine_id, bottle_code, details)
        VALUES (?, 'moved', ?, ?, ?)`)
        .bind(eventDate, existing.wine_id, bottleMatch[1], body.location_text || "待记录位置").run();
    }
    return json(await env.DB.prepare("SELECT * FROM bottles WHERE bottle_code = ?").bind(bottleMatch[1]).first());
  }
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
  if (pathname === "/api/wines" && request.method === "GET") return json(await winesWithBottles(env));
  if (pathname === "/api/wines/merge" && request.method === "POST") {
    const body = await requestBody(request);
    const targetId = Number(body.target_id);
    const sourceIds = [...new Set((body.source_ids || []).map(Number).filter(id => id && id !== targetId))];
    if (!targetId || !sourceIds.length) return json({ error: "Target and source wine IDs are required" }, 400);

    const target = await env.DB.prepare("SELECT * FROM wines WHERE id = ?").bind(targetId).first();
    const sources = (await env.DB.prepare(`SELECT * FROM wines WHERE id IN (${sourceIds.map(() => "?").join(", ")})`).bind(...sourceIds).all()).results;
    if (!target || sources.length !== sourceIds.length) return json({ error: "Wine record not found" }, 404);
    const identity = wine => [wine.producer, wine.wine_name, wine.vintage ?? "", wine.color].join("|");
    if (sources.some(source => identity(source) !== identity(target))) {
      return json({ error: "Only identical producer, wine, vintage and colour records can be merged" }, 400);
    }

    const totalCurrent = Number(target.current_inventory || 0) + sources.reduce((sum, wine) => sum + Number(wine.current_inventory || 0), 0);
    const totalOnOrder = Number(target.on_order_inventory || 0) + sources.reduce((sum, wine) => sum + Number(wine.on_order_inventory || 0), 0);
    const totalTarget = Number(target.target_inventory || 0) + sources.reduce((sum, wine) => sum + Number(wine.target_inventory || 0), 0);
    const statements = [
      env.DB.prepare("UPDATE wines SET current_inventory = ?, on_order_inventory = ?, target_inventory = ?, storage_unit = NULL, storage_shelf = NULL, storage_row = NULL, storage_stack = NULL, storage_slot = NULL, storage_positions = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(totalCurrent, totalOnOrder, totalTarget, targetId)
    ];
    for (const sourceId of sourceIds) {
      statements.push(env.DB.prepare("UPDATE bottles SET wine_id = ?, updated_at = CURRENT_TIMESTAMP WHERE wine_id = ?").bind(targetId, sourceId));
      statements.push(env.DB.prepare("UPDATE purchases SET wine_id = ? WHERE wine_id = ?").bind(targetId, sourceId));
      statements.push(env.DB.prepare("DELETE FROM wines WHERE id = ?").bind(sourceId));
    }
    await env.DB.batch(statements);
    return json({ ok: true, target_id: targetId, merged_source_ids: sourceIds });
  }
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

      // Preserve bottle identities when an order arrives instead of creating a second code.
      const sourceStatus = existing.fulfillment_status === "delivered" ? "in_stock" : "on_order";
      const targetStatus = nextStatus === "delivered" ? "in_stock" : "on_order";
      const sourceBottles = (await env.DB.prepare(
        "SELECT id FROM bottles WHERE wine_id = ? AND status = ? ORDER BY id LIMIT ?"
      ).bind(existing.wine_id, sourceStatus, existing.quantity).all()).results;
      for (const bottle of sourceBottles) {
        const locationText = targetStatus === "on_order" ? "运输中" : null;
        statements.push(env.DB.prepare(
          "UPDATE bottles SET status = ?, location_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(targetStatus, locationText, bottle.id));
      }
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
        await ensureBottleRecords(env);
        return await api(request, env, url.pathname);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: error.message || "Unexpected error" }, 500);
    }
  }
};
