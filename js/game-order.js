// Drag-to-order: putting tiles in order. Part of the game (game.js).

(() => {
  const { isOrdering } = window.cirrusly.game; // game-checks.js
  const { submitButton } = window.cirrusly.game; // game-answers.js
  const { DRAG_START_PX, edgeScroller } = window.cirrusly.game; // game-drag.js
  const { match } = window.cirrusly;
  const form = document.querySelector(".qbox");
  const el = (selector) => form.querySelector(selector);
  const play = el(".qplay");

  // Drag-to-order: a column of equal tiles numbered down the left, starting in the order the question lists them
  // (or, when that is already the answer, a fixed other order: match.startOrder), with the list's two ends named
  // above and below. Drag a tile (a ghost follows the pointer, as in a match, and the
  // tile's spot moves as the ghost passes the others), tap one tile and then another to swap them, or move a focused
  // tile with the arrow keys. A dragged or focused tile never leaves its place in the page itself: the tiles it
  // passes move round it, so neither the pointer's capture nor the focus is lost. A drag held near an edge of the
  // tiles, when they scroll inside the box, scrolls them, as in a match. A drag that ends any way (a drop,
  // pointercancel, Escape, a lost window, the question ending) keeps the order as it stands.
  function buildOrder(q, { saveDraft }) {
    const wrap = document.createElement("div");
    wrap.className = "qorder qscroll"; // scrolls inside the box when the box would run off the screen
    const hint = document.createElement("p");
    hint.className = "qmatch-hint";
    hint.textContent = "Drag the tiles into order, or tap two to swap them.";
    const end = (arrow, name) => {
      const line = document.createElement("p");
      line.className = "qorder-end";
      const mark = document.createElement("span");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = `${arrow} `;
      line.append(mark, name);
      return line;
    };
    // Numbers first, then the tiles: the grid flows down two columns, so a tile's row (and its number) follows its
    // place among the tiles, and the tiles' page order is the order shown (and the Tab order).
    const list = document.createElement("div");
    list.className = "qorder-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", `${q.ends[0]} at the top, ${q.ends[1]} at the bottom`);
    list.style.setProperty("--rows", String(q.items.length));
    const numbers = q.items.map((_, k) => {
      const number = document.createElement("span");
      number.className = "qorder-num";
      number.setAttribute("aria-hidden", "true");
      number.textContent = String(k + 1);
      return number;
    });
    const tiles = q.items.map(({ text }, i) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "qmatch-item qorder-item";
      tile.dataset.item = String(i);
      const grip = document.createElement("span");
      grip.className = "qorder-grip";
      grip.setAttribute("aria-hidden", "true");
      grip.textContent = "⋮⋮";
      tile.append(grip, text);
      tile.setAttribute("aria-pressed", "false");
      return tile;
    });
    list.append(...numbers, ...match.startOrder(q.items).map((i) => tiles[i]));
    wrap.append(hint, end("▲", q.ends[0]), list, end("▼", q.ends[1]));
    play.append(wrap, submitButton());

    const placed = () => Array.from(list.querySelectorAll(".qorder-item"));
    const renumber = () =>
      placed().forEach((tile, k) =>
        tile.setAttribute("aria-label", `Position ${k + 1}: ${q.items[tile.dataset.item].text}`),
      );
    renumber();
    // `tile` to place `to` (from 0): the tiles between move round it, `tile` itself stays put.
    const moveTo = (tile, to) => {
      const now = placed();
      const from = now.indexOf(tile);
      if (to === from) return;
      if (to > from) tile.before(...now.slice(from + 1, to + 1));
      else tile.after(...now.slice(to, from));
      renumber();
      saveDraft();
    };
    const swap = (a, b) => {
      const [i, j] = [placed().indexOf(a), placed().indexOf(b)];
      moveTo(b, i);
      moveTo(a, j);
    };

    let chosen = null;
    const choose = (tile) => {
      if (chosen) chosen.setAttribute("aria-pressed", "false");
      chosen = tile === chosen ? null : tile;
      if (chosen) chosen.setAttribute("aria-pressed", "true");
    };
    // As in a match: the click a browser may send after a drag is ignored, until the next pointerdown.
    let dragged = false;
    list.addEventListener("click", (event) => {
      const tile = event.target.closest(".qorder-item");
      if (!tile || (dragged && event.detail > 0)) return;
      if (chosen && chosen !== tile) {
        const other = chosen;
        choose(other);
        swap(other, tile);
      } else {
        choose(tile);
      }
    });
    list.addEventListener("pointerdown", () => (dragged = false));
    list.addEventListener("keydown", (event) => {
      const tile = event.target.closest(".qorder-item");
      const by = { ArrowUp: -1, ArrowDown: 1 }[event.key];
      if (!tile || !by || drag) return;
      event.preventDefault();
      const to = placed().indexOf(tile) + by;
      if (to >= 0 && to < tiles.length) moveTo(tile, to);
    });

    let drag = null; // { tile, pointerId, x, y, ghost? }; one drag at a time
    // The ghost slides up and down with the pointer; the tile takes the place among the others that the ghost's
    // middle has reached (again as the tiles scroll under it).
    const moveGhost = (x, y) => {
      const dy = y - drag.y;
      if (!drag.ghost) {
        if (Math.hypot(x - drag.x, dy) < DRAG_START_PX) return;
        lift();
      }
      drag.ghost.style.transform = `translateY(${dy}px)`;
      place();
      scroller.follow(y);
    };
    const place = () => {
      const ghost = drag.ghost.getBoundingClientRect();
      const middle = ghost.top + ghost.height / 2;
      const above = placed().filter((tile) => {
        if (tile === drag.tile) return false;
        const rect = tile.getBoundingClientRect();
        return rect.top + rect.height / 2 < middle;
      });
      moveTo(drag.tile, above.length);
    };
    const scroller = edgeScroller(wrap, place);
    const follow = (event) => {
      if (event.pointerId !== drag.pointerId) return;
      // A mouse released where no pointerup reached us (outside the window, a switched app): the drag is over.
      if (event.pointerType === "mouse" && event.buttons === 0) endDrag();
      else moveGhost(event.clientX, event.clientY);
    };
    const release = (event) => {
      if (event.pointerId !== drag.pointerId) return;
      moveGhost(event.clientX, event.clientY);
      endDrag();
    };
    const cancelled = (event) => {
      if (event.pointerId === drag.pointerId) endDrag(); // a cancel's position is not one to drop at
    };
    const escape = (event) => {
      if (event.key === "Escape") endDrag();
    };
    const leave = (event) => {
      if (event.target === window) endDrag();
    };
    const LISTENERS = [
      ["pointermove", follow],
      ["pointerup", release],
      ["pointercancel", cancelled],
      ["keydown", escape],
      ["blur", leave],
    ];
    const lift = () => {
      const { tile } = drag;
      const rect = tile.getBoundingClientRect();
      const ghost = document.createElement("div");
      ghost.className = "qmatch-item qorder-item qmatch-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.append(...Array.from(tile.childNodes, (node) => node.cloneNode(true)));
      Object.assign(ghost.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      document.body.append(ghost);
      drag.ghost = ghost;
      tile.classList.add("lifted");
      if (chosen) choose(chosen);
    };
    const endDrag = () => {
      if (!drag) return;
      const { tile, ghost } = drag;
      drag = null;
      scroller.stop();
      for (const [type, listener] of LISTENERS) window.removeEventListener(type, listener, true);
      if (!ghost) return; // a tap: the click that follows chooses or swaps
      ghost.remove();
      tile.classList.remove("lifted");
      dragged = true;
    };
    for (const tile of tiles) {
      tile.addEventListener("pointerdown", (event) => {
        if (drag || !event.isPrimary || event.button !== 0) return;
        drag = { tile, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        for (const [type, listener] of LISTENERS) window.addEventListener(type, listener, true);
        try {
          tile.setPointerCapture(event.pointerId);
        } catch {
          // No capture (an unknown pointer): the window listeners still see the drag through.
        }
      });
    }

    // The order's draft: the item indices from the top down.
    const draft = () => placed().map((tile) => Number(tile.dataset.item));
    const check = () => ({ ...match.checkOrder(draft(), q.items), hints: q.items.map(() => null) });
    const restore = (saved) => {
      if (isOrdering(saved, tiles.length)) saved.forEach((item, k) => moveTo(tiles[item], k));
    };
    return {
      get first() {
        return placed()[0];
      },
      fields: [],
      check,
      draft,
      restore,
      stop: endDrag,
    };
  }

  window.cirrusly.game = { ...window.cirrusly.game, buildOrder };
})();
