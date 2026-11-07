// 7 for 7: a few fireworks bursts over the sky once the last right answer has climbed to 10,000 m (Jack's pick C,
// 2026-10-18). A canvas over the scenery and under the question box (index.html .fireworks), drawn only while it
// runs; none with reduced motion (the end screen's golden row is still there). While it runs, <html> has
// "fireworks-on", which drops the question box's backdrop blur as a slide does (start.css): re-blurring the sky
// behind the box every frame would cost the bursts their frames. Part of the game (game.js).

(() => {
  const root = document.documentElement;
  const canvas = document.querySelector(".fireworks");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const COLOURS = ["#ffd166", "#ff6b6b", "#4dd4ff", "#b48cff", "#7cf29a", "#ffffff"];
  const BURSTS = 7; // one per right answer
  const SPARKS = 60; // per burst
  const GAP_MS = 400; // between bursts
  const LIFE_MS = 1600; // a spark's life
  const DRAG = 2.4; // per second: sparks slow as they spread
  const GRAVITY = 0.12; // in screen sides per second squared
  const TRAIL_S = 0.07; // each spark is drawn as a streak from where it was this long ago

  let frame = 0;

  // Where a spark is `age` seconds after its burst: thrown out, slowing, then falling.
  function placeOf(spark, age, side) {
    const spread = (1 - Math.exp(-DRAG * age)) / DRAG;
    return [spark.x + spark.vx * spread, spark.y + spark.vy * spread + 0.5 * GRAVITY * side * age * age];
  }

  // Starts once the climb has arrived (world.js drops "sliding"), so the bursts open over the 10,000 m sky.
  function fireworks() {
    if (reduceMotion.matches) return;
    cancelAnimationFrame(frame);
    const { width, height } = canvas.parentElement.getBoundingClientRect(); // the stage
    const side = Math.min(width, height);
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const sparks = [];
    for (let b = 0; b < BURSTS; b += 1) {
      const x = width * (0.12 + 0.76 * Math.random());
      const y = height * (0.1 + 0.32 * Math.random());
      for (let i = 0; i < SPARKS; i += 1) {
        const angle = (2 * Math.PI * (i + Math.random() * 0.5)) / SPARKS;
        const speed = side * (0.45 + 0.25 * Math.random()); // per second
        const colour = COLOURS[(b + (i % 3 === 0 ? 1 : 0)) % COLOURS.length];
        sparks.push({ at: b * GAP_MS, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, colour });
      }
    }
    const length = (BURSTS - 1) * GAP_MS + LIFE_MS;
    let start = null;
    canvas.hidden = false;
    const draw = (now) => {
      if (start === null && root.classList.contains("sliding")) {
        frame = requestAnimationFrame(draw);
        return;
      }
      if (start === null) {
        start = now;
        root.classList.add("fireworks-on");
      }
      const t = now - start;
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineWidth = Math.max(2, side * 0.006);
      context.globalCompositeOperation = "lighter"; // overlapping sparks brighten, as light does
      for (const spark of sparks) {
        const age = (t - spark.at) / 1000;
        if (age < 0 || age * 1000 > LIFE_MS) continue;
        const [x, y] = placeOf(spark, age, side);
        const [tailX, tailY] = placeOf(spark, Math.max(0, age - TRAIL_S), side);
        context.globalAlpha = 1 - (age * 1000) / LIFE_MS;
        context.strokeStyle = spark.colour;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(x + 0.01, y);
        context.stroke();
      }
      if (t < length) {
        frame = requestAnimationFrame(draw);
        return;
      }
      context.clearRect(0, 0, width, height);
      canvas.hidden = true;
      root.classList.remove("fireworks-on");
    };
    frame = requestAnimationFrame(draw);
  }

  window.cirrusly.game = { ...window.cirrusly.game, fireworks };
})();
