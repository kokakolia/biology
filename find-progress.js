import { findProgressKey, loadQuizProgress, saveQuizProgress } from "./quiz-progress.js";

export {
  answerQuizTask as answerFindTask, attemptLimit, beginQuizRun as beginFindRun,
  findProgressKey, findUnlockCount, nextQuizTask as nextFindTask, quizPercent as findPercent,
  resumeQuizRun as resumeFindRun, startQuizReview as startFindReview,
} from "./quiz-progress.js";

export const loadFindProgress = () => loadQuizProgress(findProgressKey);
export const saveFindProgress = (state) => saveQuizProgress(findProgressKey, state);
