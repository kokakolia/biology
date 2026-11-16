import { sectionFromSearch } from "./sections.js";
import { applySectionPage } from "./section-page.js";
import { createSectionProgress } from "./section-progress.js";
import { quizPercent } from "./quiz-progress.js";

const section = sectionFromSearch(location.search);
const { keys, partIds, study, quiz, findUnlockCount } = createSectionProgress(section);
applySectionPage(section, "home");

const meter = document.querySelector("#study-meter");
const percentOutput = document.querySelector("#study-percent");
const studyAction = document.querySelector("#study-action");
const findCard = document.querySelector("#find-card");
const findStatus = document.querySelector("#find-status");
const findLock = document.querySelector("#find-lock");
const findEntry = document.querySelector("#find-entry");
const findMeter = document.querySelector("#find-meter");
const findPercentOutput = document.querySelector("#find-percent");
const photoCard = document.querySelector("#photo-card");
const photoLock = document.querySelector("#photo-lock");
const photoEntry = document.querySelector("#photo-entry");
const photoStatus = document.querySelector("#photo-status");
const photoMeter = document.querySelector("#photo-meter");
const photoPercent = document.querySelector("#photo-percent");

function quizAction(run) {
  if (!run) return "Начать";
  return run.phase === "results" ? "Повторить" : "Продолжить";
}

function renderProgress() {
  const count = study.load().size;
  const percent = study.percent(count);
  meter.value = percent;
  percentOutput.textContent = `${percent}%`;
  studyAction.textContent = percent === 0 ? "Начать" : percent === 100 ? "Повторить" : "Продолжить";

  const findAvailable = count >= study.unlockCount;
  const find = quiz.load(keys.find);
  const score = quizPercent(find.credited.length, partIds.length);
  findCard.dataset.status = findAvailable ? "available" : "locked";
  findLock.hidden = findAvailable;
  findEntry.hidden = !findAvailable;
  findMeter.value = score;
  findPercentOutput.textContent = `${score}%`;
  findStatus.textContent = quizAction(find.run);

  const photoAvailable = find.credited.length >= findUnlockCount;
  photoCard.dataset.status = photoAvailable ? "available" : "locked";
  photoLock.hidden = photoAvailable;
  photoEntry.hidden = !photoAvailable;
  const photo = quiz.load(keys.photo);
  const photoScore = quizPercent(photo.credited.length, partIds.length);
  photoMeter.value = photoScore;
  photoPercent.textContent = `${photoScore}%`;
  photoStatus.textContent = quizAction(photo.run);
}

renderProgress();
window.addEventListener("pageshow", renderProgress);
window.addEventListener("storage", (event) => {
  if (event.key === keys.study || event.key === keys.find || event.key === keys.photo || event.key === null) renderProgress();
});
