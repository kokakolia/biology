import { writeProgress } from "./progress-storage.js";

export function createStudyProgress(ids, key) {
  const knownMarks = new Set(ids.flatMap((id) => [`select:${id}`, `info:${id}`]));
  const total = knownMarks.size;

  function parse(value) {
    try {
      const saved = JSON.parse(value);
      if (Array.isArray(saved)) return new Set(saved.filter((mark) => knownMarks.has(mark)));
    } catch {
      // A damaged entry is treated as an empty one.
    }
    return new Set();
  }

  function load() {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return new Set();
    }
  }

  function save(marks) {
    for (const saved of load()) marks.add(saved);
    return writeProgress(key, [...marks]);
  }

  return {
    parse, load, save, total,
    unlockCount: Math.max(1, total / 2),
    percent: (count) => total ? Math.round(count * 100 / total) : 0,
  };
}
