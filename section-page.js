import { sectionHref } from "./sections.js";

export function applySectionPage(section, page) {
  const { title, lessons, attribution } = section;
  const text = {
    sceneTitle: title,
    studyInstruction: "Выбери часть модели или её название в списке.",
    studyList: "Части модели",
    findList: "Видимость частей модели",
    layerGroup: "Слои модели",
    pointerHint: "Потяни мышью, чтобы повернуть модель",
    touchHint: "Проведи пальцем по модели, чтобы повернуть её",
    resultParts: "Результаты по частям модели",
    photoQuestion: "Как называется эта часть модели?",
    photoPlaceholder: "Введи название…",
    photoAlt: "Часть модели для определения",
    ...section.copy,
    sectionTitle: title,
    studyTitle: lessons.study.title,
    findTitle: lessons.find.title,
    photoTitle: lessons.photo.title,
    findLock: `Достигни 50% в «${lessons.study.title}»`,
    photoLock: `Достигни 50% в «${lessons.find.title}»`,
  };

  document.title = `${page === "home" ? title : lessons[page].title} — Изнутри`;
  const description = page === "home" ? section.description : lessons[page].description;
  document.querySelector('meta[name="description"]').content = description ?? `Интерактивные уроки по теме «${title}».`;
  for (const [attribute, target] of [
    ["data-section-text", "textContent"],
    ["data-section-label", "aria-label"],
    ["data-section-alt", "alt"],
    ["data-section-placeholder", "placeholder"],
  ]) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      const value = text[element.getAttribute(attribute)];
      if (target === "textContent") element.textContent = value;
      else element.setAttribute(target, value);
    }
  }
  for (const element of document.querySelectorAll("[data-section-link]")) {
    element.href = sectionHref(section, element.dataset.sectionLink);
  }
  for (const element of document.querySelectorAll("[data-lesson-image]")) {
    element.src = lessons[element.dataset.lessonImage].image;
  }
  for (const element of document.querySelectorAll("[data-lesson-meter]")) {
    element.setAttribute("aria-label", `Прогресс урока «${lessons[element.dataset.lessonMeter].title}»`);
  }
  const credit = document.querySelector(".footer a");
  credit.hidden = !attribution;
  if (attribution) {
    credit.href = attribution.href;
    credit.textContent = attribution.label;
  }
}
