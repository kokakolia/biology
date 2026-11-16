import { writeProgress } from "./progress-storage.js";

export function createStudyProgress(ids, key) {
  const knownMarks = new Set(ids.flatMap((id) => [`select:${id}`, `info:${id}`]));
  const total = knownMarks.size;
  const prefix = `${key}:`;

  function parse(value) {
    try {
      const saved = JSON.parse(value);
      if (Array.isArray(saved)) return new Set(saved.filter((mark) => knownMarks.has(mark)));
    } catch {
      // A damaged entry is treated as an empty one.
    }
    return new Set();
  }

  function read(marks = new Set()) {
    for (const mark of parse(localStorage.getItem(key))) marks.add(mark);
    for (const mark of knownMarks) {
      if (!marks.has(mark) && localStorage.getItem(prefix + mark) === "true") marks.add(mark);
    }
    return marks;
  }

  function load() {
    const marks = new Set();
    try {
      read(marks);
    } catch {
      // Keep the marks read before the failure.
    }
    return marks;
  }

  function save(marks) {
    // Each mark has its own key, so writing it cannot replace another tab's marks.
    const saved = load();
    for (const mark of saved) marks.add(mark);
    for (const mark of marks) {
      if (knownMarks.has(mark) && !saved.has(mark) && !writeProgress(prefix + mark, true)) return false;
    }
    return true;
  }

  return {
    read, load, save, total,
    matchesKey: (changed) => changed === key || Boolean(changed?.startsWith(prefix) && knownMarks.has(changed.slice(prefix.length))),
    unlockCount: Math.max(1, total / 2),
    percent: (count) => total ? Math.round(count * 100 / total) : 0,
  };
}
