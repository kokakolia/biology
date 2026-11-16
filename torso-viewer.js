import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function addLighting(scene) {
  const key = new THREE.DirectionalLight(0xffefdf, 2.0);
  key.position.set(-3, 4, 5);
  const rim = new THREE.DirectionalLight(0x889dff, 1.7);
  rim.position.set(2, 1, -4);
  scene.add(new THREE.HemisphereLight(0xe7efff, 0xa58183, 2.2), key, rim);
}

function createAnatomy({ rotation, center, scale }) {
  const anatomy = new THREE.Group();
  anatomy.rotation.set(...rotation);
  anatomy.scale.setScalar(scale);
  anatomy.position.fromArray(center).applyEuler(anatomy.rotation).multiplyScalar(-scale);
  return anatomy;
}

function renderThumbnails(renderer, anatomy, organs) {
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
    const angle = organ.thumbnailAngle;
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
  const idsByMesh = new Map([...organs].map(([id, { mesh }]) => [mesh, id]));
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
    onPick(idsByMesh.get(hit?.object) ?? null);
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

export async function createTorsoViewer(stage, config, { ghostHidden = false, onPick, onViewChange } = {}) {
  const { model, context, camera: cameraConfig, label } = config;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", label);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(cameraConfig.fieldOfView, 1, ...cameraConfig.clipping);
  const anatomy = createAnatomy(model.transform);
  scene.add(anatomy);
  addLighting(scene);

  const loader = new GLTFLoader();
  const [{ scene: models }, contextModel] = await Promise.all([
    loader.loadAsync(model.url),
    context && loader.loadAsync(context.url),
  ]);
  const layers = contextModel ? await context.buildLayers(contextModel.scene) : {};
  const organs = new Map();
  const partsGroup = new THREE.Group();
  for (const [id, { meshName = id, thumbnailAngle = .16 }] of Object.entries(model.organs)) {
    const mesh = models.getObjectByName(meshName);
    if (!mesh?.isMesh) throw new Error(`Missing organ mesh: ${meshName}`);
    if (!mesh.material.emissive) throw new Error(`Organ mesh needs a material with emissive color: ${meshName}`);
    const material = mesh.material.clone();
    material.emissive.set(material.userData.displayColor ?? material.color);
    material.emissiveIntensity = 0;
    mesh.material = material;
    const organ = { mesh, material, thumbnailAngle, removed: false };
    if (ghostHidden) {
      organ.ghost = material.clone();
      organ.ghost.transparent = true;
      organ.ghost.opacity = .21;
      organ.ghost.depthWrite = false;
    }
    organs.set(id, organ);
    partsGroup.attach(mesh);
  }
  anatomy.add(partsGroup);
  for (const layer of Object.values(layers)) anatomy.add(layer);
  const thumbnails = renderThumbnails(renderer, anatomy, organs);

  stage.prepend(canvas);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  [controls.minDistance, controls.maxDistance] = cameraConfig.zoomRange;
  const views = new Map(Object.entries(cameraConfig.views).map(([id, { target, direction }]) => [
    id, { target, direction: new THREE.Vector3(...direction).normalize() },
  ]));
  const viewingDirection = new THREE.Vector3();
  let homeDistance = cameraConfig.distance;
  let selected = null;

  function render() {
    renderer.render(scene, camera);
  }

  function resize() {
    const { clientWidth, clientHeight } = stage;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    const distance = Math.max(cameraConfig.distance, cameraConfig.narrowFit / camera.aspect);
    camera.position.sub(controls.target).multiplyScalar(distance / homeDistance).add(controls.target);
    homeDistance = distance;
    camera.updateProjectionMatrix();
    render();
  }

  function setView(id) {
    const view = views.get(id);
    controls.target.fromArray(view.target);
    camera.position.copy(view.direction).multiplyScalar(homeDistance).add(controls.target);
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
    viewingDirection.subVectors(camera.position, controls.target);
    onViewChange?.(Object.fromEntries([...views].map(([id, view]) => [id, viewingDirection.angleTo(view.direction) < .035])));
    render();
  });
  resize();
  setView(cameraConfig.initialView);
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
    layerVisible: (name) => layers[name]?.visible,
    toggleLayer(name) {
      const layer = layers[name];
      layer.visible = !layer.visible;
      render();
      return layer.visible;
    },
  };
}
