import { organIds } from "./organs.js";

export const findProgressKey = "iznutri:find-progress:v1";
export const photoProgressKey = "iznutri:photo-progress:v1";
export const findUnlockCount = organIds.length / 2;
export const attemptLimit = 2;

const knownOrgans = new Set(organIds);

function uniqueKnownIds(value) {
  return Array.isArray(value) ? [...new Set(value.filter((id) => knownOrgans.has(id)))] : [];
}

function restoreTasks(value, maxAttempts) {
  const seen = new Set();
  const tasks = [];
  for (const entry of value) {
    const { id, attempts, answer, corrected } = entry ?? {};
    if (!knownOrgans.has(id) || seen.has(id) || !Number.isInteger(attempts) || attempts < 0 || attempts > maxAttempts) continue;
    seen.add(id);
    const task = { id, attempts };
    if (typeof answer === "string") task.answer = answer;
    if (typeof corrected === "boolean") task.corrected = corrected;
    tasks.push(task);
  }
  return tasks;
}

function restoreRun(saved, credited) {
  if (!Array.isArray(saved?.queue) || !Array.isArray(saved.review)) return null;
  const { phase } = saved;
  const active = phase === "main" || phase === "review";
  if (!active && phase !== "break" && phase !== "results") return null;
  const practice = saved.practice === true;
  if (practice && credited.length !== organIds.length) return null;

  const queue = restoreTasks(saved.queue, attemptLimit);
  const review = restoreTasks(saved.review, 0);
  if (active !== Boolean(queue.length) || (phase === "break" && !review.length)) return null;
  if ((phase === "review" || phase === "results") && review.length) return null;
  if (review.some(({ id }) => queue.some((task) => task.id === id))) return null;
  if (queue.slice(1).some(({ attempts }) => attempts === attemptLimit)) return null;

  const task = queue[0];
  const savedTask = saved.queue[0];
  const sameTask = task?.id === savedTask?.id && task?.attempts === savedTask?.attempts;
  const originalFeedback = sameTask ? saved.feedback : null;
  let feedback = null;
  if (task?.attempts) {
    if (originalFeedback === "correct" && (task.attempts > 1 || credited.includes(task.id))) feedback = "correct";
    else if (task.attempts < attemptLimit) feedback = "retry";
    else if (originalFeedback === "missed") feedback = "missed";
    else return null;
  }

  const firstTry = uniqueKnownIds(saved.firstTry).filter((id) => credited.includes(id));
  const creditRounds = Object.fromEntries(firstTry
    .map((id) => [id, saved.creditRounds?.[id]])
    .filter(([, round]) => round === "main" || round === "review"));
  const practiceCredits = practice ? uniqueKnownIds([...uniqueKnownIds(saved.practiceCredits), ...firstTry]) : [];
  const removedTasks = saved.queue.length - queue.length;
  const total = Number.isInteger(saved.total) && saved.total <= organIds.length
    ? Math.max(queue.length, saved.total - removedTasks)
    : queue.length;
  return {
    phase, practice, practiceCredits, total, queue, review, firstTry, creditRounds, feedback,
    departed: active && saved.departed === "study" ? "study" : null,
  };
}

export function loadQuizProgress(key) {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(key));
  } catch {
    // The test can still run with in-memory progress when storage is unavailable.
  }
  const credited = uniqueKnownIds(saved?.credited);
  const failures = Object.fromEntries(organIds
    .map((id) => [id, saved?.failures?.[id]])
    .filter(([, count]) => Number.isSafeInteger(count) && count >= 0));
  return { credited, failures, run: restoreRun(saved?.run, credited) };
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
