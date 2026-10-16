import test from "node:test";
import assert from "node:assert/strict";
import {
  createStudyService,
  studyMiddleware,
  kana,
  fileStore,
} from "./study.mjs";
import { questions, lessons, examSections } from "../content/course.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function fixture() {
  let saved = {
      version: 1,
      sessions: {},
      events: [],
      days: {},
      sync: {},
      cards: {},
      settings: { autoCards: true, notionLogs: true },
    },
    clock = Date.parse("2026-10-17T03:00:00Z"),
    ratingCalls = 0,
    wkWrites = 0,
    notionCreates = 0,
    notionUpdates = 0,
    notes = 0,
    cardId = 10,
    failRate = false,
    loseNotionReply = false,
    loseCardReply = false,
    notionPage = null;
  const store = {
    read: async () => structuredClone(saved),
    write: async (s) => {
      saved = structuredClone(s);
    },
  };
  const assignment = {
    id: 99,
    data: {
      subject_id: 7,
      available_at: "2026-10-17T00:00:00Z",
      started_at: "2026-01-01T00:00:00Z",
      srs_stage: 1,
    },
  };
  const fetchImpl = async (url, o = {}) => {
    const ok = (data) => ({
      ok: true,
      status: 200,
      json: async () => structuredClone(data),
    });
    if (url.includes("8765")) {
      const { action, params } = JSON.parse(o.body);
      let result;
      switch (action) {
        case "deckNames":
          result = ["Japanese"];
          break;
        case "guiDeckReview":
          result = true;
          break;
        case "guiCurrentCard":
          result = {
            cardId,
            question: "<b>学校</b>",
            answer: "school",
            css: ".card {}",
            deckName: "Japanese",
            buttons: [1, 2, 3, 4],
            nextReviews: ["1m", "6m", "1d", "4d"],
          };
          break;
        case "guiShowAnswer":
        case "guiPlayAudio":
          result = true;
          break;
        case "guiAnswerCard":
          ratingCalls++;
          if (failRate) throw new Error("secret");
          cardId++;
          result = true;
          break;
        case "createDeck":
          result = 1;
          break;
        case "modelNames":
          result = ["DokuGaku Recall"];
          break;
        case "findNotes":
          result = notes ? [notes] : [];
          break;
        case "addNote":
          notes++;
          if (loseCardReply) {
            loseCardReply = false;
            throw new Error("lost card response");
          }
          result = notes;
          break;
        default:
          throw new Error(`Unexpected Anki ${action}`);
      }
      return ok({ result, error: null });
    }
    assert.equal(o.headers.Authorization, "Bearer fake-secret");
    if (url.includes("wanikani")) {
      if (url.endsWith("/user"))
        return ok({ data: { subscription: { max_level_granted: 3 } } });
      if (url.includes("assignments?"))
        return ok({ data: [assignment], pages: { next_url: null } });
      if (url.includes("subjects?"))
        return ok({
          data: [
            {
              id: 7,
              object: "vocabulary",
              data: {
                characters: "学校",
                level: 2,
                meanings: [{ meaning: "School", accepted_answer: true }],
                readings: [{ reading: "がっこう", accepted_answer: true }],
              },
            },
          ],
          pages: { next_url: null },
        });
      if (url.includes("study_materials?"))
        return ok({
          data: [{ data: { subject_id: 7, meaning_synonyms: ["academy"] } }],
          pages: { next_url: null },
        });
      if (url.endsWith("/assignments/99")) return ok(assignment);
      if (url.endsWith("/reviews")) {
        const b = JSON.parse(o.body);
        assert.equal(b.review.assignment_id, 99);
        wkWrites++;
        return ok({ id: 0 });
      }
    }
    if (url.includes("notion")) {
      if (url.endsWith("/query"))
        return ok({ results: notionPage ? [{ id: notionPage }] : [] });
      if (url.endsWith("/pages")) {
        notionCreates++;
        notionPage = "page";
        if (loseNotionReply) {
          loseNotionReply = false;
          throw new Error("lost response");
        }
        return ok({ id: notionPage });
      }
      if (url.endsWith("/pages/page")) {
        notionUpdates++;
        return ok({ id: "page" });
      }
    }
    throw new Error(`Unexpected ${url}`);
  };
  const options = {
    store,
    fetchImpl,
    loadSecret: async () => "fake-secret",
    readConfig: async () => ({
      checks: [
        {
          target: "Study Schedule",
          data_sources: [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
        },
      ],
    }),
    now: () => clock,
  };
  const service = createStudyService(options);
  return {
    service,
    post: (p, b) =>
      service.handle("POST", new URL(`http://localhost/api/${p}`), b),
    get: () => service.handle("GET", new URL("http://localhost/api/study")),
    advance: (n) => (clock += n),
    snapshot: () => saved,
    fail: () => (failRate = true),
    loseReplies: () => {
      loseNotionReply = true;
      loseCardReply = true;
    },
    changeAssignment: () => {
      assignment.data.srs_stage = 2;
    },
    restart: () => createStudyService(options),
    counts: () => ({
      ratingCalls,
      wkWrites,
      notionCreates,
      notionUpdates,
      notes,
    }),
  };
}
test("content has unique IDs, valid answer keys, linked lessons and 90-minute paper", () => {
  assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
  for (const q of questions) {
    assert.equal(q.options.length, 4);
    assert.ok(q.answer >= 0 && q.answer < 4);
    assert.ok(q.explanation);
  }
  for (const l of lessons)
    assert.ok(questions.some((q) => q.id === l.questionId));
  assert.equal(
    examSections.reduce((n, s) => n + s.minutes, 0),
    90,
  );
  assert.equal(examSections.flatMap((s) => s.ids).length, 96);
});
test("Anki requires reveal, uses its allowed ratings, and deduplicates concurrent rating retries", async () => {
  const f = fixture(),
    s = await f.post("anki/start", { deck: "Japanese", limit: 5 });
  await assert.rejects(
    f.post("anki/rate", { id: s.id, ticket: s.card.ticket, ease: 3 }),
    /Reveal/,
  );
  await f.post("anki/reveal", { id: s.id, ticket: s.card.ticket });
  await Promise.all([
    f.post("anki/rate", { id: s.id, ticket: s.card.ticket, ease: 3 }),
    f.post("anki/rate", { id: s.id, ticket: s.card.ticket, ease: 3 }),
  ]);
  assert.equal(f.counts().ratingCalls, 1);
  assert.equal((await f.get()).events.length, 1);
});
test("uncertain Anki write is persisted and never blindly retried after restart", async () => {
  const f = fixture(),
    s = await f.post("anki/start", { deck: "Japanese" });
  await f.post("anki/reveal", { id: s.id, ticket: s.card.ticket });
  f.fail();
  await assert.rejects(
    f.post("anki/rate", { id: s.id, ticket: s.card.ticket, ease: 3 }),
    /interrupted/,
  );
  const restarted = f.restart();
  await assert.rejects(
    restarted.handle("POST", new URL("http://localhost/api/anki/rate"), {
      id: s.id,
      ticket: s.card.ticket,
      ease: 3,
    }),
    /unknown result/,
  );
  assert.equal(f.counts().ratingCalls, 1);
  assert.equal((await f.get()).events.length, 0);
});
test("WaniKani counts misses, accepts synonyms and kana, requires both parts, deduplicates final retry", async () => {
  const f = fixture(),
    s = await f.post("wanikani/start", { limit: 5 });
  const base = { id: s.id, cardId: 99 };
  const wrong = await f.post("wanikani/answer", {
    ...base,
    phase: "meaning",
    answer: "water",
    attempt: "wrong-attempt",
  });
  assert.equal(wrong.correct, false);
  await f.post("wanikani/answer", {
    ...base,
    phase: "meaning",
    answer: "water",
    attempt: "wrong-attempt",
  });
  const meaning = await f.post("wanikani/answer", {
    ...base,
    phase: "meaning",
    answer: "academy",
    attempt: "meaning-attempt",
  });
  assert.equal(meaning.card.phase, "reading");
  assert.equal(f.counts().wkWrites, 0);
  const request = {
    ...base,
    phase: "reading",
    answer: "ガッコウ",
    attempt: "reading-attempt",
  };
  const r = await f.post("wanikani/answer", request);
  assert.equal(r.done, true);
  await f.post("wanikani/answer", request);
  assert.equal(f.counts().wkWrites, 1);
  const e = (await f.get()).events[0];
  assert.equal(e.incorrectMeaning, 1);
  assert.equal(kana("ガッコウ"), "がっこう");
  assert.ok(!JSON.stringify(await f.get()).includes("fake-secret"));
});
test("lesson scores are server-derived, failed lessons do not pass, mistake cards and daily logs deduplicate", async () => {
  const f = fixture(),
    s = await f.post("attempt/start", {
      kind: "lesson",
      lessonId: "sentences",
    });
  await f.post("attempt/save", { id: s.id, questionId: "g1", answer: 1 });
  const r = await f.post("attempt/finish", { id: s.id });
  assert.equal(r.passed, false);
  await f.post("attempt/finish", { id: s.id });
  assert.equal((await f.get()).events.length, 1);
  await f.post("sync", {});
  await f.post("sync", {});
  assert.deepEqual(f.counts(), {
    ratingCalls: 0,
    wkWrites: 0,
    notionCreates: 1,
    notionUpdates: 0,
    notes: 1,
  });
  const s2 = await f.post("attempt/start", {
    kind: "lesson",
    lessonId: "sentences",
  });
  await f.post("attempt/save", { id: s2.id, questionId: "g1", answer: 0 });
  await f.post("attempt/finish", { id: s2.id });
  await f.post("sync", {});
  assert.equal(f.counts().notionUpdates, 1);
  assert.equal(f.counts().notionCreates, 1);
  assert.equal(f.counts().notes, 1);
  assert.equal(
    (await f.get()).events.filter((e) => e.type === "lesson").length,
    1,
  );
});
test("timed exams lock earlier sections, persist answers, reject late changes, and score unanswered items as wrong", async () => {
  const f = fixture(),
    s = await f.post("attempt/start", { kind: "exam" });
  await f.post("attempt/save", { id: s.id, questionId: "v1", answer: 0 });
  await assert.rejects(
    f.post("attempt/save", { id: s.id, questionId: "g1", answer: 0 }),
    /Invalid answer/,
  );
  f.advance(20 * 60000 + 1);
  await assert.rejects(
    f.post("attempt/save", { id: s.id, questionId: "v2", answer: 1 }),
    /time is over/,
  );
  await f.post("attempt/section", { id: s.id, section: 0 });
  await assert.rejects(
    f.post("attempt/save", { id: s.id, questionId: "v1", answer: 1 }),
    /Invalid answer/,
  );
  const resume = await f.post("attempt/resume", { id: s.id });
  assert.equal(resume.answers.v1, 0);
  assert.equal(resume.section, 1);
  await f.post("attempt/section", { id: s.id, section: 1 });
  const r = await f.post("attempt/finish", { id: s.id });
  assert.equal(r.total, 96);
  assert.equal(r.score, 1);
});
test("active time caps client deltas and does not invent time from long gaps", async () => {
  const f = fixture();
  await f.post("activity", { seconds: 30 });
  f.advance(15000);
  await f.post("activity", { seconds: 9999 });
  f.advance(3600000);
  await f.post("activity", { seconds: 15 });
  assert.equal(Object.values((await f.get()).days)[0].seconds, 30);
});
test("atomic file store preserves saved activity across reloads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dokugaku-"));
  try {
    const store = fileStore(dir);
    const data = await store.read();
    data.events.push({ id: "saved" });
    await store.write(data);
    assert.equal((await fileStore(dir).read()).events[0].id, "saved");
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    await rm(dir, { recursive: true, force: true });
  }
});
test("lost card and Notion create replies reconcile by stable markers without duplicate creation", async () => {
  const f = fixture();
  f.loseReplies();
  const s = await f.post("attempt/start", {
    kind: "lesson",
    lessonId: "sentences",
  });
  await f.post("attempt/save", { id: s.id, questionId: "g1", answer: 1 });
  await f.post("attempt/finish", { id: s.id });
  await f.post("sync", {});
  assert.equal((await f.get()).cards.g1.state, "pending");
  assert.equal(Object.values((await f.get()).sync)[0].state, "pending");
  await f.post("sync", {});
  assert.equal(f.counts().notes, 1);
  assert.equal(f.counts().notionCreates, 1);
  assert.equal(f.counts().notionUpdates, 1);
  assert.equal((await f.get()).cards.g1.state, "synced");
});
test("WaniKani rejects an assignment changed in another client before submission", async () => {
  const f = fixture(),
    s = await f.post("wanikani/start", {});
  await f.post("wanikani/answer", {
    id: s.id,
    cardId: 99,
    phase: "meaning",
    answer: "school",
    attempt: "meaning-test",
  });
  f.changeAssignment();
  await assert.rejects(
    f.post("wanikani/answer", {
      id: s.id,
      cardId: 99,
      phase: "reading",
      answer: "がっこう",
      attempt: "reading-test",
    }),
    /assignment changed/,
  );
  assert.equal(f.counts().wkWrites, 0);
});
test("write middleware rejects missing origin, forged headers and cross-site writes before reaching service", async () => {
  let called = false;
  const middleware = studyMiddleware({
    handle: async () => {
      called = true;
      return {};
    },
  });
  for (const headers of [
    { host: "127.0.0.1:3000" },
    {
      host: "127.0.0.1:3000",
      origin: "https://evil.test",
      "content-type": "application/json",
      "x-dokugaku": "1",
    },
    {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "text/plain",
      "x-dokugaku": "1",
    },
  ]) {
    const res = { setHeader() {}, end() {} };
    await middleware(
      { url: "/api/settings", method: "POST", headers },
      res,
      () => {},
    );
    assert.equal(res.statusCode, 403);
  }
  assert.equal(called, false);
});
