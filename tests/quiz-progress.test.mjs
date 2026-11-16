import assert from "node:assert/strict";
import test from "node:test";
import { createPhotoAnswerMatcher } from "../photo-answer.js";
import { digestiveSection, sectionFromSearch, sectionHref } from "../sections.js";
import { createSectionProgress } from "../section-progress.js";
import { createQuizSession } from "../quiz-session.js";
import {
  answerQuizTask, moveQuizTaskToStudy, nextQuizTask, quizPercent, saveQuizProgress, startQuizReview,
} from "../quiz-progress.js";

const { keys, partIds, quiz, study } = createSectionProgress(digestiveSection);
const matchPhotoAnswer = createPhotoAnswerMatcher(digestiveSection.parts);

function useStorage(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, String(value)),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
}

function testLocks() {
  const held = new Set();
  return {
    async request(key, { ifAvailable }, callback) {
      assert.equal(ifAvailable, true);
      if (held.has(key)) return callback(null);
      held.add(key);
      try {
        return await callback({ name: key });
      } finally {
        held.delete(key);
      }
    },
  };
}

test("missing queue restarts the run with saved credit and failures", (t) => {
  useStorage(t);
  saveQuizProgress(keys.photo, {
    credited: ["liver", "liver", "unknown"],
    failures: { liver: 2, unknown: 3, pancreas: -1, stomach: "2" },
    run: { phase: "main", review: [] },
  });
  const state = quiz.load(keys.photo);
  assert.deepEqual(state, { credited: ["liver"], failures: { liver: 2 }, run: null });
  assert.equal(quizPercent(state.credited.length, partIds.length), 17);
  quiz.begin(state);
  assert.equal(state.run.total, partIds.length - 1);
  assert.ok(!state.run.queue.some(({ id }) => id === "liver"));
});

test("a damaged task is skipped without passing its feedback to the next organ", (t) => {
  useStorage(t);
  saveQuizProgress(keys.photo, {
    credited: ["liver"],
    run: {
      phase: "main", total: 4, review: [], feedback: "correct",
      queue: [
        { id: "unknown", attempts: 1 },
        { id: "liver", attempts: 0, answer: "печ", corrected: "yes" },
        { id: "liver", attempts: 0 },
        { id: "stomach", attempts: -1 },
      ],
    },
  });
  const { run } = quiz.load(keys.photo);
  assert.deepEqual(run.queue, [{ id: "liver", attempts: 0, answer: "печ" }]);
  assert.equal(run.feedback, null);
  assert.equal(run.total, 1);
});

test("an exhausted task without valid feedback cannot trap the student", (t) => {
  useStorage(t);
  saveQuizProgress(keys.find, {
    credited: ["liver"],
    run: { phase: "review", total: 1, queue: [{ id: "stomach", attempts: 2 }], review: [], feedback: "retry" },
  });
  assert.deepEqual(quiz.load(keys.find), { credited: ["liver"], failures: {}, run: null });
});

test("normal reopening preserves the question, draft and attempts", (t) => {
  useStorage(t);
  const state = quiz.load(keys.photo);
  quiz.begin(state);
  const task = state.run.queue[0];
  answerQuizTask(state, null);
  task.answer = "черновик";
  saveQuizProgress(keys.photo, state);
  const reopened = quiz.load(keys.photo);
  assert.deepEqual(reopened, state);
  assert.equal(reopened.run.feedback, "retry");
  assert.equal(reopened.run.queue[0].attempts, 1);
  answerQuizTask(reopened, null);
  saveQuizProgress(keys.photo, reopened);
  const missed = quiz.load(keys.photo);
  assert.equal(missed.run.feedback, "missed");
  assert.equal(missed.run.queue[0].attempts, 2);
  nextQuizTask(missed.run);
  assert.notEqual(missed.run.queue[0].id, task.id);
  assert.deepEqual(missed.run.review, [{ id: task.id, attempts: 0 }]);
});

test("returning from study moves main tasks and preserves review attempts", (t) => {
  useStorage(t);
  let state = quiz.load(keys.find);
  quiz.begin(state);
  const { id } = state.run.queue[0];
  answerQuizTask(state, null);
  moveQuizTaskToStudy(state.run);
  saveQuizProgress(keys.find, state);
  state = quiz.load(keys.find);
  assert.deepEqual(state.run.review, [{ id, attempts: 0 }]);
  while (state.run.queue.length) {
    answerQuizTask(state, state.run.queue[0].id);
    nextQuizTask(state.run);
  }
  assert.equal(state.run.phase, "break");
  saveQuizProgress(keys.find, state);
  state = quiz.load(keys.find);
  startQuizReview(state.run);
  assert.deepEqual(state.run.queue, [{ id, attempts: 0 }]);
  answerQuizTask(state, null);
  moveQuizTaskToStudy(state.run);
  saveQuizProgress(keys.find, state);
  state = quiz.load(keys.find);
  assert.equal(state.run.queue[0].attempts, 1);
});

test("credit earned in review keeps its round after reloading", (t) => {
  useStorage(t);
  const state = { credited: partIds.filter((id) => id !== "stomach"), failures: {}, run: null };
  quiz.begin(state);
  answerQuizTask(state, null);
  answerQuizTask(state, "stomach");
  assert.equal(state.run.feedback, "correct");
  nextQuizTask(state.run);
  startQuizReview(state.run);
  answerQuizTask(state, "stomach");
  nextQuizTask(state.run);
  saveQuizProgress(keys.photo, state);
  const { run, credited } = quiz.load(keys.photo);
  assert.equal(run.phase, "results");
  assert.equal(run.creditRounds.stomach, "review");
  assert.equal(credited.length, partIds.length);
});

test("a repeat uses only missing organs and keeps the separate practice score", (t) => {
  useStorage(t);
  const state = { credited: partIds.slice(0, 4), failures: {}, run: null };
  quiz.begin(state);
  assert.deepEqual(new Set(state.run.queue.map(({ id }) => id)), new Set(partIds.slice(4)));
  while (state.run.queue.length) {
    answerQuizTask(state, state.run.queue[0].id);
    nextQuizTask(state.run);
  }
  quiz.begin(state);
  assert.equal(state.run.practice, true);
  assert.equal(state.run.queue.length, 6);
  assert.equal(quizPercent(state.run.practiceCredits.length, partIds.length), 0);
  answerQuizTask(state, state.run.queue[0].id);
  saveQuizProgress(keys.photo, state);
  const reopened = quiz.load(keys.photo);
  assert.equal(quizPercent(reopened.run.practiceCredits.length, partIds.length), 17);
  assert.equal(quizPercent(reopened.credited.length, partIds.length), 100);
});

test("older practice results retain first-attempt credit", (t) => {
  useStorage(t);
  saveQuizProgress(keys.photo, {
    credited: partIds,
    failures: {},
    run: { phase: "results", practice: true, queue: [], review: [], firstTry: partIds.slice(0, 4) },
  });
  const state = quiz.load(keys.photo);
  assert.equal(quizPercent(state.run.practiceCredits.length, partIds.length), 67);
  assert.deepEqual(state.run.creditRounds, {});
  quiz.begin(state);
  assert.equal(state.run.phase, "review");
  assert.equal(state.run.queue.length, 2);
  assert.equal(quizPercent(state.run.practiceCredits.length, partIds.length), 67);
});

test("unavailable or malformed storage starts with empty progress", (t) => {
  useStorage(t);
  localStorage.setItem(keys.photo, "{");
  const empty = { credited: [], failures: {}, run: null };
  assert.deepEqual(quiz.load(keys.photo), empty);
  t.mock.method(localStorage, "getItem", () => { throw new Error("Storage is disabled"); });
  assert.deepEqual(quiz.load(keys.photo), empty);
});

test("a transient quiz read failure cannot replace previously saved progress", async (t) => {
  useStorage(t);
  const state = { credited: ["liver"], failures: {}, run: null };
  quiz.begin(state);
  answerQuizTask(state, null);
  saveQuizProgress(keys.find, state);

  const read = localStorage.getItem;
  const original = read(keys.find);
  let fail = true;
  t.mock.method(localStorage, "getItem", (key) => {
    if (key === keys.find && fail) {
      fail = false;
      throw new Error("Temporary read failure");
    }
    return read(key);
  });
  const write = t.mock.method(localStorage, "setItem");
  const session = createQuizSession(keys.find, quiz, testLocks());
  assert.equal(await session.open(), "read-failed");
  assert.equal(session.isActive(), false);
  assert.equal(session.save(), false);
  assert.equal(write.mock.callCount(), 0);
  assert.equal(read(keys.find), original);

  assert.equal(await session.open(), "active");
  assert.deepEqual(session.state, state);
  session.close();
  assert.equal(write.mock.callCount(), 0);
});

test("study reports a write failure and retries without losing marks", (t) => {
  useStorage(t);
  localStorage.setItem(keys.study, JSON.stringify(["select:liver"]));
  const marks = new Set(["select:stomach"]);
  const write = t.mock.method(localStorage, "setItem", () => { throw new Error("Quota exceeded"); });
  assert.equal(study.save(marks), false);
  assert.deepEqual(study.load(), new Set(["select:liver"]));
  assert.deepEqual(marks, new Set(["select:stomach", "select:liver"]));

  write.mock.restore();
  localStorage.setItem(keys.study, JSON.stringify(["select:liver", "info:liver"]));
  assert.equal(study.save(marks), true);
  assert.deepEqual(study.load(), new Set(["select:stomach", "select:liver", "info:liver"]));
});

test("interleaved study writes preserve marks from both tabs", (t) => {
  useStorage(t);
  const first = new Set(["select:stomach", "info:stomach", "select:liver"]);
  const second = new Set(["info:liver", "select:esophagus", "info:esophagus"]);
  const write = localStorage.setItem;
  let interleaved = false;
  t.mock.method(localStorage, "setItem", (key, value) => {
    if (!interleaved) {
      interleaved = true;
      assert.ok(study.save(second));
    }
    write(key, value);
  });

  assert.ok(study.save(first));
  assert.deepEqual(study.load(), new Set([...first, ...second]));
  assert.equal(study.load().size, study.unlockCount);
  assert.equal(study.matchesKey(`${keys.study}:select:liver`), true);
  assert.equal(study.matchesKey(`${keys.study}:select:unknown`), false);
});

test("quiz keeps the latest in-memory attempt when a write fails", (t) => {
  useStorage(t);
  const state = quiz.load(keys.photo);
  quiz.begin(state);
  assert.equal(saveQuizProgress(keys.photo, state), true);
  answerQuizTask(state, null);
  state.run.queue[0].answer = "черновик";

  const write = t.mock.method(localStorage, "setItem", () => { throw new Error("Quota exceeded"); });
  assert.equal(saveQuizProgress(keys.photo, state), false);
  assert.equal(quiz.load(keys.photo).run.queue[0].attempts, 0);
  write.mock.restore();
  assert.equal(saveQuizProgress(keys.photo, state), true);
  assert.deepEqual(quiz.load(keys.photo), state);
});

test("an old study marker cannot move a task during ordinary reopening", (t) => {
  useStorage(t);
  const state = quiz.load(keys.find);
  quiz.begin(state);
  answerQuizTask(state, null);
  const task = { ...state.run.queue[0] };
  state.run.departed = "study";
  saveQuizProgress(keys.find, state);
  const reopened = quiz.load(keys.find);
  assert.deepEqual(reopened.run.queue[0], task);
  assert.equal(reopened.run.feedback, "retry");
  assert.deepEqual(reopened.run.review, []);
});

test("only one tab opens the same quiz and it keeps an unsaved answer", async (t) => {
  useStorage(t);
  const locks = testLocks();
  for (const key of [keys.find, keys.photo]) {
    const first = createQuizSession(key, quiz, locks);
    const second = createQuizSession(key, quiz, locks);
    assert.equal(await first.open(), "active");
    assert.equal(first.save(), true);
    const { id } = first.state.run.queue[0];

    const write = t.mock.method(localStorage, "setItem", () => { throw new Error("Quota exceeded"); });
    assert.ok(first.edit((state) => answerQuizTask(state, id)));
    assert.equal(first.save(), false);
    assert.equal(await second.open(), "busy");
    assert.equal(second.isActive(), false);
    assert.equal(second.save(), false);
    assert.equal(await first.open(), "active");
    assert.deepEqual(first.state.credited, [id]);
    assert.deepEqual(quiz.load(key).credited, []);

    write.mock.restore();
    assert.equal(first.save(), true);
    first.close();
    await Promise.resolve();
    assert.equal(await second.open(), "active");
    assert.equal(second.state.run.feedback, "correct");
    assert.deepEqual(second.state.credited, [id]);
    second.close();
  }
});

test("closing during lock acquisition cannot start a quiz in the background", async (t) => {
  useStorage(t);
  const locks = testLocks();
  let grant;
  const delayed = {
    async request(...args) {
      await new Promise((resolve) => { grant = resolve; });
      return locks.request(...args);
    },
  };
  const session = createQuizSession(keys.find, quiz, delayed);
  const opening = session.open();
  session.close();
  grant();
  assert.equal(await opening, "closed");
  assert.equal(session.isActive(), false);
  assert.equal(quiz.load(keys.find).run, null);
});

test("moving a task to study only changes the quiz after a successful write", async (t) => {
  useStorage(t);
  const session = createQuizSession(keys.find, quiz, testLocks());
  assert.equal(await session.open(), "active");
  session.edit((state) => answerQuizTask(state, null));
  assert.equal(session.save(), true);
  const { id } = session.state.run.queue[0];
  const write = t.mock.method(localStorage, "setItem", () => { throw new Error("Quota exceeded"); });
  assert.equal(session.moveToStudy(), false);
  assert.deepEqual(session.state.run.queue[0], { id, attempts: 1 });
  assert.deepEqual(quiz.load(keys.find).run.queue[0], { id, attempts: 1 });
  write.mock.restore();
  assert.equal(session.moveToStudy(), true);
  assert.notEqual(quiz.load(keys.find).run.queue[0].id, id);
  assert.deepEqual(quiz.load(keys.find).run.review, [{ id, attempts: 0 }]);
  session.close();
});

test("photo answers accept familiar names and a unique typo", () => {
  assert.deepEqual(matchPhotoAnswer(" ТОНКАЯ   КИШКА "), { id: "small-intestine", corrected: false });
  assert.deepEqual(matchPhotoAnswer("толстый кишечник"), { id: "large-intestine", corrected: false });
  assert.deepEqual(matchPhotoAnswer("печен"), { id: "liver", corrected: true });
  assert.deepEqual(matchPhotoAnswer("кишка"), { id: null, corrected: false });
});

test("digestion retains its original URLs and storage keys", () => {
  assert.equal(sectionFromSearch(""), digestiveSection);
  assert.equal(sectionFromSearch("?section=digestion"), digestiveSection);
  assert.equal(sectionFromSearch("?section=unknown"), digestiveSection);
  assert.equal(sectionHref(digestiveSection, "study"), "./study.html");
  assert.deepEqual(keys, {
    study: "iznutri:study-progress:v1",
    find: "iznutri:find-progress:v1",
    photo: "iznutri:photo-progress:v1",
  });
});

test("a different section uses its own part IDs, answers and progress", (t) => {
  useStorage(t);
  const section = {
    id: "test-section",
    parts: { stomach: { name: "Камера" }, wall: { name: "Стенка" }, opening: { name: "Вход" } },
  };
  const next = createSectionProgress(section);
  assert.equal(sectionHref(section, "photo"), "./photo.html?section=test-section");
  assert.equal(sectionHref(section, "home"), "./?section=test-section");
  assert.equal(next.findUnlockCount, 2);
  assert.equal(next.study.total, 6);
  assert.notEqual(next.keys.find, keys.find);
  study.save(new Set(["select:stomach", "info:stomach"]));
  saveQuizProgress(keys.find, { credited: ["stomach"], failures: {}, run: null });
  assert.equal(next.study.load().size, 0);
  assert.deepEqual(next.quiz.load(next.keys.find).credited, []);

  const state = next.quiz.load(next.keys.find);
  next.quiz.begin(state);
  assert.deepEqual(new Set(state.run.queue.map(({ id }) => id)), new Set(Object.keys(section.parts)));
  assert.equal(createPhotoAnswerMatcher(section.parts)("камера").id, "stomach");
  assert.equal(createPhotoAnswerMatcher(section.parts)("желудок").id, null);
  next.study.save(new Set(["select:wall"]));
  assert.deepEqual(study.load(), new Set(["select:stomach", "info:stomach"]));
});

test("an empty section shows zero progress and keeps quizzes locked", (t) => {
  useStorage(t);
  const empty = createSectionProgress({ id: "empty", parts: {} });
  const marks = empty.study.load().size;
  const credits = empty.quiz.load(empty.keys.find).credited.length;
  assert.equal(empty.study.percent(marks), 0);
  assert.equal(quizPercent(credits, empty.partIds.length), 0);
  assert.ok(marks < empty.study.unlockCount);
  assert.ok(credits < empty.findUnlockCount);
});
