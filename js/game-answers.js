// The answer boxes for typed, spelling and multi-part questions, and the spelling word said out loud. Part
// of the game (game.js).

(() => {
  const { announce } = window.cirrusly.game; // game-text.js
  const { boxCount } = window.cirrusly.game; // game-dial.js
  const { match } = window.cirrusly;
  const form = document.querySelector(".qbox");
  const el = (selector) => form.querySelector(selector);
  const picture = el(".qpic");
  const play = el(".qplay");
  const feedback = el(".qfeedback");

  // ---- Answer boxes, one builder per style -------------------------------------------------------------
  // Each is called with the question and { saveDraft } (match and order call it after every move; the text boxes
  // are saved by game.js on input) and returns
  // { first, check() -> { verdict, boxes, hints }, fields, draft(), restore(draft), stop? }: `first` takes focus
  // when the question opens; `draft` is the answer in progress as saved (restore puts a saved one back, ignoring one
  // that doesn't fit the question); `stop` (match, order) ends a drag when the question ends under it.

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

  // `joined` (crosswords) ignores spaces (OPEN ARMS = OPENARMS) but takes no typo. Spelling takes exact matches only.
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
    speaker.addEventListener("click", () => sayWord(q));
    const input = field({ label: "Spell the word", placeholder: "Type the spelling" });
    input.enterKeyHint = "done";
    const row = document.createElement("div");
    row.className = "qrow";
    row.append(input, submitButton());
    play.append(speaker, row);
    const check = () => match.checkParts([input.value], q.parts, partOptions(q));
    return { first: input, fields: [input], check, ...fieldsDraft([input]) };
  }

  // The word out loud: the question's recorded clip (`audio`), or the browser's speech when it has none or the clip
  // fails to load or play. A replay starts the clip again rather than playing two at once.
  let clip = null;
  function sayWord(q) {
    hush();
    if (!q.audio) {
      speak(q.say);
      return;
    }
    const audio = new Audio(q.audio);
    clip = audio;
    let fellBack = false;
    const fallBack = () => {
      if (fellBack || clip !== audio) return;
      fellBack = true;
      speak(q.say);
    };
    audio.addEventListener("error", fallBack);
    audio.play().catch(fallBack);
  }

  // Stops the word (the clip or the speech) when its question ends, so it never plays over the reveal; a clip that
  // fails after this no longer falls back to speech.
  function hush() {
    clip?.pause();
    clip = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // No speech to stop.
    }
  }

  function speak(word) {
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

  // Picture parts get a box under each picture, checked in order; labelled parts (an "each of these" list) a column
  // of boxes in order, each beside the item the question names; other text parts a column of boxes in any order.
  function buildMulti(q) {
    const order = q.order ?? "fixed";
    const labels = q.parts.every((part) => typeof part.label === "string") ? q.parts.map((part) => part.label) : null;
    const figuresShown = Array.from(picture.querySelectorAll("figure"));
    const underPictures = !labels && order === "fixed" && figuresShown.length === q.parts.length;
    const fields = Array.from({ length: boxCount(q) }, (_, i) => {
      if (labels) return field({ label: `Answer for ${labels[i]}`, placeholder: "Answer" });
      return field({
        label: underPictures ? `Answer for picture ${i + 1}` : `Answer ${i + 1}`,
        placeholder: underPictures ? "Answer" : `Answer ${i + 1}`,
      });
    });
    if (underPictures) fields.forEach((input, i) => figuresShown[i].append(input));
    else {
      const column = document.createElement("div");
      column.className = labels ? "qfields qlabels" : "qfields";
      column.append(...(labels ? fields.map((input, i) => labelled(labels[i], input)) : fields));
      play.append(column);
    }
    play.append(submitButton());
    updateEnterHints(fields);
    const check = () =>
      match.checkParts(fields.map((f) => f.value), q.parts, { order, boxes: fields.length, ...partOptions(q) });
    return { first: fields[0], fields, check, ...fieldsDraft(fields) };
  }

  // A box with the item it answers written beside it.
  function labelled(text, input) {
    const wrap = document.createElement("label");
    wrap.className = "qlabelled";
    const name = document.createElement("span");
    name.className = "qlabel";
    name.textContent = text;
    wrap.append(name, input);
    return wrap;
  }

  // The phone key reads Next while another box is still empty, then Done.
  function updateEnterHints(fields) {
    for (const input of fields) {
      input.enterKeyHint = fields.every((other) => other === input || other.value.trim()) ? "done" : "next";
    }
  }

  window.cirrusly.game = {
    ...window.cirrusly.game,
    buildTyped, buildSpell, buildMulti, submitButton, updateEnterHints, sayWord, hush,
  };
})();
