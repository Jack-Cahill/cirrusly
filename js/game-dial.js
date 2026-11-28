// The timer's dial: a question's time and drawing the time left. Part of the game (game.js).

(() => {
  const questionGroup = document.querySelector(".qgroup"); // the timer and the box

  const QUESTION_S = 40;
  const EXTRA_BOX_S = 10;
  const URGENT_S = 5;
  const TIMER_STEPS_PER_S = 20; // the dial redraws 20 times a second: a step of the arc is under a pixel
  const WARN_S = 20; // the colour arc is green above this, amber at it and under, red at 10 and under (HOT_S)
  const HOT_S = 10;

  const timer = document.querySelector(".timer");
  const dial = timer.querySelector(".dial");
  const needle = dial.querySelector(".dial-needle");
  const extraArc = dial.querySelector(".dial-extra");
  const timeArc = dial.querySelector(".dial-arc");
  const timeNumber = dial.querySelector(".dial-num");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // A multi question's answer boxes: one per part, or `boxes` of them for an "N of M" pool.
  const boxCount = (q) => q.boxes ?? q.parts.length;

  function totalSeconds(q) {
    return q.style === "multi" ? QUESTION_S + EXTRA_BOX_S * (boxCount(q) - 1) : QUESTION_S;
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

  window.cirrusly.game = { ...window.cirrusly.game, drawTimer, totalSeconds, boxCount };
})();
