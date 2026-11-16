import { activeLessonName, connectLessonActivity } from "./lesson-activity.js";
import { startFindLesson } from "./find-lesson.js";
import { createProgressNotice } from "./progress-notice.js";
import { createTorsoViewer } from "./torso-viewer.js";
import { sectionFromSearch, sectionHref } from "./sections.js";
import { applySectionPage } from "./section-page.js";
import { createSectionProgress } from "./section-progress.js";

const section = sectionFromSearch(location.search);
const progressData = createSectionProgress(section);
const { keys, partIds, study, quiz } = progressData;

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
const viewButtons = new Map();
const progress = document.querySelector("#progress");
const progressPercent = document.querySelector("#progress-percent");
const marks = study.load();
let viewer;
let studySaveNotice;
let selectionLocked = false;

function updateProgress() {
  progress.value = marks.size;
  progress.setAttribute("aria-valuetext", `${marks.size} из ${study.total} отметок`);
  progressPercent.textContent = `${study.percent(marks.size)}%`;
}

function recordMark(mark) {
  if (marks.has(mark)) return;
  marks.add(mark);
  studySaveNotice.write(keys.study, () => {
    const saved = study.save(marks);
    updateProgress();
    return saved;
  });
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
    const organ = section.parts[id];
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
  const action = removed ? (section.copy?.restore ?? "Вернуть на модель") : "Убрать с обзора";
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
  for (const [index, id] of partIds.entries()) {
    const organ = section.parts[id];
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
    const label = isFind ? `${section.copy?.anonymousPart ?? "часть"} ${index + 1}` : organ.name;
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

function makeSceneControls(config) {
  const views = document.querySelector(".view-controls");
  for (const [id, { label }] of Object.entries(config.camera.views)) {
    if (!label) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(id === config.camera.initialView));
    button.addEventListener("click", () => viewer.setView(id));
    views.append(button);
    viewButtons.set(id, button);
  }
  views.hidden = !views.childElementCount;

  const layers = document.querySelector(".context-controls");
  for (const [id, { label, icon }] of Object.entries(config.context?.controls ?? {})) {
    const visible = viewer.layerVisible(id);
    if (visible === undefined) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(visible));
    if (icon) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const use = document.createElementNS(svg.namespaceURI, "use");
      svg.setAttribute("class", "icon");
      svg.setAttribute("aria-hidden", "true");
      use.setAttribute("href", `#icon-${icon}`);
      svg.append(use);
      button.append(svg);
    }
    button.append(label);
    button.addEventListener("click", () => {
      button.setAttribute("aria-pressed", String(viewer.toggleLayer(id)));
    });
    layers.append(button);
  }
  layers.hidden = !layers.childElementCount;
}

function attachEvents() {
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
    if (event.key !== keys.study) return;
    for (const mark of study.parse(event.newValue)) marks.add(mark);
    updateProgress();
  });
}

async function start() {
  applySectionPage(section, isFind ? "find" : "study");
  if (isFind) {
    if (marks.size < study.unlockCount) {
      location.replace(sectionHref(section, "home"));
      return;
    }
    startFindLesson({ reset: resetScene, selected: () => viewer?.selected ?? null, setLocked: setSelectionLocked }, section, progressData);
  } else {
    progress.max = Math.max(1, study.total);
    if (!partIds.length) {
      document.querySelector(".lesson-instruction").textContent = "В этом разделе пока нет деталей для изучения.";
    }
    updateProgress();
    const inactive = document.querySelector("#lesson-inactive");
    const layout = document.querySelector(".layout");
    studySaveNotice = createProgressNotice(() => activity.isActive());
    const activity = connectLessonActivity(keys.activity, "study", (active) => {
      inactive.hidden = active;
      layout.inert = !active;
      studySaveNotice.setActive(active);
    });
    function enterStudy() {
      const previous = activeLessonName(keys.activity);
      activity.claim();
      if (previous === "find" || previous === "photo") {
        studySaveNotice.write(keys[previous], () => quiz.pauseForStudy(keys[previous]));
      }
    }
    enterStudy();
    document.querySelector("#continue-here").addEventListener("click", enterStudy);
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      enterStudy();
      for (const mark of study.load()) marks.add(mark);
      updateProgress();
    });
  }
  try {
    const config = {
      ...section.scene,
      label: section.scene.label ?? section.title,
      model: { ...section.scene.model, organs: section.parts },
    };
    viewer = await createTorsoViewer(stage, config, {
      ghostHidden: isFind,
      onPick(id) {
        if (!selectionLocked) selectOrgan(id);
      },
      onViewChange(views) {
        for (const [id, button] of viewButtons) {
          button.setAttribute("aria-pressed", String(views[id]));
        }
      },
    });
    makeSceneControls(config);
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
