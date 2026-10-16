import { useEffect, useState } from "react";
import { toKana, toHiragana } from "wanakana";
import { api, ErrorNote, Heading, useActivity, useAsyncAction } from "./study";

type Card = {
  id: number;
  html?: string;
  css?: string;
  deck?: string;
  ticket?: string;
  word?: string;
  image?: string;
  type?: string;
  phase?: string;
  level?: number;
};
function cardDocument(html: string, css: string) {
  const doc = new DOMParser().parseFromString(
    html
      .replace(/\[anki:play:[^\]]+\]/g, "")
      .replace(
        /\[sound:([^\]]+)\]/g,
        (_, f) =>
          `<audio controls preload="none" src="/api/anki/media?name=${encodeURIComponent(f)}"></audio>`,
      ),
    "text/html",
  );
  doc
    .querySelectorAll("script,iframe,object,embed,form,link,meta,base,svg,math")
    .forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      if (
        a.name.startsWith("on") ||
        ["srcset", "action", "formaction", "href", "poster"].includes(a.name)
      )
        el.removeAttribute(a.name);
    });
    if (el.hasAttribute("src")) {
      const src = el.getAttribute("src")!;
      if (!src.startsWith("/api/anki/media?name=")) {
        let name = src;
        try {
          name = decodeURIComponent(src);
        } catch {}
        if (
          !/[\\/]/.test(name) &&
          /\.(mp3|wav|ogg|m4a|mp4|png|jpe?g|gif|webp)$/i.test(name)
        )
          el.setAttribute(
            "src",
            `/api/anki/media?name=${encodeURIComponent(name)}`,
          );
        else el.removeAttribute("src");
      }
    }
  });
  const origin = location.origin;
  const safeCSS = css.replace(/<\/style/gi, "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${origin}; media-src ${origin};"><base href="${origin}/"><style>${safeCSS}\nhtml,body{margin:0;padding:16px;background:#faf6eb;color:#29251f;font:22px/1.7 'Yu Gothic',sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}audio{max-width:100%}rt{font-size:.55em}.card{text-align:center}</style></head><body class="card">${doc.body.innerHTML}</body></html>`;
}
export default function Reviews() {
  const [source, setSource] = useState<"anki" | "wanikani">("anki");
  const [decks, setDecks] = useState<string[]>([]);
  const [deck, setDeck] = useState("");
  const [limit, setLimit] = useState(5);
  const [session, setSession] = useState(""),
    [card, setCard] = useState<Card | null>(null),
    [count, setCount] = useState(0),
    [total, setTotal] = useState(0),
    [done, setDone] = useState(false),
    [paused, setPaused] = useState(false),
    [revealed, setRevealed] = useState(false),
    [buttons, setButtons] = useState<number[]>([]),
    [intervals, setIntervals] = useState<string[]>([]),
    [answer, setAnswer] = useState(""),
    [feedback, setFeedback] = useState(""),
    [waiting, setWaiting] = useState(false);
  const [attempt, setAttempt] = useState(() => crypto.randomUUID());
  const { busy, error, run, setError } = useAsyncAction();
  useActivity(!!session && !done && !paused);
  useEffect(() => {
    void api("anki/decks")
      .then((r) => {
        setDecks(r.decks);
        setDeck(r.decks[0] ?? "");
      })
      .catch((e) => setError(e.message));
    const active = localStorage.getItem("dokugaku-review-session");
    if (active)
      void api("review/resume", { id: active })
        .then((r) => {
          if (r.closed) {
            localStorage.removeItem("dokugaku-review-session");
            return;
          }
          setSession(r.id);
          setSource(r.source);
          setCard(r.card);
          setTotal(r.limit);
          setCount(r.index);
          setDone(!r.card);
          setRevealed(r.revealed);
          setButtons(r.buttons ?? []);
          setIntervals(r.nextReviews ?? []);
        })
        .catch((e) => setError(e.message));
  }, []);
  function reset(next: "anki" | "wanikani") {
    if (session && !done)
      void api("session/finish", { id: session }).catch(() => {});
    setSource(next);
    setSession("");
    localStorage.removeItem("dokugaku-review-session");
    setCard(null);
    setDone(false);
    setCount(0);
    setPaused(false);
    setFeedback("");
    setWaiting(false);
    setError("");
  }
  function begin() {
    void run(async () => {
      const r = await api(`${source}/start`, { deck, limit });
      setSession(r.id);
      localStorage.setItem("dokugaku-review-session", r.id);
      setCard(r.card);
      setTotal(r.limit);
      setCount(0);
      setDone(!r.card);
      setRevealed(false);
      setFeedback("");
      setAttempt(crypto.randomUUID());
    });
  }
  async function nextAnki() {
    const r = await api("anki/next", { id: session });
    setCard(r.card);
    setDone(!r.card);
    setWaiting(false);
    setRevealed(false);
  }
  function rate(ease: number) {
    void run(async () => {
      const r = await api("anki/rate", {
        id: session,
        ticket: card?.ticket,
        ease,
      });
      setCount(r.index);
      setRevealed(false);
      if (r.done) {
        setDone(true);
        setCard(null);
        void api("sync", {}).catch(() => {});
      } else {
        setWaiting(true);
        await nextAnki();
      }
    });
  }
  function check() {
    void run(async () => {
      const r = await api("wanikani/answer", {
        id: session,
        cardId: card?.id,
        phase: card?.phase,
        answer: card?.phase === "reading" ? toHiragana(answer) : answer,
        attempt,
      });
      setAttempt(crypto.randomUUID());
      if (!r.correct) {
        setFeedback(
          `Not quite. Accepted: ${r.expected}. Try it once more; this miss is recorded.`,
        );
        setAnswer("");
        return;
      }
      setFeedback(
        r.saved
          ? "Review saved to WaniKani."
          : "Meaning correct. Now recall the reading.",
      );
      setAnswer("");
      setCard(r.card);
      setCount(r.index ?? count);
      if (r.done) {
        setDone(true);
        void api("sync", {}).catch(() => {});
      }
    });
  }
  return (
    <>
      <Heading
        eyebrow="Your existing decks. Your existing schedules."
        title="One card at a time."
      />
      <div className="review-layout">
        <section className="review-workspace">
          <div
            className="source-selector"
            role="group"
            aria-label="Review source"
          >
            {(["anki", "wanikani"] as const).map((s) => (
              <button
                key={s}
                aria-pressed={source === s}
                disabled={busy}
                onClick={() => reset(s)}
              >
                {s === "anki" ? "Anki" : "WaniKani"}
              </button>
            ))}
          </div>
          <ErrorNote error={error} />
          {!session ? (
            <div className="review-stage setup">
              <h2>A short round is enough.</h2>
              <p>
                These are real reviews. Answers you submit update{" "}
                {source === "anki" ? "Anki" : "WaniKani"}.
              </p>
              {source === "anki" && (
                <label className="field">
                  Deck
                  <select
                    value={deck}
                    onChange={(e) => setDeck(e.target.value)}
                  >
                    {decks.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Round size
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  {[5, 10, 20].map((n) => (
                    <option key={n} value={n}>
                      {n} cards
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={busy || (source === "anki" && !deck)}
                onClick={begin}
              >
                {busy ? "Opening…" : "Start real review"} →
              </button>
            </div>
          ) : done ? (
            <div className="review-stage complete">
              <span className="completion-mark">✓</span>
              <h2>A good place to pause.</h2>
              <p>
                {count} reviews saved
                {count === 0 ? ". No answers were submitted." : "."}
              </p>
              <p className="fine">
                Anki respects its deck limits and learning steps. WaniKani
                rounds include due assignments only.
              </p>
              <button className="primary" onClick={() => reset(source)}>
                Back to setup →
              </button>
            </div>
          ) : paused ? (
            <div className="review-stage">
              <h2>Take your time.</h2>
              <p>
                Your round is paused. No answer is submitted while you rest.
              </p>
              <button className="primary" onClick={() => setPaused(false)}>
                Resume →
              </button>
            </div>
          ) : (
            <>
              <div className="session-top">
                <span>{source === "anki" ? card?.deck : card?.type}</span>
                <span>
                  {count} / {total} saved
                </span>
              </div>
              <div className="progress-track">
                <span
                  style={{ width: `${total ? (count / total) * 100 : 0}%` }}
                />
              </div>
              <div className="real-card">
                {waiting ? (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void run(nextAnki)}
                  >
                    Load next card
                  </button>
                ) : source === "anki" && card ? (
                  <>
                    <iframe
                      title={revealed ? "Anki answer" : "Anki question"}
                      sandbox=""
                      srcDoc={cardDocument(card.html ?? "", card.css ?? "")}
                    />
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api("anki/audio", {
                            id: session,
                            ticket: card.ticket,
                          });
                          setFeedback("Audio requested in Anki.");
                        })
                      }
                    >
                      ▶ Play card audio
                    </button>
                    <p className="fine">
                      Card audio plays through Anki on this computer.
                      {feedback && ` ${feedback}`}
                    </p>
                    {!revealed ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const r = await api("anki/reveal", {
                              id: session,
                              ticket: card.ticket,
                            });
                            setCard({ ...card, html: r.html, css: r.css });
                            setButtons(r.buttons);
                            setIntervals(r.nextReviews);
                            setRevealed(true);
                          })
                        }
                      >
                        Reveal answer ↓
                      </button>
                    ) : (
                      <div className="rating-buttons">
                        {buttons.map((b, i) => (
                          <button
                            key={b}
                            disabled={busy}
                            className={b === 3 ? "good" : ""}
                            onClick={() => rate(b)}
                          >
                            <span>
                              {["Again", "Hard", "Good", "Easy"][b - 1]}
                            </span>
                            <small>{intervals[i]}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : card ? (
                  <>
                    <p className="question-type">
                      {card.type} ·{" "}
                      {card.phase === "meaning"
                        ? "English meaning"
                        : "Japanese reading"}
                    </p>
                    <div className="review-word" lang="ja">
                      {card.word || (
                        <img src={card.image} alt="WaniKani radical" />
                      )}
                    </div>
                    <form
                      className="answer-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        check();
                      }}
                    >
                      <label htmlFor="wk-answer">
                        {card.phase === "meaning"
                          ? "What does it mean?"
                          : "Type the reading. Romaji converts to kana."}
                      </label>
                      <input
                        autoFocus
                        key={`${card.id}-${card.phase}`}
                        id="wk-answer"
                        value={answer}
                        onChange={(e) =>
                          setAnswer(
                            card.phase === "reading" &&
                              !(e.nativeEvent as InputEvent).isComposing
                              ? toKana(e.target.value, { IMEMode: true })
                              : e.target.value,
                          )
                        }
                        autoComplete="off"
                        spellCheck={false}
                        lang={card.phase === "reading" ? "ja" : "en"}
                      />
                      <button
                        className="primary"
                        disabled={busy || !answer.trim()}
                      >
                        Check answer →
                      </button>
                    </form>
                    <p className="fine">{feedback}</p>
                  </>
                ) : null}
              </div>
            </>
          )}
          {session && !done && (
            <div className="session-bottom">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setPaused((v) => !v)}
              >
                {paused ? "Resume" : "Take a break"}
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("session/finish", { id: session });
                    setDone(true);
                    await api("sync", {});
                  })
                }
              >
                Finish for now
              </button>
            </div>
          )}
        </section>
        <aside className="review-aside">
          <span className="small-seal" lang="ja">
            学
          </span>
          <h2>Room to remember.</h2>
          <p>
            You do not have to empty the queue. Five thoughtful reviews count.
          </p>
          <hr />
          <h3>Your schedule stays connected.</h3>
          <p>
            Anki must stay open. DokuGaku uses Anki’s reviewer and its available
            ratings. Avoid reviewing the same deck in both windows at once.
          </p>
          <p className="fine">
            Custom card scripts stay disabled in the embedded view. Use Anki’s
            own window for script-driven template controls.
          </p>
          <p>
            WaniKani checks both meaning and reading where required. Incorrect
            attempts count toward its review result.
          </p>
          <p className="fine">
            Furigana is included in lessons and practice. Recall cards keep
            their original prompts so they do not reveal the answer.
          </p>
        </aside>
      </div>
    </>
  );
}
