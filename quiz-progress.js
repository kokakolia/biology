import { organIds } from "./organs.js";

export const findProgressKey = "iznutri:find-progress:v1";
export const photoProgressKey = "iznutri:photo-progress:v1";
export const findUnlockCount = organIds.length / 2;
export const attemptLimit = 2;

export function loadQuizProgress(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved?.credited) && saved.failures && typeof saved.failures === "object") {
      return saved;
    }
  } catch {
    // The test can still run with in-memory progress when storage is unavailable.
  }
  return { credited: [], failures: {}, run: null };
}

export function saveQuizProgress(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Keep the current in-memory run available.
  }
}

export function quizPercent(count) {
  return Math.round(count * 100 / organIds.length);
}

export function beginQuizRun(state) {
  const remaining = organIds.filter((id) => !state.credited.includes(id));
  const practice = remaining.length === 0;
  const previous = state.run;
  const previousPracticeCredits = previous?.practice ? previous.practiceCredits ?? previous.firstTry : [];
  const reviewing = previous?.phase === "results" && (!practice || (previous.practice && previousPracticeCredits.length < organIds.length));
  const practiceCredits = practice && reviewing ? [...previousPracticeCredits] : [];
  const ids = practice ? organIds.filter((id) => !practiceCredits.includes(id)) : remaining;
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  state.run = {
    phase: reviewing ? "review" : "main",
    practice,
    practiceCredits,
    total: ids.length,
    queue: ids.map((id) => ({ id, attempts: 0 })),
    review: [],
    firstTry: [],
    creditRounds: {},
    feedback: null,
    departed: null,
  };
}

export function answerQuizTask(state, selected) {
  const { run } = state;
  const task = run.queue[0];
  if (!task || task.attempts >= attemptLimit || (run.feedback && run.feedback !== "retry")) return;
  task.attempts++;
  if (selected === task.id) {
    run.feedback = "correct";
    if (task.attempts === 1) {
      run.firstTry.push(task.id);
      run.creditRounds ??= {};
      run.creditRounds[task.id] = run.phase;
      if (run.practice) {
        run.practiceCredits ??= run.firstTry.slice(0, -1);
        if (!run.practiceCredits.includes(task.id)) run.practiceCredits.push(task.id);
      }
      if (!state.credited.includes(task.id)) state.credited.push(task.id);
    }
  } else {
    state.failures[task.id] = (state.failures[task.id] ?? 0) + 1;
    run.feedback = task.attempts < attemptLimit ? "retry" : "missed";
  }
}

function endRound(run) {
  if (run.queue.length) return;
  run.phase = run.phase === "main" && run.review.length ? "break" : "results";
}

export function nextQuizTask(run) {
  if (run.feedback !== "correct" && run.feedback !== "missed") return;
  const task = run.queue.shift();
  if (run.phase === "main" && task.attempts > 1) run.review.push({ id: task.id, attempts: 0 });
  run.feedback = run.queue[0]?.attempts ? "retry" : null;
  endRound(run);
}

export function startQuizReview(run) {
  if (run.phase !== "break") return;
  run.phase = "review";
  run.queue = run.review;
  run.total = run.queue.length;
  run.review = [];
  run.feedback = run.queue[0]?.attempts ? "retry" : null;
}

export function pauseQuizForStudy(lesson) {
  const key = lesson === "find" ? findProgressKey : lesson === "photo" ? photoProgressKey : undefined;
  if (!key) return;
  const state = loadQuizProgress(key);
  const run = state.run;
  if (!run?.queue.length || run.departed === "study") return;
  run.departed = "study";
  saveQuizProgress(key, state);
}

export function resumeQuizRun(run) {
  const returningFromStudy = run.departed === "study";
  run.departed = null;
  if (!returningFromStudy || !run.queue.length) return;
  if (run.feedback === "correct" || run.feedback === "missed") {
    nextQuizTask(run);
    return;
  }
  if (run.phase === "main") {
    const { id } = run.queue.shift();
    run.review.push({ id, attempts: 0 });
  } else {
    if (run.queue.length < 2) return;
    run.queue.push(run.queue.shift());
  }
  run.feedback = run.queue[0]?.attempts ? "retry" : null;
  endRound(run);
}
