import { loadFindProgress, findUnlockCount } from "./find-progress.js";
import { connectLessonActivity } from "./lesson-activity.js";
import { organCatalog } from "./organs.js";
import { matchPhotoAnswer, normalizePhotoAnswer } from "./photo-answer.js";
import {
  answerQuizTask, attemptLimit, beginQuizRun, loadQuizProgress, nextQuizTask, photoProgressKey,
  resumeQuizRun, saveQuizProgress, startQuizReview,
} from "./quiz-progress.js";
import { quizFeedback, renderQuizProgress, renderQuizSummary } from "./quiz-ui.js";

const imagePaths = {
  esophagus: "./assets/photo-esophagus.webp",
  stomach: "./assets/lesson-study.webp",
  liver: "./assets/lesson-photo.webp",
  pancreas: "./assets/photo-pancreas.webp",
  "small-intestine": "./assets/photo-small-intestine.webp",
  "large-intestine": "./assets/photo-large-intestine.webp",
};

function startPhotoLesson() {
  const taskView = document.querySelector("#photo-task");
  const summary = document.querySelector("#photo-summary");
  const summaryTitle = document.querySelector("#summary-title");
  const inactive = document.querySelector("#lesson-inactive");
  const phase = document.querySelector("#photo-phase");
  const attempt = document.querySelector("#photo-attempt");
  const percent = document.querySelector("#photo-percent");
  const progress = document.querySelector("#photo-progress");
  const image = document.querySelector("#organ-photo");
  const form = document.querySelector("#photo-form");
  const input = document.querySelector("#photo-answer");
  const submit = document.querySelector("#photo-submit");
  const submitLabel = document.querySelector("#photo-submit-label");
  const feedback = document.querySelector("#photo-feedback");
  const next = document.querySelector("#next-task");

  let state;
  const activity = connectLessonActivity("photo", (active) => {
    inactive.hidden = active;
    taskView.inert = !active;
    summary.inert = !active;
  });

  function render({ focus = false } = {}) {
    const { run } = state;
    const task = run.queue[0];
    taskView.hidden = !task;
    summary.hidden = Boolean(task);
    if (!task) {
      renderQuizSummary(summary, state);
      if (focus) summaryTitle.focus();
      return;
    }

    const correct = run.feedback === "correct";
    const missed = run.feedback === "missed";
    const complete = correct || missed;
    const position = run.total - run.queue.length + 1;
    phase.textContent = `${run.phase === "review" ? "Закрепление" : "Основной круг"} · ${position} из ${run.total}`;
    attempt.textContent = `Попытка ${complete ? task.attempts : task.attempts + 1} из ${attemptLimit}`;
    renderQuizProgress(progress, percent, state);
    const source = imagePaths[task.id];
    if (image.getAttribute("src") !== source) image.src = source;
    input.value = task.answer ?? "";
    input.setCustomValidity("");
    input.readOnly = complete;
    input.required = !complete;
    submit.setAttribute("aria-label", correct ? "Дальше" : "Проверить ответ");
    submitLabel.hidden = !correct;
    submit.disabled = missed;
    next.hidden = !missed;
    feedback.dataset.kind = run.feedback ?? "";
    const correctedName = task.corrected ? organCatalog[task.id].name.toLocaleLowerCase("ru-RU") : undefined;
    feedback.textContent = quizFeedback(run, task, correctedName);
    if (focus) input.focus();
  }

  function commit(options) {
    saveQuizProgress(photoProgressKey, state);
    render(options);
  }

  function enter({ startNew = false } = {}) {
    activity.claim();
    state = loadQuizProgress(photoProgressKey);
    if (!state.run || (startNew && state.run.phase === "results")) beginQuizRun(state);
    resumeQuizRun(state.run);
    commit();
  }

  function advance() {
    nextQuizTask(state.run);
    commit({ focus: true });
  }

  input.addEventListener("input", () => {
    if (!activity.isActive() || input.readOnly) return;
    input.setCustomValidity("");
    state.run.queue[0].answer = input.value;
    saveQuizProgress(photoProgressKey, state);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!activity.isActive()) return;
    const { run } = state;
    if (run.feedback === "correct") {
      advance();
      return;
    }
    if (run.feedback === "missed") return;
    if (!normalizePhotoAnswer(input.value)) {
      input.setCustomValidity("Введи название органа.");
      input.reportValidity();
      return;
    }

    const task = run.queue[0];
    const match = matchPhotoAnswer(input.value);
    task.answer = input.value;
    task.corrected = match.corrected && match.id === task.id;
    answerQuizTask(state, match.id);
    commit();
    if (run.feedback === "correct") submit.focus();
    else if (run.feedback === "missed") next.focus();
    else {
      input.focus();
      input.select();
    }
  });
  next.addEventListener("click", () => {
    if (activity.isActive()) advance();
  });
  document.querySelector("#start-review").addEventListener("click", () => {
    if (!activity.isActive()) return;
    startQuizReview(state.run);
    commit({ focus: true });
  });
  document.querySelector("#repeat-photo").addEventListener("click", () => {
    if (!activity.isActive()) return;
    beginQuizRun(state);
    commit({ focus: true });
  });
  document.querySelector("#continue-here").addEventListener("click", () => enter());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) enter();
  });

  const navigation = performance.getEntriesByType("navigation")[0]?.type;
  enter({ startNew: navigation !== "reload" && navigation !== "back_forward" });
  document.querySelector("main").hidden = false;
}

if (loadFindProgress().credited.length < findUnlockCount) location.replace("./");
else startPhotoLesson();
