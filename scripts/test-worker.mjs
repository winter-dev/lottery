import assert from "node:assert/strict";

const worker = (await import("../dist/server/index.js")).default;

class MockStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.parameters = [];
  }

  bind(...parameters) {
    this.parameters = parameters;
    return this;
  }

  async run() {
    if (!this.sql.startsWith("INSERT OR IGNORE INTO draw_records")) {
      return { success: true, results: [], meta: { changes: 0 } };
    }
    const [
      id,
      prizeId,
      prizeName,
      prizeEmoji,
      drawMode,
      drawNo,
      weight,
      stockAfter,
      drawnAt,
      clientTimezone,
      receivedAt,
    ] = this.parameters;
    if (this.database.records.has(id)) {
      return { success: true, results: [], meta: { changes: 0 } };
    }
    this.database.records.set(id, {
      id,
      prize_id: prizeId,
      prize_name: prizeName,
      prize_emoji: prizeEmoji,
      draw_mode: drawMode,
      draw_no: drawNo,
      weight,
      stock_after: stockAfter,
      drawn_at: drawnAt,
      client_timezone: clientTimezone,
      received_at: receivedAt,
    });
    return { success: true, results: [], meta: { changes: 1 } };
  }
}

class MockD1 {
  constructor() {
    this.records = new Map();
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    return await Promise.all(
      statements.map(async (statement) => {
        if (statement.sql.startsWith("CREATE ")) {
          return { success: true, results: [], meta: { changes: 0 } };
        }
        const records = [...this.records.values()].sort((a, b) => b.drawn_at - a.drawn_at);
        if (statement.sql.includes("COUNT(DISTINCT prize_name)")) {
          return {
            success: true,
            results: [{
              total: records.length,
              today: records.length,
              unique_prizes: new Set(records.map((record) => record.prize_name)).size,
              stock_mode: records.filter((record) => record.draw_mode === "stock").length,
            }],
            meta: {},
          };
        }
        if (statement.sql.startsWith("SELECT COUNT(*) AS total")) {
          return { success: true, results: [{ total: records.length }], meta: {} };
        }
        if (statement.sql.includes("FROM draw_records")) {
          return { success: true, results: records, meta: {} };
        }
        return await statement.run();
      })
    );
  }
}

const database = new MockD1();
const env = {
  DB: database,
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "test-password",
};

async function request(path, init = {}, requestEnv = env) {
  return await worker.fetch(new Request(`https://lottery.example${path}`, init), requestEnv);
}

const root = await request("/");
assert.equal(root.status, 200);
assert.match(root.headers.get("content-security-policy"), /default-src 'self'/);

const unauthorized = await request("/admin");
assert.equal(unauthorized.status, 401);
assert.match(unauthorized.headers.get("www-authenticate"), /^Basic /);

const authorization = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;
const protectedConfig = await request("/config");
assert.equal(protectedConfig.status, 401);

const configRedirect = await request("/config", {
  headers: { Authorization: authorization },
  redirect: "manual",
});
assert.equal(configRedirect.status, 302);
assert.equal(configRedirect.headers.get("location"), "/admin#config");

const authorizedAdmin = await request("/admin", {
  headers: { Authorization: authorization },
});
assert.equal(authorizedAdmin.status, 200);

const drawRecord = {
  id: "7f03d755-8af1-410c-a163-699c1c732138",
  prizeId: "prize-1",
  prizeName: "一等奖",
  prizeEmoji: "🏆",
  mode: "stock",
  drawNo: 1,
  weight: 2,
  stockAfter: 0,
  drawnAt: Date.now(),
  timezone: "Asia/Shanghai",
};

const inserted = await request("/api/draws", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://lottery.example",
  },
  body: JSON.stringify(drawRecord),
});
assert.equal(inserted.status, 201);

const duplicate = await request("/api/draws", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://lottery.example",
  },
  body: JSON.stringify(drawRecord),
});
assert.equal(duplicate.status, 200);
assert.equal(database.records.size, 1);

const rejected = await request("/api/draws", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prizeName: "缺少字段" }),
});
assert.equal(rejected.status, 400);

const adminData = await request("/api/admin/draws?page=1&pageSize=50", {
  headers: { Authorization: authorization },
});
assert.equal(adminData.status, 200);
const adminPayload = await adminData.json();
assert.equal(adminPayload.records.length, 1);
assert.equal(adminPayload.records[0].prize_name, "一等奖");
assert.equal(adminPayload.stats.total, 1);

const health = await request("/health");
assert.deepEqual(await health.json(), { ok: true, database: true });

console.log("Worker route, D1 record, validation, and Basic Auth tests passed");
