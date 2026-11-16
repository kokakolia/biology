import { quizPercent } from "./quiz-progress.js";

const creditLabels = {
  main: "С первой попытки",
  review: "Зачтён на закреплении",
};

function creditedForRun(state) {
  const { run } = state;
  return run.practice ? run.practiceCredits ?? run.firstTry : state.credited;
}

export function renderQuizProgress(meter, percent, state, total) {
  const count = creditedForRun(state).length;
  meter.labels[0].textContent = state.run.practice ? "Прогресс прохода" : "Прогресс урока";
  meter.max = total;
  meter.value = count;
  percent.textContent = `${quizPercent(count, total)}%`;
}

export function renderQuizSummary(summary, state, section, nextThreshold) {
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
  const entries = Object.entries(section.parts);
  const total = entries.length;
  const partNoun = section.copy?.countParts ?? "частей";
  summaryTitle.textContent = reviewing ? "Основной круг пройден" : "Результат";
  summaryText.textContent = reviewing ? `На закреплении заданий: ${run.review.length}.` : `Зачтено за проход: ${count} из ${total}.`;
  if (!reviewing && !run.practice) summaryText.textContent = `Зачтено ${partNoun}: ${count} из ${total}.`;
  summaryScore.textContent = `${quizPercent(count, total)}%`;
  summaryScore.hidden = reviewing;
  savedScore.hidden = reviewing || !run.practice;
  reviewButton.hidden = !reviewing;
  repeatButton.hidden = reviewing;
  summaryStudy.hidden = reviewing || count === total;
  const summaryNext = summary.querySelector("#summary-next");
  if (summaryNext) summaryNext.hidden = reviewing || state.credited.length < nextThreshold;
  summaryList.hidden = reviewing;
  if (reviewing) return;

  summaryList.replaceChildren(...entries.map(([id, part]) => {
    const item = document.createElement("li");
    const title = document.createElement("span");
    const result = document.createElement("span");
    title.textContent = part.name;
    const credited = scoreIds.includes(id);
    result.textContent = run.firstTry.includes(id)
      ? creditLabels[run.creditRounds?.[id]] ?? "Зачтён"
      : credited ? "Зачтён ранее" : "К повторению";
    item.dataset.credited = String(credited);
    item.append(title, result);
    return item;
  }));
}

export function quizFeedback(run, task, copy, correctedName) {
  const reviewing = run.phase === "review";
  switch (run.feedback) {
    case "retry":
      return "Пока неверно. Попробуй ещё раз.";
    case "missed":
      return reviewing
        ? copy?.missedReview ?? "Пока неверно. Это задание можно повторить позже."
        : copy?.missedMain ?? "Пока неверно. Задание вернётся на закреплении.";
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
