const textRoutes = new Map(__TEXT_ROUTES__);
const binaryRoutes = new Map(__BINARY_ROUTES__);

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const htmlSecurityHeaders = {
  ...securityHeaders,
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const DEFAULT_PRIZES = [
  { id: "default-first", name: "一等奖", emoji: "🏆", weight: 2, stock: 1 },
  { id: "default-second", name: "二等奖", emoji: "🎁", weight: 5, stock: 2 },
  { id: "default-third", name: "三等奖", emoji: "🎊", weight: 8, stock: 3 },
  { id: "default-red-packet", name: "现金红包", emoji: "🧧", weight: 10, stock: 5 },
  { id: "default-coupon", name: "优惠券", emoji: "🎟️", weight: 14, stock: 8 },
  { id: "default-points", name: "积分 × 100", emoji: "⭐", weight: 18, stock: 12 },
  { id: "default-again", name: "再来一次", emoji: "🔁", weight: 20, stock: 99 },
  { id: "default-thanks", name: "谢谢参与", emoji: "🍀", weight: 23, stock: 99 },
];

function decodeBase64(value) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function jsonResponse(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(securityHeaders)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function staticResponse(request, pathname) {
  const textAsset = textRoutes.get(pathname);
  if (textAsset) {
    const isHtml = textAsset.contentType.startsWith("text/html");
    const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
    return new Response(request.method === "HEAD" ? null : textAsset.body, {
      headers: {
        ...(isHtml ? htmlSecurityHeaders : securityHeaders),
        "Content-Type": textAsset.contentType,
        "Cache-Control": isAdmin || isHtml ? "no-store" : "public, max-age=3600",
      },
    });
  }

  const binaryAsset = binaryRoutes.get(pathname);
  if (binaryAsset) {
    return new Response(request.method === "HEAD" ? null : decodeBase64(binaryAsset.body), {
      headers: {
        ...securityHeaders,
        "Content-Type": binaryAsset.contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  return null;
}

function integerInRange(value, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function stringWithin(value, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maximum) return null;
  return normalized;
}

function validateDrawRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = stringWithin(value.id, 80);
  const prizeName = stringWithin(value.prizeName, 64);
  const prizeEmoji = stringWithin(value.prizeEmoji || "🎁", 16);
  const mode = value.mode === "stock" || value.mode === "infinite" ? value.mode : null;
  const drawNo = integerInRange(value.drawNo, 0, 1_000_000_000);
  const weight = integerInRange(value.weight ?? 0, 0, 1_000_000);
  const stockAfter = integerInRange(value.stockAfter ?? 0, 0, 1_000_000_000);
  const drawnAt = integerInRange(value.drawnAt, 1_577_836_800_000, Date.now() + 86_400_000);
  const timezone = stringWithin(value.timezone || "", 64, { allowEmpty: true });
  const prizeId =
    value.prizeId === null || value.prizeId === undefined || value.prizeId === ""
      ? null
      : stringWithin(value.prizeId, 80);

  if (
    !id ||
    !/^[A-Za-z0-9-]+$/.test(id) ||
    !prizeName ||
    !prizeEmoji ||
    !mode ||
    drawNo === null ||
    weight === null ||
    stockAfter === null ||
    drawnAt === null ||
    timezone === null ||
    (value.prizeId && !prizeId)
  ) {
    return null;
  }

  return {
    id,
    prizeId,
    prizeName,
    prizeEmoji,
    mode,
    drawNo,
    weight,
    stockAfter,
    drawnAt,
    timezone,
  };
}

function safeConfigImage(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value !== "string" || value.length > 300_000) return null;
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)
    ? value
    : null;
}

function validateLotteryConfig(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.prizes)) return null;
  if (value.prizes.length < 2 || value.prizes.length > 12) return null;

  const ids = new Set();
  const prizes = [];
  for (let index = 0; index < value.prizes.length; index += 1) {
    const raw = value.prizes[index];
    if (!raw || typeof raw !== "object") return null;
    const id = stringWithin(raw.id, 80);
    const name = stringWithin(raw.name, 24);
    const emoji = stringWithin(raw.emoji || "🎁", 8);
    const image = safeConfigImage(raw.image);
    const weight = integerInRange(raw.weight, 0, 9_999);
    const stock = integerInRange(raw.stock, 0, 9_999);
    const initialStock = integerInRange(raw.initialStock ?? raw.stock, 0, 9_999);
    if (
      !id ||
      !/^[A-Za-z0-9-]+$/.test(id) ||
      ids.has(id) ||
      !name ||
      !emoji ||
      image === null ||
      weight === null ||
      stock === null ||
      initialStock === null
    ) {
      return null;
    }
    ids.add(id);
    prizes.push({ id, name, emoji, image, weight, stock, initialStock, sortOrder: index });
  }
  return prizes;
}

async function initializeSchema(database) {
  await database.batch([
    database.prepare(`
      CREATE TABLE IF NOT EXISTS draw_records (
        id TEXT PRIMARY KEY NOT NULL,
        prize_id TEXT,
        prize_name TEXT NOT NULL,
        prize_emoji TEXT NOT NULL DEFAULT '🎁',
        draw_mode TEXT NOT NULL CHECK (draw_mode IN ('infinite', 'stock')),
        draw_no INTEGER NOT NULL CHECK (draw_no >= 0),
        weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0),
        stock_after INTEGER NOT NULL DEFAULT 0 CHECK (stock_after >= 0),
        drawn_at INTEGER NOT NULL,
        client_timezone TEXT NOT NULL DEFAULT '',
        received_at INTEGER NOT NULL
      ) STRICT
    `),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS draw_records_drawn_at_idx ON draw_records (drawn_at DESC)"
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS draw_records_prize_name_idx ON draw_records (prize_name)"
    ),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS draw_records_mode_drawn_at_idx ON draw_records (draw_mode, drawn_at DESC)"
    ),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS lottery_settings (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        updated_at INTEGER NOT NULL
      ) STRICT
    `),
    database.prepare(
      "INSERT OR IGNORE INTO lottery_settings (id, revision, updated_at) VALUES (1, 1, 0)"
    ),
    database.prepare(`
      CREATE TABLE IF NOT EXISTS lottery_prizes (
        id TEXT PRIMARY KEY NOT NULL,
        sort_order INTEGER NOT NULL UNIQUE CHECK (sort_order >= 0),
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '🎁',
        image TEXT NOT NULL DEFAULT '',
        weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        initial_stock INTEGER NOT NULL DEFAULT 0 CHECK (initial_stock >= 0),
        updated_at INTEGER NOT NULL
      ) STRICT
    `),
    database.prepare(
      "CREATE INDEX IF NOT EXISTS lottery_prizes_sort_order_idx ON lottery_prizes (sort_order)"
    ),
  ]);
}

async function withSchemaRetry(database, operation) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("no such table")) throw error;
    await initializeSchema(database);
    return await operation();
  }
}

function publicPrize(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    emoji: String(row.emoji || "🎁"),
    image: String(row.image || ""),
    weight: Number(row.weight || 0),
    stock: Number(row.stock || 0),
    initialStock: Number(row.initial_stock || 0),
  };
}

async function ensureLotteryConfig(database) {
  const count = await withSchemaRetry(database, () =>
    database.prepare("SELECT COUNT(*) AS total FROM lottery_prizes").first()
  );
  if (Number(count?.total || 0) > 0) return;

  const now = Date.now();
  await database.batch([
    database.prepare(
      "INSERT OR IGNORE INTO lottery_settings (id, revision, updated_at) VALUES (1, 1, ?)"
    ).bind(now),
    ...DEFAULT_PRIZES.map((prize, index) =>
      database.prepare(`
        INSERT OR IGNORE INTO lottery_prizes (
          id, sort_order, name, emoji, image, weight, stock, initial_stock, updated_at
        ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)
      `).bind(
        prize.id,
        index,
        prize.name,
        prize.emoji,
        prize.weight,
        prize.stock,
        prize.stock,
        now
      )
    ),
  ]);
}

async function readLotteryConfig(database, { includeRecords = false } = {}) {
  await ensureLotteryConfig(database);
  const statements = [
    database.prepare("SELECT revision, updated_at FROM lottery_settings WHERE id = 1"),
    database.prepare(`
      SELECT id, sort_order, name, emoji, image, weight, stock, initial_stock
      FROM lottery_prizes
      ORDER BY sort_order ASC
    `),
  ];
  if (includeRecords) {
    statements.push(
      database.prepare("SELECT COUNT(*) AS total FROM draw_records"),
      database.prepare(`
        SELECT
          r.id, r.prize_id, r.prize_name, r.prize_emoji, r.draw_mode,
          r.draw_no, r.weight, r.stock_after, r.drawn_at, r.client_timezone,
          COALESCE(p.image, '') AS prize_image
        FROM draw_records AS r
        LEFT JOIN lottery_prizes AS p ON p.id = r.prize_id
        ORDER BY r.drawn_at DESC, r.received_at DESC
        LIMIT 9
      `)
    );
  }

  const results = await database.batch(statements);
  const settings = results[0].results?.[0] || {};
  const config = {
    revision: Number(settings.revision || 1),
    updatedAt: Number(settings.updated_at || 0),
    prizes: (results[1].results || []).map(publicPrize),
  };
  if (!includeRecords) return config;

  return {
    ...config,
    drawCount: Number(results[2].results?.[0]?.total || 0),
    history: (results[3].results || []).map((row) => ({
      id: String(row.id),
      prizeId: row.prize_id ? String(row.prize_id) : "",
      name: String(row.prize_name),
      emoji: String(row.prize_emoji || "🎁"),
      image: String(row.prize_image || ""),
      createdAt: Number(row.drawn_at),
      drawNo: Number(row.draw_no),
      mode: row.draw_mode === "stock" ? "stock" : "infinite",
      weight: Number(row.weight || 0),
      stockAfter: Number(row.stock_after || 0),
      timezone: String(row.client_timezone || ""),
      synced: true,
    })),
  };
}

async function getLotteryConfig(request, env) {
  if (!env.DB) return jsonResponse({ error: "Database binding unavailable" }, { status: 503 });
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: "GET" },
    });
  }
  return jsonResponse(await readLotteryConfig(env.DB, { includeRecords: true }));
}

async function saveLotteryConfig(request, env, url) {
  if (!env.DB) return jsonResponse({ error: "Database binding unavailable" }, { status: 503 });
  if (request.method === "GET") {
    return jsonResponse(await readLotteryConfig(env.DB, { includeRecords: true }));
  }
  if (request.method !== "PUT") {
    return jsonResponse({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: "GET, PUT" },
    });
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    return jsonResponse({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 4_000_000) {
    return jsonResponse({ error: "Request body too large" }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }
  const prizes = validateLotteryConfig(body);
  if (!prizes) return jsonResponse({ error: "Invalid lottery configuration" }, { status: 400 });

  await ensureLotteryConfig(env.DB);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM lottery_prizes"),
    ...prizes.map((prize) =>
      env.DB.prepare(`
        INSERT INTO lottery_prizes (
          id, sort_order, name, emoji, image, weight, stock, initial_stock, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        prize.id,
        prize.sortOrder,
        prize.name,
        prize.emoji,
        prize.image,
        prize.weight,
        prize.stock,
        prize.initialStock,
        now
      )
    ),
    env.DB.prepare(`
      UPDATE lottery_settings
      SET revision = revision + 1, updated_at = ?
      WHERE id = 1
    `).bind(now),
  ]);

  console.log(JSON.stringify({ message: "lottery_config_saved", prizes: prizes.length }));
  return jsonResponse(await readLotteryConfig(env.DB, { includeRecords: true }));
}

function secureRandomUnit() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 4_294_967_296;
}

function pickWeightedPrize(prizes) {
  const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  if (!prizes.length || total <= 0) return null;
  let cursor = secureRandomUnit() * total;
  for (const prize of prizes) {
    cursor -= prize.weight;
    if (cursor < 0) return prize;
  }
  return prizes.at(-1) || null;
}

async function createDrawRecord(request, env, url) {
  if (!env.DB) return jsonResponse({ error: "Database binding unavailable" }, { status: 503 });
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    return jsonResponse({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 4_096) {
    return jsonResponse({ error: "Request body too large" }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }
  const mode = body?.mode === "stock" || body?.mode === "infinite" ? body.mode : null;
  const timezone = stringWithin(body?.timezone || "", 64, { allowEmpty: true });
  if (!mode || timezone === null) {
    return jsonResponse({ error: "Invalid draw request" }, { status: 400 });
  }

  let selected = null;
  let stockAfter = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const config = await readLotteryConfig(env.DB);
    const pool = config.prizes.filter(
      (prize) => prize.weight > 0 && (mode === "infinite" || prize.stock > 0)
    );
    selected = pickWeightedPrize(pool);
    if (!selected) {
      return jsonResponse({ error: "No eligible prizes", code: "EMPTY_POOL" }, { status: 409 });
    }
    stockAfter = selected.stock;
    if (mode === "infinite") break;

    const update = await env.DB.prepare(`
      UPDATE lottery_prizes
      SET stock = stock - 1, updated_at = ?
      WHERE id = ? AND stock > 0
    `).bind(Date.now(), selected.id).run();
    if (Number(update.meta?.changes || 0) > 0) {
      stockAfter = Math.max(0, selected.stock - 1);
      await env.DB.prepare(`
        UPDATE lottery_settings
        SET revision = revision + 1, updated_at = ?
        WHERE id = 1
      `).bind(Date.now()).run();
      break;
    }
    selected = null;
  }

  if (!selected) {
    return jsonResponse({ error: "Prize inventory changed, please retry" }, { status: 409 });
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM draw_records").first();
  const drawNo = Number(count?.total || 0) + 1;
  const drawnAt = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO draw_records (
      id, prize_id, prize_name, prize_emoji, draw_mode, draw_no,
      weight, stock_after, drawn_at, client_timezone, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    selected.id,
    selected.name,
    selected.emoji,
    mode,
    drawNo,
    selected.weight,
    stockAfter,
    drawnAt,
    timezone,
    drawnAt
  ).run();

  console.log(JSON.stringify({ message: "draw_record_saved", id, prizeId: selected.id }));
  const config = await readLotteryConfig(env.DB);
  return jsonResponse({
    stored: true,
    config,
    prize: { ...selected, stock: stockAfter },
    record: {
      id,
      prizeId: selected.id,
      name: selected.name,
      emoji: selected.emoji,
      image: selected.image,
      createdAt: drawnAt,
      drawNo,
      mode,
      weight: selected.weight,
      stockAfter,
      timezone,
      synced: true,
    },
  }, { status: 201 });
}

function utf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function timingSafeStringEqual(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
  }
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function checkAdminAuthorization(request, env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return { configured: false, authorized: false };
  }
  const provided = request.headers.get("Authorization") || "";
  const expected = `Basic ${utf8Base64(`${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`)}`;
  return {
    configured: true,
    authorized: await timingSafeStringEqual(provided, expected),
  };
}

function adminAuthFailure(configured, apiRequest = false) {
  if (!configured) {
    return apiRequest
      ? jsonResponse({ error: "Admin credentials are not configured" }, { status: 503 })
      : new Response("Admin credentials are not configured", {
          status: 503,
          headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
        });
  }

  const headers = {
    ...securityHeaders,
    "WWW-Authenticate": 'Basic realm="Weilihua Admin", charset="UTF-8"',
    "Cache-Control": "no-store",
  };
  return apiRequest
    ? jsonResponse({ error: "Unauthorized" }, { status: 401, headers })
    : new Response("Authentication required", {
        status: 401,
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      });
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(value || "", 10);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function escapeLike(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function shanghaiDayStart(timestamp = Date.now()) {
  const offset = 8 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  return Math.floor((timestamp + offset) / day) * day - offset;
}

async function listDrawRecords(request, env, url) {
  if (!env.DB) return jsonResponse({ error: "Database binding unavailable" }, { status: 503 });
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  const page = clampInteger(url.searchParams.get("page"), 1, 1, 1_000_000);
  const pageSize = clampInteger(url.searchParams.get("pageSize"), 50, 1, 100);
  const offset = (page - 1) * pageSize;
  const query = (url.searchParams.get("q") || "").trim().slice(0, 40);
  const mode = url.searchParams.get("mode");
  const from = integerInRange(url.searchParams.get("from"), 0, Number.MAX_SAFE_INTEGER);
  const to = integerInRange(url.searchParams.get("to"), 0, Number.MAX_SAFE_INTEGER);
  const conditions = [];
  const parameters = [];

  if (query) {
    conditions.push("prize_name LIKE ? ESCAPE '\\'");
    parameters.push(`%${escapeLike(query)}%`);
  }
  if (mode === "stock" || mode === "infinite") {
    conditions.push("draw_mode = ?");
    parameters.push(mode);
  }
  if (from !== null) {
    conditions.push("drawn_at >= ?");
    parameters.push(from);
  }
  if (to !== null) {
    conditions.push("drawn_at <= ?");
    parameters.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const queryDatabase = () =>
    env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) AS total FROM draw_records ${where}`).bind(...parameters),
      env.DB.prepare(`
        SELECT
          id, prize_id, prize_name, prize_emoji, draw_mode, draw_no,
          weight, stock_after, drawn_at, client_timezone, received_at
        FROM draw_records
        ${where}
        ORDER BY drawn_at DESC, received_at DESC
        LIMIT ? OFFSET ?
      `).bind(...parameters, pageSize, offset),
      env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN drawn_at >= ? THEN 1 ELSE 0 END) AS today,
          COUNT(DISTINCT prize_name) AS unique_prizes,
          SUM(CASE WHEN draw_mode = 'stock' THEN 1 ELSE 0 END) AS stock_mode
        FROM draw_records
      `).bind(shanghaiDayStart()),
    ]);

  const [countResult, recordsResult, statsResult] = await withSchemaRetry(env.DB, queryDatabase);
  const total = Number(countResult.results?.[0]?.total || 0);
  const stats = statsResult.results?.[0] || {};
  return jsonResponse({
    records: recordsResult.results || [],
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    stats: {
      total: Number(stats.total || 0),
      today: Number(stats.today || 0),
      uniquePrizes: Number(stats.unique_prizes || 0),
      stockMode: Number(stats.stock_mode || 0),
    },
  });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/health") {
    return jsonResponse({ ok: true, database: Boolean(env.DB) });
  }

  if (pathname === "/api/config") {
    return await getLotteryConfig(request, env);
  }

  if (pathname === "/api/draws") {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, {
        status: 405,
        headers: { Allow: "POST" },
      });
    }
    return await createDrawRecord(request, env, url);
  }

  const isAdminPage =
    pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/index.html";
  const isLegacyConfigPage =
    pathname === "/config" || pathname === "/config/" || pathname === "/config/index.html";
  const isAdminApi = pathname.startsWith("/api/admin/");
  if (isAdminPage || isLegacyConfigPage || isAdminApi) {
    const auth = await checkAdminAuthorization(request, env);
    if (!auth.authorized) return adminAuthFailure(auth.configured, isAdminApi);
    if (isLegacyConfigPage) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { ...securityHeaders, Allow: "GET, HEAD" },
        });
      }
      return new Response(null, {
        status: 302,
        headers: {
          ...securityHeaders,
          "Cache-Control": "no-store",
          Location: "/admin#config",
        },
      });
    }
    if (isAdminApi) {
      if (pathname === "/api/admin/config") return await saveLotteryConfig(request, env, url);
      if (pathname === "/api/admin/draws") return await listDrawRecords(request, env, url);
      return jsonResponse({ error: "Not found" }, { status: 404 });
    }
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...securityHeaders, Allow: "GET, HEAD" },
    });
  }

  const asset = staticResponse(request, pathname);
  if (asset) return asset;
  return new Response("Not Found", {
    status: 404,
    headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request_failed",
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return jsonResponse({ error: "Internal server error" }, { status: 500 });
    }
  },
};
