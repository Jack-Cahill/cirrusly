// Step 1's start screen, How to play card and question box (markup in index.html, looks in start.css).
// There is no game logic yet; this file only moves between the two screens and exposes a small API:
//
//   Start     title block + LIFTOFF in the sky, the How to play stone in the dirt. The stone opens a
//             sky-glass card that floats down on two balloon bunches while the title block fades back; the
//             card's ✕, Escape or the stone again closes it and focus goes back to the stone.
//   Question  LIFTOFF floats the title block (and the stone) away and the question box, with the timer on
//             its left, floats up into the
//             sky, focus in the answer field once it lands. There is no way back to the start screen.
//             Submit / Enter do nothing yet. The question box then rides with the camera, so it stays on
//             screen, in the middle, while the steps slide past (the dev arrows move you, not it).
//
//   window.cirrusly.question.show({ number, text, image })   image is optional: { src, alt }
//   window.cirrusly.question.setBalloons(k)                  k correct answers -> k balloons per top corner
//
// Loads after world.js, which creates window.cirrusly.

(() => {
  const root = document.documentElement;
  const startLayer = document.querySelector(".start");
  const startUi = document.querySelector(".start-ui");
  const liftoff = document.querySelector(".liftoff");
  const stone = document.querySelector(".how-stone");
  const card = document.querySelector(".how-card");
  const closeCard = card.querySelector(".how-close");
  const group = document.querySelector(".qgroup"); // the timer and the question box, which float up together
  const box = group.querySelector(".qbox");
  const numberLabel = box.querySelector(".qnum-value");
  const questionText = box.querySelector(".qtext");
  const picture = box.querySelector(".qpic");
  const pictureImg = picture.querySelector("img");
  const answer = box.querySelector("input");

  const QUESTION_COUNT = 7;
  const HOW_TO_PLAY_BALLOONS = 2;
  const FLOAT_BACKSTOP_MS = 3000; // longer than the float-up (0.45 s delay + 1.5 s in start.css)

  // ---- Balloon bunches -------------------------------------------------------------------------------

  const COLOURS = [
    ["#ff8a7a", "#e0473b"],
    ["#ffe27a", "#f0a91e"],
    ["#8fd0ff", "#2f86d6"],
    ["#b9f28c", "#4caf50"],
    ["#d4a8ff", "#7b61d9"],
    ["#ffb4d9", "#e0508f"],
  ];
  // Where the strings meet, in the bunch's 160 x 150 viewBox; start.css puts this point on the card's edge.
  const TIE = { x: 80, y: 146 };
  // Balloon centres packed like grapes above the knot, in balloon widths / heights from the bunch centre,
  // in the order they are added.
  const CLUSTER = [
    [0, 0],
    [-0.85, 0.3],
    [0.85, 0.28],
    [-0.42, -0.5],
    [0.44, -0.52],
    [0, 0.62],
  ];
  const BALLOON_SCALE = 1.35;
  const BALLOON_W = 26 * BALLOON_SCALE;
  const BALLOON_H = 33 * BALLOON_SCALE;
  let gradientId = 0;

  // One balloon drawn with its knot at (0, 0), so it can be tipped about the knot.
  function balloonMarkup([light, dark], isNew) {
    gradientId += 1;
    const id = `balloon-${gradientId}`;
    return (
      `<defs><radialGradient id="${id}" cx="0.35" cy="0.3" r="0.85"><stop offset="0" stop-color="${light}"/>` +
      `<stop offset="1" stop-color="${dark}"/></radialGradient></defs>` +
      `<g${isNew ? ' class="bal-new"' : ""}>` +
      `<path d="M0,-33 C9,-33 13,-26 13,-19 C13,-10 6,-4 1,-2.5 L-1,-2.5` +
      ` C-6,-4 -13,-10 -13,-19 C-13,-26 -9,-33 0,-33 Z" fill="url(#${id})"/>` +
      `<path d="M-2,0 L2,0 L1,-2.8 L-1,-2.8 Z" fill="${dark}"/>` +
      `<ellipse cx="-5" cy="-25" rx="3.4" ry="2" fill="#fff" opacity="0.6" transform="rotate(-30 -5 -25)"/></g>`
    );
  }

  // n overlapping balloons leaning out from the card, each tipped toward the knot, strings converging on it.
  // Lower balloons draw in front of higher ones. `newest` (an index into CLUSTER, or -1) pops in.
  function bunchSvg(n, side, newest) {
    const lean = side === "left" ? -10 : 10;
    const centreX = TIE.x + lean;
    const centreY = TIE.y - 50 - BALLOON_H / 2;
    const balloons = CLUSTER.slice(0, n)
      .map(([dx, dy], i) => ({ i, x: centreX + dx * BALLOON_W * 0.78, y: centreY + dy * BALLOON_H * 0.62 }))
      .sort((a, b) => a.y - b.y);
    const strings = balloons.map(({ x, y }) => {
      const knotY = y + BALLOON_H / 2;
      const midX = (x + TIE.x) / 2 + (x < TIE.x ? 2 : -2);
      const midY = (knotY + TIE.y) / 2;
      return (
        `<path d="M${x.toFixed(1)},${knotY.toFixed(1)} Q${midX.toFixed(1)},${midY.toFixed(1)} ${TIE.x},${TIE.y}"` +
        ` stroke="#6b6f86" stroke-width="0.9" fill="none"/>`
      );
    });
    const bodies = balloons.map(({ i, x, y }) => {
      const tip = ((Math.atan2(TIE.y - y, TIE.x - x) * 180) / Math.PI - 90) * 0.55;
      const colour = COLOURS[(side === "left" ? i * 2 + 1 : i * 2) % COLOURS.length];
      return (
        `<g transform="translate(${x.toFixed(1)},${(y + BALLOON_H / 2).toFixed(1)}) rotate(${tip.toFixed(1)})` +
        ` scale(${BALLOON_SCALE})">${balloonMarkup(colour, i === newest)}</g>`
      );
    });
    return (
      `<svg viewBox="0 0 160 150" aria-hidden="true">${strings.join("")}${bodies.join("")}` +
      `<circle cx="${TIE.x}" cy="${TIE.y}" r="1.8" fill="#6b6f86"/></svg>`
    );
  }

  function drawBunches(container, count, newest) {
    for (const anchor of container.querySelectorAll(".bunch-anchor")) {
      anchor.innerHTML = count > 0 ? bunchSvg(count, anchor.dataset.side, newest) : "";
    }
  }

  let balloonCount = 0;

  /** k correct answers so far -> k balloons in each top corner of the question box (0 to 6). */
  function setBalloons(k) {
    const count = Math.min(CLUSTER.length, Math.max(0, Math.round(Number(k)) || 0));
    // Only a single new balloon pops in; a jump (or a redraw) just shows the bunch.
    drawBunches(box, count, count === balloonCount + 1 ? count - 1 : -1);
    balloonCount = count;
  }

  // ---- Question box --------------------------------------------------------------------------------

  /**
   * Put up question `number` (clamped to 1-7) with its text and an optional picture ({ src, alt }). A
   * picture that fails to load is hidden rather than shown as a broken image.
   */
  function show({ number = 1, text = "", image = null } = {}) {
    const n = Math.min(QUESTION_COUNT, Math.max(1, Math.round(Number(number)) || 1));
    numberLabel.textContent = String(n);
    box.setAttribute("aria-label", `Question ${n} of ${QUESTION_COUNT}`);
    questionText.textContent = text == null ? "" : String(text);
    const src = typeof image?.src === "string" ? image.src : "";
    if (src) {
      pictureImg.alt = typeof image.alt === "string" ? image.alt : "";
      pictureImg.src = src;
    } else {
      pictureImg.removeAttribute("src");
      pictureImg.alt = "";
    }
    picture.hidden = !src;
    answer.value = "";
  }

  // Checks the image's own state, so a late error from a picture already replaced can't hide the new one.
  pictureImg.addEventListener("error", () => {
    if (pictureImg.complete && pictureImg.naturalWidth === 0) picture.hidden = true;
  });

  // No answers are checked yet: Submit and Enter must not reload the page.
  box.addEventListener("submit", (event) => event.preventDefault());

  // ---- How to play card ----------------------------------------------------------------------------

  function openCard() {
    card.hidden = false;
    root.classList.add("how-open");
    startUi.inert = true;
    stone.setAttribute("aria-expanded", "true");
    // The card is inside the overflow-hidden stage; scrolling to it would shift the whole world.
    closeCard.focus({ preventScroll: true });
  }

  function hideCard() {
    if (card.hidden) return;
    card.hidden = true;
    root.classList.remove("how-open");
    startUi.inert = false;
    stone.setAttribute("aria-expanded", "false");
    stone.focus({ preventScroll: true });
  }

  stone.addEventListener("click", () => (card.hidden ? openCard() : hideCard()));
  closeCard.addEventListener("click", hideCard);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideCard();
  });

  // ---- LIFTOFF -------------------------------------------------------------------------------------

  // The group is off screen until it has floated up, so it stays inert (Tab can't reach it) and takes focus
  // only once it lands; with reduced motion there is no float and it lands at once. Landing happens once.
  let landed = false;
  function land() {
    if (landed) return;
    landed = true;
    group.inert = false;
    answer.focus({ preventScroll: true });
  }

  // Only reachable with the card closed: the title block is inert while the card is open.
  liftoff.addEventListener("click", () => {
    root.classList.add("lifted-off");
    // Leave step 1's scenery: from here world.js keeps this layer on screen whichever step is showing.
    startLayer.removeAttribute("data-step");
    startUi.inert = true;
    stone.inert = true;
    group.hidden = false;
    if (!getComputedStyle(group).animationName.includes("floatup")) {
      land();
      return;
    }
    group.inert = true;
    // Land when the float ends, or if it is cancelled (e.g. reduced motion switched on mid-float); the
    // timeout is a backstop so the group can never stay inert.
    const onFloatDone = (event) => {
      if (event.animationName === "floatup") land();
    };
    group.addEventListener("animationend", onFloatDone);
    group.addEventListener("animationcancel", onFloatDone);
    setTimeout(land, FLOAT_BACKSTOP_MS);
  });

  drawBunches(card, HOW_TO_PLAY_BALLOONS, -1);
  window.cirrusly.question = { show, setBalloons };
})();
