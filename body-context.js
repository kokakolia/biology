import * as THREE from "three";

// The coordinates below are in the source atlas: Z up, X left/right, in mm.
const layers = {
  skin: {
    color: "#789b93",
    opacity: 0.155,
    rim: 0.235,
    mask: `
      float torso = smoothstep(735.0, 895.0, z);
      float arm = smoothstep(173.0, 212.0, abs(vContextPosition.x)) * smoothstep(610.0, 686.0, z);
      float fade = max(torso, arm) * (1.0 - smoothstep(1432.0, 1512.0, z));
    `,
  },
  "rib-cage": { color: "#9ea594", opacity: 0.26, rim: 0.026, mask: "float fade = 1.0;" },
  spine: {
    color: "#9ea594", opacity: 0.28, rim: 0.025,
    mask: "float fade = smoothstep(1048.0, 1120.0, z) * (1.0 - smoothstep(1438.0, 1490.0, z));",
  },
  arms: {
    color: "#9ea594", opacity: 0.23, rim: 0.02,
    mask: "float fade = smoothstep(625.0, 708.0, z);",
  },
};

function contextMaterial(name) {
  const { color, opacity, rim, mask } = layers[name];
  const skin = name === "skin";
  const params = { color, opacity, transparent: true, depthWrite: false };
  const material = skin
    ? new THREE.MeshBasicMaterial(params)
    : new THREE.MeshStandardMaterial({ ...params, roughness: 0.9 });

  // Fade by source position instead of removing triangles. A stronger rim keeps
  // the silhouette visible while the face of the skin stays very transparent.
  const varyings = `
    varying vec3 vContextPosition;
    varying vec3 vContextNormal;
    varying vec3 vContextView;
  `;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = varyings + shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vContextPosition = position;
      vContextNormal = normalMatrix * normal;
      vContextView = -(modelViewMatrix * vec4(position, 1.0)).xyz;
    `);
    shader.fragmentShader = varyings + shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      float z = vContextPosition.z;
      ${mask}
      float facing = clamp(abs(dot(normalize(vContextNormal), normalize(vContextView))), 0.0, 1.0);
      float grazing = (1.0 - facing) * (1.0 - facing);
      diffuseColor.a = fade * (diffuseColor.a + ${rim} * grazing);
      if (diffuseColor.a < 0.001) discard;
    `);
  };
  material.customProgramCacheKey = () => name;
  return material;
}

export async function loadBodyContext(loader) {
  const { scene } = await loader.loadAsync("./assets/body-context.glb");
  const bones = new THREE.Group();
  const meshes = new Map(scene.children.map((mesh) => [mesh.name, mesh]));
  const skin = meshes.get("skin");

  for (const name of Object.keys(layers)) {
    const mesh = meshes.get(name);
    if (!mesh?.isMesh) throw new Error(`Missing body context layer: ${name}`);
    mesh.material = contextMaterial(name);
    mesh.renderOrder = mesh === skin ? 2 : 1;
    if (mesh !== skin) bones.add(mesh);
  }
  return { skin, bones };
}

