const warning = "Браузер не сохранил прогресс. Если уйти со страницы, последние действия могут потеряться.";

export function createProgressNotice(canRetry) {
  const main = document.querySelector("main");
  const notice = document.createElement("div");
  notice.className = "progress-notice";
  notice.hidden = true;
  const message = document.createElement("p");
  message.textContent = warning;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "lesson-button secondary";
  retry.textContent = "Повторить сохранение";
  notice.append(message, retry);

  const status = document.createElement("div");
  status.className = "progress-notice-status";
  status.setAttribute("role", "status");
  main.prepend(notice, status);

  const pending = new Map();

  function write(key, save) {
    const hadFailure = pending.size > 0;
    if (save()) pending.delete(key);
    else pending.set(key, save);
    const hasFailure = pending.size > 0;
    notice.hidden = !hasFailure;
    if (hadFailure !== hasFailure) status.textContent = hasFailure ? warning : "Прогресс сохранён.";
  }

  retry.addEventListener("click", () => {
    if (!canRetry()) return;
    for (const [key, save] of [...pending]) write(key, save);
  });

  return {
    write,
    setActive(active) { retry.disabled = !active; },
  };
}
