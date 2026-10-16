// Drag-to-match: sorting tiles into groups. Part of the game (game.js).

(() => {
  const { isOrdering } = window.cirrusly.game; // game-checks.js
  const { markScrollEdges } = window.cirrusly.game; // game-fit.js
  const { submitButton } = window.cirrusly.game; // game-answers.js
  const { DRAG_START_PX, edgeScroller } = window.cirrusly.game; // game-drag.js
  const form = document.querySelector(".qbox");
  const el = (selector) => form.querySelector(selector);
  const play = el(".qplay");

  function buildMatch(q, { saveDraft }) {
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
    groupRow.classList.toggle("rows", groups.length > 2); // more than two: a row each, its name beside its tiles
    // "One each" (a "Match these" question: every group holds exactly one item): a group takes one tile, so its spot
    // goes once it has one (game.css) and a tile dropped on it swaps with the one there. Never a two-group sort: its
    // groups never hint how many belong in them.
    const oneEach =
      q.groups.length > 2 &&
      q.groups.length === q.items.length &&
      new Set(q.items.map(({ group }) => group)).size === q.items.length;
    wrap.classList.toggle("one-each", oneEach);
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
    const place = (item, target) => {
      const slot = target.querySelector(".qmatch-slot");
      slot.insertBefore(item, slot.querySelector(".qmatch-drop"));
    };
    // In a one-each question a tile moved onto a full group swaps with the one there, which takes the moved tile's
    // place (in Not sorted or the other group), so a group never holds two.
    const moveTo = (item, target) => {
      if (zoneOf(item) !== target) {
        const held = oneEach && target !== tray ? target.querySelector(".qmatch-item") : null;
        if (held) item.before(held);
        place(item, target);
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
      scroller.follow(y);
    };
    // Held near an edge of the scrolling tiles, the drag scrolls them, and the lit zone follows.
    const scroller = edgeScroller(wrap, aim);
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
      scroller.stop();
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
      return { verdict: boxes.every((b) => b === "right") ? "right" : "wrong", boxes, hints: boxes.map(() => null) };
    };
    // The sort as checked, for the reveal: each item's group index, null while not sorted.
    const sorted = () => items.map((item) => {
      const group = item.closest(".qmatch-group");
      return group ? Number(group.dataset.group) : null;
    });
    // The match's draft: each zone's item indices from the top, Not sorted's first, then each group's, so a reload
    // puts the tiles back in the order they were dropped. A page from before 2026-10-14 saved each item's group index
    // (null: not sorted) instead; that comes back too, each group in item order.
    const draft = () =>
      zones.map((zone) => Array.from(zone.querySelectorAll(".qmatch-item"), (item) => Number(item.dataset.item)));
    const restore = (saved) => {
      const isGroup = (g) => g === null || (Number.isInteger(g) && g >= 0 && g < groups.length);
      if (saved.length === items.length && saved.every(isGroup)) {
        saved.forEach((g, i) => g !== null && place(items[i], groups[g]));
      } else {
        const fits = saved.length === zones.length && saved.every(Array.isArray);
        if (!fits || !isOrdering(saved.flat(), items.length)) return;
        saved.forEach((ids, z) => ids.forEach((i) => place(items[i], zones[z])));
      }
      // A one-each group saved with several tiles (by a page from before one each) keeps its first; the rest go back.
      if (oneEach) {
        for (const group of groups) {
          for (const extra of Array.from(group.querySelectorAll(".qmatch-item")).slice(1)) place(extra, tray);
        }
      }
      markScrollEdges(wrap);
    };
    return { first: items[0], fields: [], check, draft, restore, sorted, stop: cancel };
  }

  window.cirrusly.game = { ...window.cirrusly.game, buildMatch };
})();
