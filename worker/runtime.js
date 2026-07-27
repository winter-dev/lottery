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

async function createDrawRecord(request, env, url) {
  if (!env.DB) return jsonResponse({ error: "Database binding unavailable" }, { status: 503 });
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    return jsonResponse({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 16_384) {
    return jsonResponse({ error: "Request body too large" }, { status: 413 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = validateDrawRecord(body);
  if (!record) return jsonResponse({ error: "Invalid draw record" }, { status: 400 });

  const insert = () =>
    env.DB.prepare(`
      INSERT OR IGNORE INTO draw_records (
        id, prize_id, prize_name, prize_emoji, draw_mode, draw_no,
        weight, stock_after, drawn_at, client_timezone, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        record.id,
        record.prizeId,
        record.prizeName,
        record.prizeEmoji,
        record.mode,
        record.drawNo,
        record.weight,
        record.stockAfter,
        record.drawnAt,
        record.timezone,
        Date.now()
      )
      .run();

  const result = await withSchemaRetry(env.DB, insert);
  console.log(
    JSON.stringify({
      message: "draw_record_saved",
      id: record.id,
      inserted: Number(result.meta?.changes || 0) > 0,
    })
  );
  return jsonResponse(
    { id: record.id, stored: true },
    { status: Number(result.meta?.changes || 0) > 0 ? 201 : 200 }
  );
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
  const isAdminApi = pathname.startsWith("/api/admin/");
  if (isAdminPage || isAdminApi) {
    const auth = await checkAdminAuthorization(request, env);
    if (!auth.authorized) return adminAuthFailure(auth.configured, isAdminApi);
    if (isAdminApi) {
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
