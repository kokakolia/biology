import { findPercent, findProgressKey, findUnlockCount, loadFindProgress } from "./find-progress.js";
import { loadQuizProgress, photoProgressKey } from "./quiz-progress.js";
import { loadStudyMarks, studyProgressKey, studyPercent, studyUnlockMarks } from "./study-progress.js";

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
  const count = loadStudyMarks().size;
  const percent = studyPercent(count);
  meter.value = percent;
  percentOutput.textContent = `${percent}%`;
  studyAction.textContent = percent === 0 ? "Начать" : percent === 100 ? "Повторить" : "Продолжить";

  const findAvailable = count >= studyUnlockMarks;
  const find = loadFindProgress();
  const score = findPercent(find.credited.length);
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
  const photo = loadQuizProgress(photoProgressKey);
  const photoScore = findPercent(photo.credited.length);
  photoMeter.value = photoScore;
  photoPercent.textContent = `${photoScore}%`;
  photoStatus.textContent = quizAction(photo.run);
}

renderProgress();
window.addEventListener("pageshow", renderProgress);
window.addEventListener("storage", (event) => {
  if (event.key === studyProgressKey || event.key === findProgressKey || event.key === photoProgressKey || event.key === null) renderProgress();
});
