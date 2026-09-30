// The altitude steps the camera rests at, bottom to top. world.js reads STEPS (classic scripts share one
// global scope, so this file must load first).
//
// Each step: `altitude` is the camera centre in meters, `span` is how many meters of world fit in one
// screen height at rest (never shown to the visitor; it only sets the zoom), and `sprites` are that
// step's images, drawn in list order (later ones in front):
//   subject, variant  -> img/sprites/<subject>-<variant>.svg
//   altitude          -> meters, the sprite's vertical centre
//   x                 -> 0..100 across the strip between the ruler and the right-hand controls
//                        (0 = flush left, 100 = flush right)
//   scale             -> optional size multiplier (about 0.85-1.15) so copies look nearer or farther
//   flip, tilt        -> optional mirror (all art faces right) and rotation in degrees
// A sprite's LONGEST side is SPRITE_SIZE[subject] x scale of the screen height (of the width on a portrait
// screen), always: sprites never scale with altitude, so the sizes below are relative on-screen sizes, not
// real ones.
//
// Rules for authoring: each sprite must sit fully inside its own step's view (altitude ± span / 2); moving
// between steps slides whole screens, so at rest no other step's sprites can be on screen. Each step shows
// 8-10 sprites and mixes two-type subjects about evenly. Above step 1 the question box sits mid-screen
// (about x 19-80 and the middle 42% of the height, its balloons above, the timer on its left), so the
// sprites ring it: top corners and between the balloon bunches, beside it on the right, above and under the
// timer, and along the bottom. Wide art (blimps, jets, clouds, fireworks) goes in the top and bottom bands;
// only small art fits beside the box.

const SPRITE_SIZE = {
  worm: 0.17,
  bumblebee: 0.12,
  butterfly: 0.115,
  robin: 0.14,
  kite: 0.13,
  duck: 0.15,
  firework: 0.2,
  flamingo: 0.18,
  "hot-air-balloon": 0.18,
  "bald-eagle": 0.14,
  "hang-glider": 0.19,
  blimp: 0.28,
  "weather-balloon": 0.12,
  jet: 0.26,
  cirrus: 0.4,
};

// Art that must not be CSS-mirrored because it carries lettering: a flipped copy loads <name>-left.svg,
// a separate drawing that faces left with the text still reading correctly.
const LEFT_ART = new Set(["blimp-1"]);

// Travel between neighbouring steps, in screen heights (STEP_GAPS[k] is step k+1 -> step k+2). Low steps
// are one screen apart so they feel close; high ones get several screens of open sky, so the climb feels
// like flying. One entry fewer than STEPS, each at least 1 (world.js refuses anything else).
const STEP_GAPS = [1, 1.2, 1.6, 2.2, 3, 4, 5];

const STEPS = [
  {
    number: 1,
    altitude: 0,
    span: 6,
    // Worms only, all in the dirt; the pebbles are the dirt texture.
    sprites: [
      { subject: "worm", variant: 2, altitude: -2.57, x: 93, scale: 0.89, tilt: -6 },
      { subject: "worm", variant: 2, altitude: -2.3, x: 78, scale: 0.90, flip: true, tilt: 4 },
      { subject: "worm", variant: 1, altitude: -2.59, x: 55, scale: 0.94, flip: true, tilt: -6 },
      { subject: "worm", variant: 1, altitude: -2.38, x: 0, scale: 0.97, tilt: -3 },
      { subject: "worm", variant: 2, altitude: -0.7, x: 3, scale: 0.99, flip: true, tilt: 4 },
      { subject: "worm", variant: 1, altitude: -0.52, x: 98, scale: 1.04, flip: true, tilt: -6 },
      { subject: "worm", variant: 2, altitude: -1.86, x: 18, scale: 1.06, tilt: 4 },
      { subject: "worm", variant: 1, altitude: -1.15, x: 36, scale: 1.07, flip: true, tilt: -4 },
      { subject: "worm", variant: 1, altitude: -1.66, x: 78, scale: 1.14, tilt: -6 },
    ],
  },
  {
    number: 2,
    altitude: 5,
    span: 8,
    sprites: [
      { subject: "butterfly", variant: 1, altitude: 6.46, x: 0, scale: 1.00, tilt: 3 },
      { subject: "bumblebee", variant: 1, altitude: 8.50, x: 8, scale: 0.95, flip: true, tilt: -3 },
      { subject: "butterfly", variant: 1, altitude: 7.19, x: 41, scale: 0.93, flip: true, tilt: 4 },
      { subject: "bumblebee", variant: 1, altitude: 8.27, x: 98, scale: 0.92, flip: true, tilt: 5 },
      { subject: "butterfly", variant: 1, altitude: 5.88, x: 100, scale: 1.03, tilt: -3 },
      { subject: "bumblebee", variant: 1, altitude: 3.64, x: 98, scale: 0.90, flip: true, tilt: -5 },
      { subject: "butterfly", variant: 1, altitude: 3.48, x: 3, scale: 0.97, tilt: 6 },
      { subject: "bumblebee", variant: 1, altitude: 1.78, x: 9, scale: 1.05, tilt: 3 },
      { subject: "butterfly", variant: 1, altitude: 2.74, x: 58, scale: 1.10, flip: true, tilt: -4 },
      { subject: "bumblebee", variant: 1, altitude: 1.59, x: 86, scale: 0.98, flip: true, tilt: 4 },
    ],
  },
  {
    number: 3,
    altitude: 25,
    span: 30,
    sprites: [
      { subject: "kite", variant: 1, altitude: 30.8, x: 0, scale: 0.95, flip: true, tilt: 4 },
      { subject: "robin", variant: 1, altitude: 38.0, x: 10, scale: 0.93, flip: true, tilt: 3 },
      { subject: "kite", variant: 1, altitude: 33.8, x: 37, scale: 0.92, tilt: -4 },
      { subject: "robin", variant: 1, altitude: 37.4, x: 98, scale: 0.90, flip: true, tilt: -3 },
      { subject: "kite", variant: 1, altitude: 28.6, x: 100, scale: 0.90, tilt: 4 },
      { subject: "robin", variant: 1, altitude: 20.2, x: 98, scale: 0.92, flip: true, tilt: 4 },
      { subject: "robin", variant: 1, altitude: 19.3, x: 2, scale: 0.90, tilt: -4 },
      { subject: "kite", variant: 1, altitude: 13.2, x: 13, scale: 1.02, flip: true, tilt: -6 },
      { subject: "robin", variant: 1, altitude: 16.7, x: 44, scale: 1.00, tilt: 3 },
      { subject: "kite", variant: 1, altitude: 13.2, x: 86, scale: 1.05, tilt: 5 },
    ],
  },
  {
    number: 4,
    altitude: 100,
    span: 120,
    sprites: [
      { subject: "duck", variant: 1, altitude: 152, x: 8, scale: 0.90, tilt: 4 },
      { subject: "firework", variant: 1, altitude: 139, x: 35, scale: 0.90 },
      { subject: "duck", variant: 1, altitude: 149, x: 98, scale: 0.88, flip: true, tilt: -4 },
      { subject: "duck", variant: 1, altitude: 114, x: 100, scale: 0.86, flip: true, tilt: 4 },
      { subject: "duck", variant: 1, altitude: 81, x: 98, scale: 0.86, tilt: -6 },
      { subject: "duck", variant: 1, altitude: 77, x: 0, scale: 0.86, flip: true, tilt: 6 },
      { subject: "firework", variant: 2, altitude: 56, x: 9, scale: 0.95 },
      { subject: "firework", variant: 2, altitude: 62, x: 44, scale: 0.90, flip: true },
      { subject: "firework", variant: 1, altitude: 54, x: 86, scale: 1.00, flip: true },
    ],
  },
  {
    number: 5,
    altitude: 400,
    span: 500,
    sprites: [
      { subject: "hot-air-balloon", variant: 2, altitude: 506, x: 0, scale: 0.90 },
      { subject: "flamingo", variant: 1, altitude: 613, x: 8, scale: 0.90, tilt: 4 },
      { subject: "hot-air-balloon", variant: 1, altitude: 556, x: 33, scale: 0.86, flip: true },
      { subject: "flamingo", variant: 1, altitude: 608, x: 98, scale: 0.88, flip: true, tilt: -3 },
      { subject: "hot-air-balloon", variant: 2, altitude: 455, x: 100, scale: 0.86, flip: true },
      { subject: "hot-air-balloon", variant: 1, altitude: 302, x: 0, scale: 0.85 },
      { subject: "flamingo", variant: 1, altitude: 200, x: 9, scale: 1.00, flip: true, tilt: 3 },
      { subject: "flamingo", variant: 1, altitude: 255, x: 54, scale: 1.08, tilt: -4 },
      { subject: "hot-air-balloon", variant: 1, altitude: 205, x: 86, scale: 1.00, flip: true },
    ],
  },
  {
    number: 6,
    altitude: 1500,
    span: 1800,
    sprites: [
      { subject: "hang-glider", variant: 1, altitude: 2266, x: 8, scale: 0.88, tilt: -4 },
      { subject: "bald-eagle", variant: 1, altitude: 2006, x: 37, scale: 0.95, flip: true, tilt: 4 },
      { subject: "hang-glider", variant: 1, altitude: 2245, x: 98, scale: 0.90, flip: true, tilt: 4 },
      { subject: "bald-eagle", variant: 1, altitude: 1716, x: 100, scale: 0.88, tilt: -4 },
      { subject: "bald-eagle", variant: 1, altitude: 1212, x: 98, scale: 0.86, flip: true, tilt: 6 },
      { subject: "bald-eagle", variant: 1, altitude: 1158, x: 0, scale: 0.86, tilt: 6 },
      { subject: "hang-glider", variant: 1, altitude: 784, x: 9, scale: 1.00, flip: true, tilt: 6 },
      { subject: "bald-eagle", variant: 1, altitude: 999, x: 58, scale: 1.10, tilt: -6 },
      { subject: "hang-glider", variant: 1, altitude: 750, x: 86, scale: 1.02, tilt: -4 },
    ],
  },
  {
    number: 7,
    altitude: 5000,
    span: 5000,
    sprites: [
      { subject: "blimp", variant: 2, altitude: 7085, x: 2, scale: 0.90, flip: true },
      { subject: "weather-balloon", variant: 1, altitude: 6460, x: 35, scale: 0.95 },
      { subject: "blimp", variant: 1, altitude: 7028, x: 98, scale: 0.92 },
      { subject: "weather-balloon", variant: 1, altitude: 5600, x: 100, scale: 1.00, flip: true },
      { subject: "weather-balloon", variant: 1, altitude: 4050, x: 0, scale: 1.02, flip: true },
      { subject: "blimp", variant: 1, altitude: 3100, x: 9, scale: 1.00, flip: true },
      { subject: "weather-balloon", variant: 1, altitude: 3560, x: 60, scale: 1.05 },
      { subject: "blimp", variant: 2, altitude: 2968, x: 86, scale: 1.05 },
    ],
  },
  {
    number: 8,
    altitude: 10000,
    span: 6000,
    // Clouds first so the jets draw in front of them.
    sprites: [
      { subject: "cirrus", variant: 2, altitude: 11810, x: 47, scale: 0.80 },
      { subject: "cirrus", variant: 1, altitude: 8225, x: 30, scale: 0.85 },
      { subject: "cirrus", variant: 2, altitude: 10660, x: 100, scale: 0.75, flip: true },
      { subject: "jet", variant: 1, altitude: 12636, x: 6, scale: 0.95, tilt: 4 },
      { subject: "jet", variant: 1, altitude: 12524, x: 98, scale: 0.92, flip: true, tilt: -3 },
      { subject: "jet", variant: 1, altitude: 8920, x: 98, scale: 0.80, flip: true, tilt: 3 },
      { subject: "jet", variant: 1, altitude: 7570, x: 9, scale: 1.05, tilt: -3 },
      { subject: "jet", variant: 1, altitude: 7523, x: 86, scale: 1.10, flip: true, tilt: 4 },
    ],
  },
];
