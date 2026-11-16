import { organCatalog } from "./organs.js";

export function normalizePhotoAnswer(value) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
}

const names = new Map(Object.entries(organCatalog).flatMap(([id, { name, aliases = [] }]) =>
  [name, ...aliases].map((answer) => [normalizePhotoAnswer(answer), id]),
));

function oneEditApart(left, right) {
  if (left.length < right.length) [left, right] = [right, left];
  const lengthDifference = left.length - right.length;
  if (lengthDifference > 1) return false;

  let index = 0;
  while (index < right.length && left[index] === right[index]) index++;
  if (lengthDifference === 1) return left.slice(index + 1) === right.slice(index);
  if (index === right.length) return false;
  const swapped = left[index] === right[index + 1] && left[index + 1] === right[index];
  return left.slice(index + 1) === right.slice(index + 1) ||
    (swapped && left.slice(index + 2) === right.slice(index + 2));
}

export function matchPhotoAnswer(answer) {
  const text = normalizePhotoAnswer(answer);
  const exact = names.get(text);
  if (exact) return { id: exact, corrected: false };

  const matches = new Set();
  for (const [name, id] of names) {
    if (oneEditApart(name, text)) matches.add(id);
  }
  if (matches.size === 1) return { id: matches.values().next().value, corrected: true };
  return { id: null, corrected: false };
}
