// The results counter (src/cirrusly/stats/, a Cloudflare Worker): a dated day's game opening counts a player, and
// its results once finished, which questions were right and nothing else, each once per browser; the review screen
// shows how everyone did on each question. Only on the live site, so a local copy and the browser tests never touch
// the real counter; anything failing just means a player or a result uncounted, or no percentages. Part of the game
// (game.js).
//
//   POST <STATS_URL>/visit           {"date": "YYYY-MM-DD", "label": "#1"}
//   POST <STATS_URL>/result          {"date": "YYYY-MM-DD", "label": "#1", "right": [1, 0, 1, 1, 0, 1, 0]}
//                                    both sent as text/plain (a CORS simple request, which keepalive allows)
//   GET  <STATS_URL>/day/YYYY-MM-DD  {"players": N, "plays": N, "right": [n1, ..., n7]}

(() => {
  const { readJson, writeJson, removeKey, dayIdOf } = window.cirrusly.game; // game-saves.js

  const LIVE_ORIGIN = "https://cirrusly.fun";
  const STATS_URL = "https://cirrusly-stats.cirrusly.workers.dev"; // the counter (src/cirrusly/stats/)
  const SENT_KEY = "cirrusly:sent:"; // + the day's id: this day's results went to the counter (game.js prunes them)
  const VISIT_KEY = "cirrusly:visit:"; // + the day's id: this browser was counted as one of the day's players (same)
  const TIMEOUT_MS = 5000;

  const live = window.location.origin === LIVE_ORIGIN;

  function fetchWithin(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  // Once per dated day per browser, never for the sample. Marked before it goes, so a reload, a second tab or a time
  // limit running out after the counter took it can't count it twice (keepalive finishes the request across a
  // reload). The mark is taken back only when the counter says it didn't count it (a server error or the rate
  // limit), so it goes again on the next load (or, for a result, the next visit to the end screen); a lost
  // connection, which may have reached the counter, keeps it: better one short than one counted twice.
  // -> the request, settled either way (or a settled promise when nothing went).
  function sendOnce(day, mark, path, fields) {
    if (!live || day.date === undefined) return Promise.resolve();
    const key = mark + dayIdOf(day);
    if (readJson(key)) return Promise.resolve();
    writeJson(key, true);
    const body = JSON.stringify({ date: day.date, label: day.label, ...fields });
    return fetchWithin(`${STATS_URL}${path}`, { method: "POST", body, keepalive: true })
      .then((response) => {
        if (response.status >= 500 || response.status === 429) removeKey(key);
      })
      .catch(() => {});
  }

  // A dated day's game has opened in this browser: one of the day's players.
  const sendVisit = (day) => sendOnce(day, VISIT_KEY, "/visit", {});

  let sending = Promise.resolve(); // the day's results on their way, settled either way

  function sendResult(day, answers) {
    sending = sendOnce(day, SENT_KEY, "/result", {
      right: answers.map((answer) => (answer.verdict === "right" ? 1 : 0)),
    });
  }

  // How everyone did on `day`: each question's share of players right, in whole percent, or null (not the live
  // site, the sample, no plays yet, or anything failing). Asked once the player's own results have settled, so
  // they are counted whenever the counter took them; kept for the page once known.
  const known = new Map(); // date -> percentages
  async function dayPercents(day) {
    if (!live || day.date === undefined) return null;
    if (known.has(day.date)) return known.get(day.date);
    try {
      await sending;
      const response = await fetchWithin(`${STATS_URL}/day/${day.date}`, { cache: "no-store" });
      const found = response.ok ? percents(await response.json(), day.questions.length) : null;
      if (found) known.set(day.date, found);
      return found;
    } catch {
      return null;
    }
  }

  // The counter's answer is outside input: anything off-shape (or no plays) shows no percentages.
  function percents(data, count) {
    const { plays, right } = data ?? {};
    const ok =
      Number.isInteger(plays) &&
      plays > 0 &&
      Array.isArray(right) &&
      right.length === count &&
      right.every((n) => Number.isInteger(n) && n >= 0 && n <= plays);
    return ok ? right.map((n) => Math.round((100 * n) / plays)) : null;
  }

  window.cirrusly.game = { ...window.cirrusly.game, SENT_KEY, VISIT_KEY, sendVisit, sendResult, dayPercents };
})();
