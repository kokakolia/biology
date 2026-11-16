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

  let pending;

  function write(save, failureMessage = warning) {
    const hadFailure = Boolean(pending);
    pending = save() ? undefined : { save, failureMessage };
    notice.hidden = !pending;
    if (pending && (message.textContent !== failureMessage || !hadFailure)) {
      message.textContent = status.textContent = failureMessage;
    } else if (hadFailure && !pending) {
      status.textContent = "Прогресс сохранён.";
    }
  }

  retry.addEventListener("click", () => {
    if (pending && canRetry()) write(pending.save, pending.failureMessage);
  });

  return {
    write,
    clear() {
      pending = undefined;
      notice.hidden = true;
      status.textContent = "";
    },
    setActive(active) { retry.disabled = !active; },
  };
}
