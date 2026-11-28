// What drag-to-match (game-match.js) and drag-to-order (game-order.js) share. Part of the game (game.js).

(() => {
  const DRAG_START_PX = 6;
  const SCROLL_EDGE_PX = 40; // a drag this near a scrolling tile area's edge scrolls it
  const SCROLL_MAX_PX = 14; // per frame

  // A pointer held near (or past) the top or bottom edge of a scrolling tile area scrolls it, faster the deeper it
  // goes, while the ghost stays under the pointer; it stops at the end (the next move starts it again) or when the
  // pointer moves away from the edge. `onScroll` runs after each step, as what the ghost is over has changed. The
  // drag calls `follow(y)` on every move and `stop()` when it ends.
  function edgeScroller(area, onScroll) {
    let frame = 0;
    let pointerY = 0;
    const autoScroll = () => {
      frame = 0;
      if (area.scrollHeight <= area.clientHeight) return;
      const view = area.getBoundingClientRect();
      const y = pointerY;
      const depth = Math.max(view.top + SCROLL_EDGE_PX - y, 0) - Math.max(y - (view.bottom - SCROLL_EDGE_PX), 0);
      if (depth === 0) return;
      const before = area.scrollTop;
      area.scrollTop -= Math.sign(depth) * Math.min(SCROLL_MAX_PX, Math.ceil(Math.abs(depth) / 3));
      if (area.scrollTop === before) return; // at the end that way: the next move starts it again
      onScroll();
      frame = requestAnimationFrame(autoScroll);
    };
    return {
      follow(y) {
        pointerY = y;
        if (!frame) frame = requestAnimationFrame(autoScroll);
      },
      stop() {
        cancelAnimationFrame(frame);
        frame = 0;
      },
    };
  }

  window.cirrusly.game = { ...window.cirrusly.game, DRAG_START_PX, edgeScroller };
})();
