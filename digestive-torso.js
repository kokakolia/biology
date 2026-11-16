export const digestiveTorso = {
  label: "Вращаемая модель торса с шестью органами пищеварения",
  model: {
    url: new URL("./assets/organ-material-trial.glb", import.meta.url).href,
    // BodyParts3D uses Z up and negative Y anterior. Both GLBs share this frame.
    transform: { rotation: [-Math.PI / 2, 0, 0], center: [-0.0445, -90.1375, 1085], scale: 1 / 680 },
  },
  context: {
    url: new URL("./assets/body-context.glb", import.meta.url).href,
    async buildLayers(scene) {
      const { createBodyContextLayers } = await import("./body-context.js");
      return createBodyContextLayers(scene);
    },
    controls: {
      skin: { label: "Оболочка" },
      bones: { label: "Кости", icon: "bone" },
    },
  },
  camera: {
    fieldOfView: 34,
    clipping: [.01, 40],
    zoomRange: [.7, 5],
    distance: 1.82,
    narrowFit: 1.46,
    views: {
      front: { label: "Спереди", target: [0, -.03, 0], direction: [0, 0, 1] },
      back: { label: "Сзади", target: [0, -.06, 0], direction: [0, 0, -1] },
    },
    initialView: "front",
  },
};
