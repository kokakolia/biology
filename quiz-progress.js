import { writeProgress } from "./progress-storage.js";

export const attemptLimit = 2;

export function createQuizProgress(partIds) {
  const knownParts = new Set(partIds);

  function uniqueKnownIds(value) {
    return Array.isArray(value) ? [...new Set(value.filter((id) => knownParts.has(id)))] : [];
  }

  function restoreTasks(value, maxAttempts) {
    const seen = new Set();
    const tasks = [];
    for (const entry of value) {
    const { id, attempts, answer, corrected, lastAnswer } = entry ?? {};
      if (!knownParts.has(id) || seen.has(id) || !Number.isInteger(attempts) || attempts < 0 || attempts > maxAttempts) continue;
      seen.add(id);
      const task = { id, attempts };
      if (typeof answer === "string") task.answer = answer;
      if (typeof corrected === "boolean") task.corrected = corrected;
    if (typeof lastAnswer === "string") task.lastAnswer = lastAnswer;
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
    if (practice && credited.length !== partIds.length) return null;

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
    const total = Number.isInteger(saved.total) && saved.total <= partIds.length
      ? Math.max(queue.length, saved.total - removedTasks)
      : queue.length;
    return {
      phase, practice, practiceCredits, total, queue, review, firstTry, creditRounds, feedback,
    };
  }

  function readSnapshot(key) {
    const value = localStorage.getItem(key);
    let saved;
    try {
      saved = JSON.parse(value);
    } catch {
      // A damaged entry is treated as an empty one.
    }
    const credited = uniqueKnownIds(saved?.credited);
    const failures = Object.fromEntries(partIds
      .map((id) => [id, saved?.failures?.[id]])
      .filter(([, count]) => Number.isSafeInteger(count) && count >= 0));
    return { value, state: { credited, failures, run: restoreRun(saved?.run, credited) } };
  }

  const read = (key) => readSnapshot(key).state;

  function begin(state) {
    const remaining = partIds.filter((id) => !state.credited.includes(id));
    const practice = remaining.length === 0;
    const previous = state.run;
    const previousPracticeCredits = previous?.practice ? previous.practiceCredits ?? previous.firstTry : [];
    const reviewing = previous?.phase === "results" && (!practice || (previous.practice && previousPracticeCredits.length < partIds.length));
    const practiceCredits = practice && reviewing ? [...previousPracticeCredits] : [];
    const ids = practice ? partIds.filter((id) => !practiceCredits.includes(id)) : remaining;
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
    };
  }

  return { read, readSnapshot, begin };
}

export function quizPercent(count, total) {
  return total ? Math.round(count * 100 / total) : 0;
}

export const saveQuizProgress = writeProgress;

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

export function moveQuizTaskToStudy(run) {
  if (!run.queue.length) return;
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
