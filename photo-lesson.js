import { sectionFromSearch, sectionHref } from "./sections.js";
import { applySectionPage } from "./section-page.js";
import { createSectionProgress } from "./section-progress.js";
import { connectQuizPage } from "./quiz-page.js";
import { createPhotoAnswerMatcher, normalizePhotoAnswer } from "./photo-answer.js";
import {
  answerQuizTask, attemptLimit, nextQuizTask, startQuizReview,
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
  const studyButton = document.querySelector("[data-study-current]");
  const phase = document.querySelector("#photo-phase");
  const attempt = document.querySelector("#photo-attempt");
  const percent = document.querySelector("#photo-percent");
  const progress = document.querySelector("#photo-progress");
  let image = document.querySelector("#organ-photo");
  const photoLoad = document.querySelector("#photo-load");
  const photoMessage = document.querySelector("#photo-load-message");
  const retryPhoto = document.querySelector("#retry-photo");
  const form = document.querySelector("#photo-form");
  const input = document.querySelector("#photo-answer");
  const submit = document.querySelector("#photo-submit");
  const submitLabel = document.querySelector("#photo-submit-label");
  const feedback = document.querySelector("#photo-feedback");
  const next = document.querySelector("#next-task");
  let photoSource;
  let photoState = "loading";

  function repeatsLastAnswer(run, answer) {
    return run.feedback === "retry" && run.queue[0]?.lastAnswer === answer;
  }

  function updateAnswerControls(run) {
    const correct = run.feedback === "correct";
    const missed = run.feedback === "missed";
    input.readOnly = correct || missed || photoState !== "ready";
    input.required = !input.readOnly;
    submit.type = correct ? "button" : "submit";
    submit.disabled = missed || (!correct &&
      (photoState !== "ready" || repeatsLastAnswer(run, normalizePhotoAnswer(input.value))));
  }

  function showPhotoState(state, run) {
    photoState = state;
    image.hidden = state !== "ready";
    photoLoad.hidden = state === "ready";
    retryPhoto.hidden = state !== "failed";
    photoMessage.textContent = state === "failed" ? "Изображение не загрузилось." : "Загружаем изображение…";
    updateAnswerControls(run);
  }

  function loadPhoto(source, run) {
    photoSource = source;
    const requested = image.cloneNode(false);
    requested.removeAttribute("src");
    image.replaceWith(requested);
    image = requested;
    showPhotoState("loading", run);
    requested.addEventListener("load", () => {
      if (image === requested) showPhotoState("ready", page.state.run);
    });
    requested.addEventListener("error", () => {
      if (image === requested) showPhotoState("failed", page.state.run);
    });
    requested.src = source;
  }

  function render(state, { focus = false } = {}) {
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
    studyButton.hidden = complete;
    const position = run.total - run.queue.length + 1;
    phase.textContent = `${run.phase === "review" ? "Закрепление" : "Основной круг"} · ${position} из ${run.total}`;
    attempt.textContent = `Попытка ${complete ? task.attempts : task.attempts + 1} из ${attemptLimit}`;
    renderQuizProgress(progress, percent, state, partIds.length);
    const organ = section.parts[task.id];
    if (photoSource !== organ.photo) loadPhoto(organ.photo, run);
    input.value = task.answer ?? "";
    input.setCustomValidity("");
    updateAnswerControls(run);
    submit.setAttribute("aria-label", correct ? "Дальше" : "Проверить ответ");
    submitLabel.hidden = !correct;
    next.hidden = !missed;
    feedback.dataset.kind = run.feedback ?? "";
    const correctedName = task.corrected ? organ.name.toLocaleLowerCase("ru-RU") : undefined;
    feedback.textContent = run.feedback === "retry"
      ? "Пока неверно. Измени ответ для второй попытки."
      : quizFeedback(run, task, section.copy, correctedName);
    if (focus) input.focus();
  }

  const page = connectQuizPage(keys.photo, quiz, {
    taskView, summary, render, studyHref: sectionHref(section, "study"),
    homeHref: sectionHref(section, "home"),
    canEnter: () => quiz.read(keys.find).credited.length >= findUnlockCount,
  });

  function advance() {
    page.change(({ run }) => nextQuizTask(run), { focus: true });
  }

  retryPhoto.addEventListener("click", () => {
    if (page.isActive() && photoState === "failed") loadPhoto(photoSource, page.state.run);
  });
  input.addEventListener("input", () => {
    if (!page.isActive() || input.readOnly) return;
    input.setCustomValidity("");
    page.change(({ run }) => { run.queue[0].answer = input.value; }, { render: false });
    updateAnswerControls(page.state.run);
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.repeat) event.preventDefault();
  });
  submit.addEventListener("click", (event) => {
    if (event.detail > 1) event.preventDefault();
    else if (page.isActive() && page.state.run.feedback === "correct") advance();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!page.isActive()) return;
    const { run } = page.state;
    const answer = normalizePhotoAnswer(input.value);
    if (run.feedback === "correct" || run.feedback === "missed" ||
        photoState !== "ready" || repeatsLastAnswer(run, answer)) return;
    if (!answer) {
      input.setCustomValidity(section.copy?.photoRequired ?? "Введи название.");
      input.reportValidity();
      return;
    }

    const task = run.queue[0];
    const match = matchPhotoAnswer(input.value);
    page.change((state) => {
      task.answer = input.value;
      task.lastAnswer = answer;
      task.corrected = match.corrected && match.id === task.id;
      answerQuizTask(state, match.id);
    });
    if (run.feedback === "correct") submit.focus();
    else if (run.feedback === "missed") next.focus();
    else {
      input.focus();
      input.select();
    }
  });
  next.addEventListener("click", advance);
  document.querySelector("#start-review").addEventListener("click", () => {
    page.change(({ run }) => startQuizReview(run), { focus: true });
  });
  document.querySelector("#repeat-photo").addEventListener("click", () => {
    page.change(quiz.begin, { focus: true });
  });
  document.querySelector("main").hidden = false;
}

startPhotoLesson();
