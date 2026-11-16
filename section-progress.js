import { createQuizProgress } from "./quiz-progress.js";
import { createStudyProgress } from "./study-progress.js";

export function createSectionProgress(section) {
  const partIds = Object.keys(section.parts);
  const prefix = section.legacyStorage ? "iznutri" : `iznutri:${section.id}`;
  const keys = {
    study: `${prefix}:study-progress:v1`,
    find: `${prefix}:find-progress:v1`,
    photo: `${prefix}:photo-progress:v1`,
    activity: `${prefix}:active-lesson`,
  };

  return {
    keys, partIds,
    study: createStudyProgress(partIds, keys.study),
    quiz: createQuizProgress(partIds),
    findUnlockCount: Math.ceil(partIds.length / 2),
  };
}
