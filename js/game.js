// The daily game. It plays the day file for the player's local date, days/<YYYY-MM-DD>.json (`#sample` plays
// days/sample.json instead, for testing, while the site has it: once the deploy leaves it out, #sample plays as the
// plain address does), 7 questions, one per level, in the question box start.js floats up. A dated file must carry
// its own date. With no file for the date, LIFTOFF gives way to a sign saying when the next
// game is (the next 2 dates' files are looked for). The page keeps the day it opened on: a game in progress at
// midnight plays on, while the start screen, the sign and the end screen's countdown reload into the new day then.
// A game left unfinished from yesterday is played on the next load instead of today's (a reload after midnight).
//
// Flow per question:  [example card, untimed] -> question (timer running) -> reveal -> next ... -> end screen.
//   Climb   a right answer before any crash adds a balloon per corner and climbs one step.
//   Crash   a wrong answer pops the balloons and drops to step 1, for good: later right answers count (🌥️ in
//           the share row) but never climb. Score = right answers in a row from question 1.
//   Timer   40 s, plus 10 s per extra answer box shown as a blue arc that drains while the needle waits at 40.
//           A colour arc drains from 40 to 0 and a window shows the whole seconds left; 5 s and under pulse red.
//           It runs on the wall clock (Date.now), so a hidden tab or a locked phone keeps counting. At 0 whatever
//           is in place (the boxes as typed, the sort or the order as it stands) is checked as a Submit would be:
//           right counts, anything else (a "close" too: no time to retype) is wrong, shown as "Time's up".
//   Close   a near-miss (match.js) gets one retype, "Close! Check your spelling", with the clock running;
//           a second near-miss is wrong. A close answer (a part's `close` list: on the right track but not specific
//           enough) gets the same retype, its line "Close! <the part's hint>" ("Be more specific" by default).
//
// Progress lives in localStorage under "cirrusly:game:<day id>" and is saved at every phase change and answer, and
// the answer in progress (the draft) at every keystroke and drop, so a reload resumes where it was: mid-question with
// the clock still running and the draft back in place (checked at once if the clock ran out meanwhile), on the
// example or reveal, or on the end screen for a finished day. A page's first save drops dated saves more than 7
// days older than its day. The sample's save lasts only for its tab (sessionStorage marks it): a new tab starts it.
// Stats are kept under "cirrusly:stats", counted once per finished day (its id in `days`), never for the sample. A
// day's id is "<label>@<date>", or just the label for an undated day (the sample): a save or stats entry from the
// mock's old "B#1" sample can never match the real, dated B#1. Stats count a day on its own date, whenever it is
// finished. Storage that throws (private mode) just means no saving.
//
// Day file (v0): { label, date? ("YYYY-MM-DD", set by the publish job), questions: [{ level, category,
//   style: "typed" | "multi" | "match" | "spell" | "order", text, images?, example?, parts?, order?, boxes?,
//   joined?, groups?, items?, ends?, say?, audio?, answer,
//   reveal? }] }; see days/sample.json. `items`: a match's `{ text, group }`, or an order question's `{ text, rank }`
//   in the order the question lists them (rank 1 belongs at the top), with `ends` naming the list's top and bottom
//   ("Earliest").
//   `joined: true` (crosswords) takes only the exact letters, spaces aside. `boxes` (multi, order "any"): "name N of
//   these M", N boxes for a pool of M parts; without it, one box per part. A part's `label` (multi, order "fixed", on
//   every part or none) names the item its box answers, written beside the box; its `close` lists
//   close answers and `hint` (only with `close`) their message. A picture (`images` or `reveal`, `{ src, alt,
//   credit? }`) that is a free-licence photo or map, or our own map, carries its `credit`: `{ title, author,
//   source_url, licence, licence_url, changes?, kind? }` (`kind: "map"`: "Map:" in place of "Photo:"), shown on the
//   reveal only, since a photo's title can name the answer. A spell question's `audio` is its recorded word (a
//   site-relative mp3); without it, or if it fails, the browser speaks `say`.
//
// Its parts are in game-*.js, plain scripts that index.html loads before this one, each sharing what it gives
// through window.cirrusly.game: game-checks (the day file's checks), game-saves (localStorage), game-load
// (which day to play), game-text (writing into the box), game-dial (the timer), game-fit (the box on the
// screen, and the phone keyboard), game-answers (typed, spelling and multi-part boxes), game-drag, game-match
// and game-order (the drag styles) and game-reveal (the reveal's lists). This file holds the game's state and
// runs it.

(() => {
  const { cirrusly } = window;
  const { isOrdering, isSorting } = window.cirrusly.game; // game-checks.js
  const {
    STATS_KEY, GAME_KEY, writeJson, removeKey, savedGameKeys, loadState, dayIdOf, readStats,
  } = window.cirrusly.game; // game-saves.js
  const { today, dateKey, midnightOf, load } = window.cirrusly.game; // game-load.js
  const { writeText, hiddenText, announce } = window.cirrusly.game; // game-text.js
  const { drawTimer, totalSeconds } = window.cirrusly.game; // game-dial.js
  const { fitBox } = window.cirrusly.game; // game-fit.js
  const {
    buildTyped, buildSpell, buildMulti, updateEnterHints, sayWord, hush,
  } = window.cirrusly.game; // game-answers.js
  const { buildMatch } = window.cirrusly.game; // game-match.js
  const { buildOrder } = window.cirrusly.game; // game-order.js
  const {
    showGiven, creditList, creditLine, orderResult, markedOrder, matchResult, markedSort,
  } = window.cirrusly.game; // game-reveal.js

  const SAVE_KEEP_DAYS = 7; // a dated save more than this many days older than the day being saved is dropped

  const LEVEL_EMOJI = ["🐝", "🪺", "🦆", "🦩", "🦅", "🎈", "🛩️"];
  const WRONG_EMOJI = "☁️";
  const AFTER_CRASH_EMOJI = "🌥️";

  const HEIGHTS = STEPS.map((step) => step.altitude); // metres reached with 0..7 right in a row

  const { question: box } = cirrusly;
  const liftoff = document.querySelector(".liftoff");
  const noGame = document.querySelector(".no-game");
  const betaLabel = document.querySelector(".beta");
  const rulesLine = document.querySelector(".rules-line");
  const form = document.querySelector(".qbox");
  const timer = document.querySelector(".timer");
  const questionGroup = document.querySelector(".qgroup"); // the timer and the box

  const el = (selector) => form.querySelector(selector);
  const qnum = el(".qnum");
  const goal = el(".qgoal"); // question 1's reminder of the goal
  const picture = el(".qpic");
  const questionText = el(".qtext");
  const play = el(".qplay");
  const feedback = el(".qfeedback");
  const reveal = el(".qreveal");
  const answerLine = reveal.querySelector(".qright");
  const example = el(".qexample");
  const end = el(".qend");
  const nextButton = el(".qnext");
  const startButton = el(".qgotit"); // the example card's "Start question N"
  const copyButton = el(".qend-copy");
  const shareText = el(".qend-text");
  const nextGame = el(".qend-next");
  const countdownValue = el(".qend-countdown");
  const verdictLine = el(".qverdict");

  let day = null;
  let examples = {};
  let playingSample = false; // the sample is what's played (#sample, while the site has it)
  let storageKey = "";
  // answers[i] = { verdict: "right" | "wrong", timedOut, left (seconds on the clock when answered), placed?, sorted?,
  //                given? }
  //              placed: an order question's item indices from the top down as checked, for the reveal
  //              sorted: a match question's sort as checked, each item's group index (null: not sorted), for the reveal
  //              given: what the player gave, struck through on a wrong reveal: the typed text (typed, spell), or
  //                each box's { text, result } in box order (multi); absent for match and order (and in older saves)
  // current    = { index, phase: "example" | "question" | "reveal" | "done", startedAt?, closeUsed?, closeBoxes?,
  //                closeHint?, draft? }
  //              closeBoxes: the boxes a "Close!" flagged, so a reload mid-retype shows them again
  //              closeHint: the close answer's message that "Close!" showed, absent for "Check your spelling"
  //              draft: the answer in progress, each box's text (strings), each match zone's item indices from
  //                the top (lists: Not sorted's, then each group's, in drop order) or an order question's item
  //                indices from the top down; see the builders' draft/restore
  let state = { answers: [], current: null };
  let ui = null; // the current question's answer boxes (see the builders, game-answers.js)
  let frame = 0;
  let midnightTimer = 0;

  let pruned = false;
  function save() {
    writeJson(storageKey, state);
    if (!pruned) {
      pruned = true;
      pruneSaves();
    }
  }

  // Once a page, on its first save: old days' saves go (dated ids only; nothing reads them once their day is past).
  function pruneSaves() {
    if (day.date === undefined) return;
    const oldest = dateKey(midnightOf(day.date, -SAVE_KEEP_DAYS));
    for (const key of savedGameKeys()) {
      const date = /@(\d{4}-\d{2}-\d{2})$/.exec(key)?.[1];
      if (date && date < oldest) removeKey(key);
    }
  }

  // ---- Score -------------------------------------------------------------------------------------------

  function progress(answers) {
    let score = 0;
    let crashed = false;
    for (const answer of answers) {
      if (answer.verdict !== "right") crashed = true;
      else if (!crashed) score += 1;
    }
    return { score, crashed };
  }

  function emojiRow() {
    let crashed = false;
    return state.answers
      .map((answer, i) => {
        if (answer.verdict !== "right") {
          crashed = true;
          return WRONG_EMOJI;
        }
        return crashed ? AFTER_CRASH_EMOJI : LEVEL_EMOJI[day.questions[i].level - 1];
      })
      .join("");
  }

  const metres = (m) => `${m.toLocaleString("en-US")} m`;

  // ---- Views -------------------------------------------------------------------------------------------

  const VIEWS = {
    example: [example],
    question: [qnum, goal, picture, questionText, play, feedback, timer],
    reveal: [questionText, reveal, timer], // no number: the question, small, then the verdict and the answer
    end: [end],
  };
  const VIEW_PARTS = [qnum, goal, picture, questionText, play, feedback, reveal, example, end, timer];

  function setView(view, label) {
    for (const part of VIEW_PARTS) part.hidden = !VIEWS[view].includes(part);
    if (view === "question") picture.hidden = picture.childElementCount === 0;
    form.dataset.view = view;
    // A match reveal's sort or an order reveal's tiles need the room: on phones the dial and the verdict shrink
    // (game.css).
    questionGroup.classList.toggle("list-reveal", view === "reveal" && !(matchResult.hidden && orderResult.hidden));
    if (label) form.setAttribute("aria-label", label);
  }

  function figures(container, pictures) {
    container.replaceChildren(
      ...(pictures ?? []).map(({ src, alt }) => {
        const figure = document.createElement("figure");
        const img = document.createElement("img");
        img.src = src;
        img.alt = alt ?? "";
        figure.append(img);
        return figure;
      }),
    );
    container.hidden = container.childElementCount === 0;
  }

  const focus = (element) => element?.focus({ preventScroll: true });

  // ---- Timer -------------------------------------------------------------------------------------------

  function secondsLeft() {
    const q = day.questions[state.current.index];
    return totalSeconds(q) - (Date.now() - state.current.startedAt) / 1000;
  }

  function tick() {
    const left = secondsLeft();
    if (left <= 0) {
      // Time's up: what is in place is checked as a Submit would be, with no retype (so "close" is wrong).
      const verdict = ui.check().verdict === "right" ? "right" : "wrong";
      finishQuestion({ verdict, timedOut: verdict === "wrong", left: 0 });
      return;
    }
    drawTimer(left, { running: true });
    frame = requestAnimationFrame(tick);
  }

  function stopClock() {
    cancelAnimationFrame(frame);
  }

  // ---- Answering ---------------------------------------------------------------------------------------

  const BUILDERS = { typed: buildTyped, spell: buildSpell, multi: buildMulti, match: buildMatch, order: buildOrder };

  // Enter in a box: the next empty box (wrapping), or submit once every box is filled. A Submit click is the
  // only way to give up with blanks.
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || !event.target.classList.contains("qfield")) return;
    event.preventDefault();
    if (state.current?.phase !== "question" || !ui) return;
    const { fields } = ui;
    if (fields.every((input) => input.value.trim())) {
      submit();
      return;
    }
    const at = fields.indexOf(event.target);
    const next = fields.map((_, k) => fields[(at + 1 + k) % fields.length]).find((input) => !input.value.trim());
    focus(next);
  });

  // A held Enter (key repeat) must not press the button that just took focus: Next after an answer, Start question
  // after Next (skipping the untimed example), Copy after the last Next.
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.repeat && event.target instanceof HTMLButtonElement) event.preventDefault();
  });

  form.addEventListener("input", (event) => {
    if (!event.target.classList.contains("qfield")) return;
    event.target.classList.remove("is-close");
    if (ui) updateEnterHints(ui.fields);
    saveDraft();
  });

  // Each keystroke and drop (a few hundred bytes), so a reload or the clock running out keeps the answer.
  function saveDraft() {
    if (state.current?.phase !== "question" || !ui) return;
    state.current.draft = ui.draft();
    save();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.current?.phase === "question") submit();
  });

  function submit() {
    // The clock can run out between frames (a tab woken from the background): then the time's-up check decides.
    const left = secondsLeft();
    if (left <= 0) {
      tick();
      return;
    }
    const result = ui.check();
    if (result.verdict === "close" && !state.current.closeUsed) {
      const closeBoxes = result.boxes.flatMap((box, i) => (box === "close" ? [i] : []));
      // The first close answer's message speaks for the line; typo closes alone are a spelling check.
      const closeHint = result.hints.find((hint) => hint !== null);
      Object.assign(state.current, { closeUsed: true, closeBoxes });
      if (closeHint !== undefined) state.current.closeHint = closeHint;
      save();
      showClose(closeBoxes, closeHint);
      return;
    }
    finishQuestion({ verdict: result.verdict === "right" ? "right" : "wrong", timedOut: false, left });
  }

  // The retype in progress: the line, and the boxes that were close (after a reload, with their draft text).
  function showClose(closeBoxes, closeHint) {
    announce(feedback, `Close! ${closeHint ?? "Check your spelling"}`);
    ui.fields.forEach((input, i) => input.classList.toggle("is-close", closeBoxes.includes(i)));
    focus(ui.fields[closeBoxes[0]] ?? ui.first);
  }

  // ---- Phases ------------------------------------------------------------------------------------------

  function enter(index) {
    const q = day.questions[index];
    if (q.example && examples[q.example]) showExample(index);
    else startQuestion(index, Date.now());
  }

  function showExample(index) {
    state.current = { index, phase: "example" };
    save();
    renderExample(index);
    focus(startButton);
  }

  // "Next up", the style's name and its one-line rule, then the framed example: "Q: <clue>" (none on the rebus card:
  // its picture is the question), "A: <answer>" big and the trick in a few quiet words (none on the crossword's).
  function renderExample(index) {
    const card = examples[day.questions[index].example];
    el(".qexample-title").textContent = card.title;
    el(".qexample-rule").textContent = card.rule;
    const clue = el(".qexample-text");
    clue.hidden = !card.text;
    clue.replaceChildren();
    if (card.text) {
      writeText(clue, card.text);
      const label = document.createElement("span");
      label.className = "qexample-label";
      label.setAttribute("aria-hidden", "true");
      label.textContent = "Q: ";
      clue.prepend(label, hiddenText("Question: "));
    }
    figures(el(".qexample-pics"), card.images);
    el(".qexample-answer").textContent = card.answer;
    const trick = el(".qexample-explain");
    trick.textContent = card.explain ?? "";
    trick.hidden = !card.explain;
    startButton.textContent = `Start question ${index + 1}`;
    setView("example", `Example before question ${index + 1}`);
    fitBox();
  }

  // `startedAt` is the wall-clock start: now for a new question, the saved one for a resumed question, which
  // also brings back a "Close!" retype in progress (`closeBoxes`, `closeHint`) and the answer in progress (`draft`).
  function startQuestion(index, startedAt, { closeBoxes = null, closeHint, draft = null } = {}) {
    const q = day.questions[index];
    state.current = { index, phase: "question", startedAt, closeUsed: closeBoxes !== null };
    if (closeBoxes) state.current.closeBoxes = closeBoxes;
    if (closeBoxes && closeHint !== undefined) state.current.closeHint = closeHint;
    if (draft) state.current.draft = draft;
    save();
    renderQuestion(index);
    if (draft) ui.restore(draft);
    if (closeBoxes) showClose(closeBoxes, closeHint);
    // The first box still empty (all of them on a new question), or the last if a restored draft filled them all.
    else focus(ui.fields.find((input) => !input.value.trim()) ?? ui.fields.at(-1) ?? ui.first);
    // Browsers only speak after the player has touched the page; a resumed question waits for the button.
    if (q.style === "spell" && (navigator.userActivation?.hasBeenActive ?? true)) sayWord(q);
    stopClock();
    tick();
  }

  function renderQuestion(index) {
    const q = day.questions[index];
    box.show({ number: index + 1, text: q.text, images: q.images ?? [] });
    writeText(questionText, q.text);
    play.replaceChildren();
    play.dataset.style = q.style;
    announce(feedback, "");
    setView("question");
    goal.hidden = index !== 0;
    ui = BUILDERS[q.style](q, { saveDraft });
    drawTimer(totalSeconds(q), { running: false });
    fitBox();
  }

  function finishQuestion(answer) {
    stopClock();
    hush();
    ui?.stop?.();
    const { style } = day.questions[state.current.index];
    if (style === "order") answer.placed = ui.draft();
    if (style === "match") answer.sorted = ui.sorted();
    if (style === "typed" || style === "spell") answer.given = ui.fields[0].value;
    if (style === "multi") {
      const { boxes } = ui.check();
      answer.given = ui.fields.map((input, i) => ({ text: input.value, result: boxes[i] }));
    }
    const before = progress(state.answers);
    state.answers.push(answer);
    const after = progress(state.answers);
    state.current = { index: state.current.index, phase: "reveal" };
    save();
    if (answer.verdict === "right" && !before.crashed) {
      box.setBalloons(after.score);
      cirrusly.goToStep(after.score + 1);
    } else if (answer.verdict !== "right" && !before.crashed) {
      box.popBalloons();
      cirrusly.goToStep(1);
    }
    showReveal(state.current.index);
  }

  function showReveal(index) {
    const q = day.questions[index];
    const answer = state.answers[index];
    const crashedBefore = progress(state.answers.slice(0, index)).crashed;
    const { score } = progress(state.answers);
    // A word or two: the popping balloons and the drop already show a crash, so a time's-up crash says only that.
    let verdict;
    if (answer.verdict === "right") verdict = crashedBefore ? "✓ Right" : `✓ Up to ${metres(HEIGHTS[score])}`;
    else if (answer.timedOut) verdict = "✗ Time’s up";
    else verdict = crashedBefore ? "✗ Not quite" : "✗ Crash!";
    box.show({ number: index + 1, text: q.text });
    writeText(questionText, q.text);
    verdictLine.dataset.verdict = answer.verdict;
    const placed = q.style === "order" && isOrdering(answer.placed, q.items.length) ? answer.placed : null;
    orderResult.replaceChildren(...(placed ? markedOrder(q, placed) : []));
    orderResult.hidden = !placed;
    const sorted = q.style === "match" && isSorting(answer.sorted, q) ? answer.sorted : null;
    matchResult.replaceChildren(...(sorted ? [markedSort(q, sorted)] : []));
    matchResult.hidden = !sorted;
    showGiven(answer);
    el(".qright-text").textContent = q.answer;
    answerLine.hidden = Boolean(sorted || placed); // the marked sort or order is the answer
    // A question picture with no reveal picture stays on as a reference for the answer.
    figures(el(".qreveal-pics"), q.reveal?.length ? q.reveal : q.images);
    const credited = [...(q.images ?? []), ...(q.reveal ?? [])].filter((picture) => picture.credit);
    creditList.replaceChildren(...credited.map((picture) => creditLine(picture.credit)));
    creditList.hidden = credited.length === 0;
    nextButton.textContent = index + 1 < day.questions.length ? "Next" : "See how you did";
    drawTimer(answer.left ?? 0, { running: false });
    ui = null;
    setView("reveal");
    fitBox();
    announce(verdictLine, verdict);
    focus(nextButton);
  }

  function next() {
    const index = state.current.index + 1;
    if (index < day.questions.length) enter(index);
    else finishDay();
  }

  function finishDay() {
    state.current = { index: day.questions.length, phase: "done" };
    save();
    recordStats();
    showEnd();
  }

  // ---- End screen, share and stats ---------------------------------------------------------------------

  function shareMessage() {
    const { score } = progress(state.answers);
    return `💨 Cirrusly ${day.label} 💨\n${metres(HEIGHTS[score])}\n${emojiRow()}`;
  }

  const dayId = () => dayIdOf(day);

  // Once per day, so a reload of a finished day doesn't count it twice; never for the sample (a test page). Streak =
  // days in a row played, by the days' own dates: a day finished after its midnight still counts on its date, so the
  // next day's game continues the run, and one finished after a later day (two tabs) counts without touching it.
  function recordStats() {
    if (playingSample) return;
    const stats = readStats();
    if (stats.days.includes(dayId())) return;
    const { score } = progress(state.answers);
    const dayBefore = dateKey(midnightOf(day.date, -1));
    stats.played += 1;
    stats.climbTotal += score;
    stats.best = Math.max(stats.best, HEIGHTS[score]);
    if (stats.lastDate === null || day.date > stats.lastDate) {
      stats.streak = stats.lastDate === dayBefore ? stats.streak + 1 : 1;
      stats.lastDate = day.date;
    }
    stats.days.push(dayId());
    writeJson(STATS_KEY, stats);
  }

  function showEnd() {
    const { score } = progress(state.answers);
    el(".qend-height").textContent = metres(HEIGHTS[score]);
    const row = el(".qend-row");
    row.textContent = emojiRow();
    row.setAttribute("aria-label", `${score} right in a row out of ${day.questions.length}`);
    const stats = readStats();
    el(".stat-played").textContent = String(stats.played);
    el(".stat-streak").textContent = String(stats.streak);
    el(".stat-best").textContent = metres(stats.best);
    el(".stat-average").textContent = `${stats.played ? (stats.climbTotal / stats.played).toFixed(1) : "0"} of 7`;
    shareText.value = shareMessage();
    setView("end", "Today’s result");
    focus(copyButton);
    // Counts down to the midnight that ends the day, then reloads into the new one. A day finished after its
    // midnight (begun the day before) has nothing to count down: the next game is ready already.
    const midnight = midnightOf(day.date ?? today, 1);
    if (midnight <= Date.now()) {
      clearInterval(midnightTimer);
      nextGame.textContent = "A new game is ready — reload to play";
      return;
    }
    nextGame.replaceChildren("Next game in ", countdownValue);
    reloadAt(midnight, showCountdown);
  }

  function showCountdown(seconds) {
    const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
    countdownValue.textContent = parts.map((n) => String(n).padStart(2, "0")).join(":");
  }

  // Checks the clock every second (a phone asleep through midnight checks on waking) and reloads once `midnight` has
  // passed, so the page opens on the new date's day; `onTick` gets the whole seconds left until then.
  function reloadAt(midnight, onTick = () => {}) {
    clearInterval(midnightTimer);
    const check = () => {
      const seconds = Math.floor((midnight - Date.now()) / 1000);
      if (seconds < 0) {
        clearInterval(midnightTimer);
        window.location.reload();
      } else {
        onTick(seconds);
      }
    };
    check();
    midnightTimer = setInterval(check, 1000);
  }

  // The clipboard API needs a secure page and permission; failing that, select the text for a manual copy.
  async function copyShare() {
    const copied = el(".qend-copied");
    const text = shareMessage();
    try {
      await navigator.clipboard.writeText(text);
      copied.textContent = "Copied!";
      return;
    } catch {
      shareText.hidden = false;
      shareText.value = text;
      shareText.focus({ preventScroll: true });
      shareText.select();
    }
    let done = false;
    try {
      done = document.execCommand("copy");
    } catch {
      done = false;
    }
    copied.textContent = done ? "Copied!" : "Select the text and copy it";
  }

  nextButton.addEventListener("click", () => {
    if (state.current?.phase === "reveal") next();
  });
  startButton.addEventListener("click", () => {
    if (state.current?.phase === "example") startQuestion(state.current.index, Date.now());
  });
  copyButton.addEventListener("click", copyShare);

  // ---- Start and resume --------------------------------------------------------------------------------

  // Puts the world, the balloons and the box back where the saved game left them.
  function resume() {
    const { score, crashed } = progress(state.answers);
    box.liftOff({ instant: true });
    cirrusly.goToStep(crashed ? 1 : score + 1, { instant: true });
    box.setBalloons(crashed ? 0 : score);
    const { index, phase, startedAt, closeUsed, closeBoxes, closeHint, draft } = state.current;
    if (phase === "done") showEnd();
    else if (phase === "reveal") showReveal(index);
    else if (phase === "example") showExample(index);
    // A clock already out checks the restored draft at once, on its first tick.
    else startQuestion(index, startedAt, { closeBoxes: closeUsed ? (closeBoxes ?? []) : null, closeHint, draft });
  }

  // No game for today: a sign in LIFTOFF's place, no box. At midnight the page reloads, perhaps into a game.
  function showNoGame(next) {
    const tomorrow = dateKey(midnightOf(today, 1));
    let text = "No game today - check back soon";
    if (next === tomorrow) text = "Next game tomorrow";
    else if (next !== null) text = `Next game ${midnightOf(next).toLocaleDateString("en-US", { weekday: "long" })}`;
    liftoff.hidden = true;
    noGame.hidden = false; // shown before its text is written, so a screen reader announces it
    noGame.textContent = text;
    reloadAt(midnightOf(tomorrow));
  }

  // The box floats up on LIFTOFF; the first question (or its example) starts once it has landed.
  window.addEventListener("cirrusly:landed", () => {
    if (day && !state.current) enter(0);
  });

  // A start screen left open past midnight reloads into the new day; once LIFTOFF is pressed the game keeps its day.
  liftoff.addEventListener("click", () => clearInterval(midnightTimer));

  liftoff.disabled = true;
  load()
    .then(({ data, cards, next, sample }) => {
      if (!data) {
        showNoGame(next);
        return;
      }
      day = data;
      examples = cards;
      storageKey = GAME_KEY + dayId();
      playingSample = sample === true;
      betaLabel.hidden = !(playingSample || day.label.startsWith("B#"));
      // Fetch every picture of the day up front, so each question opens with its pictures already in place (and a
      // spelling clip, so the word plays the moment its question opens).
      for (const q of day.questions) {
        for (const { src } of [...(q.images ?? []), ...(q.reveal ?? [])]) new Image().src = src;
        if (q.audio) new Audio(q.audio).preload = "auto";
      }
      state = loadState(storageKey, day);
      if (state.current) {
        resume();
        return;
      }
      // Drawn before the float, so the box rises already showing question 1 (or its example) with the clock
      // full; nothing is saved and the clock doesn't start until it lands.
      if (day.questions[0].example) renderExample(0);
      else renderQuestion(0);
      liftoff.disabled = false;
      reloadAt(midnightOf(today, 1));
    })
    .catch((error) => {
      rulesLine.textContent = "Today’s game didn’t load. Try reloading the page.";
      console.error(error);
    });
})();
