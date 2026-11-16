import { organCatalog, organIds } from "./organs.js";
import { quizPercent } from "./quiz-progress.js";

const creditLabels = {
  main: "С первой попытки",
  review: "Зачтён на закреплении",
};

function creditedForRun(state) {
  const { run } = state;
  return run.practice ? run.practiceCredits ?? run.firstTry : state.credited;
}

export function renderQuizProgress(meter, percent, state) {
  const count = creditedForRun(state).length;
  meter.labels[0].textContent = state.run.practice ? "Прогресс прохода" : "Прогресс урока";
  meter.max = organIds.length;
  meter.value = count;
  percent.textContent = `${quizPercent(count)}%`;
}

export function renderQuizSummary(summary, state, nextThreshold) {
  const { run } = state;
  const summaryStudy = summary.querySelector("#summary-study");
  const repeatButton = summary.querySelector("[data-quiz-repeat]");
  const reviewButton = summary.querySelector("#start-review");
  const savedScore = summary.querySelector("#summary-saved-score");
  const summaryScore = summary.querySelector("#summary-score");
  const summaryList = summary.querySelector("#summary-list");
  const summaryText = summary.querySelector("#summary-text");
  const summaryTitle = summary.querySelector("#summary-title");
  const reviewing = run.phase === "break";
  const scoreIds = creditedForRun(state);
  const count = scoreIds.length;
  summaryTitle.textContent = reviewing ? "Основной круг пройден" : "Результат";
  summaryText.textContent = reviewing ? `На закреплении заданий: ${run.review.length}.` : `Зачтено за проход: ${count} из ${organIds.length}.`;
  if (!reviewing && !run.practice) summaryText.textContent = `Зачтено органов: ${count} из ${organIds.length}.`;
  summaryScore.textContent = `${quizPercent(count)}%`;
  summaryScore.hidden = reviewing;
  savedScore.hidden = reviewing || !run.practice;
  reviewButton.hidden = !reviewing;
  repeatButton.hidden = reviewing;
  summaryStudy.hidden = reviewing || count === organIds.length;
  const summaryNext = summary.querySelector("#summary-next");
  if (summaryNext) summaryNext.hidden = reviewing || count < nextThreshold;
  summaryList.hidden = reviewing;
  if (reviewing) return;

  summaryList.replaceChildren(...organIds.map((id) => {
    const item = document.createElement("li");
    const title = document.createElement("span");
    const result = document.createElement("span");
    title.textContent = organCatalog[id].name;
    const credited = scoreIds.includes(id);
    result.textContent = run.firstTry.includes(id)
      ? creditLabels[run.creditRounds?.[id]] ?? "Зачтён"
      : credited ? "Зачтён ранее" : "К повторению";
    item.dataset.credited = String(credited);
    item.append(title, result);
    return item;
  }));
}

export function quizFeedback(run, task, correctedName) {
  const reviewing = run.phase === "review";
  switch (run.feedback) {
    case "retry":
      return "Пока неверно. Попробуй ещё раз.";
    case "missed":
      return reviewing ? "Пока неверно. Этот орган можно повторить позже." : "Пока неверно. Этот орган вернётся на закреплении.";
    case "correct":
      if (correctedName) {
        const message = `Верно — ${correctedName}.`;
        return task.attempts > 1 && !reviewing ? `${message} Задание вернётся на закреплении.` : message;
      }
      if (task.attempts === 1) return "Верно! Зачтено.";
      return reviewing ? "Верно со второй попытки." : "Верно. Задание вернётся на закреплении.";
    default:
      return "";
  }
}
