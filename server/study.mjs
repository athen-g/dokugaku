import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { windowsSecret, parseLocalConfig } from "./dashboard.mjs";
import { lessons, questions, examSections } from "../content/course.mjs";

const local = fileURLToPath(new URL("../.local/", import.meta.url));
const day = (n = Date.now()) =>
  new Date(n + 19800000).toISOString().slice(0, 10);
const clean = (v) =>
  String(v ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[.!?。！・]/g, "")
    .replace(/\s+/g, " ");
export const kana = (v) =>
  clean(v).replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
const strip = (v) => v.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, "$1（$2）");
const escapeHTML = (v) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
class PublicError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const requireThat = (v, m, status) => {
  if (!v) throw new PublicError(m, status);
};
export function fileStore(directory = local) {
  const filename = path.join(directory, "study-state.json");
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filename, "utf8"));
      } catch (e) {
        if (e.code === "ENOENT")
          return {
            version: 1,
            sessions: {},
            events: [],
            days: {},
            sync: {},
            cards: {},
            settings: { autoCards: true, notionLogs: true },
          };
        throw e;
      }
    },
    async write(value) {
      await mkdir(directory, { recursive: true });
      const tmp = `${filename}.${randomUUID()}.tmp`;
      await writeFile(tmp, JSON.stringify(value), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(tmp, filename);
    },
  };
}

export function createStudyService({
  fetchImpl = fetch,
  loadSecret = windowsSecret,
  store = fileStore(),
  now = Date.now,
  readConfig = async () =>
    parseLocalConfig(
      await readFile(path.join(local, "notion-check.json"), "utf8"),
    ),
} = {}) {
  let state,
    serial = Promise.resolve();
  async function json(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new PublicError(
        "Connection interrupted. Refresh before continuing; an interrupted submission is never automatically sent twice.",
        503,
      );
    }
    if (!response.ok)
      throw new PublicError(
        response.status === 429
          ? "Service rate limit reached. Please wait a minute."
          : `Connected service declined the request (${response.status}). Check access and try again.`,
        503,
      );
    return response.json();
  }
  async function anki(action, params = {}) {
    const r = await json("http://127.0.0.1:8765", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
    });
    if (r.error) {
      if (
        action === "guiCurrentCard" &&
        /reviewer is not available|review is not currently active/i.test(
          String(r.error),
        )
      )
        return null;
      throw new PublicError(
        "Anki could not complete that action. Keep Anki open, close any dialogs, and refresh. If reviewing, leave the same deck open.",
        503,
      );
    }
    return r.result;
  }
  async function wk(endpoint, method = "GET", body) {
    const token = await loadSecret("wanikani");
    return json(`https://api.wanikani.com/v2/${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Wanikani-Revision": "20170710",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function pages(endpoint) {
    let result = [];
    let url = endpoint;
    while (url) {
      const r = await wk(url);
      result.push(...r.data);
      url = r.pages?.next_url;
      if (url) {
        requireThat(
          url.startsWith("https://api.wanikani.com/v2/"),
          "Unexpected service pagination.",
          503,
        );
        url = url.slice("https://api.wanikani.com/v2/".length);
      }
      if (result.length > 10000) throw new PublicError("Queue too large.", 503);
    }
    return result;
  }
  function event(id, type, details = {}) {
    if (state.events.some((e) => e.id === id)) return;
    state.events.push({
      id,
      type,
      at: new Date(now()).toISOString(),
      day: day(now()),
      ...details,
    });
  }
  function session(id, type) {
    const s = state.sessions[id];
    requireThat(
      s && (!type || s.type === type),
      "This session is unavailable. Start a new round.",
      404,
    );
    return s;
  }
  async function persist() {
    await store.write(state);
  }
  async function queueCard(q) {
    const key = q.id;
    if (!state.cards[key])
      state.cards[key] = { state: "pending", questionId: q.id };
  }
  async function syncCards() {
    if (!state.settings.autoCards) return;
    const items = Object.entries(state.cards)
      .filter(([, v]) => v.state !== "synced")
      .slice(0, 8);
    if (!items.length) return;
    try {
      await anki("createDeck", { deck: "DokuGaku::Mistakes" });
      const model = "DokuGaku Recall";
      const models = await anki("modelNames");
      if (!models.includes(model))
        await anki("createModel", {
          modelName: model,
          inOrderFields: ["Front", "Back"],
          css: ".card { font-family: sans-serif; font-size: 24px; text-align: center; }",
          cardTemplates: [
            {
              Name: "Recall",
              Front: "{{Front}}",
              Back: '{{FrontSide}}<hr id="answer">{{Back}}',
            },
          ],
        });
      for (const [key, item] of items) {
        const q = questions.find((q) => q.id === key);
        if (!q) continue;
        const tag = `dokugaku_${key}`;
        const found = await anki("findNotes", { query: `tag:${tag}` });
        let noteId = found[0];
        if (!noteId) {
          noteId = await anki("addNote", {
            note: {
              deckName: "DokuGaku::Mistakes",
              modelName: model,
              fields: {
                Front: escapeHTML(
                  strip(`${q.passage ?? ""}\n${q.audio ?? ""}\n${q.prompt}`),
                ),
                Back: escapeHTML(
                  strip(`${q.options[q.answer]} — ${q.explanation}`),
                ),
              },
              tags: ["dokugaku", tag],
              options: { allowDuplicate: false },
            },
          });
        }
        requireThat(noteId, "Card creation failed.", 503);
        item.state = "synced";
        item.noteId = noteId;
        await persist();
      }
    } catch {
      for (const [, item] of items)
        if (item.state !== "synced") item.state = "pending";
    }
  }
  async function syncNotion() {
    if (!state.settings.notionLogs) return;
    const days = [...new Set(state.events.map((e) => e.day))]
      .filter((d) => {
        const marker =
          JSON.stringify(state.events.filter((e) => e.day === d)) +
          String(state.days[d]?.seconds ?? 0);
        return (
          state.sync[d]?.fingerprint !==
          createHash("sha256").update(marker).digest("hex")
        );
      })
      .slice(-5);
    if (!days.length) return;
    try {
      const config = await readConfig();
      const sourceId = config.checks?.find((c) => c.target === "Study Schedule")
        ?.data_sources?.[0]?.id;
      requireThat(
        /^[a-f0-9-]{32,36}$/i.test(sourceId ?? ""),
        "Planner setup is missing.",
        503,
      );
      const token = await loadSecret("notion");
      const headers = {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2026-03-11",
        "Content-Type": "application/json",
      };
      for (const d of days) {
        const events = state.events.filter((e) => e.day === d);
        const seconds = state.days[d]?.seconds ?? 0;
        const counts = Object.fromEntries(
          ["anki", "wanikani", "lesson", "exam", "practice"].map((t) => [
            t,
            events.filter((e) => e.type === t).length,
          ]),
        );
        const marker = `dokugaku-day-${d}`;
        const notes = `${marker}\nAutomatically recorded activity in DokuGaku only.\nAnki reviews: ${counts.anki}; WaniKani reviews: ${counts.wanikani}; lessons passed: ${counts.lesson}; papers finished: ${counts.exam}; practice sessions: ${counts.practice}.\nActive study time: ${Math.floor(seconds / 60)} minutes. Breaks and hidden tabs excluded.`;
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(events) + String(seconds))
          .digest("hex");
        const matches = await json(
          `https://api.notion.com/v1/data_sources/${sourceId}/query`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              filter: { property: "Notes", rich_text: { contains: marker } },
              page_size: 10,
            }),
          },
        );
        const properties = {
          Task: { title: [{ text: { content: `DokuGaku · ${d}` } }] },
          Done: { checkbox: events.length > 0 },
          Notes: { rich_text: [{ text: { content: notes } }] },
        };
        const existing = matches.results?.[0];
        const page = await json(
          existing
            ? `https://api.notion.com/v1/pages/${existing.id}`
            : "https://api.notion.com/v1/pages",
          {
            method: existing ? "PATCH" : "POST",
            headers,
            body: JSON.stringify(
              existing
                ? { properties }
                : {
                    parent: {
                      type: "data_source_id",
                      data_source_id: sourceId,
                    },
                    properties,
                  },
            ),
          },
        );
        state.sync[d] = {
          state: "synced",
          pageId: page.id,
          fingerprint,
          at: new Date(now()).toISOString(),
        };
        await persist();
      }
    } catch {
      for (const d of days)
        state.sync[d] = { ...state.sync[d], state: "pending" };
    }
  }
  async function flush() {
    await syncCards();
    await syncNotion();
    await persist();
    return { ok: true };
  }
  function publicWK(s) {
    const item = s.queue[s.index];
    if (!item) return null;
    const d = item.subject.data;
    return {
      id: item.assignment.id,
      word: d.characters,
      image: d.character_images?.find((x) => x.content_type === "image/png")
        ?.url,
      type: item.subject.object,
      phase: item.meaningDone ? "reading" : "meaning",
      level: d.level,
    };
  }
  async function publicAnki(s) {
    const c = await anki("guiCurrentCard");
    if (!c) return null;
    requireThat(
      c.deckName === s.deck || c.deckName?.startsWith(s.deck + "::"),
      "Anki changed decks. Start a new session for the selected deck.",
      409,
    );
    s.cardId = c.cardId;
    s.card = c;
    s.revealed = false;
    s.ticket = randomUUID();
    return {
      id: c.cardId,
      html: c.question,
      css: c.css,
      deck: c.deckName,
      ticket: s.ticket,
    };
  }
  async function route(method, url, body = {}) {
    if (method === "GET" && url.pathname === "/api/resources") {
      try {
        const catalog = parseLocalConfig(
          await readFile(path.join(local, "resource-catalog.json"), "utf8"),
        );
        return {
          items: (catalog.items ?? [])
            .filter(
              (item) =>
                typeof item.title === "string" &&
                /^https:\/\/drive\.google\.com\/(file\/d\/[\w-]+\/(preview|view)|drive\/folders\/[\w-]+)$/.test(
                  item.url,
                ),
            )
            .map(({ title, url, kind }) => ({ title, url, kind })),
        };
      } catch {
        return { items: [] };
      }
    }
    if (method === "GET" && url.pathname === "/api/study")
      return {
        events: state.events,
        days: state.days,
        sync: state.sync,
        cards: state.cards,
        settings: state.settings,
        sessions: Object.values(state.sessions).map((s) => ({
          id: s.id,
          type: s.type,
          closed: s.closed,
          index: s.index,
          limit: s.limit,
          startedAt: s.startedAt,
        })),
      };
    if (method === "GET" && url.pathname === "/api/anki/decks")
      return {
        decks: (await anki("deckNames")).filter(
          (n) => !n.includes("Integration Test") && n !== "Default",
        ),
      };
    if (method === "GET" && url.pathname === "/api/anki/media") {
      const name = url.searchParams.get("name");
      requireThat(
        name &&
          name.length < 512 &&
          !/[\\/\x00]/.test(name) &&
          !name.startsWith("."),
        "Invalid media filename.",
      );
      const ext = path.extname(name).toLowerCase();
      const mime = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".mp4": "video/mp4",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
      }[ext];
      requireThat(mime, "Unsupported media type.");
      const b64 = await anki("retrieveMediaFile", { filename: name });
      requireThat(typeof b64 === "string", "Media not found.", 404);
      requireThat(b64.length < 28000000, "Media file too large.");
      return { binary: Buffer.from(b64, "base64"), mime };
    }
    if (method !== "POST") throw new PublicError("Not found.", 404);
    if (url.pathname === "/api/settings") {
      requireThat(
        typeof body.autoCards === "boolean" &&
          typeof body.notionLogs === "boolean",
        "Invalid settings.",
      );
      state.settings = {
        autoCards: body.autoCards,
        notionLogs: body.notionLogs,
      };
      return state.settings;
    }
    if (url.pathname === "/api/sync") return flush();
    if (url.pathname === "/api/activity") {
      const seconds = Math.max(0, Math.min(30, Number(body.seconds) || 0));
      const d = day(now());
      const prev = state.days[d] ?? { seconds: 0, lastAt: now() };
      const elapsed = Math.max(0, (now() - prev.lastAt) / 1000);
      state.days[d] = {
        seconds: prev.seconds + Math.min(seconds, elapsed),
        lastAt: now(),
      };
      return { ok: true };
    }
    if (url.pathname === "/api/anki/start") {
      const names = await anki("deckNames");
      requireThat(
        names.includes(body.deck) && !body.deck.includes("Integration Test"),
        "Choose a study deck.",
      );
      const id = randomUUID();
      const s = {
        id,
        type: "anki",
        deck: body.deck,
        index: 0,
        limit: [5, 10, 20].includes(body.limit) ? body.limit : 5,
        startedAt: now(),
      };
      state.sessions[id] = s;
      await anki("guiDeckReview", { name: s.deck });
      const card = await publicAnki(s);
      return { id, card, limit: s.limit };
    }
    if (url.pathname === "/api/anki/reveal") {
      const s = session(body.id, "anki");
      requireThat(
        !s.closed && s.ticket === body.ticket,
        "Card changed. Refresh the review.",
        409,
      );
      const c = await anki("guiCurrentCard");
      requireThat(
        c?.cardId === s.cardId,
        "The card changed in Anki. Start a fresh round.",
        409,
      );
      requireThat(await anki("guiShowAnswer"), "Could not reveal answer.", 503);
      const revealed = await anki("guiCurrentCard");
      s.revealed = true;
      s.card = revealed;
      return {
        html: revealed.answer,
        css: revealed.css,
        buttons: revealed.buttons,
        nextReviews: revealed.nextReviews,
      };
    }
    if (url.pathname === "/api/anki/rate") {
      const s = session(body.id, "anki");
      const opId = `anki:${s.id}:${body.ticket}`;
      const old = state.events.find((e) => e.id === opId);
      if (old) return { saved: true, index: s.index, done: s.index >= s.limit };
      requireThat(
        !s.closed && s.revealed && s.ticket === body.ticket,
        "Reveal the current answer first.",
        409,
      );
      requireThat(
        !s.pending,
        "An earlier submission has an unknown result. Check Anki before starting another round.",
        409,
      );
      const c = await anki("guiCurrentCard");
      requireThat(
        c.cardId === s.cardId,
        "The card changed in Anki. Start a fresh round.",
        409,
      );
      requireThat(
        c.buttons.includes(body.ease),
        "Choose one of Anki’s available ratings.",
      );
      s.pending = { opId, cardId: s.cardId, at: now() };
      await persist();
      const result = await anki("guiAnswerCard", { ease: body.ease });
      requireThat(
        result,
        "Anki did not accept the rating. Check Anki before starting another round.",
        409,
      );
      event(opId, "anki", { session: s.id, cardId: s.cardId, ease: body.ease });
      s.pending = null;
      s.index++;
      s.card = null;
      if (s.index >= s.limit) s.closed = true;
      await persist();
      return { saved: true, index: s.index, done: !!s.closed };
    }
    if (url.pathname === "/api/anki/next") {
      const s = session(body.id, "anki");
      requireThat(
        !s.pending,
        "Submission outcome unknown. Check Anki first.",
        409,
      );
      if (s.closed) return { card: null };
      return { card: await publicAnki(s) };
    }
    if (url.pathname === "/api/anki/audio") {
      const s = session(body.id, "anki");
      requireThat(!s.closed && s.ticket === body.ticket, "Card changed.", 409);
      const c = await anki("guiCurrentCard");
      requireThat(c?.cardId === s.cardId, "The card changed in Anki.", 409);
      requireThat(
        await anki("guiPlayAudio"),
        "Anki could not play this card’s audio.",
        503,
      );
      return { ok: true };
    }
    if (url.pathname === "/api/review/resume") {
      const s = session(body.id);
      requireThat(
        ["anki", "wanikani"].includes(s.type),
        "Unknown review session.",
      );
      requireThat(
        !s.pending,
        "A submission has an unknown result. Check the source app before starting a new round.",
        409,
      );
      if (s.closed) return { closed: true };
      let card;
      if (s.type === "wanikani") card = publicWK(s);
      else if (s.card) {
        const c = await anki("guiCurrentCard");
        requireThat(
          c?.cardId === s.cardId,
          "The card changed in Anki. Start a fresh round.",
          409,
        );
        card = {
          id: s.cardId,
          html: s.revealed ? c.answer : c.question,
          css: c.css,
          deck: c.deckName,
          ticket: s.ticket,
        };
      } else card = await publicAnki(s);
      return {
        id: s.id,
        source: s.type,
        index: s.index,
        limit: s.limit,
        card,
        revealed: !!s.revealed,
        buttons: s.card?.buttons,
        nextReviews: s.card?.nextReviews,
      };
    }
    if (url.pathname === "/api/wanikani/start") {
      const user = await wk("user");
      const max = user.data.subscription.max_level_granted;
      const assignments = await pages(
        `assignments?immediately_available_for_review=true&hidden=false`,
      );
      const limit = [5, 10, 20].includes(body.limit) ? body.limit : 5;
      const due = assignments
        .filter(
          (a) =>
            a.data.available_at &&
            Date.parse(a.data.available_at) <= now() &&
            a.data.started_at,
        )
        .slice(0, limit);
      const subjects = due.length
        ? await pages(
            `subjects?ids=${due.map((a) => a.data.subject_id).join(",")}`,
          )
        : [];
      const materials = due.length
        ? await pages(
            `study_materials?subject_ids=${due.map((a) => a.data.subject_id).join(",")}`,
          )
        : [];
      const queue = due
        .map((assignment) => ({
          assignment,
          subject: subjects.find((s) => s.id === assignment.data.subject_id),
          synonyms:
            materials.find(
              (m) => m.data.subject_id === assignment.data.subject_id,
            )?.data.meaning_synonyms ?? [],
          wrongMeaning: 0,
          wrongReading: 0,
          meaningDone: false,
          readingDone: false,
        }))
        .filter((i) => i.subject && i.subject.data.level <= max);
      const s = {
        id: randomUUID(),
        type: "wanikani",
        queue,
        index: 0,
        limit: queue.length,
        startedAt: now(),
      };
      state.sessions[s.id] = s;
      return { id: s.id, card: publicWK(s), limit: s.limit };
    }
    if (url.pathname === "/api/wanikani/answer") {
      const s = session(body.id, "wanikani");
      const item = s.queue[s.index];
      if (s.attempts?.[body.attempt]) return s.attempts[body.attempt];
      requireThat(!s.closed && item, "Round finished.", 409);
      requireThat(
        !s.pending,
        "An earlier submission has an unknown result. Check WaniKani before starting another round.",
        409,
      );
      requireThat(
        body.cardId === item.assignment.id &&
          body.phase === (item.meaningDone ? "reading" : "meaning"),
        "Question changed. Refresh before answering.",
        409,
      );
      requireThat(
        typeof body.answer === "string" &&
          body.answer.trim().length > 0 &&
          body.answer.length < 200,
        "Enter an answer.",
      );
      // A client attempt UUID makes a retry of an incorrect answer harmless too.
      requireThat(/^[\w-]{8,80}$/.test(body.attempt ?? ""), "Invalid attempt.");
      s.attempts ??= {};
      if (s.attempts[body.attempt]) return s.attempts[body.attempt];
      const d = item.subject.data;
      const meaning = !item.meaningDone;
      const accepted = meaning
        ? [
            ...d.meanings
              .filter((m) => m.accepted_answer)
              .map((m) => m.meaning),
            ...item.synonyms,
            ...(d.auxiliary_meanings ?? [])
              .filter((m) => m.type === "whitelist")
              .map((m) => m.meaning),
          ]
        : d.readings.filter((r) => r.accepted_answer).map((r) => r.reading);
      const normalized = meaning ? clean(body.answer) : kana(body.answer);
      const correct = accepted.some(
        (a) => (meaning ? clean(a) : kana(a)) === normalized,
      );
      if (!correct) {
        if (meaning) item.wrongMeaning++;
        else item.wrongReading++;
        const feedback = {
          correct: false,
          expected: accepted.join(" / "),
          card: publicWK(s),
          saved: false,
        };
        s.attempts[body.attempt] = feedback;
        return feedback;
      }
      if (meaning) {
        item.meaningDone = true;
        if (["radical", "kana_vocabulary"].includes(item.subject.object))
          item.readingDone = true;
      } else item.readingDone = true;
      if (!item.readingDone) {
        const feedback = { correct: true, card: publicWK(s), saved: false };
        s.attempts[body.attempt] = feedback;
        return feedback;
      }
      const current = await wk(`assignments/${item.assignment.id}`);
      requireThat(
        current.data.available_at === item.assignment.data.available_at &&
          current.data.srs_stage === item.assignment.data.srs_stage,
        "This assignment changed on WaniKani. Start a fresh round.",
        409,
      );
      s.pending = { assignment: item.assignment.id, at: now() };
      await persist();
      await wk("reviews", "POST", {
        review: {
          assignment_id: item.assignment.id,
          incorrect_meaning_answers: item.wrongMeaning,
          incorrect_reading_answers: item.wrongReading,
        },
      });
      event(`wanikani:${s.id}:${item.assignment.id}`, "wanikani", {
        session: s.id,
        subjectId: item.subject.id,
        incorrectMeaning: item.wrongMeaning,
        incorrectReading: item.wrongReading,
      });
      s.pending = null;
      s.index++;
      if (s.index >= s.limit) s.closed = true;
      const feedback = {
        correct: true,
        saved: true,
        index: s.index,
        card: publicWK(s),
        done: !!s.closed,
      };
      s.attempts[body.attempt] = feedback;
      await persist();
      return feedback;
    }
    if (url.pathname === "/api/session/finish") {
      const s = session(body.id);
      s.closed = true;
      await persist();
      return { ok: true };
    }
    if (url.pathname === "/api/attempt/start") {
      requireThat(
        ["lesson", "practice", "exam"].includes(body.kind),
        "Unknown practice type.",
      );
      const ids =
        body.kind === "lesson"
          ? [lessons.find((l) => l.id === body.lessonId)?.questionId]
          : body.kind === "exam"
            ? examSections.flatMap((s) => s.ids)
            : body.ids;
      requireThat(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 150 &&
          ids.every((id) => questions.some((q) => q.id === id)),
        "Invalid practice selection.",
      );
      const s = {
        id: randomUUID(),
        type: body.kind,
        lessonId: body.lessonId,
        ids: [...new Set(ids)],
        startedAt: now(),
        section: 0,
        sectionStartedAt: now(),
        answers: {},
        closed: false,
      };
      state.sessions[s.id] = s;
      return {
        id: s.id,
        section: 0,
        deadline:
          body.kind === "exam" ? now() + examSections[0].minutes * 60000 : null,
      };
    }
    if (url.pathname === "/api/attempt/save") {
      const s = session(body.id);
      requireThat(
        ["lesson", "practice", "exam"].includes(s.type) && !s.closed,
        "Attempt already finished.",
        409,
      );
      const allowed = s.type === "exam" ? examSections[s.section].ids : s.ids;
      requireThat(
        allowed.includes(body.questionId) &&
          Number.isInteger(body.answer) &&
          body.answer >= 0 &&
          body.answer <= 3,
        "Invalid answer.",
      );
      requireThat(
        s.type !== "exam" ||
          now() <= s.sectionStartedAt + examSections[s.section].minutes * 60000,
        "This section’s time is over. Move to the next section.",
        409,
      );
      s.answers[body.questionId] = body.answer;
      return { ok: true };
    }
    if (url.pathname === "/api/attempt/resume") {
      const s = session(body.id);
      requireThat(
        ["lesson", "practice", "exam"].includes(s.type),
        "Unknown attempt.",
      );
      return {
        id: s.id,
        kind: s.type,
        ids: s.ids,
        answers: s.answers,
        section: s.section,
        closed: s.closed,
        result: s.result,
        deadline:
          s.type === "exam"
            ? s.sectionStartedAt + examSections[s.section].minutes * 60000
            : null,
      };
    }
    if (url.pathname === "/api/attempt/section") {
      const s = session(body.id, "exam");
      requireThat(
        !s.closed && s.section === body.section,
        "Section changed.",
        409,
      );
      requireThat(
        s.section < examSections.length - 1,
        "Finish the paper instead.",
      );
      s.section++;
      s.sectionStartedAt = now();
      return {
        section: s.section,
        deadline: now() + examSections[s.section].minutes * 60000,
      };
    }
    if (url.pathname === "/api/attempt/finish") {
      const s = session(body.id);
      requireThat(
        ["lesson", "practice", "exam"].includes(s.type),
        "Unknown attempt.",
      );
      if (s.closed) return s.result;
      requireThat(
        s.type !== "exam" || s.section === examSections.length - 1,
        "Complete the earlier sections first.",
      );
      const results = s.ids.map((id) => {
        const q = questions.find((q) => q.id === id);
        return {
          id,
          correct: s.answers[id] === q.answer,
          answer: s.answers[id] ?? null,
        };
      });
      const score = results.filter((r) => r.correct).length;
      const result = {
        id: s.id,
        score,
        total: results.length,
        results,
        passed: s.type === "lesson" ? score === results.length : undefined,
      };
      s.result = result;
      s.closed = true;
      if (s.type !== "lesson" || result.passed)
        event(s.id, s.type, {
          lessonId: s.lessonId,
          score,
          total: results.length,
          results,
        });
      else
        event(s.id, "practice", {
          lessonId: s.lessonId,
          score,
          total: results.length,
          results,
        });
      for (const r of results.filter((r) => !r.correct && r.answer !== null))
        await queueCard(questions.find((q) => q.id === r.id));
      await persist();
      return result;
    }
    throw new PublicError("Not found.", 404);
  }
  return {
    handle(method, url, body) {
      const task = serial.then(async () => {
        state ??= await store.read();
        const result = await route(method, url, body);
        if (method === "POST") await persist();
        return result;
      });
      serial = task.catch(() => {});
      return task;
    },
    async flush() {
      return this.handle("POST", new URL("http://localhost/api/sync"), {});
    },
  };
}

export function studyMiddleware(service) {
  return async (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/") || url.pathname === "/api/dashboard")
      return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const host = req.headers.host ?? "";
    const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const origin = req.headers.origin;
    const write = req.method === "POST";
    if (
      !localHost ||
      (origin && origin !== `http://${host}`) ||
      req.headers["sec-fetch-site"] === "cross-site" ||
      (write &&
        (!origin ||
          req.headers["x-dokugaku"] !== "1" ||
          !req.headers["content-type"]?.startsWith("application/json")))
    ) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "application/json");
      return res.end(
        JSON.stringify({ error: "Local same-origin access only." }),
      );
    }
    try {
      let body = {};
      if (write) {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 64000)
            throw new PublicError("Request too large.", 413);
        }
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          throw new PublicError("Invalid JSON.");
        }
        requireThat(
          body && typeof body === "object" && !Array.isArray(body),
          "Invalid request.",
        );
      }
      const result = await service.handle(req.method, url, body);
      if (result?.binary) {
        res.setHeader("Content-Type", result.mime);
        return res.end(result.binary);
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    } catch (e) {
      res.statusCode = e instanceof PublicError ? e.status : 503;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error:
            e instanceof PublicError
              ? e.message
              : "The local study service is unavailable. Check the connection and retry.",
        }),
      );
    }
  };
}
export function studyPlugin() {
  const service = createStudyService();
  let timer;
  return {
    name: "dokugaku-study",
    configureServer(server) {
      server.middlewares.use(studyMiddleware(service));
      timer = setInterval(() => void service.flush().catch(() => {}), 60000);
      timer.unref();
      server.httpServer?.once("close", () => clearInterval(timer));
    },
    configurePreviewServer(server) {
      server.middlewares.use(studyMiddleware(service));
      timer = setInterval(() => void service.flush().catch(() => {}), 60000);
      timer.unref();
      server.httpServer?.once("close", () => clearInterval(timer));
    },
  };
}
