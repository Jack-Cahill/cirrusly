// Which day the page plays: today's file (by the player's local date), yesterday's when it was left
// unfinished, or the sample at #sample while the site has it; with no file for today, the date of the next game.
// Part of the game (game.js).

(() => {
  const { checkDay } = window.cirrusly.game; // game-checks.js
  const { GAME_KEY, readJson, removeKey, savedGameKeys, loadState, dayIdOf } = window.cirrusly.game; // game-saves.js

  const SAMPLE = window.location.hash === "#sample";
  // #sample is the only address with a hash: any other (an old #play or #3 link) is dropped from the address bar,
  // so it reads as the plain address it plays.
  if (window.location.hash && !SAMPLE) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  const SAMPLE_URL = "days/sample.json";
  const LOOK_AHEAD_DAYS = 2; // with no game today, how many dates ahead the sign looks for the next one
  // The deploy adds ?v=<commit> to this line, as to the page's scripts (cache_bust.py): keep it as written.
  const EXAMPLES_URL = "data/examples.json?v=2782813d362c61a5b3a883ba1fa1421a50483670";

  // sessionStorage: the sample is open in this tab (index.html's first script reads it too, as it does the saves)
  const SAMPLE_SESSION_KEY = "cirrusly:sample-session";

  // Dates are local calendar dates, "YYYY-MM-DD": a new game starts at the player's own midnight.
  const dateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  // Local midnight at the start of the date `days` after `key` (Date rolls the month and year over).
  function midnightOf(key, days = 0) {
    const [year, month, date] = key.split("-").map(Number);
    return new Date(year, month - 1, date + days);
  }
  const today = dateKey(new Date()); // the date this page opened on, which it keeps

  // The sample is a test page: a new tab (a new session) starts it afresh, while a reload still resumes it. Done as
  // the script runs, before anything can write a save, so it only ever clears a save left by an earlier visit
  // (days/sample.json's id is its label, "Sample").
  if (SAMPLE) {
    try {
      if (!sessionStorage.getItem(SAMPLE_SESSION_KEY)) {
        sessionStorage.setItem(SAMPLE_SESSION_KEY, "1");
        removeKey(`${GAME_KEY}Sample`);
      }
    } catch {
      // No session storage to tell a reload from a new visit by: the save is kept.
    }
  }

  // The day and the examples, { data, cards, sample? }: the sample at #sample (`sample: true`), else yesterday's,
  // when the player left it unfinished, else today's. From #1 on the deploy leaves the sample out, and #sample's 404
  // plays on as the plain address does. When today has no day file (a 404; any other failure is an error), the next
  // game instead: { next: { date, label } } (label null when its file doesn't read), next null when none of the next
  // LOOK_AHEAD_DAYS dates has one yet.
  async function load() {
    const examples = fetch(EXAMPLES_URL).then((response) => {
      if (!response.ok) throw new Error(`${EXAMPLES_URL} did not load`);
      return response.json();
    });
    examples.catch(() => {}); // awaited below: this only stops an early failure being reported as unhandled
    if (SAMPLE) {
      const response = await fetch(SAMPLE_URL);
      if (response.status !== 404) return { ...(await checked(response, SAMPLE_URL, null, examples)), sample: true };
    }
    const unfinished = await yesterdaysGame(examples);
    if (unfinished) return unfinished;
    const url = `days/${today}.json`;
    const response = await fetch(url);
    if (response.status === 404) return { next: await nextGame() };
    return checked(response, url, today, examples);
  }

  // A fetched day file and the examples, once they pass checkDay (`date` null for the sample): { data, cards }.
  async function checked(response, url, date, examples) {
    if (!response.ok) throw new Error(`${url} did not load`);
    const [data, cards] = await Promise.all([response.json(), examples]);
    checkDay(data, cards, url, date);
    return { data, cards };
  }

  // A game left unfinished at midnight resumes after a reload (a phone that dropped the tab while it slept, say)
  // rather than giving way to today's: { data, cards } for yesterday's day, or null to play today's. A finished game,
  // a save for today, a missing file or any failure loading or checking it means today's.
  async function yesterdaysGame(examples) {
    const yesterday = dateKey(midnightOf(today, -1));
    const keys = savedGameKeys();
    if (keys.some((key) => key.endsWith(`@${today}`))) return null; // today's game, once begun, wins
    const open = keys.some((key) => {
      const current = key.endsWith(`@${yesterday}`) ? readJson(key)?.current : null;
      return Boolean(current) && current.phase !== "done";
    });
    if (!open) return null;
    try {
      const url = `days/${yesterday}.json`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const [data, cards] = await Promise.all([response.json(), examples]);
      checkDay(data, cards, url, yesterday);
      const saved = loadState(GAME_KEY + dayIdOf(data), data);
      return saved.current && saved.current.phase !== "done" ? { data, cards } : null;
    } catch {
      return null;
    }
  }

  // The first of the next LOOK_AHEAD_DAYS dates with a day file, { date, label }, or null. Fetched whole (a few
  // kB), as the sign says more when that day is the main game's first (game.js).
  async function nextGame() {
    const dates = Array.from({ length: LOOK_AHEAD_DAYS }, (_, i) => dateKey(midnightOf(today, i + 1)));
    const labelOf = (data) => (typeof data?.label === "string" ? data.label : null);
    const found = await Promise.all(
      dates.map((date) =>
        fetch(`days/${date}.json`).then(
          async (response) => (response.ok ? { date, label: await response.json().then(labelOf, () => null) } : null),
          () => null,
        ),
      ),
    );
    return found.find(Boolean) ?? null;
  }

  window.cirrusly.game = { ...window.cirrusly.game, today, dateKey, midnightOf, load };
})();
