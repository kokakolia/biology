import { createProgressNotice } from "./progress-notice.js";
import { createQuizSession } from "./quiz-session.js";

export function connectQuizPage(key, quiz, { taskView, summary, render, reset, studyHref }) {
  const session = createQuizSession(key, quiz);
  const status = document.querySelector("#lesson-inactive");
  const message = status.querySelector("p");
  const retry = document.querySelector("#continue-here");
  const notice = createProgressNotice(session.isActive);
  const study = document.querySelector("[data-study-current]");
  const save = () => notice.write(session.save);
  let retryOptions;

  async function enter(options) {
    if (session.isActive()) return;
    retry.disabled = true;
    const result = await session.open(options);
    if (result === "closed") return;
    if (result === "active" && session.isActive()) {
      status.hidden = true;
      notice.setActive(true);
      reset?.();
      save();
      render(session.state);
      return;
    }
    taskView.hidden = summary.hidden = true;
    notice.setActive(false);
    status.hidden = false;
    retryOptions = result === "read-failed" ? options : undefined;
    message.textContent = result === "busy"
      ? "Тест уже открыт в другой вкладке. Вернись к ней, чтобы продолжить."
      : result === "read-failed"
        ? "Не удалось прочитать сохранённый прогресс. Повтори загрузку, чтобы продолжить тест."
        : "Для запуска теста открой сайт по HTTPS или через localhost в современном браузере.";
    retry.textContent = result === "read-failed" ? "Повторить загрузку" : "Проверить снова";
    retry.hidden = result !== "busy" && result !== "read-failed";
    retry.disabled = false;
  }

  retry.addEventListener("click", () => enter(retryOptions));
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
    if (event.persisted) enter();
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
      if (options.render !== false) render(session.state, options);
      return true;
    },
  };
}
