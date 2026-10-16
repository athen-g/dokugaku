import test from "node:test";
import assert from "node:assert/strict";
import {
  createDashboardService,
  dashboardMiddleware,
  dueSubjectCount,
  parseLocalConfig,
} from "./dashboard.mjs";

test("reads Windows PowerShell UTF-8 configuration files with a BOM", () =>
  assert.deepEqual(parseLocalConfig('\uFEFF{"checks":[]}'), { checks: [] }));

function fixture() {
  let clock = Date.parse("2026-10-17T02:00:00Z");
  let failAnki = false;
  let calls = 0;
  const service = createDashboardService({
    now: () => clock,
    loadSecret: async () => "server-only-secret",
    readConfig: async () => ({
      checks: [
        {
          target: "Study Schedule",
          data_sources: [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
        },
      ],
    }),
    fetchImpl: async (url, options) => {
      calls++;
      if (url.includes("8765")) {
        if (failAnki) throw new Error("do not expose server-only-secret");
        const request = JSON.parse(options.body);
        assert.ok(
          request.action === "deckNames" || request.action === "findCards",
        );
        if (request.action === "findCards")
          assert.match(request.params.query, /-tag:integration_test/);
        const result =
          request.action === "deckNames"
            ? ["ClASS", "ClASS::Lesson 1", "Default", "Japanese Study"]
            : request.params.query.includes("is:due")
              ? [1, 2]
              : request.params.query.includes("rated:1")
                ? [1]
                : [1, 2, 3];
        return { ok: true, json: async () => ({ result, error: null }) };
      }
      assert.equal(options.headers.Authorization, "Bearer server-only-secret");
      if (url.endsWith("/user"))
        return {
          ok: true,
          json: async () => ({
            data: {
              level: 3,
              subscription: { type: "free", max_level_granted: 3 },
            },
          }),
        };
      if (url.endsWith("/summary"))
        return {
          ok: true,
          json: async () => ({
            data: {
              reviews: [
                { available_at: "2026-10-17T01:00:00Z", subject_ids: [3, 4] },
                { available_at: "2026-10-18T01:00:00Z", subject_ids: [5] },
              ],
              lessons: [{ subject_ids: [8, 9] }],
            },
          }),
        };
      return {
        ok: true,
        json: async () => ({ properties: { Task: {}, Done: {} } }),
      };
    },
  });
  return {
    service,
    advance: () => (clock += 61000),
    fail: () => (failAnki = true),
    calls: () => calls,
  };
}
test("due items exclude future batches and deduplicate IDs", () =>
  assert.equal(
    dueSubjectCount(
      [
        { available_at: "2026-10-17T01:00:00Z", subject_ids: [1, 2] },
        { available_at: "2026-10-17T01:00:00Z", subject_ids: [2] },
        { available_at: "2026-10-18T01:00:00Z", subject_ids: [3] },
      ],
      Date.parse("2026-10-17T02:00:00Z"),
    ),
    2,
  ));
test("aggregates only read operations and never returns secrets", async () => {
  const f = fixture();
  const result = await f.service.get();
  assert.equal(result.services.anki.data.due, 2);
  assert.equal(result.services.anki.data.deckCount, 1);
  assert.equal(result.services.wanikani.data.due, 2);
  assert.equal(result.services.notion.data.loggingEnabled, false);
  assert.ok(!JSON.stringify(result).includes("server-only-secret"));
});
test("deduplicates concurrent loads and caches for one minute", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.service.get(), f.service.get()]);
  assert.strictEqual(a, b);
  const count = f.calls();
  await f.service.get();
  assert.equal(f.calls(), count);
  f.advance();
  await f.service.get();
  assert.ok(f.calls() > count);
});
test("Anki failure retains stale counts without hiding other services", async () => {
  const f = fixture();
  await f.service.get();
  f.advance();
  f.fail();
  const result = await f.service.get();
  assert.equal(result.services.anki.state, "offline");
  assert.equal(result.services.anki.stale, true);
  assert.equal(result.services.anki.data.due, 2);
  assert.equal(result.services.wanikani.state, "connected");
  assert.ok(!JSON.stringify(result).includes("server-only-secret"));
});
test("first-time failure reports unknown, never zero", async () => {
  const f = fixture();
  f.fail();
  const result = await f.service.get();
  assert.equal(result.services.anki.data, null);
  assert.equal(result.services.anki.stale, false);
});
test("API rejects cross-origin access, nonlocal hosts, and writes", async () => {
  const middleware = dashboardMiddleware({
    get: async () => ({ mode: "read-only" }),
  });
  for (const [headers, method, status] of [
    [{ host: "127.0.0.1:3000", origin: "https://example.com" }, "GET", 403],
    [{ host: "evil.example" }, "GET", 403],
    [{ host: "localhost:3000", "sec-fetch-site": "cross-site" }, "GET", 403],
    [{ host: "127.0.0.1:3000" }, "POST", 405],
    [{ host: "127.0.0.1:3000" }, "GET", 200],
  ]) {
    let body = "";
    const res = {
      statusCode: 200,
      setHeader() {},
      end(value) {
        body = value;
      },
    };
    await middleware({ url: "/api/dashboard", headers, method }, res, () =>
      assert.fail("unexpected next"),
    );
    assert.equal(res.statusCode, status);
    assert.ok(body);
  }
});
