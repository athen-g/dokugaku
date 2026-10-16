import { useCallback, useEffect, useState } from "react";

type Connection<T> = {
  state: "connected" | "offline" | "setup";
  data: T | null;
  updatedAt: string | null;
  stale: boolean;
  message?: string;
};
type Dashboard = {
  checkedAt: string;
  mode: "read-only";
  services: {
    anki: Connection<{
      due: number;
      totalCards: number;
      reviewedToday: number;
      deckCount: number;
      scope: string;
    }>;
    wanikani: Connection<{
      due: number;
      lessons: number;
      level: number;
      maxLevel: number;
      subscription: string;
    }>;
    notion: Connection<{
      plannerReadable: boolean;
      fieldCount: number;
      loggingEnabled: false;
    }>;
  };
};
function time(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
export default function LiveDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dashboard", {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      const result: Dashboard = await response.json();
      if (result.mode !== "read-only" || !result.services) throw new Error();
      setDashboard(result);
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setError(
          "The local dashboard is unavailable. Keep the local server running and try again.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const interval = setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [load]);
  const anki = dashboard?.services.anki;
  const wk = dashboard?.services.wanikani;
  const notion = dashboard?.services.notion;
  function status(c: Connection<unknown> | undefined) {
    return !c
      ? "Checking"
      : c.state === "connected"
        ? "Connected"
        : c.stale
          ? "Last known data"
          : c.state === "setup"
            ? "Setup needed"
            : "Unavailable";
  }
  function hint(c: Connection<unknown> | undefined) {
    return c?.state !== "connected" ? c?.message : null;
  }
  return (
    <section className="live-dashboard" aria-labelledby="live-title">
      <div className="live-heading">
        <div>
          <h2 id="live-title">Your connected desk</h2>
          <p className="fine">
            Real account data. No reviews or logs are submitted yet.
          </p>
        </div>
        <button
          className="text-button"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Checking connections…" : "Refresh connections ↻"}
        </button>
      </div>
      {error && (
        <p className="connection-error" role="alert">
          {error}
          {dashboard
            ? " Showing the previous response; counts may be out of date."
            : ""}
        </p>
      )}
      <div className="connections-grid" aria-busy={loading}>
        <article className="connection">
          <div className="connection-name">
            <h3>Anki</h3>
            <span
              className={`connection-status ${anki?.state === "connected" && !error ? "online" : ""}`}
            >
              {error ? "Not refreshed" : status(anki)}
            </span>
          </div>
          {anki?.data ? (
            <>
              <p className="queue-number">
                {anki.data.due}
                <span> cards due</span>
              </p>
              <p className="fine">
                {anki.data.reviewedToday} distinct cards reviewed today.
                <br />
                {anki.data.totalCards} cards across {anki.data.deckCount} decks.
              </p>
              <details>
                <summary>Which cards are included?</summary>
                <p className="fine">
                  {anki.data.scope}. Due cards include learning and review
                  cards; new cards are not counted as due. Anki’s daily limits
                  can make its displayed queue smaller.
                </p>
              </details>
            </>
          ) : (
            <p className="connection-empty">
              {loading ? "Reading your decks…" : "Queue unknown"}
            </p>
          )}
          {hint(anki) && <p className="connection-error">{hint(anki)}</p>}
          {anki?.stale && anki.updatedAt && (
            <p className="fine">
              Last successful check: {time(anki.updatedAt)} IST
            </p>
          )}
        </article>
        <article className="connection">
          <div className="connection-name">
            <h3>WaniKani</h3>
            <span
              className={`connection-status ${wk?.state === "connected" && !error ? "online" : ""}`}
            >
              {error ? "Not refreshed" : status(wk)}
            </span>
          </div>
          {wk?.data ? (
            <>
              <p className="queue-number">
                {wk.data.due}
                <span> items due</span>
              </p>
              <p className="fine">
                Level {wk.data.level} · {wk.data.lessons} available lessons.
                <br />
                {wk.data.subscription === "free"
                  ? `Free account · access through level ${wk.data.maxLevel}.`
                  : `Account access through level ${wk.data.maxLevel}.`}
              </p>
            </>
          ) : (
            <p className="connection-empty">
              {loading ? "Reading your review queue…" : "Queue unknown"}
            </p>
          )}
          {hint(wk) && <p className="connection-error">{hint(wk)}</p>}
          {wk?.stale && wk.updatedAt && (
            <p className="fine">
              Last successful check: {time(wk.updatedAt)} IST
            </p>
          )}
        </article>
        <article className="connection">
          <div className="connection-name">
            <h3>Notion</h3>
            <span
              className={`connection-status ${notion?.state === "connected" && !error ? "online" : ""}`}
            >
              {error ? "Not refreshed" : status(notion)}
            </span>
          </div>
          {notion?.data ? (
            <>
              <p className="notion-ready">Planner available.</p>
              <p className="fine">
                Study Schedule is readable.
                <br />
                Automatic study logging comes next.
              </p>
            </>
          ) : (
            <p className="connection-empty">
              {loading ? "Checking planner access…" : "Planner access unknown"}
            </p>
          )}
          {hint(notion) && <p className="connection-error">{hint(notion)}</p>}
          {notion?.stale && notion.updatedAt && (
            <p className="fine">
              Last successful check: {time(notion.updatedAt)} IST
            </p>
          )}
        </article>
      </div>
      <p className="refresh-note" aria-live="polite">
        {dashboard ? `Checked ${time(dashboard.checkedAt)} IST. ` : ""}Checks
        run at most once a minute while this page is visible. You do not have to
        clear the whole queue today.
      </p>
    </section>
  );
}
