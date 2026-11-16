import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadBodyContext } from "./body-context.js";
import { loadStudyMarks, parseStudyMarks, studyMarkTotal, studyPercent, studyProgressKey, studyUnlockMarks } from "./study-progress.js";

import { organCatalog, organIds } from "./organs.js";
import { activeLessonName, connectLessonActivity } from "./lesson-activity.js";
import { startFindLesson } from "./find-lesson.js";
import { pauseQuizForStudy } from "./quiz-progress.js";

const organs = new Map(organIds.map((id) => [id, { ...organCatalog[id] }]));

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
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
const anatomy = new THREE.Group();

let renderer;
let controls;
let homeDistance = 1.82;
let selected = null;
let interactionStart;
let selectionLocked = false;

function addLighting(target) {
  const key = new THREE.DirectionalLight(0xffefdf, 2.0);
  key.position.set(-3, 4, 5);
  const rim = new THREE.DirectionalLight(0x889dff, 1.7);
  rim.position.set(2, 1, -4);
  target.add(new THREE.HemisphereLight(0xe7efff, 0xa58183, 2.2), key, rim);
}

scene.add(anatomy);
addLighting(scene);

function render() {
  renderer.render(scene, camera);
}

function resize() {
  const { clientWidth, clientHeight } = stage;
  if (!clientWidth || !clientHeight) return;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  const distance = Math.max(1.82, 1.46 / camera.aspect);
  camera.position.sub(controls.target).multiplyScalar(distance / homeDistance).add(controls.target);
  homeDistance = distance;
  camera.updateProjectionMatrix();
  render();
}

function updateView() {
  const angle = Math.abs(controls.getAzimuthalAngle());
  const level = Math.abs(controls.getPolarAngle() - Math.PI / 2) < .035;
  viewButtons[0].setAttribute("aria-pressed", String(level && angle < .035));
  viewButtons[1].setAttribute("aria-pressed", String(level && Math.PI - angle < .035));
  render();
}

function setView(view) {
  const front = view === "front";
  const height = front ? -.03 : -.06;
  controls.target.set(0, height, 0);
  camera.position.set(0, height, front ? homeDistance : -homeDistance);
  controls.update();
}

function normalizeAnatomy() {
  // BodyParts3D uses Z up and negative Y anterior. Both GLBs share this frame.
  anatomy.rotation.x = -Math.PI / 2;
  const center = new THREE.Vector3(-0.0445, -90.1375, 1085).applyEuler(anatomy.rotation);
  const scale = 1 / 680;
  anatomy.scale.setScalar(scale);
  anatomy.position.copy(center).multiplyScalar(-scale);
}

function renderThumbnails() {
  const thumbnailScene = new THREE.Scene();
  const thumbnailCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 12);
  const thumbnailAnatomy = new THREE.Group();
  thumbnailAnatomy.rotation.copy(anatomy.rotation);
  thumbnailAnatomy.scale.copy(anatomy.scale);
  thumbnailScene.add(thumbnailAnatomy);
  addLighting(thumbnailScene);
  thumbnailScene.updateMatrixWorld();
  renderer.setPixelRatio(1);
  renderer.setSize(120, 104, false);

  for (const organ of organs.values()) {
    const mesh = organ.mesh.clone();
    thumbnailAnatomy.add(mesh);
    const bounds = new THREE.Box3().setFromObject(mesh, true);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const half = size.length() * .5;
    const extent = half * 1.04;
    thumbnailCamera.left = -extent * 120 / 104;
    thumbnailCamera.right = -thumbnailCamera.left;
    thumbnailCamera.top = extent;
    thumbnailCamera.bottom = -extent;
    const angle = organ.thumbnailAngle ?? .16;
    thumbnailCamera.position.set(Math.sin(angle), .14, Math.cos(angle)).multiplyScalar(half * 4).add(center);
    thumbnailCamera.lookAt(center);
    thumbnailCamera.updateProjectionMatrix();
    renderer.render(thumbnailScene, thumbnailCamera);
    organ.thumbnail = renderer.domElement.toDataURL("image/png");
    thumbnailAnatomy.remove(mesh);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

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
  if (open) recordMark(`info:${selected}`);
}

function selectOrgan(clickedId) {
  const id = clickedId === selected ? null : clickedId;
  if (id === selected) return;
  if (selected) {
    const previous = organs.get(selected);
    previous.mesh.material.emissiveIntensity = 0;
    previous.row.dataset.selected = "false";
    previous.pickButton?.setAttribute("aria-pressed", "false");
  }
  selected = id;
  if (!isFind) setReference(false);
  selection.hidden = !id;
  if (id) {
    const organ = organs.get(id);
    organ.mesh.material.emissiveIntensity = .45;
    organ.row.dataset.selected = "true";
    if (!isFind) {
      organ.pickButton.setAttribute("aria-pressed", "true");
      selectionName.textContent = organ.name;
      referenceTitle.textContent = organ.name;
      referenceLocation.textContent = organ.location;
      referenceFunction.textContent = organ.function;
      recordMark(`select:${id}`);
    }
  }
  render();
}

function updateVisibility(organ) {
  organ.mesh.visible = !organ.removed || isFind;
  organ.mesh.material = organ.removed && isFind ? organ.translucent : organ.material;
  organ.row.dataset.removed = String(organ.removed);
  organ.pickButton?.setAttribute("aria-disabled", String(organ.removed));
  const action = organ.removed ? "Вернуть на торс" : "Убрать с обзора";
  const label = `${action} · ${organ.label}`;
  organ.visibilityButton.setAttribute("aria-label", label);
  organ.visibilityButton.title = label;
  organ.visibilityButton.querySelector("use").setAttribute("href", organ.removed ? "#icon-eye-off" : "#icon-eye");
}

function toggleOrgan(id) {
  if (selectionLocked) return;
  const organ = organs.get(id);
  organ.removed = !organ.removed;
  if (organ.removed && selected === id) selectOrgan(null);
  updateVisibility(organ);
  render();
}

function setSelectionLocked(locked) {
  selectionLocked = locked;
  remove.disabled = locked;
  for (const organ of organs.values()) {
    if (organ.visibilityButton) organ.visibilityButton.disabled = locked;
  }
}

function resetScene() {
  if (!controls) return;
  selectOrgan(null);
  for (const organ of organs.values()) {
    organ.removed = false;
    updateVisibility(organ);
  }
  render();
}

function makeRows() {
  const list = document.querySelector("#organ-list");
  for (const [index, [id, organ]] of [...organs].entries()) {
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
    row.querySelector("img").src = organ.thumbnail;
    organ.row = row;
    organ.pickButton = row.querySelector(".organ-pick");
    organ.visibilityButton = row.querySelector(".visibility");
    organ.label = isFind ? `орган ${index + 1}` : organ.name;
    if (organ.pickButton) {
      row.querySelector(".organ-name").textContent = organ.name;
      organ.pickButton.addEventListener("click", () => {
        if (!organ.removed) selectOrgan(id);
      });
    }
    updateVisibility(organ);
    organ.visibilityButton.addEventListener("click", () => toggleOrgan(id));
    list.append(row);
  }
}

function pick(event) {
  if (selectionLocked) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    1 - ((event.clientY - rect.top) / rect.height) * 2,
  );
  raycaster.setFromCamera(pointer, camera);
  const visible = [...organs.values()].filter((organ) => !organ.removed).map((organ) => organ.mesh);
  const [hit] = raycaster.intersectObjects(visible, false);
  selectOrgan(hit?.object.name ?? null);
}

function attachEvents(bodyContext) {
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (event) => {
    interactionStart = event.isPrimary && event.button === 0
      ? { id: event.pointerId, x: event.clientX, y: event.clientY }
      : null;
  });
  canvas.addEventListener("pointermove", (event) => {
    const start = interactionStart;
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      interactionStart = null;
    }
  });
  canvas.addEventListener("pointercancel", () => { interactionStart = null; });
  canvas.addEventListener("pointerup", (event) => {
    const start = interactionStart;
    interactionStart = null;
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) pick(event);
  });

  for (const button of viewButtons) {
    button.addEventListener("click", () => setView(button.dataset.view));
    button.disabled = false;
  }
  for (const [id, layer] of [["torso-toggle", bodyContext.skin], ["bones-toggle", bodyContext.bones]]) {
    const button = document.getElementById(id);
    button.disabled = false;
    button.addEventListener("click", () => {
      layer.visible = !layer.visible;
      button.setAttribute("aria-pressed", String(layer.visible));
      render();
    });
  }

  remove.addEventListener("click", () => {
    const { visibilityButton } = organs.get(selected);
    toggleOrgan(selected);
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
    startFindLesson({ reset: resetScene, selected: () => selected, setLocked: setSelectionLocked });
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
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.domElement.setAttribute("aria-label", "Вращаемая модель торса с шестью органами пищеварения");
    const loader = new GLTFLoader();
    const [{ scene: organModels }, bodyContext] = await Promise.all([
      loader.loadAsync("./assets/organ-material-trial.glb"),
      loadBodyContext(loader),
    ]);
    normalizeAnatomy();
    for (const [id, organ] of organs) {
      const mesh = organModels.getObjectByName(id);
      if (!mesh?.isMesh) throw new Error(`Missing organ mesh: ${id}`);
      mesh.material.emissive.set(mesh.material.userData.displayColor);
      mesh.material.emissiveIntensity = 0;
      organ.mesh = mesh;
      organ.removed = false;
      organ.material = mesh.material;
      if (isFind) {
        organ.translucent = mesh.material.clone();
        organ.translucent.transparent = true;
        organ.translucent.opacity = .21;
        organ.translucent.depthWrite = false;
      }
      anatomy.add(mesh);
    }
    bodyContext.bones.visible = false;
    anatomy.add(bodyContext.skin, bodyContext.bones);
    renderThumbnails();
    makeRows();
    setSelectionLocked(selectionLocked);

    stage.prepend(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = .7;
    controls.maxDistance = 5;
    controls.addEventListener("change", updateView);
    resize();
    setView("front");
    attachEvents(bodyContext);
    new ResizeObserver(resize).observe(stage);
    loading.hidden = true;
  } catch (error) {
    loading.textContent = "Не удалось открыть 3D-модель. Перезагрузи страницу и проверь поддержку WebGL 2 в браузере.";
    console.error(error);
  } finally {
    stage.setAttribute("aria-busy", "false");
  }
}

start();
