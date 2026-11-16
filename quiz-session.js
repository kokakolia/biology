import { moveQuizTaskToStudy, saveQuizProgress } from "./quiz-progress.js";

export function createQuizSession(key, quiz, locks = globalThis.navigator?.locks) {
  let state;
  let dirty = false;
  let release;
  let opening;
  let generation = 0;

  function open({ startNew = false } = {}) {
    if (release) return Promise.resolve("active");
    if (opening) return opening;
    if (!locks) return Promise.resolve("unavailable");

    const attempt = generation;
    opening = new Promise((resolve) => {
      locks.request(key, { ifAvailable: true }, (lock) => {
        if (attempt !== generation) {
          resolve("closed");
          return;
        }
        if (!lock) {
          resolve("busy");
          return;
        }
        state = quiz.load(key);
        dirty = !state.run || (startNew && state.run.phase === "results");
        if (dirty) quiz.begin(state);
        const hold = new Promise((finish) => { release = finish; });
        resolve("active");
        return hold;
      }).catch(() => resolve("unavailable"));
    }).finally(() => {
      if (attempt === generation) opening = undefined;
    });
    return opening;
  }

  function save() {
    if (!release) return false;
    if (dirty) dirty = !saveQuizProgress(key, state);
    return !dirty;
  }

  function close() {
    generation++;
    opening = undefined;
    if (!release) return;
    save();
    release();
    release = undefined;
  }

  return {
    open, save, close,
    get state() { return state; },
    isActive: () => Boolean(release),
    edit(change) {
      if (!release) return false;
      change(state);
      dirty = true;
      return true;
    },
    moveToStudy() {
      if (!release) return false;
      const next = structuredClone(state);
      moveQuizTaskToStudy(next.run);
      if (!saveQuizProgress(key, next)) return false;
      state = next;
      dirty = false;
      return true;
    },
  };
}
