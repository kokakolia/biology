import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "./vendor/meshopt_decoder.mjs";

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
  const thumbnails = new Map();
  const missing = [];
  for (const [id, organ] of organs) {
    if (organ.thumbnail) thumbnails.set(id, organ.thumbnail);
    else missing.push([id, organ]);
  }
  if (!missing.length) return thumbnails;

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

  for (const [id, organ] of missing) {
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
  return thumbnails;
}

function attachPicking(canvas, camera, organs, onPick, isReady) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const idsByMesh = new Map([...organs].map(([id, { mesh }]) => [mesh, id]));
  let interactionStart;

  function pick(event) {
    if (!isReady()) return;
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
  canvas.addEventListener("webglcontextlost", () => { interactionStart = null; });
  canvas.addEventListener("pointerup", (event) => {
    const start = interactionStart;
    interactionStart = null;
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8) pick(event);
  });
}

function loadModel(loader, asset) {
  return loader.loadAsync((loader.meshoptDecoder && asset.compressedUrl) || asset.url);
}

async function loadOrgans(loader, model, ghostHidden) {
  const { scene: models } = await loadModel(loader, model);
  const organs = new Map();
  const partsGroup = new THREE.Group();
  for (const [id, { meshName = id, thumbnailAngle = .16, thumbnail, photo }] of Object.entries(model.organs)) {
    const mesh = models.getObjectByName(meshName);
    if (!mesh?.isMesh) throw new Error(`Missing organ mesh: ${meshName}`);
    if (!mesh.material.emissive) throw new Error(`Organ mesh needs a material with emissive color: ${meshName}`);
    const material = mesh.material.clone();
    material.emissive.set(material.userData.displayColor ?? material.color);
    material.emissiveIntensity = 0;
    mesh.material = material;
    const organ = { mesh, material, thumbnailAngle, thumbnail: thumbnail ?? photo, removed: false };
    if (ghostHidden) {
      organ.ghost = material.clone();
      organ.ghost.transparent = true;
      organ.ghost.opacity = .21;
      organ.ghost.depthWrite = false;
    }
    organs.set(id, organ);
    partsGroup.attach(mesh);
  }
  return { organs, partsGroup };
}

export class WebGLStartError extends Error {}

export async function createTorsoViewer(stage, config, { ghostHidden = false, onPick, onViewChange, onContextChange } = {}) {
  const { model, context, camera: cameraConfig, label } = config;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (cause) {
    throw new WebGLStartError("WebGL 2 could not start", { cause });
  }
  const canvas = renderer.domElement;
  let contextLost = false;
  const isReady = () => !contextLost && !renderer.getContext().isContextLost();
  canvas.setAttribute("aria-label", label);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(cameraConfig.fieldOfView, 1, ...cameraConfig.clipping);
  const anatomy = createAnatomy(model.transform);
  scene.add(anatomy);
  addLighting(scene);

  const loader = new GLTFLoader();
  if ((model.compressedUrl || context?.compressedUrl) && MeshoptDecoder.supported) {
    const decoderReady = await MeshoptDecoder.ready.then(() => true, () => false);
    if (decoderReady) loader.setMeshoptDecoder(MeshoptDecoder);
  }
  let organs;
  let thumbnails;
  try {
    const result = await loadOrgans(loader, model, ghostHidden);
    if (!isReady()) throw new Error("WebGL context was lost during model loading");
    organs = result.organs;
    anatomy.add(result.partsGroup);
    thumbnails = renderThumbnails(renderer, anatomy, organs);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  } catch (error) {
    renderer.dispose();
    renderer.forceContextLoss();
    throw error;
  }

  let layers = {};
  stage.prepend(canvas);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  [controls.minDistance, controls.maxDistance] = cameraConfig.zoomRange;
  const views = new Map(Object.entries(cameraConfig.views).map(([id, { target, direction }]) => [
    id, { target: new THREE.Vector3(...target), direction: new THREE.Vector3(...direction).normalize() },
  ]));
  const viewingDirection = new THREE.Vector3();
  let homeDistance = cameraConfig.distance;
  let selected = null;
  let viewFrame = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function render() {
    if (isReady()) renderer.render(scene, camera);
  }

  function resize() {
    const { clientWidth, clientHeight } = stage;
    if (!clientWidth || !clientHeight || !isReady()) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    const distance = Math.max(cameraConfig.distance, cameraConfig.narrowFit / camera.aspect);
    camera.position.sub(controls.target).multiplyScalar(distance / homeDistance).add(controls.target);
    homeDistance = distance;
    camera.updateProjectionMatrix();
    render();
  }

  function cancelViewAnimation() {
    cancelAnimationFrame(viewFrame);
    viewFrame = 0;
  }

  function applyView(view) {
    controls.target.copy(view.target);
    camera.position.copy(view.direction).multiplyScalar(homeDistance).add(controls.target);
    controls.update();
  }

  function setView(id, animate = true) {
    const view = views.get(id);
    cancelViewAnimation();
    if (!animate || reducedMotion.matches) {
      applyView(view);
      return;
    }

    const startTarget = controls.target.clone();
    const start = new THREE.Spherical().setFromVector3(viewingDirection.subVectors(camera.position, startTarget));
    const end = new THREE.Spherical().setFromVector3(view.direction);
    const theta = end.theta - start.theta;
    const turn = Math.atan2(Math.sin(theta), Math.cos(theta));
    const zoom = start.radius / homeDistance;
    const startTime = performance.now();

    function frame(now) {
      viewFrame = 0;
      const progress = Math.min(1, (now - startTime) / 420);
      if (progress === 1 || reducedMotion.matches) {
        applyView(view);
        return;
      }
      const eased = progress * progress * (3 - 2 * progress);
      controls.target.lerpVectors(startTarget, view.target, eased);
      camera.position.setFromSphericalCoords(
        THREE.MathUtils.lerp(zoom, 1, eased) * homeDistance,
        THREE.MathUtils.lerp(start.phi, end.phi, eased),
        start.theta + turn * eased,
      ).add(controls.target);
      controls.update();
      viewFrame = requestAnimationFrame(frame);
    }

    viewFrame = requestAnimationFrame(frame);
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
  setView(cameraConfig.initialView, false);
  canvas.addEventListener("pointerdown", cancelViewAnimation, { capture: true });
  canvas.addEventListener("wheel", cancelViewAnimation, { capture: true, passive: true });
  if (onPick) attachPicking(canvas, camera, organs, onPick, isReady);
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    cancelViewAnimation();
    controls.enabled = false;
    onContextChange?.(false);
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    controls.enabled = true;
    resize();
    onContextChange?.(true);
  });
  new ResizeObserver(resize).observe(stage);

  return {
    isReady,
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
    async loadContext() {
      if (!context) return;
      const { scene: contextScene } = await loadModel(loader, context);
      layers = await context.buildLayers(contextScene);
      for (const layer of Object.values(layers)) anatomy.add(layer);
      render();
    },
    layerVisible: (name) => layers[name]?.visible,
    toggleLayer(name) {
      const layer = layers[name];
      layer.visible = !layer.visible;
      render();
      return layer.visible;
    },
  };
}
