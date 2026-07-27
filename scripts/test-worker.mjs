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

  async first() {
    if (this.sql === "SELECT COUNT(*) AS total FROM lottery_prizes") {
      return { total: this.database.prizes.size };
    }
    if (this.sql === "SELECT COUNT(*) AS total FROM draw_records") {
      return { total: this.database.records.size };
    }
    return null;
  }

  async run() {
    if (this.sql.startsWith("CREATE ")) {
      return { success: true, results: [], meta: { changes: 0 } };
    }
    if (this.sql.startsWith("INSERT OR IGNORE INTO lottery_settings")) {
      if (!this.database.settings) {
        this.database.settings = {
          revision: 1,
          updated_at: Number(this.parameters[0] || 0),
        };
      }
      return { success: true, results: [], meta: { changes: 0 } };
    }
    if (this.sql === "DELETE FROM lottery_prizes") {
      const changes = this.database.prizes.size;
      this.database.prizes.clear();
      return { success: true, results: [], meta: { changes } };
    }
    if (
      this.sql.startsWith("INSERT OR IGNORE INTO lottery_prizes") ||
      this.sql.startsWith("INSERT INTO lottery_prizes")
    ) {
      const [id, sortOrder, name, emoji] = this.parameters;
      const hasImageParameter = this.parameters.length === 9;
      const image = hasImageParameter ? this.parameters[4] : "";
      const offset = hasImageParameter ? 5 : 4;
      if (!this.database.prizes.has(id) || !this.sql.includes("OR IGNORE")) {
        this.database.prizes.set(id, {
          id,
          sort_order: sortOrder,
          name,
          emoji,
          image,
          weight: this.parameters[offset],
          stock: this.parameters[offset + 1],
          initial_stock: this.parameters[offset + 2],
          updated_at: this.parameters[offset + 3],
        });
      }
      return { success: true, results: [], meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE lottery_prizes SET stock = stock - 1")) {
      const [updatedAt, id] = this.parameters;
      const prize = this.database.prizes.get(id);
      if (!prize || prize.stock <= 0) {
        return { success: true, results: [], meta: { changes: 0 } };
      }
      prize.stock -= 1;
      prize.updated_at = updatedAt;
      return { success: true, results: [], meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE lottery_settings")) {
      this.database.settings ??= { revision: 1, updated_at: 0 };
      this.database.settings.revision += 1;
      this.database.settings.updated_at = Number(this.parameters[0] || Date.now());
      return { success: true, results: [], meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO draw_records")) {
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
    return { success: true, results: [], meta: { changes: 0 } };
  }
}

class MockD1 {
  constructor() {
    this.records = new Map();
    this.prizes = new Map();
    this.settings = null;
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    return await Promise.all(
      statements.map(async (statement) => {
        const records = [...this.records.values()].sort((a, b) => b.drawn_at - a.drawn_at);
        const prizes = [...this.prizes.values()].sort((a, b) => a.sort_order - b.sort_order);
        if (statement.sql.startsWith("SELECT revision, updated_at FROM lottery_settings")) {
          return { success: true, results: this.settings ? [this.settings] : [], meta: {} };
        }
        if (
          statement.sql.includes("FROM lottery_prizes") &&
          statement.sql.includes("ORDER BY sort_order ASC")
        ) {
          return { success: true, results: prizes, meta: {} };
        }
        if (statement.sql.includes("LEFT JOIN lottery_prizes")) {
          return {
            success: true,
            results: records.slice(0, 9).map((record) => ({
              ...record,
              prize_image: this.prizes.get(record.prize_id)?.image || "",
            })),
            meta: {},
          };
        }
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
        if (statement.sql.startsWith("SELECT COUNT(*) AS total FROM draw_records")) {
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
const authorization = `Basic ${Buffer.from("admin:test-password").toString("base64")}`;

async function request(path, init = {}, requestEnv = env) {
  return await worker.fetch(new Request(`https://lottery.example${path}`, init), requestEnv);
}

const root = await request("/");
assert.equal(root.status, 200);
assert.match(root.headers.get("content-security-policy"), /default-src 'self'/);

const unauthorized = await request("/admin");
assert.equal(unauthorized.status, 401);
assert.match(unauthorized.headers.get("www-authenticate"), /^Basic /);

const protectedConfigPage = await request("/config");
assert.equal(protectedConfigPage.status, 401);

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

const initialConfig = await request("/api/config");
assert.equal(initialConfig.status, 200);
const initialPayload = await initialConfig.json();
assert.equal(initialPayload.prizes.length, 8);
assert.equal(database.prizes.size, 8);

const unauthorizedConfigApi = await request("/api/admin/config");
assert.equal(unauthorizedConfigApi.status, 401);

const savedConfig = await request("/api/admin/config", {
  method: "PUT",
  headers: {
    Authorization: authorization,
    "Content-Type": "application/json",
    Origin: "https://lottery.example",
  },
  body: JSON.stringify({
    prizes: [
      {
        id: "gold-prize",
        name: "金奖",
        emoji: "🏆",
        image: "",
        weight: 1,
        stock: 1,
        initialStock: 1,
      },
      {
        id: "thanks-prize",
        name: "谢谢参与",
        emoji: "🍀",
        image: "",
        weight: 0,
        stock: 10,
        initialStock: 10,
      },
    ],
  }),
});
assert.equal(savedConfig.status, 200);
assert.equal(database.prizes.size, 2);

const publicConfig = await request("/api/config");
const publicConfigPayload = await publicConfig.json();
assert.deepEqual(publicConfigPayload.prizes.map((prize) => prize.name), ["金奖", "谢谢参与"]);

const inserted = await request("/api/draws", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://lottery.example",
  },
  body: JSON.stringify({ mode: "stock", timezone: "Asia/Shanghai" }),
});
assert.equal(inserted.status, 201);
const insertedPayload = await inserted.json();
assert.equal(insertedPayload.prize.id, "gold-prize");
assert.equal(insertedPayload.prize.stock, 0);
assert.equal(database.prizes.get("gold-prize").stock, 0);
assert.equal(database.records.size, 1);

const emptyStock = await request("/api/draws", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://lottery.example",
  },
  body: JSON.stringify({ mode: "stock", timezone: "Asia/Shanghai" }),
});
assert.equal(emptyStock.status, 409);

const rejected = await request("/api/draws", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
assert.equal(rejected.status, 400);

const adminData = await request("/api/admin/draws?page=1&pageSize=50", {
  headers: { Authorization: authorization },
});
assert.equal(adminData.status, 200);
const adminPayload = await adminData.json();
assert.equal(adminPayload.records.length, 1);
assert.equal(adminPayload.records[0].prize_name, "金奖");
assert.equal(adminPayload.stats.total, 1);

const health = await request("/health");
assert.deepEqual(await health.json(), { ok: true, database: true });

console.log("Worker D1 config, server-side draw, inventory, records, and Basic Auth tests passed");
