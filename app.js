import { loadStudyMarks, parseStudyMarks, studyMarkTotal, studyPercent, studyProgressKey, studyUnlockMarks } from "./study-progress.js";
import { organCatalog, organIds } from "./organs.js";
import { activeLessonName, connectLessonActivity } from "./lesson-activity.js";
import { startFindLesson } from "./find-lesson.js";
import { pauseQuizForStudy } from "./quiz-progress.js";
import { createTorsoViewer } from "./torso-viewer.js";

const rows = new Map();

const stage = document.querySelector("#stage");
const isFind = document.body.classList.contains("find-lesson");
const loading = document.querySelector("#loading");
const selection = document.querySelector("#selection");
const selectionName = document.querySelector("#selection-name");
const info = document.querySelector("#info");
const remove = document.querySelector("#remove");
const reference = document.querySelector("#reference");
const referenceTitle = document.querySelector("#reference-title");
const referenceLocation = document.querySelector("#reference-location");
const referenceFunction = document.querySelector("#reference-function");
const viewButtons = [...document.querySelectorAll("[data-view]")];
const progress = document.querySelector("#progress");
const progressPercent = document.querySelector("#progress-percent");
const marks = loadStudyMarks();
let viewer;
let selectionLocked = false;

function updateProgress() {
  progress.value = marks.size;
  progress.setAttribute("aria-valuetext", `${marks.size} из ${studyMarkTotal} отметок`);
  progressPercent.textContent = `${studyPercent(marks.size)}%`;
}

function recordMark(mark) {
  if (marks.has(mark)) return;
  marks.add(mark);
  try {
    for (const saved of loadStudyMarks()) marks.add(saved);
    localStorage.setItem(studyProgressKey, JSON.stringify([...marks]));
  } catch {
    // The lesson still tracks progress in memory when storage is unavailable.
  }
  updateProgress();
}

function setReference(open) {
  reference.hidden = !open;
  info.setAttribute("aria-expanded", String(open));
  info.setAttribute("aria-label", open ? "Закрыть справку" : "Открыть справку");
  info.title = info.getAttribute("aria-label");
  if (open) recordMark(`info:${viewer.selected}`);
}

function selectOrgan(clickedId) {
  const selected = viewer.selected;
  const id = clickedId === selected ? null : clickedId;
  if (id === selected) return;
  viewer.setSelection(id);
  if (selected) {
    const previous = rows.get(selected);
    previous.element.dataset.selected = "false";
    previous.pickButton?.setAttribute("aria-pressed", "false");
  }
  if (!isFind) setReference(false);
  selection.hidden = !id;
  if (!id) return;

  const row = rows.get(id);
  row.element.dataset.selected = "true";
  if (!isFind) {
    const organ = organCatalog[id];
    row.pickButton.setAttribute("aria-pressed", "true");
    selectionName.textContent = organ.name;
    referenceTitle.textContent = organ.name;
    referenceLocation.textContent = organ.location;
    referenceFunction.textContent = organ.function;
    recordMark(`select:${id}`);
  }
}

function updateVisibility(id) {
  const row = rows.get(id);
  const removed = !viewer.isOrganVisible(id);
  row.element.dataset.removed = String(removed);
  row.pickButton?.setAttribute("aria-disabled", String(removed));
  const action = removed ? "Вернуть на торс" : "Убрать с обзора";
  const label = `${action} · ${row.label}`;
  row.visibilityButton.setAttribute("aria-label", label);
  row.visibilityButton.title = label;
  row.visibilityButton.querySelector("use").setAttribute("href", removed ? "#icon-eye-off" : "#icon-eye");
}

function toggleOrgan(id) {
  if (selectionLocked) return;
  const visible = viewer.isOrganVisible(id);
  if (visible && viewer.selected === id) selectOrgan(null);
  viewer.setOrganVisible(id, !visible);
  updateVisibility(id);
}

function setSelectionLocked(locked) {
  selectionLocked = locked;
  remove.disabled = locked;
  for (const { visibilityButton } of rows.values()) visibilityButton.disabled = locked;
}

function resetScene() {
  if (!viewer) return;
  selectOrgan(null);
  viewer.resetVisibility();
  for (const id of rows.keys()) updateVisibility(id);
}

function makeRows() {
  const list = document.querySelector("#organ-list");
  for (const [index, id] of organIds.entries()) {
    const organ = organCatalog[id];
    const row = document.createElement("li");
    row.className = "organ-row";
    const preview = `<span class="organ-preview"><img alt="" width="50" height="44"></span>`;
    const main = isFind ? preview : `
      <button class="organ-pick" type="button" aria-pressed="false">
        ${preview}
        <span class="organ-name"></span>
      </button>`;
    row.innerHTML = `${main}
      <button class="icon-button visibility" type="button">
        <svg class="icon" aria-hidden="true"><use href="#icon-eye"/></svg>
      </button>`;
    row.querySelector("img").src = viewer.thumbnail(id);
    const pickButton = row.querySelector(".organ-pick");
    const visibilityButton = row.querySelector(".visibility");
    const label = isFind ? `орган ${index + 1}` : organ.name;
    rows.set(id, { element: row, pickButton, visibilityButton, label });
    if (pickButton) {
      row.querySelector(".organ-name").textContent = organ.name;
      pickButton.addEventListener("click", () => {
        if (viewer.isOrganVisible(id)) selectOrgan(id);
      });
    }
    updateVisibility(id);
    visibilityButton.addEventListener("click", () => toggleOrgan(id));
    list.append(row);
  }
}

function attachEvents() {
  for (const button of viewButtons) {
    button.addEventListener("click", () => viewer.setView(button.dataset.view));
    button.disabled = false;
  }
  for (const [id, layer] of [["torso-toggle", "skin"], ["bones-toggle", "bones"]]) {
    const button = document.getElementById(id);
    button.disabled = false;
    button.addEventListener("click", () => {
      button.setAttribute("aria-pressed", String(viewer.toggleLayer(layer)));
    });
  }

  remove.addEventListener("click", () => {
    const id = viewer.selected;
    if (!id) return;
    const { visibilityButton } = rows.get(id);
    toggleOrgan(id);
    visibilityButton.focus({ preventScroll: true });
  });
  if (isFind) return;
  info.addEventListener("click", () => setReference(reference.hidden));
  document.querySelector("#close-info").addEventListener("click", () => {
    setReference(false);
    info.focus();
  });
  selection.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !reference.hidden) {
      setReference(false);
      info.focus();
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== studyProgressKey) return;
    for (const mark of parseStudyMarks(event.newValue)) marks.add(mark);
    updateProgress();
  });
}

async function start() {
  if (isFind) {
    if (marks.size < studyUnlockMarks) {
      location.replace("./");
      return;
    }
    startFindLesson({ reset: resetScene, selected: () => viewer?.selected ?? null, setLocked: setSelectionLocked });
  } else {
    progress.max = studyMarkTotal;
    updateProgress();
    const inactive = document.querySelector("#lesson-inactive");
    const layout = document.querySelector(".layout");
    const activity = connectLessonActivity("study", (active) => {
      inactive.hidden = active;
      layout.inert = !active;
    });
    function enterStudy() {
      const previous = activeLessonName();
      activity.claim();
      pauseQuizForStudy(previous);
    }
    enterStudy();
    document.querySelector("#continue-here").addEventListener("click", enterStudy);
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      enterStudy();
      for (const mark of loadStudyMarks()) marks.add(mark);
      updateProgress();
    });
  }
  try {
    viewer = await createTorsoViewer(stage, {
      catalog: organCatalog,
      label: "Вращаемая модель торса с шестью органами пищеварения",
      ghostHidden: isFind,
      onPick(id) {
        if (!selectionLocked) selectOrgan(id);
      },
      onViewChange(views) {
        for (const button of viewButtons) {
          button.setAttribute("aria-pressed", String(views[button.dataset.view]));
        }
      },
    });
    makeRows();
    setSelectionLocked(selectionLocked);
    attachEvents();
    loading.hidden = true;
  } catch (error) {
    loading.textContent = "Не удалось открыть 3D-модель. Перезагрузи страницу и проверь поддержку WebGL 2 в браузере.";
    console.error(error);
  } finally {
    stage.setAttribute("aria-busy", "false");
  }
}

start();
