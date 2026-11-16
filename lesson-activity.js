export function activeLessonName(activityKey) {
  try {
    return localStorage.getItem(activityKey)?.split(":", 1)[0];
  } catch {
    return undefined;
  }
}

export function connectLessonActivity(activityKey, name, onChange) {
  const token = `${name}:${Date.now()}:${Math.random()}`;
  let canShare = true;

  function owner() {
    if (!canShare) return token;
    try {
      return localStorage.getItem(activityKey);
    } catch {
      canShare = false;
      return token;
    }
  }

  function claim() {
    try {
      localStorage.setItem(activityKey, token);
      canShare = true;
    } catch {
      canShare = false;
    }
    onChange(true);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== activityKey && event.key !== null) return;
    onChange(owner() === token);
  });

  return { claim, isActive: () => owner() === token };
}
