import { digestiveTorso } from "./digestive-torso.js";
import { organCatalog } from "./organs.js";

export const digestiveSection = {
  id: "digestion",
  title: "Пищеварение",
  description: "Уроки о пищеварительной системе для 8 класса.",
  parts: organCatalog,
  scene: digestiveTorso,
  legacyStorage: true,
  lessons: {
    study: {
      title: "Изучи", image: "./assets/lesson-study.webp",
      description: "Интерактивный урок о пищеварительной системе для 8 класса.",
    },
    find: {
      title: "Найди орган", image: "./assets/lesson-find.webp",
      description: "Интерактивный урок о пищеварительной системе для 8 класса.",
    },
    photo: {
      title: "Узнай по фото", image: "./assets/lesson-photo.webp",
      description: "Узнай органы пищеварения по изображениям из 3D-модели.",
    },
  },
  attribution: { href: "./assets/ATTRIBUTION.txt", label: "Модели BodyParts3D" },
  copy: {
    sceneTitle: "Органы пищеварения",
    studyInstruction: "Выбери орган на торсе или в списке.",
    studyList: "Органы пищеварения",
    findList: "Видимость органов",
    layerGroup: "Слои тела",
    pointerHint: "Потяни мышью, чтобы повернуть торс",
    touchHint: "Проведи пальцем по торсу, чтобы повернуть его",
    restore: "Вернуть на торс",
    anonymousPart: "орган",
    resultParts: "Результаты по органам",
    countParts: "органов",
    photoQuestion: "Как называется этот орган?",
    photoPlaceholder: "Введи название органа…",
    photoRequired: "Введи название органа.",
    photoAlt: "Орган для определения",
    missedMain: "Пока неверно. Этот орган вернётся на закреплении.",
    missedReview: "Пока неверно. Этот орган можно повторить позже.",
  },
};

const sections = new Map([[digestiveSection.id, digestiveSection]]);
const pages = { home: "./", study: "./study.html", find: "./find.html", photo: "./photo.html" };

export function sectionFromSearch(search) {
  return sections.get(new URLSearchParams(search).get("section")) ?? digestiveSection;
}

export function sectionHref(section, page) {
  const href = pages[page];
  return section.id === digestiveSection.id ? href : `${href}?section=${encodeURIComponent(section.id)}`;
}
