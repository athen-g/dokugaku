import { useEffect, useState } from "react";
import { lessons, questions, examSections } from "../content/course.mjs";
import {
  api,
  ErrorNote,
  Heading,
  Listen,
  Ruby,
  useActivity,
  useAsyncAction,
} from "./study";
import type { StudyState } from "./study";
type Result = {
  id: string;
  score: number;
  total: number;
  passed?: boolean;
  results: { id: string; correct: boolean; answer: number | null }[];
};
type Attempt = {
  id: string;
  kind: "lesson" | "exam" | "practice";
  ids: string[];
  section: number;
  deadline: number | null;
  answers: Record<string, number>;
  closed?: boolean;
  result?: Result;
};
export default function Learning({
  mode,
}: {
  mode: "Learn" | "Mock exams" | "Mistakes" | "Listening" | "Reading";
}) {
  const [selected, setSelected] = useState(lessons[0]);
  const [state, setState] = useState<StudyState | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [showTranscript, setShowTranscript] = useState(false);
  const [paused, setPaused] = useState(false);
  const { busy, error, run, setError } = useAsyncAction();
  useActivity(!paused);
  useEffect(() => {
    void api<StudyState>("study")
      .then(setState)
      .catch((e) => setError(e.message));
    const t = setInterval(() => setClock(Date.now()), 1000);
    const active = localStorage.getItem(`dokugaku-${mode}-attempt`);
    if (active)
      void api("attempt/resume", { id: active })
        .then((r) => {
          if (!r.closed) {
            setAttempt(r);
            setClock(Date.now());
            const resumedIds =
              r.kind === "exam" ? examSections[r.section].ids : r.ids;
            setIndex(
              Math.max(
                0,
                resumedIds.findIndex(
                  (id: string) => r.answers[id] === undefined,
                ),
              ),
            );
            if (r.kind === "lesson") {
              const q = questions.find((q) => q.id === r.ids[0]);
              if (q)
                setSelected(
                  lessons.find((l) => l.id === q.topic) ?? lessons[0],
                );
            }
          } else {
            localStorage.removeItem(`dokugaku-${mode}-attempt`);
          }
        })
        .catch((e) => setError(e.message));
    return () => clearInterval(t);
  }, [mode]);
  const completed = new Set(
    state?.events.filter((e) => e.type === "lesson").map((e) => e.lessonId),
  );
  const latestResults = new Map<string, boolean>();
  state?.events.forEach((e) =>
    e.results?.forEach((r) => latestResults.set(r.id, r.correct)),
  );
  const wrongIds = [...latestResults]
    .filter(([, correct]) => !correct)
    .map(([id]) => id);
  const shortPractice = questions
    .filter((q) => q.section === mode.toLowerCase())
    .map((q) => q.id);
  function start(kind: Attempt["kind"], ids?: string[]) {
    void run(async () => {
      const r = await api("attempt/start", {
        kind,
        lessonId: selected.id,
        ids,
      });
      const a = {
        ...r,
        kind,
        ids:
          kind === "exam"
            ? examSections.flatMap((s) => s.ids)
            : kind === "lesson"
              ? [selected.questionId]
              : ids!,
        answers: {},
      };
      setAttempt(a);
      setClock(Date.now());
      localStorage.setItem(`dokugaku-${mode}-attempt`, r.id);
      setIndex(0);
      setResult(null);
      setPaused(false);
    });
  }
  const ids = attempt
    ? attempt.kind === "exam"
      ? examSections[attempt.section].ids
      : attempt.ids
    : [];
  const q = questions.find((q) => q.id === ids[index]);
  const expired = attempt?.deadline != null && clock >= attempt.deadline;
  const remaining = Math.max(
    0,
    Math.ceil(((attempt?.deadline ?? 0) - clock) / 1000),
  );
  function answer(n: number) {
    if (!attempt || !q) return;
    void run(async () => {
      await api("attempt/save", {
        id: attempt.id,
        questionId: q.id,
        answer: n,
      });
      setAttempt({ ...attempt, answers: { ...attempt.answers, [q.id]: n } });
    });
  }
  function finish() {
    if (!attempt) return;
    void run(async () => {
      const r = await api<Result>("attempt/finish", { id: attempt.id });
      setResult(r);
      setAttempt(null);
      localStorage.removeItem(`dokugaku-${mode}-attempt`);
      setState(await api("study"));
      void api("sync", {})
        .then(() => api<StudyState>("study").then(setState))
        .catch(() => {});
    });
  }
  function nextSection() {
    if (!attempt) return;
    void run(async () => {
      const r = await api("attempt/section", {
        id: attempt.id,
        section: attempt.section,
      });
      setAttempt({ ...attempt, ...r });
      setClock(Date.now());
      setIndex(0);
      setShowTranscript(false);
    });
  }
  return (
    <>
      <Heading
        eyebrow={
          mode === "Learn"
            ? "Start at the beginning. Build one sentence at a time."
            : mode === "Mock exams"
              ? "A practice paper. A clearer picture."
              : mode === "Mistakes"
                ? "Give the difficult things another look."
                : "A little practice, whenever you have room."
        }
        title={
          mode === "Learn"
            ? "The foundations."
            : mode === "Mock exams"
              ? "Make room for a mock."
              : mode === "Mistakes"
                ? "Your second look."
                : `${mode}, a little at a time.`
        }
      />
      <ErrorNote error={error} />
      {result ? (
        <section className="study-panel results">
          <p className="eyebrow">Saved automatically</p>
          <h2>
            {result.score} / {result.total} correct
          </h2>
          <p>
            {result.passed === false
              ? "Review the explanation, then try the lesson again."
              : result.passed
                ? "Lesson passed. Your path has been updated."
                : "Raw practice accuracy — this is not an official JLPT score or a pass prediction."}
          </p>
          <div className="result-sections">
            {["vocabulary", "grammar", "reading", "listening"].map(
              (section) => {
                const r = result.results.filter(
                  (r) =>
                    questions.find((q) => q.id === r.id)?.section === section,
                );
                return r.length ? (
                  <span key={section}>
                    {section}: {r.filter((x) => x.correct).length}/{r.length}
                  </span>
                ) : null;
              },
            )}
          </div>
          <button className="primary" onClick={() => setResult(null)}>
            Back to {mode === "Learn" ? "lessons" : "practice"} →
          </button>
          <div className="answer-review">
            {result.results.map((r, i) => {
              const item = questions.find((q) => q.id === r.id)!;
              return (
                <details key={r.id}>
                  <summary>
                    {r.correct ? "✓" : "↳"} {i + 1}. <Ruby text={item.prompt} />
                  </summary>
                  {item.passage && (
                    <p lang="ja">
                      <Ruby text={item.passage} />
                    </p>
                  )}
                  {item.audio && (
                    <>
                      <Listen text={item.audio} />
                      <p lang="ja">{item.audio}</p>
                    </>
                  )}
                  <p>
                    Your answer:{" "}
                    <Ruby
                      text={
                        r.answer === null
                          ? "Unanswered"
                          : item.options[r.answer]
                      }
                    />
                  </p>
                  <p>
                    Answer: <Ruby text={item.options[item.answer]} />
                  </p>
                  <p>
                    <Ruby text={item.explanation} />
                  </p>
                </details>
              );
            })}
          </div>
        </section>
      ) : attempt ? (
        <section className="study-panel exam-workspace">
          <div className="session-top">
            <span>
              {attempt.kind === "exam"
                ? examSections[attempt.section].title
                : attempt.kind === "lesson"
                  ? "Lesson check"
                  : `${mode} practice`}{" "}
              · {index + 1}/{ids.length}
            </span>
            {attempt.deadline && (
              <strong role="timer" aria-label="Time remaining">
                {Math.floor(remaining / 60)}:
                {String(remaining % 60).padStart(2, "0")}
              </strong>
            )}
          </div>
          <div className="progress-track">
            <span
              style={{
                width: `${(Object.keys(attempt.answers).filter((id) => ids.includes(id)).length / ids.length) * 100}%`,
              }}
            />
          </div>
          {expired && (
            <p role="alert" className="error-note">
              Time is up for this section. Your saved answers are kept.{" "}
              {attempt.section < 2
                ? "Continue to the next section."
                : "Finish to see your results."}
            </p>
          )}
          {paused ? (
            <div className="review-stage">
              <h2>A little breathing room.</h2>
              <button className="primary" onClick={() => setPaused(false)}>
                Resume practice →
              </button>
            </div>
          ) : (
            q && (
              <div className="question-block">
                <p className="eyebrow">{q.section} · furigana on</p>
                {q.passage && (
                  <div className="reading-passage" lang="ja">
                    <Ruby text={q.passage} />
                  </div>
                )}
                {q.audio && (
                  <>
                    <Listen key={q.id} text={q.audio} />
                    <p className="fine">
                      Device speech is practice audio, not an official
                      recording. Transcripts are available after finishing.
                    </p>
                    {attempt.kind !== "exam" && (
                      <button
                        className="text-button"
                        onClick={() => setShowTranscript((v) => !v)}
                      >
                        Show / hide transcript
                      </button>
                    )}
                    {showTranscript && attempt.kind !== "exam" && (
                      <p lang="ja">{q.audio}</p>
                    )}
                  </>
                )}
                <h2 lang="ja">
                  <Ruby text={q.prompt} />
                </h2>
                <div
                  className="question-options"
                  role="group"
                  aria-label="Choose an answer"
                >
                  {q.options.map((option, n) => (
                    <button
                      key={n}
                      className={attempt.answers[q.id] === n ? "chosen" : ""}
                      aria-pressed={attempt.answers[q.id] === n}
                      disabled={busy || expired}
                      onClick={() => answer(n)}
                    >
                      <span>{String.fromCharCode(65 + n)}</span>
                      <Ruby text={option} />
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
          <div className="exam-controls">
            <button
              className="secondary"
              disabled={busy || index === 0}
              onClick={() => {
                setIndex((i) => i - 1);
                setShowTranscript(false);
              }}
            >
              ← Previous
            </button>
            <span>
              {
                Object.keys(attempt.answers).filter((id) => ids.includes(id))
                  .length
              }
              /{ids.length} answered
            </span>
            <button
              className="secondary"
              disabled={busy || index >= ids.length - 1}
              onClick={() => {
                setIndex((i) => i + 1);
                setShowTranscript(false);
              }}
            >
              Next →
            </button>
          </div>
          <div className="question-map" aria-label="Question navigation">
            {ids.map((id, n) => (
              <button
                key={id}
                disabled={busy}
                aria-label={`Question ${n + 1}${attempt.answers[id] !== undefined ? ", answered" : ""}`}
                aria-current={n === index ? "step" : undefined}
                className={attempt.answers[id] !== undefined ? "answered" : ""}
                onClick={() => {
                  setIndex(n);
                  setShowTranscript(false);
                }}
              >
                {n + 1}
              </button>
            ))}
          </div>
          <div className="end-actions">
            {attempt.kind === "exam" && attempt.section < 2 ? (
              <button className="primary" disabled={busy} onClick={nextSection}>
                Submit section & continue →
              </button>
            ) : (
              <button className="primary" disabled={busy} onClick={finish}>
                {busy ? "Saving…" : "Finish & see results"} →
              </button>
            )}
            {attempt.kind !== "exam" && (
              <button
                className="text-button"
                onClick={() => setPaused((v) => !v)}
              >
                {paused ? "Resume" : "Take a break"}
              </button>
            )}
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("session/finish", { id: attempt.id });
                  localStorage.removeItem(`dokugaku-${mode}-attempt`);
                  setAttempt(null);
                  setIndex(0);
                })
              }
            >
              Leave without results
            </button>
          </div>
          <p className="fine">
            {attempt.kind === "exam"
              ? "Answers save as you choose them. Submitting a section locks it. The timer continues if you leave or refresh. Early submission is allowed."
              : "Answers save as you choose them. A wrong answer becomes an Anki card automatically when you finish."}
          </p>
        </section>
      ) : mode === "Learn" ? (
        <div className="learning-layout">
          <aside className="lesson-list" aria-label="Grammar lessons">
            {lessons.map((l) => (
              <button
                key={l.id}
                className={selected.id === l.id ? "selected" : ""}
                aria-pressed={selected.id === l.id}
                onClick={() => setSelected(l)}
              >
                <span>
                  {completed.has(l.id) ? "✓" : String(l.order).padStart(2, "0")}
                </span>
                <span>
                  {l.title}
                  <small>{l.pattern}</small>
                </span>
              </button>
            ))}
          </aside>
          <article className="study-panel lesson-content">
            <p className="eyebrow">
              Lesson {selected.order} / {lessons.length}
            </p>
            <h2>{selected.title}</h2>
            <p className="lesson-pattern" lang="ja">
              {selected.pattern}
            </p>
            <p>{selected.explanation}</p>
            <div className="lesson-example">
              <p lang="ja">
                <Ruby text={selected.example} />
              </p>
              <p>{selected.translation}</p>
              <Listen key={selected.id} text={selected.example} />
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => start("lesson")}
            >
              Check my understanding →
            </button>
            <p className="fine">
              {completed.has(selected.id)
                ? "You have passed this lesson. You can revisit it anytime."
                : "One focused explanation and a short check. Pass the check to complete the lesson."}
            </p>
          </article>
        </div>
      ) : mode === "Mock exams" ? (
        <section className="study-panel mock-intro">
          <p className="eyebrow">DokuGaku Original · Paper 01</p>
          <h2>A full timed practice session.</h2>
          <p>
            96 original multiple-choice questions across three sections.
            Includes furigana, reading passages, and device-generated Japanese
            listening practice.
          </p>
          <div className="paper-sections">
            {examSections.map((s, i) => (
              <div key={s.id}>
                <span>0{i + 1}</span>
                <h3>{s.title}</h3>
                <p>
                  {s.minutes} minutes · {s.ids.length} questions
                </p>
              </div>
            ))}
          </div>
          <p>
            The section timings follow N5. The question mix and audio are
            DokuGaku practice material; this paper is not an official exam
            replica. Furigana supports your current reading level. Results give
            raw accuracy, not a JLPT pass prediction.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => start("exam")}
          >
            Start timed paper →
          </button>
          <p className="fine">
            Allow 90 minutes. Check that Japanese audio plays before starting.
          </p>
          <Listen text="これは 音声の テストです。日本語が 聞こえますか。" />
          <a
            href="https://www.jlpt.jp/e/guideline/testsections.html"
            target="_blank"
            rel="noreferrer"
          >
            Official section timings ↗
          </a>
        </section>
      ) : mode === "Mistakes" ? (
        <section className="study-panel">
          <h2>A smaller, more useful queue.</h2>
          <p>
            {wrongIds.length
              ? `${wrongIds.length} questions have needed another look. A short practice round revisits them.`
              : "Your mistakes will appear here after you finish a lesson or paper. No manual logging needed."}
          </p>
          <button
            className="primary"
            disabled={busy || wrongIds.length === 0}
            onClick={() => start("practice", wrongIds.slice(0, 10))}
          >
            Practise up to 10 questions →
          </button>
          <p className="fine">
            Cards are added to DokuGaku::Mistakes in Anki, without changing your
            existing decks.
          </p>
        </section>
      ) : (
        <section className="study-panel">
          <p className="eyebrow">A five-question round</p>
          <h2>
            {mode === "Listening"
              ? "Listen for the small details."
              : "One short passage at a time."}
          </h2>
          <p>
            {mode === "Listening"
              ? "Practise times, directions, plans, and everyday exchanges. Listen before checking the transcript."
              : "Read a short passage with furigana, then choose an answer. Review the explanation after finishing."}
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const offset =
                state?.events.filter((e) => e.type === "practice").length ?? 0;
              const rotated = [
                ...shortPractice.slice(offset % shortPractice.length),
                ...shortPractice.slice(0, offset % shortPractice.length),
              ];
              start("practice", rotated.slice(0, 5));
            }}
          >
            Start short practice →
          </button>
          <p className="fine">
            Your results, mistakes, and study log save automatically.
          </p>
        </section>
      )}
    </>
  );
}
