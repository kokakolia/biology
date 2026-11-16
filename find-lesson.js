import { connectQuizPage } from "./quiz-page.js";
import { sectionHref } from "./sections.js";
import { quizFeedback, renderQuizProgress, renderQuizSummary } from "./quiz-ui.js";
import {
  answerQuizTask, attemptLimit, nextQuizTask, startQuizReview,
} from "./quiz-progress.js";

export function startFindLesson(scene, section, { keys, partIds, quiz, findUnlockCount }) {
  const layout = document.querySelector(".find-layout");
  const studyButton = document.querySelector("[data-study-current]");
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

  function render(state, { focus = false } = {}) {
    const { run } = state;
    const task = run.queue[0];
    layout.hidden = !task;
    summary.hidden = Boolean(task);
    if (!task) {
      renderQuizSummary(summary, state, section, findUnlockCount);
      if (focus) summaryTitle.focus();
      return;
    }

    scene.ensureLoaded();
    const position = run.total - run.queue.length + 1;
    const reviewing = run.phase === "review";
    const correct = run.feedback === "correct";
    const missed = run.feedback === "missed";
    const complete = correct || missed;
    studyButton.hidden = complete;
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

  const page = connectQuizPage(keys.find, quiz, {
    taskView: layout, summary, render, reset: scene.reset, studyHref: sectionHref(section, "study"),
  });

  function advance() {
    page.change(({ run }) => nextQuizTask(run), { reset: true, focus: true });
  }

  confirm.addEventListener("click", (event) => {
    if (!page.isActive() || event.detail > 1) return;
    if (page.state.run.feedback === "correct") {
      advance();
    } else {
      const selected = scene.selected();
      if (!selected) return;
      page.change((state) => {
        answerQuizTask(state, selected);
        if (state.run.feedback === "retry") scene.clearSelection();
      });
      if (!next.hidden) next.focus();
    }
  });
  next.addEventListener("click", advance);
  reviewButton.addEventListener("click", () => {
    page.change(({ run }) => startQuizReview(run), { reset: true, focus: true });
  });
  repeatButton.addEventListener("click", () => {
    page.change(quiz.begin, { reset: true, focus: true });
  });
}
