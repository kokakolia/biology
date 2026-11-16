import { organIds } from "./organs.js";

export const studyProgressKey = "iznutri:study-progress:v1";
const knownMarks = new Set(organIds.flatMap((id) => [`select:${id}`, `info:${id}`]));
export const studyMarkTotal = knownMarks.size;
export const studyUnlockMarks = studyMarkTotal / 2;

export function parseStudyMarks(value) {
  try {
    const saved = JSON.parse(value);
    if (Array.isArray(saved)) return new Set(saved.filter((mark) => knownMarks.has(mark)));
  } catch {
    // A damaged entry is treated as an empty one.
  }
  return new Set();
}

export function loadStudyMarks() {
  try {
    return parseStudyMarks(localStorage.getItem(studyProgressKey));
  } catch {
    return new Set();
  }
}

export function studyPercent(count) {
  return Math.round(count * 100 / studyMarkTotal);
}
