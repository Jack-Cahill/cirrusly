// Jack's challenge (2026-10-22: "I have 3 lives. my goal is to get 10 questions correct. for each correct answer i
// move up in question difficultly, if wrong, i move down"). The daily game's question box, timer, answer styles,
// "Close!" retype, reveal and example cards (the same game-*.js parts), driven by this file in place of game.js.
//
// The pool is every served bank question (challenge.py), sealed, as the site is copied to a public repo: the page
// asks for the passphrase once (kept in this browser), derives the key (PBKDF2, meta.json's salt) and opens
// data/pool.bin, and each picture or clip (data/p/<n>.bin) as its question comes up.
//
// A run: level 1 to start; a right answer moves up a level (7 at most), a wrong one down a level (1 at least) and
// pops a balloon (3 balloons per corner: the lives). 10 right wins, the climb to 10,000 m and fireworks; no lives left
// ends it. The world's step is the level (step 8 is the win). Each question: a random category among the level's
// (not the last one's), then a random question of it not seen lately (`SEEN_KEY`, across runs). A run isn't saved:
// a reload starts a new one.

(() => {
  const { cirrusly } = window;
  const { isOrdering, isSorting } = cirrusly.game; // game-checks.js
  const { writeText, hiddenText, announce } = cirrusly.game; // game-text.js
  const { drawTimer, totalSeconds } = cirrusly.game; // game-dial.js
  const { fitBox } = cirrusly.game; // game-fit.js
  const { buildTyped, buildSpell, buildMulti, updateEnterHints, sayWord, hush } = cirrusly.game; // game-answers.js
  const { buildMatch } = cirrusly.game; // game-match.js
  const { buildOrder } = cirrusly.game; // game-order.js
  const {
    showGiven, writeGiven, creditList, creditLine, orderResult, markedOrder, matchResult, markedSort,
  } = cirrusly.game; // game-reveal.js
  const { fireworks } = cirrusly.game; // game-fireworks.js

  const GOAL = 10;
  const LIVES = 3;
  const TOP_LEVEL = 7;
  const WIN_STEP = 8;
  const SHAKE_MS = 600;
  const PASS_KEY = "cirrusly:challenge:pass";
  const SEEN_KEY = "cirrusly:challenge:seen";
  const RECORD_KEY = "cirrusly:challenge:record";
  const EXAMPLES_URL = "data/examples.json";
  const HOME = "challenge/"; // the page's own files, from the site root (the page's <base>)

  const { question: box } = cirrusly;
  const liftoff = document.querySelector(".liftoff");
  const unlock = document.querySelector(".unlock");
  const passInput = document.querySelector(".unlock-pass");
  const unlockNote = document.querySelector(".unlock-note");
  const rulesLine = document.querySelector(".rules-line");
  const form = document.querySelector(".qbox");
  const timer = document.querySelector(".timer");
  const questionGroup = document.querySelector(".qgroup");
  const el = (selector) => form.querySelector(selector);
  const qnum = el(".qnum");
  const goal = el(".qgoal");
  const picture = el(".qpic");
  const questionText = el(".qtext");
  const play = el(".qplay");
  const feedback = el(".qfeedback");
  const reveal = el(".qreveal");
  const answerLine = reveal.querySelector(".qright");
  const example = el(".qexample");
  const end = el(".qend");
  const nextButton = el(".qnext");
  const startButton = el(".qgotit");
  const againButton = el(".qend-copy");
  const reviewButton = el(".qend-review");
  const review = el(".qreview");
  const reviewList = el(".qreview-list");
  const backButton = el(".qreview-back");
  const verdictLine = el(".qverdict");

  // ---- Storage (every access may throw: private mode) ---------------------------------------------------

  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // No storage: nothing kept.
    }
  };

  // ---- The sealed pool ----------------------------------------------------------------------------------

  let key = null;
  async function deriveKey(passphrase) {
    const meta = await (await fetch(`${HOME}data/meta.json`, { cache: "no-store" })).json();
    const salt = Uint8Array.from(atob(meta.salt), (c) => c.charCodeAt(0));
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
      "deriveKey",
    ]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: meta.iterations, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
  }
  async function openFile(src) {
    const response = await fetch(HOME + src);
    if (!response.ok) throw new Error(`${src} did not load`);
    const sealed = new Uint8Array(await response.arrayBuffer());
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12) }, key, sealed.slice(12));
  }

  // A question's pictures and clip, opened and handed to the game as blob URLs (each opened once a page).
  const opened = new Map();
  function fileUrl(src) {
    if (!opened.has(src)) {
      const type = src.includes(".mp3.") ? "audio/mpeg" : "image/webp";
      opened.set(src, openFile(src).then((plain) => URL.createObjectURL(new Blob([plain], { type }))));
    }
    return opened.get(src);
  }
  async function prepared(q) {
    const pictures = async (list) =>
      list ? Promise.all(list.map(async (p) => ({ ...p, src: await fileUrl(p.src) }))) : undefined;
    const [images, revealed, audio] = await Promise.all([
      pictures(q.images),
      pictures(q.reveal),
      q.audio ? fileUrl(q.audio) : undefined,
    ]);
    return { ...q, images, reveal: revealed, audio };
  }

  // ---- The draw -------------------------------------------------------------------------------------------

  const byLevel = new Map(); // level -> category -> questions
  const seen = new Set(read(SEEN_KEY, []));
  let lastCategory = null;
  function draw(level) {
    const categories = byLevel.get(level);
    const names = [...categories.keys()];
    const choices = names.length > 1 ? names.filter((name) => name !== lastCategory) : names;
    const category = choices[Math.floor(Math.random() * choices.length)];
    const list = categories.get(category);
    let fresh = list.filter((q) => !seen.has(q.id));
    if (fresh.length === 0) {
      for (const q of list) seen.delete(q.id); // the whole category seen: it starts over
      fresh = list;
    }
    const q = fresh[Math.floor(Math.random() * fresh.length)];
    seen.add(q.id);
    write(SEEN_KEY, [...seen]);
    lastCategory = category;
    return q;
  }

  // ---- The run --------------------------------------------------------------------------------------------

  let examples = {};
  const run = { level: 1, lives: LIVES, right: 0, history: [] }; // history: { q, answer, level }
  let current = null; // { q, phase, startedAt?, closeUsed?, level }
  let upcoming = null; // the next question, being opened: Promise<q>
  let ui = null;
  let frame = 0;

  const VIEWS = {
    example: [example],
    question: [qnum, picture, questionText, play, feedback, timer],
    reveal: [questionText, reveal, timer],
    end: [end],
    review: [review],
  };
  const VIEW_PARTS = [qnum, goal, picture, questionText, play, feedback, reveal, example, end, review, timer];
  function setView(view, label) {
    for (const part of VIEW_PARTS) part.hidden = !VIEWS[view].includes(part);
    if (view === "question") picture.hidden = picture.childElementCount === 0;
    form.dataset.view = view;
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
  const lives = (n) => `${n} ${n === 1 ? "life" : "lives"}`;
  const status = () => `Level ${run.level} · ${run.right} of ${GOAL} right · ${lives(run.lives)}`;

  // The words can't be copied, as in the daily game.
  const NO_COPY = ".qtext, .qexample, .qreview-text";
  for (const type of ["copy", "cut"]) {
    document.addEventListener(type, (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const selection = document.getSelection();
      const inside = (node) =>
        Boolean((node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest(NO_COPY));
      if ([event.target, selection?.anchorNode, selection?.focusNode].some(inside)) event.preventDefault();
    });
  }

  // ---- Timer and answering (as game.js) ---------------------------------------------------------------------

  const secondsLeft = () => totalSeconds(current.q) - (Date.now() - current.startedAt) / 1000;
  function tick() {
    const left = secondsLeft();
    if (left <= 0) {
      const verdict = ui.check().verdict === "right" ? "right" : "wrong";
      finishQuestion({ verdict, timedOut: verdict === "wrong", left: 0 });
      return;
    }
    drawTimer(left, { running: true });
    frame = requestAnimationFrame(tick);
  }
  const stopClock = () => cancelAnimationFrame(frame);

  const BUILDERS = { typed: buildTyped, spell: buildSpell, multi: buildMulti, match: buildMatch, order: buildOrder };

  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || !event.target.classList.contains("qfield")) return;
    event.preventDefault();
    if (current?.phase !== "question" || !ui) return;
    const { fields } = ui;
    if (fields.every((input) => input.value.trim())) {
      submit();
      return;
    }
    const at = fields.indexOf(event.target);
    focus(fields.map((_, k) => fields[(at + 1 + k) % fields.length]).find((input) => !input.value.trim()));
  });
  form.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.repeat && event.target instanceof HTMLButtonElement) event.preventDefault();
  });
  form.addEventListener("input", (event) => {
    if (!event.target.classList.contains("qfield")) return;
    event.target.classList.remove("is-close");
    if (ui) updateEnterHints(ui.fields);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (current?.phase === "question") submit();
  });

  function submit() {
    if (secondsLeft() <= 0) {
      tick();
      return;
    }
    const result = ui.check();
    if (result.verdict === "close" && !current.closeUsed) {
      current.closeUsed = true;
      const closeBoxes = result.boxes.flatMap((b, i) => (b === "close" ? [i] : []));
      const closeHint = result.hints.find((hint) => hint !== null);
      announce(feedback, `Close! ${closeHint ?? "Check your spelling"}`);
      ui.fields.forEach((input, i) => input.classList.toggle("is-close", closeBoxes.includes(i)));
      focus(ui.fields[closeBoxes[0]] ?? ui.first);
      return;
    }
    finishQuestion({ verdict: result.verdict === "right" ? "right" : "wrong", timedOut: false, left: secondsLeft() });
  }

  // ---- Phases ---------------------------------------------------------------------------------------------

  function enter(q) {
    current = { q, phase: "example", level: run.level };
    if (q.example && examples[q.example]) {
      renderExample(q);
      focus(startButton);
    } else {
      startQuestion();
    }
  }

  function renderExample(q) {
    const card = examples[q.example];
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
    startButton.textContent = "Start the question";
    setView("example", "Example before the next question");
    fitBox();
  }

  function startQuestion() {
    Object.assign(current, { phase: "question", startedAt: Date.now(), closeUsed: false });
    renderQuestion(current.q);
    focus(ui.fields[0] ?? ui.first);
    if (current.q.style === "spell") sayWord(current.q);
    stopClock();
    tick();
  }

  function renderQuestion(q) {
    box.show({ number: run.history.length + 1, text: q.text, images: q.images ?? [] });
    qnum.textContent = status();
    writeText(questionText, q.text);
    play.replaceChildren();
    play.dataset.style = q.style;
    announce(feedback, "");
    setView("question");
    ui = BUILDERS[q.style](q, { saveDraft: () => {} });
    drawTimer(totalSeconds(q), { running: false });
    fitBox();
  }

  function finishQuestion(answer) {
    stopClock();
    hush();
    ui?.stop?.();
    const { q } = current;
    if (q.style === "order") answer.placed = ui.draft();
    if (q.style === "match") answer.sorted = ui.sorted();
    if (q.style === "typed" || q.style === "spell") answer.given = ui.fields[0].value;
    if (q.style === "multi") {
      const { boxes } = ui.check();
      answer.given = ui.fields.map((input, i) => ({ text: input.value, result: boxes[i] }));
    }
    run.history.push({ q, answer, level: current.level });
    current.phase = "reveal";
    if (answer.verdict === "right") {
      run.right += 1;
      run.level = Math.min(TOP_LEVEL, run.level + 1);
    } else {
      run.lives -= 1;
      run.level = Math.max(1, run.level - 1);
      clearTimeout(shake.timer);
      form.classList.add("shake");
      shake.timer = setTimeout(() => form.classList.remove("shake"), SHAKE_MS);
    }
    box.setBalloons(run.lives);
    const won = run.right >= GOAL;
    cirrusly.goToStep(won ? WIN_STEP : run.level);
    if (won) fireworks();
    if (!won && run.lives > 0) upcoming = prepared(draw(run.level));
    showReveal(answer);
  }
  const shake = { timer: 0 };

  function showReveal(answer) {
    const { q } = current;
    const over = run.right >= GOAL || run.lives === 0;
    let verdict;
    if (answer.verdict === "right") verdict = run.right >= GOAL ? "✓ That’s 10!" : `✓ Up to level ${run.level}`;
    else verdict = `${answer.timedOut ? "✗ Time’s up" : "✗ Not quite"} · ${lives(run.lives)} left`;
    box.show({ number: run.history.length, text: q.text });
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
    answerLine.hidden = Boolean(sorted || placed);
    figures(el(".qreveal-pics"), q.reveal?.length ? q.reveal : q.images);
    const credited = [...(q.images ?? []), ...(q.reveal ?? [])].filter((p) => p.credit);
    creditList.replaceChildren(...credited.map((p) => creditLine(p.credit)));
    creditList.hidden = credited.length === 0;
    nextButton.textContent = over ? "See how you did" : "Next";
    drawTimer(answer.left ?? 0, { running: false });
    ui = null;
    setView("reveal");
    fitBox();
    announce(verdictLine, verdict);
    focus(nextButton);
  }

  async function next() {
    if (run.right >= GOAL || run.lives === 0) {
      showEnd();
      return;
    }
    nextButton.disabled = true;
    try {
      enter(await upcoming);
    } finally {
      nextButton.disabled = false;
    }
  }

  // ---- End and review --------------------------------------------------------------------------------------

  function showEnd() {
    current = { ...current, phase: "done" };
    const won = run.right >= GOAL;
    const record = read(RECORD_KEY, { runs: 0, wins: 0, best: 0, fastest: null });
    record.runs += 1;
    if (won) {
      record.wins += 1;
      record.fastest = Math.min(record.fastest ?? Infinity, run.history.length);
    }
    record.best = Math.max(record.best, run.right);
    write(RECORD_KEY, record);
    const lastLevel = run.history.at(-1).level; // the level of the question that ended it
    el(".qend-title").textContent = won ? "You made it to 10,000 m!" : `Out of lives at level ${lastLevel}`;
    el(".qend-score").textContent = `${run.right} of ${GOAL} right in ${run.history.length} questions`;
    const row = el(".qend-row");
    row.textContent = run.history.map(({ answer }) => (answer.verdict === "right" ? "🎈" : "💥")).join("");
    row.setAttribute("aria-label", `${run.right} right, ${run.history.length - run.right} wrong`);
    row.classList.toggle("gold", won);
    el(".stat-played").textContent = String(record.runs);
    el(".stat-streak").textContent = String(record.wins);
    el(".stat-best").textContent = `${record.best} of ${GOAL}`;
    el(".stat-average").textContent = record.fastest === null ? "–" : `${record.fastest} questions`;
    setView("end", "Your run");
    focus(againButton);
  }

  function showReview() {
    reviewList.replaceChildren(...run.history.map((entry, i) => reviewRow(entry, i)));
    reviewList.scrollTop = 0;
    setView("review", "Your run, question by question");
    fitBox();
    focus(backButton);
  }

  function reviewRow({ q, answer, level }, i) {
    const right = answer.verdict === "right";
    const row = document.createElement("li");
    row.className = `qreview-row is-${right ? "right" : "wrong"}`;
    const tag = document.createElement("span");
    tag.className = "qreview-tag";
    const mark = document.createElement("span");
    mark.className = "qreview-mark";
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", right ? "right" : "wrong");
    mark.textContent = right ? "✓" : "✗";
    tag.append(`${i + 1} `, mark);
    const text = document.createElement("p");
    text.className = "qreview-text";
    writeText(text, q.text);
    const said = document.createElement("p");
    said.className = "qsaid";
    const answerText = document.createElement("p");
    answerText.className = "qreview-answer";
    const shown = document.createElement("b");
    shown.textContent = q.answer;
    answerText.append(hiddenText("Answer: "), shown);
    const where = document.createElement("p");
    where.className = "qreview-share";
    where.textContent = `Level ${level} · ${q.category}`;
    const body = document.createElement("div");
    body.className = "qreview-body";
    body.append(text, ...(writeGiven(said, answer) ? [said] : []), answerText, where);
    row.append(tag, body);
    return row;
  }

  nextButton.addEventListener("click", () => {
    if (current?.phase === "reveal" && !nextButton.disabled) next();
  });
  startButton.addEventListener("click", () => {
    if (current?.phase === "example") startQuestion();
  });
  againButton.addEventListener("click", () => window.location.reload());
  reviewButton.addEventListener("click", () => {
    if (current?.phase === "done") showReview();
  });
  backButton.addEventListener("click", () => {
    setView("end", "Your run");
    focus(reviewButton);
  });

  // ---- Start: unlock, then LIFTOFF ---------------------------------------------------------------------------

  window.addEventListener("cirrusly:landed", () => {
    if (current?.phase === "ready") enter(current.q);
  });

  async function open(passphrase) {
    key = await deriveKey(passphrase);
    const pool = JSON.parse(new TextDecoder().decode(await openFile("data/pool.bin")));
    for (const q of pool.questions) {
      if (!byLevel.has(q.level)) byLevel.set(q.level, new Map());
      const categories = byLevel.get(q.level);
      if (!categories.has(q.category)) categories.set(q.category, []);
      categories.get(q.category).push(q);
    }
  }

  async function begin(passphrase) {
    unlockNote.textContent = "Opening…";
    try {
      await open(passphrase);
    } catch {
      key = null;
      byLevel.clear();
      unlockNote.textContent = "That passphrase didn’t open it";
      unlock.hidden = false;
      liftoff.hidden = true;
      return;
    }
    write(PASS_KEY, passphrase);
    unlock.hidden = true;
    liftoff.hidden = false;
    try {
      examples = await (await fetch(EXAMPLES_URL)).json();
    } catch {
      examples = {}; // no example cards
    }
    const first = await prepared(draw(run.level));
    current = { q: first, phase: "ready", level: run.level };
    box.setBalloons(LIVES);
    renderQuestion(first); // drawn before the float, so the box rises showing it
    liftoff.disabled = false;
  }

  unlock.addEventListener("submit", (event) => {
    event.preventDefault();
    if (passInput.value.trim()) begin(passInput.value.trim());
  });

  liftoff.disabled = true;
  goal.hidden = true;
  const saved = read(PASS_KEY, null);
  if (saved) {
    unlock.hidden = true;
    begin(saved);
  } else {
    liftoff.hidden = true;
    unlock.hidden = false;
    focus(passInput);
  }
  rulesLine.hidden = false;
})();
