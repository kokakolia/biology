import { connectLessonActivity } from "./lesson-activity.js";
import { createProgressNotice } from "./progress-notice.js";
import { quizFeedback, renderQuizProgress, renderQuizSummary } from "./quiz-ui.js";
import {
  answerQuizTask, attemptLimit, nextQuizTask, resumeQuizRun, saveQuizProgress, startQuizReview,
} from "./quiz-progress.js";

export function startFindLesson(scene, section, { keys, partIds, quiz, findUnlockCount }) {
  const layout = document.querySelector(".find-layout");
  const inactive = document.querySelector("#lesson-inactive");
  const summary = document.querySelector("#find-summary");
  const summaryTitle = document.querySelector("#summary-title");
  const reviewButton = document.querySelector("#start-review");
  const repeatButton = document.querySelector("#repeat-find");
  const phase = document.querySelector("#find-phase");
  const prompt = document.querySelector("#find-prompt");
  const attempt = document.querySelector("#find-attempt");
  const feedback = document.querySelector("#find-feedback");
  const next = document.querySelector("#next-task");
  const confirm = document.querySelector("#confirm-organ");
  const selection = document.querySelector("#selection");
  const remove = document.querySelector("#remove");
  const progress = document.querySelector("#progress");
  const percent = document.querySelector("#progress-percent");

  let state;
  const saveNotice = createProgressNotice(() => activity.isActive());
  const activity = connectLessonActivity(keys.activity, "find", (active) => {
    inactive.hidden = active;
    layout.inert = !active;
    summary.inert = !active;
    saveNotice.setActive(active);
  });

  function render({ focus = false } = {}) {
    const { run } = state;
    const task = run.queue[0];
    layout.hidden = !task;
    summary.hidden = Boolean(task);
    if (!task) {
      renderQuizSummary(summary, state, section, findUnlockCount);
      if (focus) summaryTitle.focus();
      return;
    }

    const position = run.total - run.queue.length + 1;
    const reviewing = run.phase === "review";
    const correct = run.feedback === "correct";
    const missed = run.feedback === "missed";
    const complete = correct || missed;
    phase.textContent = `${reviewing ? "Закрепление" : "Основной круг"} · ${position} из ${run.total}`;
    prompt.textContent = section.parts[task.id].prompt;
    attempt.textContent = `Попытка ${complete ? task.attempts : task.attempts + 1} из ${attemptLimit}`;
    renderQuizProgress(progress, percent, state, partIds.length);
    scene.setLocked(complete);
    selection.hidden = !correct && !scene.selected();
    remove.hidden = correct && !scene.selected();
    confirm.textContent = correct ? "Дальше" : "Подтвердить";
    confirm.disabled = missed;
    next.hidden = !missed;
    feedback.dataset.kind = run.feedback ?? "";
    feedback.textContent = quizFeedback(run, task, section.copy);
    if (focus) prompt.focus();
  }

  function commit(options) {
    saveNotice.write(keys.find, () => saveQuizProgress(keys.find, state));
    render(options);
  }

  function enter({ startNew = false } = {}) {
    activity.claim();
    state = quiz.load(keys.find);
    if (!state.run || (startNew && state.run.phase === "results")) quiz.begin(state);
    resumeQuizRun(state.run);
    scene.reset();
    commit();
  }

  function advance() {
    nextQuizTask(state.run);
    scene.reset();
    commit({ focus: true });
  }

  confirm.addEventListener("click", () => {
    if (!activity.isActive()) return;
    if (state.run.feedback === "correct") {
      advance();
    } else if (scene.selected()) {
      answerQuizTask(state, scene.selected());
      commit();
      if (!next.hidden) next.focus();
    }
  });
  next.addEventListener("click", () => {
    if (activity.isActive()) advance();
  });
  reviewButton.addEventListener("click", () => {
    if (!activity.isActive()) return;
    startQuizReview(state.run);
    scene.reset();
    commit({ focus: true });
  });
  repeatButton.addEventListener("click", () => {
    if (!activity.isActive()) return;
    quiz.begin(state);
    scene.reset();
    commit({ focus: true });
  });
  document.querySelector("#continue-here").addEventListener("click", () => enter());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) enter();
  });

  const navigation = performance.getEntriesByType("navigation")[0]?.type;
  enter({ startNew: navigation !== "reload" && navigation !== "back_forward" });
  return activity;
}
