// The world is a vertical column: dirt below 0 m, grass at 0 m, sky upward past 10,000 m. The page never
// scrolls. It moves like an elevator: the steps in steps.js are stacked STEP_GAPS screen heights apart
// (close together near the ground, far apart up high), and `offset` is where we are in that stack, in
// screen heights from step 1.
//
// Two things follow `offset`, and nothing is a tall pre-built layer; every frame redraws:
//   Scenery  each step's sprites (and, for step 1, the ground) are laid out as they look at rest, at fixed
//            on-screen sizes, then shifted down by (offset - that step's stack offset) screen heights.
//            Leaving a step slides its pictures out of the bottom at full size; the next step's arrive
//            from the top after however much open sky its gap holds. Any element marked data-step="n"
//            (the start screen, say) is scenery too: it moves as one piece with step n's sprites.
//   Gauges   a true camera `{centre, span}` between the two nearest steps: `centre` is the altitude at
//            mid-screen and `span` the meters of world in one screen height (the zoom; never shown). The
//            sky gradient, the ruler and the readout use it, so the numbers climb through every real
//            altitude in between. Screen y of altitude a is  H/2 - (a - centre) * H / span.
//
// goToStep() slides `offset` to a step. The URL hash is the step number (cirrusly.fun/#4), so a reload
// returns to the same step.

const RULER_WIDTH_PX = 72;
const SPRITE_GUTTER_LEFT_PX = RULER_WIDTH_PX + 8;
const SPRITE_GUTTER_RIGHT_PX = 64; // room for the right-hand controls
const MIN_SPRITE_PX = 2;
const GRASS_BLADES_PX = 30; // how far the grass blades stand above 0 m (matches world.css)
const MIN_LABEL_GAP_PX = 90;
const MIN_TICK_GAP_PX = 6;
const LABEL_EDGE_PX = 7;

// Sky colour by altitude: pale haze at the ground, darkening fast above 2,000 m to near night-navy by 10,000 m.
const SKY_STOPS = [
  [0, "#dff1fb"],
  [500, "#bfe3f8"],
  [2000, "#8cc8ef"],
  [5000, "#3f84c8"],
  [8000, "#163e78"],
  [10000, "#0a2250"],
  [13000, "#051538"],
  [20000, "#020a20"],
].map(([altitude, hex]) => ({ altitude, rgb: [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) }));

const root = document.documentElement;
const stage = document.querySelector(".stage");
const sky = document.querySelector(".sky");
const ground = document.querySelector(".ground");
const spriteLayer = document.querySelector(".sprites");
const ruler = document.querySelector(".ruler");
const rulerContext = ruler.getContext("2d");
const readout = document.querySelector(".readout-value");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const rulerInk = getComputedStyle(root).getPropertyValue("--ruler-ink").trim();
const rulerFont = `11px ${getComputedStyle(document.body).fontFamily}`;

if (STEP_GAPS.length !== STEPS.length - 1 || Array.from(STEP_GAPS).some((g) => typeof g !== "number" || !(g >= 1))) {
  // A gap under one screen would leave a neighbouring step's sprites on screen at rest.
  throw new Error("steps.js: STEP_GAPS needs one entry fewer than STEPS, each at least 1");
}
// Stack offset of each step, in screen heights from step 1.
const STACK = STEPS.map((_, i) => STEP_GAPS.slice(0, i).reduce((sum, gap) => sum + gap, 0));

let offset = 0;
let camera = cameraAt(positionAt(offset));
let stepIndex = 0;
let animation = 0;

// Step-anchored layers: full-screen elements laid out as they look with step n at rest.
const stepLayers = Array.from(document.querySelectorAll("[data-step]"), (element) => {
  const index = Number(element.dataset.step) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= STEPS.length) {
    throw new Error(`data-step="${element.dataset.step}" is not a step number from 1 to ${STEPS.length}`);
  }
  return { element, index };
});

const sprites = STEPS.flatMap((step, index) =>
  step.sprites.map((placement) => {
    const img = new Image();
    img.className = "sprite";
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    img.hidden = true;
    // Art with lettering has its own left-facing file, so the text still reads; everything else is mirrored.
    const name = `${placement.subject}-${placement.variant}`;
    const leftArt = Boolean(placement.flip) && LEFT_ART.has(name);
    img.src = `img/sprites/${name}${leftArt ? "-left" : ""}.svg`;
    const sprite = { img, placement, step: index, aspect: 1, mirror: Boolean(placement.flip) && !leftArt };
    img.addEventListener("load", () => {
      if (img.naturalHeight > 0) sprite.aspect = img.naturalWidth / img.naturalHeight;
      render();
    });
    spriteLayer.append(img);
    return sprite;
  }),
);

function screenY(altitude, height) {
  return height / 2 - ((altitude - camera.centre) * height) / camera.span;
}

// Where `altitude` sits on screen when step `index` is at rest, pushed down by the slide.
function sceneryY(altitude, index, height) {
  const step = STEPS[index];
  const atRest = height / 2 - ((altitude - step.altitude) * height) / step.span;
  return atRest + (offset - STACK[index]) * height;
}

// Stack offset -> fractional step index (2.5 = halfway from step 3 to step 4).
function positionAt(at) {
  let lower = STACK.length - 2;
  while (lower > 0 && STACK[lower] > at) lower -= 1;
  return Math.min(STEPS.length - 1, lower + Math.max(0, at - STACK[lower]) / STEP_GAPS[lower]);
}

// The true camera for the gauges: altitude moves linearly between neighbouring steps and the zoom
// geometrically, so a fractional position reads as a real altitude.
function cameraAt(at) {
  const lower = Math.min(STEPS.length - 2, Math.max(0, Math.floor(at)));
  const f = Math.min(1, Math.max(0, at - lower));
  const a = STEPS[lower];
  const b = STEPS[lower + 1];
  return { centre: a.altitude + (b.altitude - a.altitude) * f, span: a.span * (b.span / a.span) ** f };
}

function skyColour(altitude) {
  const upper = SKY_STOPS.findIndex((stop) => stop.altitude >= altitude);
  if (upper === 0) return SKY_STOPS[0].rgb;
  if (upper === -1) return SKY_STOPS[SKY_STOPS.length - 1].rgb;
  const a = SKY_STOPS[upper - 1];
  const b = SKY_STOPS[upper];
  const t = (altitude - a.altitude) / (b.altitude - a.altitude);
  return a.rgb.map((channel, i) => Math.round(channel + (b.rgb[i] - channel) * t));
}

// The gradient is linear between SKY_STOPS, and altitude is linear in screen y, so placing a CSS stop at
// the screen edges and at every SKY_STOPS altitude in view reproduces skyColour() exactly.
function renderSky() {
  const bottom = camera.centre - camera.span / 2;
  const top = camera.centre + camera.span / 2;
  const altitudes = [bottom, ...SKY_STOPS.map((stop) => stop.altitude).filter((a) => a > bottom && a < top), top];
  const stops = altitudes.map((a) => {
    const percent = ((a - bottom) / camera.span) * 100;
    return `rgb(${skyColour(a).join(" ")}) ${percent.toFixed(3)}%`;
  });
  sky.style.background = `linear-gradient(to top, ${stops.join(", ")})`;
}

function renderGround(height) {
  const y = sceneryY(0, 0, height); // the ground is step 1's scenery
  ground.hidden = y - GRASS_BLADES_PX > height;
  ground.style.transform = `translate3d(0, ${y}px, 0)`;
}

function renderSprites(width, height) {
  // A sprite's longest side is SPRITE_SIZE x scale of the shorter screen side: the screen height on
  // landscape screens, and proportionally smaller on a portrait phone so a row of sprites still fits.
  const shortSide = Math.min(width, height);
  const stripWidth = width - SPRITE_GUTTER_LEFT_PX - SPRITE_GUTTER_RIGHT_PX;
  for (const { img, placement, step, aspect, mirror } of sprites) {
    const longest = SPRITE_SIZE[placement.subject] * (placement.scale ?? 1) * shortSide;
    // Never wider than the strip (a wide cloud on a phone).
    const h = Math.min(aspect >= 1 ? longest / aspect : longest, stripWidth / aspect);
    const top = sceneryY(placement.altitude, step, height) - h / 2;
    img.hidden = h < MIN_SPRITE_PX || top > height || top + h < 0;
    if (img.hidden) continue;
    const w = h * aspect;
    const left = SPRITE_GUTTER_LEFT_PX + (placement.x / 100) * (stripWidth - w);
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.transform =
      `translate3d(${left}px, ${top}px, 0) rotate(${placement.tilt ?? 0}deg)` + (mirror ? " scaleX(-1)" : "");
  }
}

// Same shift as that step's sprites; a layer that has slid fully off screen is hidden, so keyboard focus
// can't land on its buttons. A layer whose data-step attribute has been removed (start.js does this to the
// start layer on LIFTOFF) stops sliding and rides along with the camera instead.
function renderLayers(height) {
  for (const { element, index } of stepLayers) {
    const y = element.hasAttribute("data-step") ? (offset - STACK[index]) * height : 0;
    element.style.visibility = Math.abs(y) >= height ? "hidden" : "";
    element.style.transform = `translate3d(0, ${y}px, 0)`;
  }
}

// Smallest 1, 2 or 5 x 10^n meters that is at least `meters`.
function niceStep(meters) {
  const power = 10 ** Math.floor(Math.log10(meters));
  const mantissa = [1, 2, 5, 10].find((m) => m * power >= meters * (1 - 1e-9));
  return { size: mantissa * power, mantissa: mantissa % 10 || 1 };
}

// How many minor ticks each labelled interval may split into, densest first, keeping minor ticks at nice
// values too (a 5 m interval never splits into 2.5 m halves).
const SUBDIVISIONS = { 1: [10, 5, 2], 2: [10, 4, 2], 5: [10, 5] };

function renderRuler(height) {
  const dpr = window.devicePixelRatio || 1;
  // No resize event fires when only the pixel ratio changes (window dragged to another monitor).
  if (ruler.height !== Math.round(height * dpr) || ruler.width !== Math.round(RULER_WIDTH_PX * dpr)) sizeRuler(height);
  const pxPerM = height / camera.span;
  const major = niceStep(MIN_LABEL_GAP_PX / pxPerM);
  const parts = SUBDIVISIONS[major.mantissa].find((n) => (major.size / n) * pxPerM >= MIN_TICK_GAP_PX) ?? 1;
  const minor = major.size / parts;
  const first = Math.ceil((camera.centre - camera.span / 2) / minor);
  const last = Math.floor((camera.centre + camera.span / 2) / minor);

  rulerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  rulerContext.clearRect(0, 0, RULER_WIDTH_PX, height);
  rulerContext.fillStyle = rulerInk;
  rulerContext.font = rulerFont;
  rulerContext.textBaseline = "middle";
  for (let i = first; i <= last; i += 1) {
    const y = screenY(i * minor, height);
    const index = ((i % parts) + parts) % parts;
    if (index === 0) {
      rulerContext.fillRect(0, y - 1, 24, 2);
      if (y < LABEL_EDGE_PX || y > height - LABEL_EDGE_PX) continue; // a half-clipped label reads as noise
      rulerContext.shadowColor = "rgb(0 0 0 / 45%)";
      rulerContext.shadowBlur = 2;
      rulerContext.shadowOffsetY = 1;
      rulerContext.fillText((Math.round(i / parts) * major.size).toLocaleString(), 28, y);
      rulerContext.shadowColor = "transparent";
    } else if (parts % 2 === 0 && index === parts / 2) {
      rulerContext.fillRect(0, y - 0.5, 16, 1);
    } else {
      rulerContext.fillRect(0, y - 0.5, 9, 1);
    }
  }
}

function sizeRuler(height) {
  const dpr = window.devicePixelRatio || 1;
  ruler.width = Math.round(RULER_WIDTH_PX * dpr);
  ruler.height = Math.round(height * dpr);
}

function render() {
  camera = cameraAt(positionAt(offset));
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderSky();
  renderGround(height);
  renderSprites(width, height);
  renderLayers(height);
  renderRuler(height);
  // `|| 0` turns -0 (a centre a hair below 0 m) into 0 so the readout never says "-0 m".
  readout.textContent = `${(Math.round(camera.centre) || 0).toLocaleString()} m`;
}

// Cubic Hermite from `from` (moving at `speed` screens/ms) to `to` (at rest) over `duration` ms. With
// speed 0 this is a smooth ease-in-out; with speed carried over, an interrupted slide keeps its momentum.
function hermite(from, to, speed, duration, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * speed * duration + (-2 * t3 + 3 * t2) * to;
}

let velocity = 0; // screens per ms, kept up to date while sliding
const FRAME_MS = 1000 / 60;

/**
 * Slide the stack to step `index`: 1.2 s for up to one screen of travel plus 0.4 s per extra screen (max
 * 4 s), so high steps take a little longer and move faster. A long jump passes through every
 * step in between. Starts from wherever we are and at whatever speed, so a
 * second arrow press mid-slide carries on without a stall.
 */
function slideTo(index) {
  cancelAnimationFrame(animation);
  const from = offset;
  const to = STACK[index];
  const distance = Math.abs(to - from);
  if (reduceMotion.matches || distance === 0) {
    offset = to;
    velocity = 0;
    render();
    return;
  }
  const duration = Math.min(4000, 1200 + 400 * Math.max(0, distance - 1));
  // Momentum toward the target is kept (capped so the curve can't overshoot); momentum away is dropped.
  const toward = Math.sign(to - from) === Math.sign(velocity);
  const speed = toward ? Math.sign(velocity) * Math.min(Math.abs(velocity), (2 * distance) / duration) : 0;
  // The clock starts one frame before the first frame's timestamp (rAF timestamps can precede a
  // performance.now() taken here), so the first frame already moves and an interrupt never holds still.
  let start = null;
  let last = null;
  const frame = (now) => {
    if (start === null) {
      start = now - FRAME_MS;
      last = { at: start, offset: from };
    }
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    offset = t < 1 ? hermite(from, to, speed, duration, t) : to;
    velocity = t < 1 && now > last.at ? (offset - last.offset) / (now - last.at) : 0;
    last = { at: now, offset };
    render();
    if (t < 1) animation = requestAnimationFrame(frame);
  };
  animation = requestAnimationFrame(frame);
}

/** Move to step `number` (1-based, clamped to the table) and remember it in the URL hash. */
function goToStep(number) {
  if (!Number.isFinite(number)) return;
  const index = Math.min(STEPS.length - 1, Math.max(0, Math.round(number) - 1));
  if (index !== stepIndex) {
    stepIndex = index;
    history.replaceState(null, "", `#${STEPS[index].number}`);
    window.dispatchEvent(new CustomEvent("cirrusly:step", { detail: { step: STEPS[index].number } }));
  }
  slideTo(index);
}

// `#3` -> step 3; out-of-range numbers clamp to the first/last step; anything else is step 1.
function stepIndexFromHash() {
  const number = Number.parseInt(window.location.hash.slice(1), 10);
  if (!Number.isFinite(number)) return 0;
  return Math.min(STEPS.length - 1, Math.max(0, number - 1));
}

function resize() {
  sizeRuler(stage.clientHeight);
  render();
}

stepIndex = stepIndexFromHash();
offset = STACK[stepIndex];
resize();
root.classList.remove("loading");

window.addEventListener("resize", resize);
// The stage is `overflow: clip` (world.css). Where that is unsupported it falls back to `hidden`, which focus
// or script can still scroll; any scroll would shift the whole world, so snap it straight back.
stage.addEventListener("scroll", () => stage.scrollTo(0, 0));
window.addEventListener("hashchange", () => goToStep(STEPS[stepIndexFromHash()].number));
window.cirrusly = {
  goToStep,
  currentStep: () => STEPS[stepIndex].number,
  stepCount: STEPS.length,
};
