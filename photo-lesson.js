import { sectionFromSearch, sectionHref } from "./sections.js";
import { applySectionPage } from "./section-page.js";
import { createSectionProgress } from "./section-progress.js";
import { connectLessonActivity } from "./lesson-activity.js";
import { createProgressNotice } from "./progress-notice.js";
import { createPhotoAnswerMatcher, normalizePhotoAnswer } from "./photo-answer.js";
import {
  answerQuizTask, attemptLimit, nextQuizTask,
  resumeQuizRun, saveQuizProgress, startQuizReview,
} from "./quiz-progress.js";
import { quizFeedback, renderQuizProgress, renderQuizSummary } from "./quiz-ui.js";

const section = sectionFromSearch(location.search);
const { keys, partIds, quiz, findUnlockCount } = createSectionProgress(section);

function startPhotoLesson() {
  applySectionPage(section, "photo");
  const matchPhotoAnswer = createPhotoAnswerMatcher(section.parts);
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
  const saveNotice = createProgressNotice(() => activity.isActive());
  const activity = connectLessonActivity(keys.activity, "photo", (active) => {
    inactive.hidden = active;
    taskView.inert = !active;
    summary.inert = !active;
    saveNotice.setActive(active);
  });

  function render({ focus = false } = {}) {
    const { run } = state;
    const task = run.queue[0];
    taskView.hidden = !task;
    summary.hidden = Boolean(task);
    if (!task) {
      renderQuizSummary(summary, state, section);
      if (focus) summaryTitle.focus();
      return;
    }

    const correct = run.feedback === "correct";
    const missed = run.feedback === "missed";
    const complete = correct || missed;
    const position = run.total - run.queue.length + 1;
    phase.textContent = `${run.phase === "review" ? "Закрепление" : "Основной круг"} · ${position} из ${run.total}`;
    attempt.textContent = `Попытка ${complete ? task.attempts : task.attempts + 1} из ${attemptLimit}`;
    renderQuizProgress(progress, percent, state, partIds.length);
    const organ = section.parts[task.id];
    if (image.getAttribute("src") !== organ.photo) image.src = organ.photo;
    input.value = task.answer ?? "";
    input.setCustomValidity("");
    input.readOnly = complete;
    input.required = !complete;
    submit.setAttribute("aria-label", correct ? "Дальше" : "Проверить ответ");
    submitLabel.hidden = !correct;
    submit.disabled = missed;
    next.hidden = !missed;
    feedback.dataset.kind = run.feedback ?? "";
    const correctedName = task.corrected ? organ.name.toLocaleLowerCase("ru-RU") : undefined;
    feedback.textContent = quizFeedback(run, task, section.copy, correctedName);
    if (focus) input.focus();
  }

  function save() {
    saveNotice.write(keys.photo, () => saveQuizProgress(keys.photo, state));
  }

  function commit(options) {
    save();
    render(options);
  }

  function enter({ startNew = false } = {}) {
    activity.claim();
    state = quiz.load(keys.photo);
    if (!state.run || (startNew && state.run.phase === "results")) quiz.begin(state);
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
    save();
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
      input.setCustomValidity(section.copy?.photoRequired ?? "Введи название.");
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
    quiz.begin(state);
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

if (quiz.load(keys.find).credited.length < findUnlockCount) location.replace(sectionHref(section, "home"));
else startPhotoLesson();
