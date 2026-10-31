// The game's checks on what it reads from outside: a day file and the examples it names (checkDay), and a
// saved order or sort that must fit its question (isOrdering, isSorting). Part of the game (game.js).

(() => {
  const STYLES = new Set(["typed", "multi", "match", "spell", "order"]);

  // Each of 0 .. n - 1 once: an order question's placement (a saved draft, a saved answer's `placed`).
  function isOrdering(value, n) {
    return (
      Array.isArray(value) &&
      value.length === n &&
      value.every((i) => Number.isInteger(i) && i >= 0 && i < n) &&
      new Set(value).size === n
    );
  }

  // A saved match answer's sort that fits its question: an entry per item, each a group index or null.
  function isSorting(value, q) {
    return (
      Array.isArray(value) &&
      value.length === q.items.length &&
      value.every((g) => g === null || (Number.isInteger(g) && g >= 0 && g < q.groups.length))
    );
  }

  // Labels go on every part of a fixed-order multi question, or on none.
  function labelsOk(q) {
    const labelled = (q.parts ?? []).filter((part) => part.label !== undefined);
    if (labelled.length === 0) return true;
    return (
      q.style === "multi" &&
      q.order === "fixed" &&
      labelled.length === q.parts.length &&
      labelled.every((part) => typeof part.label === "string" && part.label.trim() !== "")
    );
  }

  // A part's close answers (with an optional message for them) are non-empty text, the message only with them.
  const isText = (value) => typeof value === "string" && value.trim() !== "";

  // A picture list: each picture has a src, and a credit, if any, is complete with https links (no other keys; a
  // `kind`, if any, is "map": a map, ours or a third party's).
  const CREDIT_KEYS = ["title", "author", "source_url", "licence", "licence_url", "changes", "kind"];
  // A file of the site: a relative path, no scheme and no leading slash (as the pictures' `src`).
  const isLocalPath = (value) => isText(value) && !/^([a-z][a-z0-9+.-]*:|\/)/i.test(value);
  function isPage(value) {
    try {
      return typeof value === "string" && new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }
  function creditOk(credit) {
    return (
      typeof credit === "object" &&
      credit !== null &&
      Object.keys(credit).every((key) => CREDIT_KEYS.includes(key)) &&
      [credit.title, credit.author, credit.licence].every(isText) &&
      isPage(credit.source_url) &&
      isPage(credit.licence_url) &&
      (credit.changes === undefined || isText(credit.changes)) &&
      (credit.kind === undefined || credit.kind === "map")
    );
  }
  function picturesOk(list) {
    return (
      list === undefined ||
      (Array.isArray(list) &&
        list.every((picture) => isText(picture?.src) && (picture.credit === undefined || creditOk(picture.credit))))
    );
  }
  function closeOk(part) {
    if (part.close === undefined) return part.hint === undefined;
    const listed = Array.isArray(part.close) && part.close.length > 0 && part.close.every(isText);
    return listed && (part.hint === undefined || isText(part.hint));
  }

  // An order question's items, each once in its own place, and the names of its two ends.
  function orderOk(q) {
    const items = Array.isArray(q.items) ? q.items : [];
    return (
      items.length >= 2 &&
      items.every((item) => isText(item?.text) && Number.isInteger(item.rank)) &&
      isOrdering(items.map((item) => item.rank - 1), items.length) &&
      new Set(items.map((item) => item.text)).size === items.length &&
      Array.isArray(q.ends) &&
      q.ends.length === 2 &&
      q.ends.every(isText)
    );
  }

  const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  // The day file is outside input: check the shape the game relies on before playing it.
  // `date`: the date the file must be for (null for the sample, which may carry any date, or none). `prev_date`, the
  // day published before it, comes only with a date and before it.
  function checkDay(data, cards, url, date) {
    const ok =
      typeof data?.label === "string" &&
      (data.date === undefined || isDate(data.date)) &&
      (data.prev_date === undefined || (isDate(data.date) && isDate(data.prev_date) && data.prev_date < data.date)) &&
      Array.isArray(data.questions) &&
      data.questions.length > 0 &&
      data.questions.every(
        (q) =>
          STYLES.has(q.style) &&
          Number.isInteger(q.level) &&
          typeof q.text === "string" &&
          typeof q.answer === "string" &&
          (q.example === undefined || cards[q.example]) &&
          (q.style !== "spell" || typeof q.say === "string") &&
          (q.audio === undefined || (q.style === "spell" && isLocalPath(q.audio))) &&
          (q.joined === undefined || typeof q.joined === "boolean") &&
          picturesOk(q.images) &&
          picturesOk(q.reveal) &&
          labelsOk(q) &&
          (q.boxes === undefined ||
            (q.style === "multi" &&
              q.order === "any" &&
              Number.isInteger(q.boxes) &&
              q.boxes >= 1 &&
              q.boxes < q.parts?.length)) &&
          (q.style === "match"
            ? Array.isArray(q.groups) && Array.isArray(q.items) && q.items.length > 0
            : q.style === "order"
            ? orderOk(q)
            : Array.isArray(q.parts) &&
              q.parts.length > 0 &&
              q.parts.every((p) => Array.isArray(p.accept) && closeOk(p))),
      );
    if (!ok) throw new Error(`${url} is not a playable day`);
    if (date !== null && data.date !== date) throw new Error(`${url} is the day for ${data.date}`);
  }

  window.cirrusly.game = { ...window.cirrusly.game, checkDay, isOrdering, isSorting };
})();
