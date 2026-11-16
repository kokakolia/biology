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
  const image = document.querySelector("#organ-photo");
  const form = document.querySelector("#photo-form");
  const input = document.querySelector("#photo-answer");
  const submit = document.querySelector("#photo-submit");
  const submitLabel = document.querySelector("#photo-submit-label");
  const feedback = document.querySelector("#photo-feedback");
  const next = document.querySelector("#next-task");

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

  const page = connectQuizPage(keys.photo, quiz, {
    taskView, summary, render, studyHref: sectionHref(section, "study"),
  });

  function advance() {
    page.change(({ run }) => nextQuizTask(run), { focus: true });
  }

  input.addEventListener("input", () => {
    if (!page.isActive() || input.readOnly) return;
    input.setCustomValidity("");
    page.change(({ run }) => { run.queue[0].answer = input.value; }, { render: false });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!page.isActive()) return;
    const { run } = page.state;
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
    page.change((state) => {
      task.answer = input.value;
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

if (quiz.load(keys.find).credited.length < findUnlockCount) location.replace(sectionHref(section, "home"));
else startPhotoLesson();
