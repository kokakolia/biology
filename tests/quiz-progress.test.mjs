import assert from "node:assert/strict";
import test from "node:test";
import { organIds } from "../organs.js";
import { matchPhotoAnswer } from "../photo-answer.js";
import {
  answerQuizTask, beginQuizRun, findProgressKey, loadQuizProgress, nextQuizTask,
  pauseQuizForStudy, photoProgressKey, quizPercent, resumeQuizRun, saveQuizProgress,
  startQuizReview,
} from "../quiz-progress.js";

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
  saveQuizProgress(photoProgressKey, {
    credited: ["liver", "liver", "unknown"],
    failures: { liver: 2, unknown: 3, pancreas: -1, stomach: "2" },
    run: { phase: "main", review: [] },
  });
  const state = loadQuizProgress(photoProgressKey);
  assert.deepEqual(state, { credited: ["liver"], failures: { liver: 2 }, run: null });
  assert.equal(quizPercent(state.credited.length), 17);
  beginQuizRun(state);
  assert.equal(state.run.total, organIds.length - 1);
  assert.ok(!state.run.queue.some(({ id }) => id === "liver"));
});

test("a damaged task is skipped without passing its feedback to the next organ", (t) => {
  useStorage(t);
  saveQuizProgress(photoProgressKey, {
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
  const { run } = loadQuizProgress(photoProgressKey);
  assert.deepEqual(run.queue, [{ id: "liver", attempts: 0, answer: "печ" }]);
  assert.equal(run.feedback, null);
  assert.equal(run.total, 1);
});

test("an exhausted task without valid feedback cannot trap the student", (t) => {
  useStorage(t);
  saveQuizProgress(findProgressKey, {
    credited: ["liver"],
    run: { phase: "review", total: 1, queue: [{ id: "stomach", attempts: 2 }], review: [], feedback: "retry" },
  });
  assert.deepEqual(loadQuizProgress(findProgressKey), { credited: ["liver"], failures: {}, run: null });
});

test("normal reopening preserves the question, draft and attempts", (t) => {
  useStorage(t);
  const state = loadQuizProgress(photoProgressKey);
  beginQuizRun(state);
  const task = state.run.queue[0];
  answerQuizTask(state, null);
  task.answer = "черновик";
  saveQuizProgress(photoProgressKey, state);
  const reopened = loadQuizProgress(photoProgressKey);
  resumeQuizRun(reopened.run);
  assert.deepEqual(reopened, state);
  assert.equal(reopened.run.feedback, "retry");
  assert.equal(reopened.run.queue[0].attempts, 1);
  answerQuizTask(reopened, null);
  saveQuizProgress(photoProgressKey, reopened);
  const missed = loadQuizProgress(photoProgressKey);
  assert.equal(missed.run.feedback, "missed");
  assert.equal(missed.run.queue[0].attempts, 2);
  nextQuizTask(missed.run);
  assert.notEqual(missed.run.queue[0].id, task.id);
  assert.deepEqual(missed.run.review, [{ id: task.id, attempts: 0 }]);
});

test("returning from study moves main tasks and preserves review attempts", (t) => {
  useStorage(t);
  let state = loadQuizProgress(findProgressKey);
  beginQuizRun(state);
  const { id } = state.run.queue[0];
  answerQuizTask(state, null);
  saveQuizProgress(findProgressKey, state);
  pauseQuizForStudy("find");
  state = loadQuizProgress(findProgressKey);
  resumeQuizRun(state.run);
  assert.deepEqual(state.run.review, [{ id, attempts: 0 }]);
  while (state.run.queue.length) {
    answerQuizTask(state, state.run.queue[0].id);
    nextQuizTask(state.run);
  }
  assert.equal(state.run.phase, "break");
  saveQuizProgress(findProgressKey, state);
  state = loadQuizProgress(findProgressKey);
  startQuizReview(state.run);
  assert.deepEqual(state.run.queue, [{ id, attempts: 0 }]);
  answerQuizTask(state, null);
  saveQuizProgress(findProgressKey, state);
  pauseQuizForStudy("find");
  state = loadQuizProgress(findProgressKey);
  resumeQuizRun(state.run);
  assert.equal(state.run.queue[0].attempts, 1);
});

test("credit earned in review keeps its round after reloading", (t) => {
  useStorage(t);
  const state = { credited: organIds.filter((id) => id !== "stomach"), failures: {}, run: null };
  beginQuizRun(state);
  answerQuizTask(state, null);
  answerQuizTask(state, "stomach");
  assert.equal(state.run.feedback, "correct");
  nextQuizTask(state.run);
  startQuizReview(state.run);
  answerQuizTask(state, "stomach");
  nextQuizTask(state.run);
  saveQuizProgress(photoProgressKey, state);
  const { run, credited } = loadQuizProgress(photoProgressKey);
  assert.equal(run.phase, "results");
  assert.equal(run.creditRounds.stomach, "review");
  assert.equal(credited.length, organIds.length);
});

test("a repeat uses only missing organs and keeps the separate practice score", (t) => {
  useStorage(t);
  const state = { credited: organIds.slice(0, 4), failures: {}, run: null };
  beginQuizRun(state);
  assert.deepEqual(new Set(state.run.queue.map(({ id }) => id)), new Set(organIds.slice(4)));
  while (state.run.queue.length) {
    answerQuizTask(state, state.run.queue[0].id);
    nextQuizTask(state.run);
  }
  beginQuizRun(state);
  assert.equal(state.run.practice, true);
  assert.equal(state.run.queue.length, 6);
  assert.equal(quizPercent(state.run.practiceCredits.length), 0);
  answerQuizTask(state, state.run.queue[0].id);
  saveQuizProgress(photoProgressKey, state);
  const reopened = loadQuizProgress(photoProgressKey);
  assert.equal(quizPercent(reopened.run.practiceCredits.length), 17);
  assert.equal(quizPercent(reopened.credited.length), 100);
});

test("older practice results retain first-attempt credit", (t) => {
  useStorage(t);
  saveQuizProgress(photoProgressKey, {
    credited: organIds,
    failures: {},
    run: { phase: "results", practice: true, queue: [], review: [], firstTry: organIds.slice(0, 4) },
  });
  const state = loadQuizProgress(photoProgressKey);
  assert.equal(quizPercent(state.run.practiceCredits.length), 67);
  assert.deepEqual(state.run.creditRounds, {});
  beginQuizRun(state);
  assert.equal(state.run.phase, "review");
  assert.equal(state.run.queue.length, 2);
  assert.equal(quizPercent(state.run.practiceCredits.length), 67);
});

test("unavailable or malformed storage starts with empty progress", (t) => {
  useStorage(t);
  localStorage.setItem(photoProgressKey, "{");
  const empty = { credited: [], failures: {}, run: null };
  assert.deepEqual(loadQuizProgress(photoProgressKey), empty);
  t.mock.method(localStorage, "getItem", () => { throw new Error("Storage is disabled"); });
  assert.deepEqual(loadQuizProgress(photoProgressKey), empty);
});

test("photo answers accept familiar names and a unique typo", () => {
  assert.deepEqual(matchPhotoAnswer(" ТОНКАЯ   КИШКА "), { id: "small-intestine", corrected: false });
  assert.deepEqual(matchPhotoAnswer("толстый кишечник"), { id: "large-intestine", corrected: false });
  assert.deepEqual(matchPhotoAnswer("печен"), { id: "liver", corrected: true });
  assert.deepEqual(matchPhotoAnswer("кишка"), { id: null, corrected: false });
});
