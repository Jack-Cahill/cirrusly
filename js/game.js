// The daily game, in play mode only (`#play`, hidden until beta; world.js sets window.cirrusly.play). It plays
// one day file (days/sample.json for now) of 7 questions, one per level, in the question box start.js floats
// up. Without `#play` this file does nothing and the box stays the dead mock.
//
// Flow per question:  [example card, untimed] -> question (timer running) -> reveal -> next ... -> end screen.
//   Climb   a right answer before any crash adds a balloon per corner and climbs one step.
//   Crash   a wrong answer pops the balloons and drops to step 1, for good: later right answers count (🌥️ in
//           the share row) but never climb. Score = right answers in a row from question 1.
//   Timer   40 s, plus 10 s per extra answer box shown as a blue arc that drains while the needle waits at 40.
//           A colour arc drains from 40 to 0 and a window shows the whole seconds left; 5 s and under pulse red.
//           It runs on the wall clock (Date.now), so a hidden tab or a locked phone keeps counting. At 0 whatever
//           is in place (the boxes as typed, the sort as it stands) is checked as a Submit would be: right counts,
//           anything else (a "close" too: no time to retype) is wrong, shown as "Time's up".
//   Close   a near-miss (match.js) gets one retype, "Close! Check your spelling", with the clock running;
//           a second near-miss is wrong.
//
// Progress lives in localStorage under "cirrusly:game:<day label>" (the dev Reset button clears it) and is saved
// at every phase change and answer, and the answer in progress (the draft) at every keystroke and drop, so a
// reload resumes where it was: mid-question with the clock still running and the draft back in place (checked
// at once if the clock ran out meanwhile), on the example or reveal, or on the end screen for a finished day.
// Stats are kept under "cirrusly:stats", counted once per finished day. Storage that throws (private mode) just
// means no saving.
//
// Day file (v0): { label, questions: [{ level, category, style: "typed" | "multi" | "match" | "spell", text,
//   images?, example?, parts?, order?, joined?, groups?, items?, say?, answer, reveal? }] }; see days/sample.json.
//   `joined: true` (crosswords) compares answers with the spaces removed.

(() => {
  const { cirrusly } = window;
  if (!cirrusly.play) return;

  const DAY_URL = "days/sample.json";
  const EXAMPLES_URL = "data/examples.json";
  const STATS_KEY = "cirrusly:stats";
  const QUESTION_S = 40;
  const EXTRA_BOX_S = 10;
  const URGENT_S = 5;
  const TIMER_STEPS_PER_S = 20; // the dial redraws 20 times a second: a step of the arc is under a pixel
  const WARN_S = 20; // the colour arc is green above this, amber at it and under, red at 10 and under (HOT_S)
  const HOT_S = 10;
  const DRAG_START_PX = 6;
  const SCROLL_EDGE_PX = 40; // a drag this near a scrolling tile area's edge scrolls it
  const SCROLL_MAX_PX = 14; // per frame
  const LEVEL_EMOJI = ["🐝", "🪺", "🦆", "🦩", "🦅", "🎈", "🛩️"];
  const WRONG_EMOJI = "☁️";
  const AFTER_CRASH_EMOJI = "🌥️";
  const STYLES = new Set(["typed", "multi", "match", "spell"]);
  const HEIGHTS = STEPS.map((step) => step.altitude); // metres reached with 0..7 right in a row

  const { match, question: box } = cirrusly;
  const liftoff = document.querySelector(".liftoff");
  const rulesLine = document.querySelector(".rules-line");
  const form = document.querySelector(".qbox");
  const timer = document.querySelector(".timer");
  const dial = timer.querySelector(".dial");
  const needle = dial.querySelector(".dial-needle");
  const extraArc = dial.querySelector(".dial-extra");
  const timeArc = dial.querySelector(".dial-arc");
  const timeNumber = dial.querySelector(".dial-num");
  const el = (selector) => form.querySelector(selector);
  const qnum = el(".qnum");
  const picture = el(".qpic");
  const questionText = el(".qtext");
  const deadAnswer = el(".qanswer");
  const play = el(".qplay");
  const feedback = el(".qfeedback");
  const reveal = el(".qreveal");
  const example = el(".qexample");
  const end = el(".qend");
  const nextButton = el(".qnext");
  const gotIt = el(".qgotit");
  const copyButton = el(".qend-copy");
  const shareText = el(".qend-text");
  const nextGame = el(".qend-next");
  const countdownValue = el(".qend-countdown");
  const verdictLine = el(".qverdict");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let day = null;
  let examples = {};
  let storageKey = "";
  // answers[i] = { verdict: "right" | "wrong", timedOut, left (seconds on the clock when answered) }
  // current    = { index, phase: "example" | "question" | "reveal" | "done", startedAt?, closeUsed?, closeBoxes?,
  //                draft? }
  //              closeBoxes: the boxes a "Close!" flagged, so a reload mid-retype shows them again
  //              draft: the answer in progress, each box's text (strings) or each match item's group (an
  //                index, or null while not sorted); see the builders' draft/restore
  let state = { answers: [], current: null };
  let ui = null; // the current question's answer boxes (see the builders below)
  let frame = 0;
  let countdown = 0;

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

  function save() {
    writeJson(storageKey, state);
  }

  // A saved game is outside input (another version of this file, or hand-edited): anything off-shape is dropped.
  function loadState() {
    const saved = readJson(storageKey);
    const count = day.questions.length;
    const answersOk =
      Array.isArray(saved?.answers) &&
      saved.answers.length <= count &&
      saved.answers.every((a) => a && (a.verdict === "right" || a.verdict === "wrong"));
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
      (current.draft === undefined ||
        (Array.isArray(current.draft) &&
          current.draft.every((v) => v === null || typeof v === "string" || Number.isInteger(v))));
    return answersOk && currentOk ? saved : { answers: [], current: null };
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
    question: [qnum, picture, questionText, play, feedback, timer],
    reveal: [qnum, questionText, reveal, timer],
    end: [end],
  };
  const VIEW_PARTS = [qnum, picture, questionText, deadAnswer, play, feedback, reveal, example, end, timer];

  function setView(view, label) {
    for (const part of VIEW_PARTS) part.hidden = !VIEWS[view].includes(part);
    if (view === "question") picture.hidden = picture.childElementCount === 0;
    form.dataset.view = view;
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

  // ---- Fitting the box to the screen -------------------------------------------------------------------
  // The pictures on show (the question's, the reveal's or the example card's) get the height the slot leaves
  // after the rest of the box (--pic-fit), up to start.css's design size, remeasured whenever the box or its
  // slot changes size. A builder's `.qscroll` part
  // (the match's tiles) gets at most the height left between the slot's top and the screen's bottom edge
  // (--scroll-fit): past that it scrolls inside the box, so Submit, under it, stays on screen.
  //
  // A phone's on-screen keyboard covers the bottom of the screen without resizing the page (iOS; Android Chrome
  // too, by default), and the browser pans what is visible to show the field. Browsers differ in how (iOS 26 is
  // not iOS 18), so no one model is assumed: a document scroll is undone (the stage is fixed and full-screen, so
  // the page never needs one), then the visible area (visualViewport) is measured against the question slot's
  // own layer, both in client coordinates, on every visualViewport event and every frame for a while after focus
  // moves or an answer box is touched. While an answer box has focus and the visible area is much shorter than
  // the screen, <html> gets "keyboard" (game.css): the slot becomes the visible area (--vv-top in the layer, --vv-h
  // tall) and the box rests on its bottom edge, so the timer, picture, question and field are all in view above
  // the keys.

  const KEYBOARD_MIN_PX = 120; // less than this covered is a browser bar coming and going, not a keyboard
  const KEYBOARD_WATCH_MS = 1500; // a keyboard slides in or out (and the browser pans) within this of a focus or tap
  const SCREEN_EDGE_PX = 8; // kept clear under a box that runs past its slot
  const root = document.documentElement;
  const questionSlot = document.querySelector(".q-slot");
  const questionGroup = document.querySelector(".qgroup"); // the timer and the box

  const pictureSets = [picture, el(".qreveal-pics"), el(".qexample-pics")];

  function fitBox() {
    const height = questionGroup.offsetHeight;
    if (height === 0) return;
    const shown = pictureSets.find((set) => set.getClientRects().length > 0);
    const images = shown ? Array.from(shown.querySelectorAll("img")) : [];
    if (images.length > 0) {
      const rest = height - Math.max(...images.map((img) => img.offsetHeight));
      form.style.setProperty("--pic-fit", `${Math.floor(questionSlot.clientHeight - rest)}px`);
    }
    const scroller = play.hidden ? null : play.querySelector(".qscroll");
    if (scroller) {
      const room = questionSlot.offsetParent.clientHeight - questionSlot.offsetTop - SCREEN_EDGE_PX;
      form.style.setProperty("--scroll-fit", `${Math.floor(room - (height - scroller.offsetHeight))}px`);
      markScrollEdges(scroller);
    }
  }

  // A scroll area with more above or below its view fades at that edge (game.css "more-above"/"more-below").
  function markScrollEdges(scroller) {
    const hidden = scroller.scrollHeight - scroller.clientHeight;
    scroller.classList.toggle("more-above", scroller.scrollTop > 1);
    scroller.classList.toggle("more-below", scroller.scrollTop < hidden - 1);
  }

  // Scroll events don't bubble, so the box listens in the capture phase.
  form.addEventListener(
    "scroll",
    (event) => {
      if (event.target.classList?.contains("qscroll")) markScrollEdges(event.target);
    },
    true,
  );

  // Refitted a frame later: resizing the box from inside its own observer would loop.
  const refit = new ResizeObserver(() => requestAnimationFrame(fitBox));
  refit.observe(form);
  refit.observe(questionSlot);

  // Pinch zoom also shrinks the visible area, so the keyboard is decided only at scale 1: a pinch with the keys up
  // holds them up (the box stays under the player's fingers), and a zoomed page keeps its scroll (that is the
  // player panning around). The screen's height is the larger of innerHeight and the layer's, as a browser may
  // shrink one of them with the keyboard. With focus elsewhere and nothing new from the viewport there is nothing
  // to measure, so a watch frame during a reveal's slide reads no layout.
  let placed = "";
  function followKeyboard(viewChanged) {
    const typing = Boolean(document.activeElement?.classList.contains("qfield"));
    if (!typing && !viewChanged && !root.classList.contains("keyboard")) return;
    const view = window.visualViewport;
    const unzoomed = Math.abs(view.scale - 1) < 0.01;
    if (unzoomed && (window.scrollY !== 0 || root.scrollTop !== 0)) window.scrollTo(0, 0);
    if (typing && !unzoomed) return;
    const layer = typing ? questionSlot.offsetParent : null;
    const screenHeight = Math.max(window.innerHeight, layer?.clientHeight ?? 0);
    const covered = Boolean(layer) && screenHeight - view.height > KEYBOARD_MIN_PX;
    root.classList.toggle("keyboard", covered);
    if (!covered) {
      placed = "";
      return;
    }
    const top = Math.round(view.offsetTop - layer.getBoundingClientRect().top);
    const place = `${top} ${Math.round(view.height)}`;
    if (place === placed) return;
    placed = place;
    root.style.setProperty("--vv-top", `${top}px`);
    root.style.setProperty("--vv-h", `${Math.round(view.height)}px`);
  }

  // Run once a frame at most: on viewport events, and every frame for a while after focus moves or an answer box
  // is touched (a box already focused by the game, Q1's or a resumed question's, gets no focusin when the tap
  // raises the keys, and a browser may send no resize either).
  let keyboardFrame = 0;
  let watchUntil = 0;
  let viewChanged = false;
  function nextKeyboardFrame() {
    if (keyboardFrame === 0) keyboardFrame = requestAnimationFrame(keyboardFrameTick);
  }
  function keyboardFrameTick() {
    keyboardFrame = 0;
    const changed = viewChanged;
    viewChanged = false;
    followKeyboard(changed);
    if (performance.now() < watchUntil) nextKeyboardFrame();
  }
  function viewportEvent() {
    viewChanged = true;
    nextKeyboardFrame();
  }
  function watchKeyboard() {
    watchUntil = performance.now() + KEYBOARD_WATCH_MS;
    nextKeyboardFrame();
  }
  function watchOnField(event) {
    if (event.target.classList?.contains("qfield")) watchKeyboard();
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", viewportEvent);
    window.visualViewport.addEventListener("scroll", viewportEvent);
    window.addEventListener("resize", viewportEvent);
    form.addEventListener("focusin", watchKeyboard);
    form.addEventListener("focusout", watchKeyboard);
    form.addEventListener("pointerdown", watchOnField);
    form.addEventListener("click", watchOnField);
  }

  // Screen readers announce a live region's change only if the region was already rendered when the text
  // changed, so callers show the region first and the text lands a frame later; a region hidden by then (the
  // player moved on within the frame) stays empty.
  const pendingText = new WeakMap(); // region -> its queued frame, so a newer message replaces an older one
  function announce(region, text) {
    cancelAnimationFrame(pendingText.get(region));
    region.textContent = "";
    const write = () => {
      if (region.getClientRects().length > 0) region.textContent = text;
    };
    pendingText.set(region, requestAnimationFrame(write));
  }

  // ---- Timer -------------------------------------------------------------------------------------------

  function totalSeconds(q) {
    return q.style === "multi" ? QUESTION_S + EXTRA_BOX_S * (q.parts.length - 1) : QUESTION_S;
  }

  const needleAngle = (seconds) => -225 + (270 * seconds) / QUESTION_S;

  // A clockwise arc along the dial's scale from s0 to s1 seconds at radius r (none when shorter than a hair, so a
  // round cap doesn't leave a dot).
  function scaleArc(s0, s1, r) {
    if (s1 - s0 <= 0.01) return "";
    const at = (seconds) => {
      const radians = (needleAngle(seconds) * Math.PI) / 180;
      return `${(80 + r * Math.cos(radians)).toFixed(2)},${(80 + r * Math.sin(radians)).toFixed(2)}`;
    };
    const large = (270 * (s1 - s0)) / QUESTION_S > 180 ? 1 : 0;
    return `M${at(s0)} A${r},${r} 0 ${large},1 ${at(s1)}`;
  }

  // `left` seconds on the clock: the time above 40 is the blue arc on the outer ring (drains first, the needle
  // waiting at 40 and the colour arc full), then the colour arc and the needle run down. The dial's data-time
  // (extra / go / warn / hot) sets the arc's and the number's colours (game.css); `urgent` on the group is the
  // pulse, at 5 s and under. The dial redraws only when the time shown changes (20 times a second), the number
  // and the aria-label once a second.
  let drawnSeconds = null; // the time last drawn: a frame with nothing new to show writes nothing
  const setIfChanged = (element, name, value) => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  };
  function drawTimer(left, { running }) {
    questionGroup.classList.toggle("urgent", running && left > 0 && left <= URGENT_S);
    // Rounded up to the next step, so every threshold (20, 10, a whole second) falls exactly where `left` does.
    const steps = reduceMotion.matches ? 1 : TIMER_STEPS_PER_S; // no sweep: steps once a second
    const shown = Math.max(0, Math.ceil(left * steps - 1e-9) / steps);
    if (shown === drawnSeconds) return;
    drawnSeconds = shown;
    const onScale = Math.min(QUESTION_S, shown);
    const extra = shown - onScale;
    setIfChanged(needle, "transform", `rotate(${needleAngle(onScale).toFixed(2)} 80 80)`);
    // At most the whole scale: more extra time than that (6+ boxes) shows a full ring until it drains below 40 s.
    setIfChanged(extraArc, "d", scaleArc(QUESTION_S - Math.min(extra, QUESTION_S), QUESTION_S, 71));
    setIfChanged(timeArc, "d", scaleArc(0, onScale, 60));
    const time = extra > 0 ? "extra" : onScale > WARN_S ? "go" : onScale > HOT_S ? "warn" : "hot";
    if (dial.dataset.time !== time) dial.dataset.time = time;
    const whole = String(Math.ceil(shown - 1e-9));
    if (timeNumber.textContent !== whole) {
      timeNumber.textContent = whole;
      dial.setAttribute("aria-label", `Timer: ${whole} seconds`);
    }
  }

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

  // ---- Answer boxes, one builder per style -------------------------------------------------------------
  // Each returns { first, check() -> { verdict, boxes }, fields, draft(), restore(draft), stop? }: `first` takes
  // focus when the question opens; `draft` is the answer in progress as saved (restore puts a saved one back,
  // ignoring one that doesn't fit the question); `stop` (match) ends a drag when the question ends under it.

  // The text boxes' draft: each box's text.
  function fieldsDraft(fields) {
    return {
      draft: () => fields.map((input) => input.value),
      restore: (draft) => {
        if (draft.length !== fields.length || !draft.every((v) => typeof v === "string")) return;
        fields.forEach((input, i) => (input.value = draft[i]));
        updateEnterHints(fields);
      },
    };
  }

  // Every answer box asks for no help from the browser or the phone's keyboard: a suggested word can give away the
  // answer (or the spelling). Hints only: iOS Safari honours autocorrect and writingsuggestions (its grey inline
  // completions, Safari 18+), but no attribute is known to empty the keyboard's QuickType bar for good.
  function field({ label, placeholder = "Type your answer" }) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "qfield";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "none");
    input.setAttribute("writingsuggestions", "false");
    return input;
  }

  function submitButton() {
    const button = document.createElement("button");
    button.className = "go";
    button.type = "submit";
    button.textContent = "Submit";
    return button;
  }

  // `joined` (crosswords) ignores spaces: OPEN ARMS = OPENARMS. Spelling takes exact matches only.
  const partOptions = (q) => ({ joined: q.joined === true, exact: q.style === "spell" });

  function buildTyped(q) {
    const input = field({ label: "Your answer" });
    input.enterKeyHint = "done";
    const row = document.createElement("div");
    row.className = "qrow";
    row.append(input, submitButton());
    play.append(row);
    const check = () => match.checkParts([input.value], q.parts, partOptions(q));
    return { first: input, fields: [input], check, ...fieldsDraft([input]) };
  }

  function buildSpell(q) {
    const speaker = document.createElement("button");
    speaker.type = "button";
    speaker.className = "qspeak";
    speaker.setAttribute("aria-label", "Hear the word");
    // A speaker drawn here rather than an emoji, so it looks the same on every phone.
    speaker.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>' +
      '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round"/></svg><span>Hear it</span>';
    speaker.addEventListener("click", () => say(q.say));
    const input = field({ label: "Spell the word", placeholder: "Type the spelling" });
    input.enterKeyHint = "done";
    const row = document.createElement("div");
    row.className = "qrow";
    row.append(input, submitButton());
    play.append(speaker, row);
    const check = () => match.checkParts([input.value], q.parts, partOptions(q));
    return { first: input, fields: [input], check, ...fieldsDraft([input]) };
  }

  // Stand-in voice for the mock: the recorded clips come later (tracker item 4).
  function say(word) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.lang = "en-US";
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    } catch {
      announce(feedback, "This browser can't play the word.");
    }
  }

  // Picture parts get a box under each picture, checked in order; text parts are a column of boxes in any order.
  function buildMulti(q) {
    const order = q.order ?? "fixed";
    const figuresShown = Array.from(picture.querySelectorAll("figure"));
    const underPictures = order === "fixed" && figuresShown.length === q.parts.length;
    const fields = q.parts.map((_, i) =>
      field({
        label: underPictures ? `Answer for picture ${i + 1}` : `Answer ${i + 1}`,
        placeholder: underPictures ? "Answer" : `Answer ${i + 1}`,
      }),
    );
    if (underPictures) fields.forEach((input, i) => figuresShown[i].append(input));
    else {
      const column = document.createElement("div");
      column.className = "qfields";
      column.append(...fields);
      play.append(column);
    }
    play.append(submitButton());
    updateEnterHints(fields);
    const check = () => match.checkParts(fields.map((f) => f.value), q.parts, { order, ...partOptions(q) });
    return { first: fields[0], fields, check, ...fieldsDraft(fields) };
  }

  // The phone key reads Next while another box is still empty, then Done.
  function updateEnterHints(fields) {
    for (const input of fields) {
      input.enterKeyHint = fields.every((other) => other === input || other.value.trim()) ? "done" : "next";
    }
  }

  function buildMatch(q) {
    const wrap = document.createElement("div");
    wrap.className = "qmatch qscroll"; // scrolls inside the box when the box would run off the screen
    // The list and each group are a heading button (the keyboard way to drop the chosen item there) over a slot.
    const zone = (className, name, label) => {
      const element = document.createElement("div");
      element.className = className;
      const heading = document.createElement("button");
      heading.type = "button";
      heading.className = "qmatch-name";
      heading.textContent = name;
      heading.setAttribute("aria-label", label);
      const slot = document.createElement("div");
      slot.className = "qmatch-slot";
      slot.setAttribute("role", "group");
      slot.setAttribute("aria-label", name);
      element.append(heading, slot);
      return element;
    };
    const tray = zone("qmatch-tray", "Not sorted", "Not sorted: put the chosen one back");
    // A group ends in one empty "Drop here" spot, which tiles land in front of: it grows a tile at a time, so it
    // never hints at how many belong in it. Only a picture of the target; the heading is the keyboard's way in.
    const groups = q.groups.map((name, g) => {
      const group = zone("qmatch-group", name, `Put the chosen one in ${name}`);
      group.dataset.group = String(g);
      const spot = document.createElement("div");
      spot.className = "qmatch-drop";
      spot.setAttribute("aria-hidden", "true");
      spot.textContent = "Drop here";
      group.querySelector(".qmatch-slot").append(spot);
      return group;
    });
    const items = q.items.map(({ text }, i) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "qmatch-item";
      item.dataset.item = String(i);
      item.textContent = text;
      item.setAttribute("aria-pressed", "false");
      return item;
    });
    tray.querySelector(".qmatch-slot").append(...items);
    const done = document.createElement("p"); // shown by CSS once the list is empty
    done.className = "qmatch-done";
    done.textContent = "All sorted — Submit when you’re ready";
    tray.append(done);
    const hint = document.createElement("p");
    hint.className = "qmatch-hint";
    hint.textContent = "Drag each one into a group, or tap it and then tap the group.";
    const groupRow = document.createElement("div");
    groupRow.className = "qmatch-groups";
    groupRow.append(...groups);
    wrap.append(hint, tray, groupRow);
    play.append(wrap, submitButton());

    let chosen = null;
    // The click a browser may send after a drag must not also choose the item or drop the chosen one. Cleared by
    // the next pointerdown, not a timer: Safari can deliver that click after a zero timeout. Keyboard clicks
    // (detail 0) always count.
    let dragged = false;
    const choose = (item) => {
      if (chosen) chosen.setAttribute("aria-pressed", "false");
      chosen = item === chosen ? null : item;
      if (chosen) chosen.setAttribute("aria-pressed", "true");
      wrap.classList.toggle("choosing", Boolean(chosen));
    };
    const zoneOf = (element) => element?.closest(".qmatch-group, .qmatch-tray");
    // A drop back into the tile's own zone leaves it where it was (appending would send it to the end). In a
    // group the tile goes in front of the empty spot (the tray has none: insertBefore null appends).
    const moveTo = (item, target) => {
      if (zoneOf(item) !== target) {
        const slot = target.querySelector(".qmatch-slot");
        slot.insertBefore(item, slot.querySelector(".qmatch-drop"));
        markScrollEdges(wrap);
        saveDraft();
      }
      if (chosen) choose(chosen);
    };
    const zones = [tray, ...groups];
    // Where a dragged tile lands follows what the player sees: the zone the ghost covers most, its whole frame
    // counted (padding and empty spot too) as far as it shows in the scroll area, the pointer's zone breaking a
    // tie. The pointer alone misleads: it sits wherever the tile was grabbed, so a tile shown inside a group can
    // have the pointer above it, in the gap or over the other group.
    const zoneUnder = (ghost, x, y) => {
      const g = ghost.getBoundingClientRect();
      const view = wrap.getBoundingClientRect();
      let best = null;
      let bestArea = 0;
      for (const zone of zones) {
        const rect = zone.getBoundingClientRect();
        const z = {
          left: rect.left,
          right: rect.right,
          top: Math.max(rect.top, view.top),
          bottom: Math.min(rect.bottom, view.bottom),
        };
        const width = Math.min(g.right, z.right) - Math.max(g.left, z.left);
        const height = Math.min(g.bottom, z.bottom) - Math.max(g.top, z.top);
        const area = width > 0 && height > 0 ? width * height : 0;
        const pointerIn = x >= z.left && x <= z.right && y >= z.top && y <= z.bottom;
        if (area > bestArea || (area > 0 && area === bestArea && pointerIn)) {
          best = zone;
          bestArea = area;
        }
      }
      return best;
    };

    // A tap on a tile chooses it (again: unchooses), unless another tile is chosen and this one sits in a
    // different zone: then the chosen one goes there. A keyboard Enter on a tile only ever chooses it; the
    // heading buttons are the keyboard's way to drop.
    wrap.addEventListener("click", (event) => {
      const tapped = event.detail > 0;
      if (dragged && tapped) return;
      const item = event.target.closest(".qmatch-item");
      const target = zoneOf(event.target);
      if (item && !(tapped && chosen && zoneOf(chosen) !== target)) {
        choose(item);
        return;
      }
      if (target && chosen) moveTo(chosen, target);
    });
    wrap.addEventListener("pointerdown", () => (dragged = false));

    // Pointer events cover mouse, pen and touch alike; the stage blocks touch scrolling. The item itself never
    // moves while dragged: a ghost copy follows the pointer and the item waits in place, faded, so nothing
    // reflows under the pointer. Moves and the release are followed on window, not only through pointer
    // capture, so a capture the browser drops mid-drag (it left the item stuck before) still ends the drag.
    let drag = null; // { item, pointerId, x, y, ghost?, over?, at? }; one drag at a time
    // The ghost goes where the pointer is, and the zone it would land in lights up: `over` is both the highlight
    // and the drop target, so what lights up is where it lands. The release moves it too, so a flick whose
    // only move arrives with the release still drops.
    const aim = () => {
      drag.over = zoneUnder(drag.ghost, ...drag.at);
      for (const zone of zones) zone.classList.toggle("over", zone === drag.over);
    };
    const moveGhost = (x, y) => {
      const dx = x - drag.x;
      const dy = y - drag.y;
      if (!drag.ghost) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        lift();
      }
      drag.ghost.style.transform = `translate(${dx}px, ${dy}px)`;
      drag.at = [x, y];
      aim();
      if (!scrolling) scrolling = requestAnimationFrame(autoScroll);
    };
    // A pointer held near (or past) the top or bottom edge of a scrolling tile area scrolls it, faster the
    // deeper it goes, while the ghost stays under the pointer and the lit zone follows; it stops at the end.
    let scrolling = 0;
    const autoScroll = () => {
      scrolling = 0;
      if (!drag?.ghost || wrap.scrollHeight <= wrap.clientHeight) return;
      const view = wrap.getBoundingClientRect();
      const y = drag.at[1];
      const depth = Math.max(view.top + SCROLL_EDGE_PX - y, 0) - Math.max(y - (view.bottom - SCROLL_EDGE_PX), 0);
      if (depth === 0) return;
      const before = wrap.scrollTop;
      wrap.scrollTop -= Math.sign(depth) * Math.min(SCROLL_MAX_PX, Math.ceil(Math.abs(depth) / 3));
      if (wrap.scrollTop === before) return; // at the end that way: the next move starts it again
      aim();
      scrolling = requestAnimationFrame(autoScroll);
    };
    const follow = (event) => {
      if (event.pointerId !== drag.pointerId) return;
      // A mouse released where no pointerup reached us (outside the window, a switched app): put it back.
      if (event.pointerType === "mouse" && event.buttons === 0) {
        endDrag({ drop: false });
        return;
      }
      moveGhost(event.clientX, event.clientY);
    };
    const release = (event) => {
      if (event.pointerId !== drag.pointerId) return;
      moveGhost(event.clientX, event.clientY);
      endDrag({ drop: true });
    };
    const cancel = () => endDrag({ drop: false });
    const cancelled = (event) => {
      if (event.pointerId === drag.pointerId) cancel();
    };
    const escape = (event) => {
      if (event.key === "Escape") cancel();
    };
    const leave = (event) => {
      if (event.target === window) cancel(); // the window lost focus, not just an element in it
    };
    const LISTENERS = [
      ["pointermove", follow],
      ["pointerup", release],
      ["pointercancel", cancelled],
      ["keydown", escape],
      ["blur", leave],
    ];

    // Past the start distance: the ghost appears on the page itself (not in the bobbing, transformed box, which
    // would carry a fixed element with it), exactly over the item.
    const lift = () => {
      const { item } = drag;
      const rect = item.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "qmatch-item qmatch-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.textContent = item.textContent;
      Object.assign(ghost.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      document.body.append(ghost);
      drag.ghost = ghost;
      item.classList.add("lifted");
      if (chosen) choose(chosen);
    };

    // Every way a drag ends comes here: the drop, pointercancel, Escape, a lost window, the question ending.
    const endDrag = ({ drop }) => {
      if (!drag) return;
      const { item, ghost, over } = drag;
      drag = null;
      cancelAnimationFrame(scrolling);
      scrolling = 0;
      for (const [type, listener] of LISTENERS) window.removeEventListener(type, listener, true);
      if (!ghost) return; // a tap: the click that follows chooses the item
      ghost.remove();
      item.classList.remove("lifted");
      for (const zone of zones) zone.classList.remove("over");
      dragged = true;
      if (drop && over) moveTo(item, over);
    };

    for (const item of items) {
      item.addEventListener("pointerdown", (event) => {
        if (drag || !event.isPrimary || event.button !== 0) return;
        const { pointerId, clientX: x, clientY: y } = event;
        drag = { item, pointerId, x, y };
        for (const [type, listener] of LISTENERS) window.addEventListener(type, listener, true);
        try {
          item.setPointerCapture(pointerId); // a mouse released outside the window still reports here
        } catch {
          // No capture (an unknown pointer): the window listeners still see the drag through.
        }
      });
    }

    const check = () => {
      const placed = items.map((item) => item.closest(".qmatch-group")?.dataset.group);
      const boxes = q.items.map(({ group }, i) => (placed[i] === String(group) ? "right" : "wrong"));
      return { verdict: boxes.every((b) => b === "right") ? "right" : "wrong", boxes };
    };
    // The match's draft: each item's group index, null while not sorted.
    const draft = () => items.map((item) => {
      const group = item.closest(".qmatch-group");
      return group ? Number(group.dataset.group) : null;
    });
    const restore = (saved) => {
      const fits = (g) => g === null || (Number.isInteger(g) && g >= 0 && g < groups.length);
      if (saved.length !== items.length || !saved.every(fits)) return;
      saved.forEach((g, i) => g !== null && moveTo(items[i], groups[g]));
    };
    return { first: items[0], fields: [], check, draft, restore, stop: cancel };
  }

  const BUILDERS = { typed: buildTyped, spell: buildSpell, multi: buildMulti, match: buildMatch };

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

  // A held Enter (key repeat) must not press the button that just took focus: Next after an answer, Got it
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
      Object.assign(state.current, { closeUsed: true, closeBoxes });
      save();
      showClose(closeBoxes);
      return;
    }
    finishQuestion({ verdict: result.verdict === "right" ? "right" : "wrong", timedOut: false, left });
  }

  // The retype in progress: the line, and the boxes that were close (after a reload, with their draft text).
  function showClose(closeBoxes) {
    announce(feedback, "Close! Check your spelling");
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
    focus(gotIt);
  }

  function renderExample(index) {
    const card = examples[day.questions[index].example];
    el(".qexample-title").textContent = card.title;
    el(".qexample-text").textContent = card.text;
    figures(el(".qexample-pics"), card.images);
    el(".qexample-answer").textContent = card.answer;
    el(".qexample-explain").textContent = card.explain;
    el(".qexample-note").textContent = `Not timed. Question ${index + 1} comes next, with the clock running.`;
    setView("example", `Example before question ${index + 1}`);
    fitBox();
  }

  // `startedAt` is the wall-clock start: now for a new question, the saved one for a resumed question, which
  // also brings back a "Close!" retype in progress (`closeBoxes`) and the answer in progress (`draft`).
  function startQuestion(index, startedAt, { closeBoxes = null, draft = null } = {}) {
    const q = day.questions[index];
    state.current = { index, phase: "question", startedAt, closeUsed: closeBoxes !== null };
    if (closeBoxes) state.current.closeBoxes = closeBoxes;
    if (draft) state.current.draft = draft;
    save();
    renderQuestion(index);
    if (draft) ui.restore(draft);
    if (closeBoxes) showClose(closeBoxes);
    // The first box still empty (all of them on a new question), or the last if a restored draft filled them all.
    else focus(ui.fields.find((input) => !input.value.trim()) ?? ui.fields.at(-1) ?? ui.first);
    // Browsers only speak after the player has touched the page; a resumed question waits for the button.
    if (q.style === "spell" && (navigator.userActivation?.hasBeenActive ?? true)) say(q.say);
    stopClock();
    tick();
  }

  function renderQuestion(index) {
    const q = day.questions[index];
    box.show({ number: index + 1, text: q.text, images: q.images ?? [] });
    play.replaceChildren();
    play.dataset.style = q.style;
    announce(feedback, "");
    setView("question");
    ui = BUILDERS[q.style](q);
    drawTimer(totalSeconds(q), { running: false });
    fitBox();
  }

  function finishQuestion(answer) {
    stopClock();
    ui?.stop?.();
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
    let verdict;
    if (answer.verdict === "right") {
      verdict = crashedBefore ? "✓ Right! (No climbing after a crash.)" : `✓ Right! Up to ${metres(HEIGHTS[score])}`;
    } else {
      verdict = `✗ ${answer.timedOut ? "Time’s up" : "Not quite"}`;
      if (!crashedBefore) verdict += ". Crash! Your balloons popped.";
    }
    box.show({ number: index + 1, text: q.text });
    verdictLine.dataset.verdict = answer.verdict;
    el(".qright-text").textContent = q.answer;
    figures(el(".qreveal-pics"), q.reveal);
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

  const dateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

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

  // Once per day label, so a reload of a finished day doesn't count it twice. Streak = days in a row played.
  function recordStats() {
    const stats = readStats();
    if (stats.days.includes(day.label)) return;
    const { score } = progress(state.answers);
    const now = new Date();
    const today = dateKey(now);
    const yesterday = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    stats.played += 1;
    stats.climbTotal += score;
    stats.best = Math.max(stats.best, HEIGHTS[score]);
    if (stats.lastDate !== today) stats.streak = stats.lastDate === yesterday ? stats.streak + 1 : 1;
    stats.lastDate = today;
    stats.days.push(day.label);
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
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    nextGame.replaceChildren("Next game in ", countdownValue);
    clearInterval(countdown);
    updateCountdown(midnight);
    countdown = setInterval(() => updateCountdown(midnight), 1000);
  }

  // Counts down to the local midnight after the end screen opened; past it, today's game is a new one.
  function updateCountdown(midnight) {
    const total = Math.floor((midnight - Date.now()) / 1000);
    if (total < 0) {
      clearInterval(countdown);
      nextGame.textContent = "A new game is ready — reload to play";
      return;
    }
    const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
    countdownValue.textContent = parts.map((n) => String(n).padStart(2, "0")).join(":");
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
  gotIt.addEventListener("click", () => {
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
    const { index, phase, startedAt, closeUsed, closeBoxes, draft } = state.current;
    if (phase === "done") showEnd();
    else if (phase === "reveal") showReveal(index);
    else if (phase === "example") showExample(index);
    // A clock already out checks the restored draft at once, on its first tick.
    else startQuestion(index, startedAt, { closeBoxes: closeUsed ? (closeBoxes ?? []) : null, draft });
  }

  // The day file is outside input: check the shape the game relies on before playing it.
  function checkDay(data, cards) {
    const ok =
      typeof data?.label === "string" &&
      Array.isArray(data.questions) &&
      data.questions.length > 0 &&
      data.questions.every(
        (q) =>
          STYLES.has(q.style) &&
          Number.isInteger(q.level) &&
          typeof q.text === "string" &&
          typeof q.answer === "string" &&
          (q.example === undefined || cards[q.example]) &&
          (q.style !== "spell" || typeof q.say === "string") &&
          (q.joined === undefined || typeof q.joined === "boolean") &&
          (q.style === "match"
            ? Array.isArray(q.groups) && Array.isArray(q.items) && q.items.length > 0
            : Array.isArray(q.parts) && q.parts.length > 0 && q.parts.every((p) => Array.isArray(p.accept))),
      );
    if (!ok) throw new Error(`${DAY_URL} is not a playable day`);
  }

  async function load() {
    const [dayResponse, examplesResponse] = await Promise.all([fetch(DAY_URL), fetch(EXAMPLES_URL)]);
    if (!dayResponse.ok || !examplesResponse.ok) throw new Error("the day or its examples did not load");
    const [data, cards] = await Promise.all([dayResponse.json(), examplesResponse.json()]);
    checkDay(data, cards);
    return { data, cards };
  }

  // The box floats up on LIFTOFF; the first question (or its example) starts once it has landed.
  window.addEventListener("cirrusly:landed", () => {
    if (day && !state.current) enter(0);
  });

  liftoff.disabled = true;
  load()
    .then(({ data, cards }) => {
      day = data;
      examples = cards;
      storageKey = `cirrusly:game:${day.label}`;
      // Fetch every picture of the day up front, so each question opens with its pictures already in place.
      for (const q of day.questions) {
        for (const { src } of [...(q.images ?? []), ...(q.reveal ?? [])]) new Image().src = src;
      }
      state = loadState();
      if (state.current) {
        resume();
        return;
      }
      // Drawn before the float, so the box rises already showing question 1 (or its example) with the clock
      // full; nothing is saved and the clock doesn't start until it lands.
      if (day.questions[0].example) renderExample(0);
      else renderQuestion(0);
      liftoff.disabled = false;
    })
    .catch((error) => {
      rulesLine.textContent = "Today’s game didn’t load. Try reloading the page.";
      console.error(error);
    });
})();
