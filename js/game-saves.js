// The game's saves and stats in localStorage: reading and writing them guarded, and a saved game's shape
// checked on load. Part of the game (game.js).

(() => {
  const STATS_KEY = "cirrusly:stats";
  const GAME_KEY = "cirrusly:game:"; // + the day's id: a day's save (index.html's first script reads these too)

  // ---- Storage (every access guarded: private mode or blocked storage must still play) ------------------

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not saved: the game carries on, it just won't survive a reload.
    }
  }

  function removeKey(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage blocked: there is nothing to remove.
    }
  }

  // The keys in this browser starting with `prefix`.
  function keysStartingWith(prefix) {
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
      return keys.filter((key) => key?.startsWith(prefix));
    } catch {
      return [];
    }
  }

  // The keys of every saved game in this browser.
  const savedGameKeys = () => keysStartingWith(GAME_KEY);

  // A saved game is outside input (another version of this file, or hand-edited): anything off-shape is dropped.
  function loadState(key, forDay) {
    const saved = readJson(key);
    const count = forDay.questions.length;
    const answersOk =
      Array.isArray(saved?.answers) &&
      saved.answers.length <= count &&
      saved.answers.every(
        (a) => a && (a.verdict === "right" || a.verdict === "wrong") && givenOk(a.given) && sortedOk(a.sorted),
      );
    const current = saved?.current;
    const currentOk =
      current &&
      Number.isInteger(current.index) &&
      ["example", "question", "reveal", "done"].includes(current.phase) &&
      (current.phase === "done"
        ? saved.answers.length === count
        : current.index >= 0 && current.index < count &&
          saved.answers.length === current.index + (current.phase === "reveal" ? 1 : 0)) &&
      (current.phase !== "question" || Number.isFinite(current.startedAt)) &&
      (current.closeBoxes === undefined ||
        (Array.isArray(current.closeBoxes) && current.closeBoxes.every((i) => Number.isInteger(i)))) &&
      (current.closeHint === undefined || typeof current.closeHint === "string") &&
      (current.draft === undefined || (Array.isArray(current.draft) && current.draft.every(draftEntryOk)));
    return answersOk && currentOk ? saved : { answers: [], current: null };
  }

  // A box's text, an order question's item index, a match zone's item indices, or an older page's match item group
  // (an index, or null: not sorted). Fitted to its question by the builder's restore.
  function draftEntryOk(v) {
    const zone = Array.isArray(v) && v.every(Number.isInteger);
    return v === null || typeof v === "string" || Number.isInteger(v) || zone;
  }

  // Fitted to its question on the reveal (isSorting); here only its shape.
  function sortedOk(sorted) {
    return sorted === undefined || (Array.isArray(sorted) && sorted.every((g) => g === null || Number.isInteger(g)));
  }

  function givenOk(given) {
    if (given === undefined || typeof given === "string") return true;
    return (
      Array.isArray(given) &&
      given.every((box) => typeof box?.text === "string" && ["right", "close", "wrong"].includes(box.result))
    );
  }

  // The day's key for its save and its stats entry: label and date, so days that share a label never meet.
  const dayIdOf = (data) => (data.date === undefined ? data.label : `${data.label}@${data.date}`);

  function readStats() {
    const saved = readJson(STATS_KEY) ?? {};
    const count = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
    return {
      played: count(saved.played),
      streak: count(saved.streak),
      best: count(saved.best),
      climbTotal: count(saved.climbTotal),
      lastDate: typeof saved.lastDate === "string" ? saved.lastDate : null,
      days: Array.isArray(saved.days) ? saved.days.filter((d) => typeof d === "string") : [],
    };
  }

  window.cirrusly.game = {
    ...window.cirrusly.game,
    STATS_KEY, GAME_KEY, readJson, writeJson, removeKey, keysStartingWith, savedGameKeys, loadState, dayIdOf,
    readStats,
  };
})();
