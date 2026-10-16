import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export async function api<T = any>(path: string, body?: object): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body
      ? { "Content-Type": "application/json", "X-DokuGaku": "1" }
      : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "The study service is unavailable.");
  return data;
}
export type StudyState = {
  events: {
    id: string;
    type: string;
    at: string;
    day: string;
    lessonId?: string;
    score?: number;
    total?: number;
    results?: { id: string; correct: boolean; answer: number | null }[];
  }[];
  days: Record<string, { seconds: number }>;
  sync: Record<string, { state: string; at?: string }>;
  cards: Record<string, { state: string }>;
  settings: { autoCards: boolean; notionLogs: boolean };
};
export function Ruby({ text }: { text: string }) {
  return (
    <>
      {text.split(/([^\s\[\]]+)\[([^\]]+)\]/g).map((v, i, a) =>
        i % 3 === 1 ? (
          <ruby key={i}>
            {v}
            <rt>{a[i + 1]}</rt>
          </ruby>
        ) : i % 3 === 2 ? null : (
          v
        ),
      )}
    </>
  );
}
export function Heading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="review-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </section>
  );
}
export function ErrorNote({ error }: { error: string }) {
  return error ? (
    <p className="error-note" role="alert">
      {error}
    </p>
  ) : null;
}
export function useActivity(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let active = Date.now(),
      last = Date.now();
    const touch = () => {
      active = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      const n = Date.now();
      const seconds =
        !document.hidden && n - active < 60000
          ? Math.min(15, (n - last) / 1000)
          : 0;
      last = n;
      if (seconds) void api("activity", { seconds }).catch(() => {});
    }, 15000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [enabled]);
}
export function Listen({ text }: { text: string }) {
  const [status, setStatus] = useState("");
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    function ready() {
      setAvailable(
        "speechSynthesis" in window &&
          speechSynthesis.getVoices().some((v) => v.lang.startsWith("ja")),
      );
    }
    ready();
    window.speechSynthesis?.addEventListener("voiceschanged", ready);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", ready);
      window.speechSynthesis?.cancel();
    };
  }, []);
  function play() {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(
      text.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, "$2"),
    );
    u.lang = "ja-JP";
    u.voice =
      speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja")) ?? null;
    u.rate = 0.85;
    u.onstart = () => setStatus("Playing…");
    u.onend = () => setStatus("");
    u.onerror = () => setStatus("Audio could not play.");
    speechSynthesis.speak(u);
  }
  return (
    <div className="listen">
      <button className="secondary" disabled={!available} onClick={play}>
        ▶ {status || "Play Japanese audio"}
      </button>
      <small>
        {available
          ? "Device-generated speech · practice audio"
          : "No Japanese voice found. Install a Japanese speech voice in Windows to play this audio."}
      </small>
    </div>
  );
}
export function useAsyncAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
