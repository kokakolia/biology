import assert from "node:assert/strict";
import test from "node:test";
import { createPhotoAnswerMatcher } from "../photo-answer.js";
import { digestiveSection, sectionFromSearch, sectionHref } from "../sections.js";
import { createSectionProgress } from "../section-progress.js";
import {
  answerQuizTask, nextQuizTask, quizPercent, resumeQuizRun, saveQuizProgress, startQuizReview,
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
  resumeQuizRun(reopened.run);
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
  saveQuizProgress(keys.find, state);
  quiz.pauseForStudy(keys.find);
  state = quiz.load(keys.find);
  resumeQuizRun(state.run);
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
  saveQuizProgress(keys.find, state);
  quiz.pauseForStudy(keys.find);
  state = quiz.load(keys.find);
  resumeQuizRun(state.run);
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

test("moving a task to study reports storage failure until it can be saved", (t) => {
  useStorage(t);
  const state = quiz.load(keys.find);
  quiz.begin(state);
  saveQuizProgress(keys.find, state);
  const write = t.mock.method(localStorage, "setItem", () => { throw new Error("Quota exceeded"); });
  assert.equal(quiz.pauseForStudy(keys.find), false);
  assert.equal(quiz.load(keys.find).run.departed, null);
  write.mock.restore();
  const read = t.mock.method(localStorage, "getItem", () => { throw new Error("Storage is disabled"); });
  assert.equal(quiz.pauseForStudy(keys.find), false);
  read.mock.restore();
  assert.equal(quiz.pauseForStudy(keys.find), true);
  assert.equal(quiz.load(keys.find).run.departed, "study");
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
    activity: "iznutri:active-lesson",
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
  assert.notEqual(next.keys.activity, keys.activity);
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
