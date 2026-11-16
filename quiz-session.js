import { moveQuizTaskToStudy, saveQuizProgress } from "./quiz-progress.js";

export function createQuizSession(key, quiz, locks = globalThis.navigator?.locks) {
  let state;
  let savedValue;
  let savedCreditCount = 0;
  let dirty = false;
  let release;
  let lockRequest;
  let releasing;
  let opening;
  let generation = 0;

  function open({ startNew = false, discardDraft = false } = {}) {
    if (release) return Promise.resolve("active");
    if (opening) return opening;
    if (!locks) return Promise.resolve("unavailable");

    const attempt = generation;
    if (releasing) {
      return releasing.then(() => attempt === generation ? open({ startNew, discardDraft }) : "closed");
    }
    opening = new Promise((resolve) => {
      lockRequest = locks.request(key, { ifAvailable: true }, (lock) => {
        if (attempt !== generation) {
          resolve("closed");
          return;
        }
        if (!lock) {
          resolve("busy");
          return;
        }
        let snapshot;
        try {
          snapshot = quiz.readSnapshot(key);
        } catch {
          resolve("read-failed");
          return;
        }
        if (dirty && !discardDraft) {
          if (snapshot.value !== savedValue) {
            resolve("draft-conflict");
            return;
          }
        } else {
          state = snapshot.state;
          savedValue = snapshot.value;
          savedCreditCount = state.credited.length;
          dirty = !state.run || (startNew && state.run.phase === "results");
          if (dirty) quiz.begin(state);
        }
        const hold = new Promise((finish) => { release = finish; });
        resolve("active");
        return hold;
      }).catch(() => resolve("unavailable"));
    }).finally(() => {
      if (attempt === generation) opening = undefined;
    });
    return opening;
  }

  function persist(snapshot) {
    if (!saveQuizProgress(key, snapshot)) return false;
    savedValue = JSON.stringify(snapshot);
    savedCreditCount = snapshot.credited.length;
    dirty = false;
    return true;
  }

  function save() {
    return Boolean(release) && (!dirty || persist(state));
  }

  function close() {
    generation++;
    opening = undefined;
    if (!release) return;
    save();
    const request = lockRequest;
    releasing = request;
    release();
    release = undefined;
    request.then(() => {
      if (releasing === request) releasing = undefined;
    });
    return request;
  }

  return {
    open, save, close,
    get state() { return state; },
    get savedCreditCount() { return savedCreditCount; },
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
      if (!persist(next)) return false;
      state = next;
      return true;
    },
  };
}
