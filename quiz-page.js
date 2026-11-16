import { createProgressNotice } from "./progress-notice.js";
import { createQuizSession } from "./quiz-session.js";

const messages = {
  busy: "Тест уже открыт в другой вкладке. Вернись к ней, чтобы продолжить.",
  "read-failed": "Не удалось прочитать сохранённый прогресс. Повтори загрузку, чтобы продолжить тест.",
  "draft-conflict": "Тест изменился в другой вкладке. Если открыть сохранённый прогресс, несохранённый ответ в этой вкладке потеряется.",
  unavailable: "Для запуска теста открой сайт по HTTPS или через localhost в современном браузере.",
};

export function connectQuizPage(key, quiz, { taskView, summary, render, reset, studyHref, homeHref, canEnter }) {
  const session = createQuizSession(key, quiz);
  const status = document.querySelector("#lesson-inactive");
  const message = status.querySelector("p");
  const retry = document.querySelector("#continue-here");
  const notice = createProgressNotice(session.isActive);
  const study = document.querySelector("[data-study-current]");
  const renderState = (options) => render(session.state, { ...options, savedCredits: session.savedCreditCount });
  const save = () => notice.write(() => {
    const saved = session.save();
    if (saved && !summary.hidden && !session.state.run.queue.length) renderState();
    return saved;
  });
  let retryOptions;
  let blockedReason;

  async function enter(options) {
    if (session.isActive()) return;
    retryOptions = options;
    retry.disabled = true;
    let result;
    try {
      if (!canEnter()) {
        location.replace(homeHref);
        return;
      }
    } catch {
      result = "read-failed";
    }
    result ??= await session.open(options);
    if (result === "closed" || (result === "active" && !session.isActive())) return;
    if (result === "active") {
      retryOptions = undefined;
      status.hidden = true;
      notice.setActive(true);
      reset?.();
      save();
      renderState();
      return;
    }
    taskView.hidden = summary.hidden = true;
    notice.setActive(false);
    status.hidden = false;
    blockedReason = result;
    message.textContent = messages[result];
    retry.textContent = {
      "read-failed": "Повторить загрузку",
      "draft-conflict": "Открыть сохранённый прогресс",
    }[result] ?? "Проверить снова";
    retry.hidden = result === "unavailable";
    retry.disabled = false;
  }

  retry.addEventListener("click", () => {
    const options = blockedReason === "draft-conflict" ? { discardDraft: true } : retryOptions;
    enter(options);
  });
  study.addEventListener("click", () => {
    if (!session.isActive()) return;
    notice.write(() => {
      if (!session.moveToStudy()) return false;
      location.assign(studyHref);
      return true;
    }, "Не удалось сохранить переход в «Изучи». Повтори сохранение, чтобы перейти.");
  });
  window.addEventListener("pagehide", () => {
    session.close();
    notice.clear();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) enter(retryOptions);
  });

  const navigation = performance.getEntriesByType("navigation")[0]?.type;
  void enter({ startNew: navigation !== "reload" && navigation !== "back_forward" });
  return {
    get state() { return session.state; },
    isActive: session.isActive,
    change(update, options = {}) {
      if (!session.edit(update)) return false;
      if (options.reset) reset?.();
      save();
      if (options.render !== false) renderState(options);
      return true;
    },
  };
}
