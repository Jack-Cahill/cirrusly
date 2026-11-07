// Fitting the question box to the screen, and to a phone's keyboard. Part of the game (game.js).

(() => {
  const form = document.querySelector(".qbox");
  const el = (selector) => form.querySelector(selector);
  const goal = el(".qgoal"); // question 1's reminder of the goal
  const picture = el(".qpic");

  // ---- Fitting the box to the screen -------------------------------------------------------------------
  // The pictures on show (the question's, the reveal's or the example card's) get the height the slot leaves
  // after the rest of the box (--pic-fit), up to start.css's design size, remeasured whenever the box or its
  // slot changes size. The `.qscroll` part on show
  // (the match's tiles, or a match reveal's sort) gets at most the height left between the slot's top and the
  // screen's bottom edge (--scroll-fit): past that it scrolls inside the box, so Submit or Next, under it, stays on
  // screen.
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
      // Unrounded heights (the group only ever moves by translateY, which leaves them be): with rounded ones the fit
      // could come out a pixel off, and the refit a frame later moved the box by that pixel.
      const tallest = Math.max(...images.map((img) => img.getBoundingClientRect().height));
      const rest = questionGroup.getBoundingClientRect().height - tallest;
      form.style.setProperty("--pic-fit", `${Math.floor(questionSlot.clientHeight - rest)}px`);
    }
    const scroller = Array.from(form.querySelectorAll(".qscroll")).find((part) => part.getClientRects().length > 0);
    if (scroller) {
      const room = questionSlot.offsetParent.clientHeight - questionSlot.offsetTop - SCREEN_EDGE_PX;
      form.style.setProperty("--scroll-fit", `${Math.floor(room - (height - scroller.offsetHeight))}px`);
      markScrollEdges(scroller);
    }
    // Question 1's reminder gives way when, with the pictures and the scroll area already at their smallest, the
    // box would still run off the screen: Submit comes first. One way only (it stays hidden for that question), so
    // the refit this causes settles.
    if (!goal.hidden && !root.classList.contains("keyboard") && goal.getClientRects().length > 0) {
      const bottom = questionSlot.offsetTop + questionGroup.offsetTop + questionGroup.offsetHeight;
      if (bottom > questionSlot.offsetParent.clientHeight - SCREEN_EDGE_PX) {
        goal.hidden = true;
        fitBox();
      }
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

  window.cirrusly.game = { ...window.cirrusly.game, fitBox, markScrollEdges };
})();
