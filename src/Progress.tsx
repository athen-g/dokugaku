import { useEffect, useState } from "react";
import { lessons } from "../content/course.mjs";
import { api, ErrorNote, Heading, useAsyncAction } from "./study";
import type { StudyState } from "./study";
export default function Progress() {
  const [data, setData] = useState<StudyState | null>(null);
  const { busy, error, run } = useAsyncAction();
  async function load() {
    setData(await api("study"));
  }
  useEffect(() => {
    void run(load);
  }, []);
  const events = data?.events ?? [];
  const completed = new Set(
    events.filter((e) => e.type === "lesson").map((e) => e.lessonId),
  );
  const seconds = Object.values(data?.days ?? {}).reduce(
    (n, d) => n + d.seconds,
    0,
  );
  const [exportError, setExportError] = useState("");
  function download() {
    if (!data) return;
    try {
      const a = document.createElement("a");
      const u = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      a.href = u;
      a.download = "dokugaku-study-backup.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch {
      setExportError("Could not export. Your records are still saved locally.");
    }
  }
  return (
    <>
      <Heading
        eyebrow="Real activity. Quietly recorded."
        title="The work adds up."
      />
      <ErrorNote error={error || exportError} />
      {data && (
        <>
          <section className="progress-summary">
            {[
              [`${completed.size}/${lessons.length}`, "lessons passed"],
              [
                events.filter((e) => e.type === "anki" || e.type === "wanikani")
                  .length,
                "reviews saved here",
              ],
              [Math.floor(seconds / 60), "active minutes"],
              [
                events.filter((e) => e.type === "exam").length,
                "papers finished",
              ],
            ].map(([value, label]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </section>
          <div className="progress-columns">
            <section className="study-panel">
              <h2>Your study rhythm.</h2>
              <p className="fine">
                Activity done inside DokuGaku. Review totals from other apps
                remain visible on Today.
              </p>
              <div className="day-history">
                {Object.keys(data.days)
                  .sort()
                  .reverse()
                  .slice(0, 14)
                  .map((day) => (
                    <div key={day}>
                      <time>{day}</time>
                      <span>{Math.floor(data.days[day].seconds / 60)} min</span>
                      <span>
                        {events.filter((e) => e.day === day).length} activities
                      </span>
                    </div>
                  ))}
              </div>
              <h3>Recent results</h3>
              {events
                .filter((e) => e.total)
                .slice(-8)
                .reverse()
                .map((e) => (
                  <p key={e.id}>
                    {e.type === "lesson"
                      ? lessons.find((l) => l.id === e.lessonId)?.title
                      : e.type === "exam"
                        ? "Timed paper"
                        : "Practice"}{" "}
                    · {e.score}/{e.total}
                    <small> · {e.day}</small>
                  </p>
                ))}
              {!events.length && (
                <p>Your first completed activity will appear here.</p>
              )}
            </section>
            <section className="study-panel">
              <h2>Connected, automatically.</h2>
              <label className="check-setting">
                <input
                  type="checkbox"
                  checked={data.settings.notionLogs}
                  disabled={busy}
                  onChange={(e) =>
                    void run(async () => {
                      await api("settings", {
                        ...data.settings,
                        notionLogs: e.target.checked,
                      });
                      await load();
                    })
                  }
                />{" "}
                Update my Notion study log
              </label>
              <p className="fine">
                One daily entry, updated automatically. Failed updates wait
                locally and retry while the server runs.
              </p>
              <label className="check-setting">
                <input
                  type="checkbox"
                  checked={data.settings.autoCards}
                  disabled={busy}
                  onChange={(e) =>
                    void run(async () => {
                      await api("settings", {
                        ...data.settings,
                        autoCards: e.target.checked,
                      });
                      await load();
                    })
                  }
                />{" "}
                Create Anki cards from mistakes
              </label>
              <p className="fine">
                Uses the separate DokuGaku::Mistakes deck. Duplicate questions
                reuse their existing card.
              </p>
              <p>
                {
                  Object.values(data.cards).filter((c) => c.state === "synced")
                    .length
                }{" "}
                cards created ·{" "}
                {
                  Object.values(data.cards).filter((c) => c.state !== "synced")
                    .length
                }{" "}
                pending
              </p>
              <div className="sync-list">
                {Object.entries(data.sync)
                  .sort()
                  .reverse()
                  .slice(0, 5)
                  .map(([day, s]) => (
                    <p key={day}>
                      {day} · Notion{" "}
                      {s.state === "synced" ? "synced" : "waiting to retry"}
                    </p>
                  ))}
              </div>
              <div className="end-actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("sync", {});
                      await load();
                    })
                  }
                >
                  {busy ? "Checking…" : "Retry connections & refresh"}
                </button>
                <button className="text-button" onClick={download}>
                  Export my records ↓
                </button>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
