import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { loadBodyContext } from "./body-context.js";

function addLighting(scene) {
  const key = new THREE.DirectionalLight(0xffefdf, 2.0);
  key.position.set(-3, 4, 5);
  const rim = new THREE.DirectionalLight(0x889dff, 1.7);
  rim.position.set(2, 1, -4);
  scene.add(new THREE.HemisphereLight(0xe7efff, 0xa58183, 2.2), key, rim);
}

function createAnatomy() {
  const anatomy = new THREE.Group();
  // BodyParts3D uses Z up and negative Y anterior. Both GLBs share this frame.
  anatomy.rotation.x = -Math.PI / 2;
  const center = new THREE.Vector3(-0.0445, -90.1375, 1085).applyEuler(anatomy.rotation);
  const scale = 1 / 680;
  anatomy.scale.setScalar(scale);
  anatomy.position.copy(center).multiplyScalar(-scale);
  return anatomy;
}

function renderThumbnails(renderer, anatomy, organs, catalog) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 12);
  const group = new THREE.Group();
  group.rotation.copy(anatomy.rotation);
  group.scale.copy(anatomy.scale);
  scene.add(group);
  addLighting(scene);
  scene.updateMatrixWorld();
  renderer.setPixelRatio(1);
  renderer.setSize(120, 104, false);

  const thumbnails = new Map();
  for (const [id, organ] of organs) {
    const mesh = organ.mesh.clone();
    group.add(mesh);
    const bounds = new THREE.Box3().setFromObject(mesh, true);
    const center = bounds.getCenter(new THREE.Vector3());
    const half = bounds.getSize(new THREE.Vector3()).length() * .5;
    const extent = half * 1.04;
    camera.left = -extent * 120 / 104;
    camera.right = -camera.left;
    camera.top = extent;
    camera.bottom = -extent;
    const angle = catalog[id].thumbnailAngle ?? .16;
    camera.position.set(Math.sin(angle), .14, Math.cos(angle)).multiplyScalar(half * 4).add(center);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    thumbnails.set(id, renderer.domElement.toDataURL("image/png"));
    group.remove(mesh);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return thumbnails;
}

function attachPicking(canvas, camera, organs, onPick) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let interactionStart;

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
    raycaster.setFromCamera(pointer, camera);
    const visible = [...organs.values()].filter((organ) => !organ.removed).map((organ) => organ.mesh);
    const [hit] = raycaster.intersectObjects(visible, false);
    onPick(hit?.object.name ?? null);
  }

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
}

export async function createTorsoViewer(stage, { catalog, label, ghostHidden = false, onPick, onViewChange }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", label);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 40);
  const anatomy = createAnatomy();
  scene.add(anatomy);
  addLighting(scene);

  const loader = new GLTFLoader();
  const [{ scene: models }, layers] = await Promise.all([
    loader.loadAsync("./assets/organ-material-trial.glb"),
    loadBodyContext(loader),
  ]);
  const organs = new Map();
  for (const id of Object.keys(catalog)) {
    const mesh = models.getObjectByName(id);
    if (!mesh?.isMesh) throw new Error(`Missing organ mesh: ${id}`);
    const material = mesh.material;
    material.emissive.set(material.userData.displayColor);
    material.emissiveIntensity = 0;
    const organ = { mesh, material, removed: false };
    if (ghostHidden) {
      organ.ghost = material.clone();
      organ.ghost.transparent = true;
      organ.ghost.opacity = .21;
      organ.ghost.depthWrite = false;
    }
    organs.set(id, organ);
    anatomy.add(mesh);
  }
  layers.bones.visible = false;
  anatomy.add(layers.skin, layers.bones);
  const thumbnails = renderThumbnails(renderer, anatomy, organs, catalog);

  stage.prepend(canvas);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minDistance = .7;
  controls.maxDistance = 5;
  let homeDistance = 1.82;
  let selected = null;

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

  function setView(view) {
    const front = view === "front";
    const height = front ? -.03 : -.06;
    controls.target.set(0, height, 0);
    camera.position.set(0, height, front ? homeDistance : -homeDistance);
    controls.update();
  }

  function setSelection(id) {
    if (id === selected || (id !== null && (!organs.has(id) || organs.get(id).removed))) return;
    if (selected) organs.get(selected).material.emissiveIntensity = 0;
    selected = id;
    if (id) organs.get(id).material.emissiveIntensity = .45;
    render();
  }

  function updateVisibility(organ, visible) {
    organ.removed = !visible;
    organ.mesh.visible = visible || ghostHidden;
    organ.mesh.material = !visible && ghostHidden ? organ.ghost : organ.material;
  }

  controls.addEventListener("change", () => {
    const angle = Math.abs(controls.getAzimuthalAngle());
    const level = Math.abs(controls.getPolarAngle() - Math.PI / 2) < .035;
    onViewChange?.({
      front: level && angle < .035,
      back: level && Math.PI - angle < .035,
    });
    render();
  });
  resize();
  setView("front");
  if (onPick) attachPicking(canvas, camera, organs, onPick);
  new ResizeObserver(resize).observe(stage);

  return {
    thumbnail: (id) => thumbnails.get(id),
    get selected() { return selected; },
    setSelection,
    isOrganVisible: (id) => !organs.get(id).removed,
    setOrganVisible(id, visible) {
      if (!visible && selected === id) setSelection(null);
      updateVisibility(organs.get(id), visible);
      render();
    },
    resetVisibility() {
      for (const organ of organs.values()) updateVisibility(organ, true);
      render();
    },
    setView,
    toggleLayer(name) {
      const layer = layers[name];
      layer.visible = !layer.visible;
      render();
      return layer.visible;
    },
  };
}
