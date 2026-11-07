// Writing into the question box: a question's text (a crossword's letter pattern kept whole), text read out
// only, and live-region messages. Part of the game (game.js).

(() => {
  // A crossword's letter pattern at the end of its text ("B _ R T H _ A _ C A _ E": single letters and blanks, one
  // blank at least) goes in its own span (game.css .qpattern), so it wraps whole onto a line of its own if need be
  // and is never split between its letters. It starts at a word's start ("am a _ _" spans "a _ _"); no lookbehind,
  // which older iPhones can't parse.
  const LETTER_PATTERN = /^(|.*?\s)((?:[A-Za-z_] )+[A-Za-z_])$/s;
  function writeText(element, text) {
    const found = LETTER_PATTERN.exec(text);
    if (!found || !found[2].includes("_")) {
      element.textContent = text;
      return;
    }
    const pattern = document.createElement("span");
    pattern.className = "qpattern";
    pattern.textContent = found[2];
    element.replaceChildren(found[1], pattern);
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

  // Read out, not shown (start.css .sr-only).
  function hiddenText(text) {
    const span = document.createElement("span");
    span.className = "sr-only";
    span.textContent = text;
    return span;
  }

  window.cirrusly.game = { ...window.cirrusly.game, writeText, hiddenText, announce };
})();
