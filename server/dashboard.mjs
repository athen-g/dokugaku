import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const local = path.join(root, ".local");
const secretFiles = {
  wanikani: "wanikani-token.clixml",
  notion: "notion-token.clixml",
};

export async function windowsSecret(service) {
  const filename = secretFiles[service];
  if (!filename || process.platform !== "win32") throw new Error("setup");
  // DPAPI decryption happens in a child process. Its output stays in server memory.
  const script = `$ErrorActionPreference='Stop'; $s=Import-Clixml -LiteralPath '${path.join(local, filename).replaceAll("'", "''")}'; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 15000 },
    );
    if (!stdout.trim()) throw new Error();
    return stdout.trim();
  } catch {
    throw new Error("setup");
  }
}

export function dueSubjectCount(reviews, now) {
  return new Set(
    reviews
      .filter((r) => Date.parse(r.available_at) <= now)
      .flatMap((r) => r.subject_ids),
  ).size;
}

export function parseLocalConfig(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

export function createDashboardService({
  fetchImpl = fetch,
  loadSecret = windowsSecret,
  readConfig = async () =>
    parseLocalConfig(
      await readFile(path.join(local, "notion-check.json"), "utf8"),
    ),
  now = Date.now,
} = {}) {
  const lastGood = {};
  let cached = null;
  let inFlight = null;
  let cacheUntil = 0;
  async function json(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403 ? "auth" : "offline",
      );
    return response.json();
  }
  async function anki(action, params = {}) {
    const response = await json("http://127.0.0.1:8765", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    });
    if (response.error) throw new Error("offline");
    return response.result;
  }
  async function readAnki() {
    const scope =
      '-deck:"Japanese Study::Integration Test" -tag:integration_test';
    const [due, all, reviewed, names] = await Promise.all([
      anki("findCards", { query: `is:due -is:suspended ${scope}` }),
      anki("findCards", { query: scope }),
      anki("findCards", { query: `rated:1 ${scope}` }),
      anki("deckNames"),
    ]);
    return {
      due: due.length,
      totalCards: all.length,
      reviewedToday: reviewed.length,
      deckCount: names.filter(
        (n) => !n.includes("::") && !["Default", "Japanese Study"].includes(n),
      ).length,
      scope: "All decks; integration test cards excluded",
    };
  }
  async function readWaniKani() {
    const token = await loadSecret("wanikani");
    const headers = {
      Authorization: `Bearer ${token}`,
      "Wanikani-Revision": "20170710",
    };
    const [user, summary] = await Promise.all([
      json("https://api.wanikani.com/v2/user", { headers }),
      json("https://api.wanikani.com/v2/summary", { headers }),
    ]);
    return {
      level: user.data.level,
      subscription: user.data.subscription.type,
      maxLevel: user.data.subscription.max_level_granted,
      due: dueSubjectCount(summary.data.reviews, now()),
      lessons: new Set(summary.data.lessons.flatMap((r) => r.subject_ids)).size,
    };
  }
  async function readNotion() {
    const config = await readConfig().catch(() => {
      throw new Error("setup");
    });
    const id = config.checks?.find((c) => c.target === "Study Schedule")
      ?.data_sources?.[0]?.id;
    if (!id || !/^[a-f0-9-]{32,36}$/i.test(id)) throw new Error("setup");
    const token = await loadSecret("notion");
    const schema = await json(`https://api.notion.com/v1/data_sources/${id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2026-03-11",
      },
    });
    return {
      plannerReadable: true,
      fieldCount: Object.keys(schema.properties).length,
      loggingEnabled: false,
    };
  }
  async function safe(name, reader) {
    try {
      const data = await reader();
      const value = {
        state: "connected",
        updatedAt: new Date(now()).toISOString(),
        data,
        stale: false,
      };
      lastGood[name] = value;
      return value;
    } catch (error) {
      const messages = {
        anki: "Open Anki with AnkiConnect enabled, then refresh.",
        wanikani:
          error.message === "setup"
            ? "Set up the local WaniKani token."
            : "WaniKani could not be reached. Check your token or connection.",
        notion:
          error.message === "setup"
            ? "Set up the local Notion connection and planner access."
            : "Notion could not be reached. Check connection access or internet.",
      };
      return {
        state: error.message === "setup" ? "setup" : "offline",
        message: messages[name],
        data: lastGood[name]?.data ?? null,
        updatedAt: lastGood[name]?.updatedAt ?? null,
        stale: !!lastGood[name],
      };
    }
  }
  return {
    async get() {
      if (cached && now() < cacheUntil) return cached;
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const [anki, wanikani, notion] = await Promise.all([
          safe("anki", readAnki),
          safe("wanikani", readWaniKani),
          safe("notion", readNotion),
        ]);
        cached = {
          checkedAt: new Date(now()).toISOString(),
          mode: "read-only",
          services: { anki, wanikani, notion },
        };
        cacheUntil = now() + 60000;
        return cached;
      })();
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
  };
}

export function dashboardMiddleware(service) {
  return async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return next();
    const host = req.headers.host ?? "";
    const loopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
    const originOkay =
      !req.headers.origin || req.headers.origin === `http://${host}`;
    const crossSite = req.headers["sec-fetch-site"] === "cross-site";
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!loopback || !originOkay || crossSite) {
      res.statusCode = 403;
      return res.end('{"error":"Local same-origin access only."}');
    }
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      return res.end('{"error":"Read-only endpoint."}');
    }
    if (url.pathname !== "/api/dashboard") {
      res.statusCode = 404;
      return res.end('{"error":"Not found."}');
    }
    try {
      res.end(JSON.stringify(await service.get()));
    } catch {
      res.statusCode = 503;
      res.end('{"error":"Dashboard unavailable. Retry shortly."}');
    }
  };
}

export function dashboardPlugin() {
  const service = createDashboardService();
  return {
    name: "dokugaku-local-dashboard",
    configureServer(server) {
      server.middlewares.use(dashboardMiddleware(service));
    },
    configurePreviewServer(server) {
      server.middlewares.use(dashboardMiddleware(service));
    },
  };
}
