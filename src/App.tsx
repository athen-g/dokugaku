import { useEffect, useState } from "react";
import LiveDashboard from "./LiveDashboard";
import Reviews from "./Reviews";
import Learning from "./Learning";
import Progress from "./Progress";
import Resources from "./Resources";
import { api, Heading, useActivity, ErrorNote } from "./study";
import type { StudyState } from "./study";
import { lessons } from "../content/course.mjs";
const navigation = [
  ["Today", "⌂"],
  ["Learn", "本"],
  ["Review", "↻"],
  ["Mock exams", "▤"],
  ["Progress", "▥"],
  ["Library", "▧"],
] as const;
type Page =
  (typeof navigation)[number][0] | "Mistakes" | "Listening" | "Reading";
export default function App() {
  const [dark, setDark] = useState(
    () => localStorage.getItem("dokugaku-theme") === "dark",
  );
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem("dokugaku-page");
    return [
      ...navigation.map((n) => n[0]),
      "Mistakes",
      "Listening",
      "Reading",
    ].includes(saved ?? "")
      ? (saved as Page)
      : "Today";
  });
  useEffect(() => {
    localStorage.setItem("dokugaku-page", page);
  }, [page]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("dokugaku-theme", dark ? "dark" : "light");
  }, [dark]);
  function go(p: Page) {
    setPage(p);
    window.scrollTo(0, 0);
  }
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              go("Today");
            }}
          >
            DokuGaku
            <span lang="ja">
              独学 <b aria-hidden="true">独</b>
            </span>
          </a>
          <nav aria-label="Main navigation">
            {navigation.map(([name, icon]) => (
              <button
                key={name}
                className={`nav-item ${page === name ? "selected" : ""}`}
                aria-current={page === name ? "page" : undefined}
                onClick={() => go(name)}
              >
                <span className="nav-symbol" aria-hidden="true">
                  {icon}
                </span>
                {name}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <p className="sidebar-note">
              A little, regularly.
              <br />
              少しずつ。
            </p>
            <button
              className="theme-button"
              onClick={() => setDark((v) => !v)}
              aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
            >
              {dark ? "☾" : "☼"} {dark ? "Dark" : "Light"}{" "}
              <span>/ {dark ? "Light" : "Dark"}</span>
            </button>
          </div>
        </aside>
        <main id="main">
          <header className="topline">
            <span>Your study desk</span>
            <span>
              JLPT N5 <i />6 December 2026
            </span>
          </header>
          {page === "Today" ? (
            <Today go={go} />
          ) : page === "Review" ? (
            <Reviews />
          ) : page === "Learn" ||
            page === "Listening" ||
            page === "Reading" ||
            page === "Mock exams" ||
            page === "Mistakes" ? (
            <Learning key={page} mode={page} />
          ) : page === "Progress" ? (
            <Progress />
          ) : (
            <Library go={go} />
          )}
          <footer>
            <div className="resource-list">
              <span>Anki</span>
              <b>·</b>
              <span>WaniKani</span>
              <b>·</b>
              <span>Notion</span>
            </div>
            <span className="preview-label">
              Private study desk · saved locally
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}
function Today({ go }: { go: (p: Page) => void }) {
  const [state, setState] = useState<StudyState | null>(null);
  const [historyError, setHistoryError] = useState("");
  useActivity();
  useEffect(() => {
    void api<StudyState>("study")
      .then(setState)
      .catch((e) => setHistoryError(e.message));
  }, []);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  const weekend = [0, 6].includes(new Date().getDay());
  const budget = weekend ? 120 : 60;
  const completed = new Set(
    state?.events.filter((e) => e.type === "lesson").map((e) => e.lessonId),
  );
  const next = lessons.find((l) => !completed.has(l.id));
  const mins = Math.floor((state?.days[today]?.seconds ?? 0) / 60);
  const days = Math.max(
    0,
    Math.ceil(
      (Date.parse("2026-12-06T00:00:00+05:30") - Date.now()) / 86400000,
    ),
  );
  const rows: [Page, string, string, string][] = [
    [
      "Review",
      "A manageable review round",
      "Start with five Anki or WaniKani cards.",
      weekend ? "25 min" : "15 min",
    ],
    [
      "Learn",
      next ? next.title : "Revisit a grammar foundation",
      next
        ? `Lesson ${next.order} · ${next.pattern}`
        : "Choose any lesson to refresh.",
      weekend ? "35 min" : "20 min",
    ],
    [
      "Mistakes",
      "Give the difficult things another look",
      "Practise mistakes; cards and logs take care of themselves.",
      weekend ? "20 min" : "10 min",
    ],
    [
      weekend ? "Mock exams" : "Listening",
      weekend ? "Make space for a mock" : "Listening & exam practice",
      weekend
        ? "A full paper takes 90 minutes. Use a longer weekend session."
        : "Five short listening questions with Japanese audio.",
      weekend ? "90 min" : "15 min",
    ],
  ];
  return (
    <>
      <section className="greeting">
        <p className="eyebrow">Make a little room to learn</p>
        <h1>
          A little progress,
          <br className="desktop-break" /> every day
          <span className="accent">.</span>
        </h1>
        <p className="subtitle">
          {days} days to N5. One focused session. Then take a breath.
        </p>
      </section>
      <section className="review-invitation" aria-labelledby="invite-title">
        <div className="invite-copy">
          <span className="section-mark">Start small</span>
          <h2 id="invite-title">
            A short round.
            <br />A fresh start.
          </h2>
          <p>
            Your own pace <span className="dot">·</span> everything recorded
          </p>
          <button className="primary" onClick={() => go("Review")}>
            Start a real review <span>→</span>
          </button>
          <p className="fine">
            Your answers update your existing review schedules.
          </p>
        </div>
        <img
          className="sparrow"
          src="/sparrow.png"
          alt="An ink-painted sparrow beside two thread-bound notebooks"
        />
      </section>
      <LiveDashboard />
      <ErrorNote error={historyError} />
      <div className="today-lower">
        <section className="path">
          <h2>Today’s path</h2>
          <div className="double-rule" />
          {rows.map(([dest, title, desc, duration], i) => (
            <button className="path-row" key={dest} onClick={() => go(dest)}>
              <span className="ordinal">0{i + 1}</span>
              <span>
                <strong>{title}</strong>
                <small>{desc}</small>
              </span>
              <span className="row-meta">{duration}</span>
              <span>→</span>
            </button>
          ))}
        </section>
        <aside className="rhythm">
          <h2>Room for a break.</h2>
          <div className="double-rule" />
          <p className="rhythm-intro">
            {state ? mins : "—"} active minutes today.
          </p>
          <p>
            {budget} minutes is your{" "}
            {weekend
              ? "weekend baseline. A full paper can use your longer 2–3 hour session."
              : "weekday plan, including breaks."}
          </p>
          <p className="fine">
            The plan is a guide. Review queues are information, not a finish
            line. Try a break every twenty minutes.
          </p>
          <div className="small-note">
            ↳ {state ? completed.size : "—"}/{lessons.length} foundation lessons
            passed.
          </div>
        </aside>
      </div>
    </>
  );
}
function Library({ go }: { go: (p: Page) => void }) {
  return (
    <>
      <Heading
        eyebrow="One desk. All your resources."
        title="Keep good company."
      />
      <Resources />
      <div className="library-grid">
        <section className="study-panel">
          <p className="eyebrow">Built into your desk</p>
          <h2>Learn, practise, remember.</h2>
          <p>
            Original grammar explanations, examples with furigana, timed papers,
            automatic mistake cards, and your activity history.
          </p>
          <div className="library-actions">
            <button className="secondary" onClick={() => go("Listening")}>
              Short listening practice →
            </button>
            <button className="secondary" onClick={() => go("Reading")}>
              Short reading practice →
            </button>
            <button className="secondary" onClick={() => go("Learn")}>
              Grammar foundations →
            </button>
            <button className="secondary" onClick={() => go("Mistakes")}>
              My mistakes →
            </button>
            <button className="secondary" onClick={() => go("Mock exams")}>
              Timed mock paper →
            </button>
          </div>
        </section>
        <section className="study-panel">
          <p className="eyebrow">Your connected resources</p>
          <h2>Everything has a place.</h2>
          <p>
            Anki and WaniKani reviews are available in Review. Notion gets a
            daily activity summary automatically while the local server runs.
          </p>
          <ul className="resource-links">
            <li>
              <a
                href="https://www.wanikani.com/"
                target="_blank"
                rel="noreferrer"
              >
                WaniKani account ↗
              </a>
            </li>
            <li>
              <a href="https://www.notion.so/" target="_blank" rel="noreferrer">
                Notion workspace ↗
              </a>
            </li>
            <li>
              <a
                href="https://www.jlpt.jp/e/samples/forlearners.html"
                target="_blank"
                rel="noreferrer"
              >
                Official JLPT practice workbooks & audio ↗
              </a>
            </li>
            <li>
              <a
                href="https://www.jlpt.jp/e/samples/sampleindex.html"
                target="_blank"
                rel="noreferrer"
              >
                Official sample questions ↗
              </a>
            </li>
          </ul>
          <p className="fine">
            External papers stay at their source. DokuGaku’s built-in paper is
            original material. No protected paper has been republished in this
            public repository.
          </p>
        </section>
      </div>
      <section className="study-panel roadmap">
        <p className="eyebrow">Your route to 6 December</p>
        <h2>A steady path through N5.</h2>
        <p>
          Begin with basic sentences and particles, then verb and adjective
          forms. Revisit missed questions in short rounds. Use weekend papers to
          find gaps in reading and listening. In the final week, focus on
          mistakes, familiar material, and rest.
        </p>
        <p className="fine">
          No paid AI services are used. Japanese practice audio uses an
          installed device voice. This is an independent study tool, not
          affiliated with WaniKani or the JLPT organisers.
        </p>
      </section>
    </>
  );
}
