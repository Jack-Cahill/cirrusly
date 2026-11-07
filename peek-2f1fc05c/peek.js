// Preview only: remove with the peek-2f1fc05c folder. This page plays one day before players get it, with the live
// site's own scripts, styles, art and day files (so what is checked here is what goes live, and a fix to a day file
// shows here too); this script is the first thing in <head> (a plain script, so it runs before index.html's inline
// resume check and the deferred game scripts):
//   <script src="../peek.js" data-date="2026-10-24" data-store="d6"></script>
//
// The clock: `new Date()` and `Date.now()` read as the page's date at the current local time of day, so game-load.js
// opens that day, and every difference the game takes (the 40 s timer, the midnight checks) is as on the live page.
//
// Storage: the preview shares the live site's origin, so every key of localStorage and sessionStorage is read and
// written as "peek:<store>:<key>", and only those keys are listed (`key`, `length`). The game's saves, stats, sent
// marks and clean-up of old saves then only ever see this page's own keys: they never read, count or delete the real
// "cirrusly:" ones, and the real game never sees these. Patched on Storage.prototype, so it covers both stores.
// Open the page as <page>#reset to clear this page's keys and play it again.
//
// The results counter: the page runs on https://cirrusly.fun, where game-stats.js posts a finished day and reads
// everyone's percentages. Here nothing goes to it: fetch answers a POST with a 204 itself and the day's GET with
// made-up counts (SAMPLE_COUNTS, which the label calls sample numbers), so the review shows its "NN% got it" lines.
(() => {
  const { date, store } = document.currentScript.dataset;
  const [year, month, day] = date.split("-").map(Number);

  const RealDate = Date;
  const now = new RealDate();
  const shifted = new RealDate(
    year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds(),
  );
  const offset = shifted.getTime() - now.getTime();
  class PreviewDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }

    static now() {
      return RealDate.now() + offset;
    }
  }
  window.Date = PreviewDate;

  const prefix = `peek:${store}:`;
  const proto = Storage.prototype;
  const real = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem, key: proto.key };
  const realLength = Object.getOwnPropertyDescriptor(proto, "length").get;
  // This page's keys in `storage`, without the prefix, in the browser's order.
  function ownKeys(storage) {
    const keys = [];
    for (let i = 0; i < realLength.call(storage); i += 1) {
      const key = real.key.call(storage, i);
      if (key !== null && key.startsWith(prefix)) keys.push(key.slice(prefix.length));
    }
    return keys;
  }
  // <page>#reset: replay the day from the start. This page's keys go (the real ones stay), and the hash with them,
  // before any other script reads storage or the address.
  if (window.location.hash === "#reset") {
    for (const name of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[name];
        for (const key of ownKeys(storage)) real.removeItem.call(storage, prefix + key);
      } catch {
        // Storage blocked: there is nothing to remove.
      }
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  proto.getItem = function getItem(key) {
    return real.getItem.call(this, prefix + key);
  };
  proto.setItem = function setItem(key, value) {
    real.setItem.call(this, prefix + key, value);
  };
  proto.removeItem = function removeItem(key) {
    real.removeItem.call(this, prefix + key);
  };
  proto.key = function key(index) {
    return ownKeys(this)[index] ?? null;
  };
  proto.clear = function clear() {
    for (const key of ownKeys(this)) real.removeItem.call(this, prefix + key);
  };
  Object.defineProperty(proto, "length", {
    configurable: true,
    enumerable: true,
    get() {
      return ownKeys(this).length;
    },
  });

  // The counter's address as game-stats.js names it; anything fetched from it is answered here, never sent.
  const STATS_ORIGIN = "https://cirrusly-stats.cirrusly.workers.dev";
  const SAMPLE_COUNTS = { plays: 412, right: [389, 301, 268, 214, 157, 118, 63] };
  const realFetch = window.fetch;
  window.fetch = function fetch(input, init) {
    // The day files and the examples are the live site's own, two folders up.
    if (typeof input === "string" && /^(days|data)\//.test(input)) return realFetch.call(this, `../../${input}`, init);
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), window.location.href);
    if (url.origin !== STATS_ORIGIN) return realFetch.call(this, input, init);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const json = { "Content-Type": "application/json" };
    if (method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
    if (method === "GET" && url.pathname === `/day/${date}`) {
      return Promise.resolve(new Response(JSON.stringify(SAMPLE_COUNTS), { status: 200, headers: json }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  // The page's address is two folders down from the live page's, and the pictures a script names ("img/sprites/…" in
  // world.js, the day's "img/q/…", the examples' "img/examples/…") are the live site's own: point them there, and a
  // spelling clip ("audio/…") too.
  const srcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    enumerable: true,
    get() {
      return srcSetter.get.call(this);
    },
    set(value) {
      const url = String(value);
      srcSetter.set.call(this, url.startsWith("img/") ? `../../${url}` : url);
    },
  });
  const RealAudio = window.Audio;
  window.Audio = function Audio(url) {
    return new RealAudio(typeof url === "string" && url.startsWith("audio/") ? `../../${url}` : url);
  };
})();
