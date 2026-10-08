// Answer matching for the game: pure functions, no DOM. The page uses them as window.cirrusly.match; Node
// tests load the same file with require() (module.exports).
//
//   normalise(text)                         the form both sides are compared in
//   allowance(answer)                       typo edits forgiven for an accepted answer (0, 1 or 2)
//   distance(a, b)                          edit distance; a swap of two neighbouring letters is one edit
//   checkPart(typed, part, options)         "right" | "close" | "wrong" for one answer box
//   checkParts(typed, parts, options)       every box of a multi-part question at once
//
// A part is { accept: [...], reject: [...] }. Rejects are the traps (Austria for Australia): typed exactly,
// they are wrong even when they sit within typo reach of an accepted answer. "close" means a bigger
// near-miss that earns one retype; spelling questions (`exact`) never get one.

(() => {
  const UNITS = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  ];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const UNIT_VALUE = new Map(UNITS.map((word, value) => [word, value]));
  const TENS_VALUE = new Map(TENS.map((word, i) => [word, i * 10]).filter(([word]) => word));

  // Word-by-word: "twenty one" -> 21, "one hundred" -> 100, "seven" -> 7. Hyphens are spaces by now, so
  // "twenty-one" arrives as two words.
  function numbersToDigits(words) {
    const out = [];
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      const next = words[i + 1];
      if (word === "one" && next === "hundred") {
        out.push("100");
        i += 1;
      } else if (TENS_VALUE.has(word)) {
        const unit = UNIT_VALUE.get(next);
        if (unit !== undefined && unit >= 1 && unit <= 9) {
          out.push(String(TENS_VALUE.get(word) + unit));
          i += 1;
        } else {
          out.push(String(TENS_VALUE.get(word)));
        }
      } else if (UNIT_VALUE.has(word)) {
        out.push(String(UNIT_VALUE.get(word)));
      } else {
        out.push(word);
      }
    }
    return out;
  }

  /** Lowercase, no accents or punctuation, "&" as "and", number words as digits, no leading "the". */
  function normalise(text) {
    const plain = String(text ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/&/g, " and ")
      .replace(/[-‐‑‒–—/\\]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, "");
    const words = numbersToDigits(plain.split(/\s+/).filter(Boolean));
    if (words[0] === "the" && words.length > 1) words.shift();
    return words.join(" ");
  }

  function letterCount(normalised) {
    return normalised.replace(/ /g, "").length;
  }

  /** Typo edits forgiven for an accepted answer: none under 5 letters, 1 from 5, 2 from 10 (spaces don't count). */
  function allowance(answer) {
    const letters = letterCount(normalise(answer));
    if (letters >= 10) return 2;
    if (letters >= 5) return 1;
    return 0;
  }

  /** Optimal string alignment distance: insert, delete, substitute or swap two neighbours, each one edit. */
  function distance(a, b) {
    const s = Array.from(a);
    const t = Array.from(b);
    const rows = Array.from({ length: s.length + 1 }, (_, i) => {
      const row = new Array(t.length + 1).fill(0);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= t.length; j += 1) rows[0][j] = j;
    for (let i = 1; i <= s.length; i += 1) {
      for (let j = 1; j <= t.length; j += 1) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
          rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
        }
      }
    }
    return rows[s.length][t.length];
  }

  /**
   * One answer box against one part. `exact` (spelling): only an exact match is right, never "close".
   * `joined` (crosswords): spaces are ignored on both sides, so OPEN ARMS and OPENARMS are the same.
   */
  function checkPart(typed, part, options = {}) {
    const squash = (text) => (options.joined ? normalise(text).replace(/ /g, "") : normalise(text));
    const answer = squash(typed);
    if (!answer) return "wrong";
    const accepts = (part.accept ?? []).map(squash).filter(Boolean);
    if (accepts.includes(answer)) return "right";
    if ((part.reject ?? []).map(squash).includes(answer)) return "wrong";
    if (options.exact) return "wrong";
    const near = accepts.map((accept) => {
      const letters = letterCount(accept);
      const leeway = letters >= 10 ? 2 : letters >= 5 ? 1 : 0;
      return { d: distance(answer, accept), leeway, letters };
    });
    if (near.some(({ d, leeway }) => d <= leeway)) return "right";
    if (near.some(({ d, leeway, letters }) => d > leeway && d <= leeway + 2 && d <= 0.4 * letters)) return "close";
    return "wrong";
  }

  // Every ordering of 0..n-1 (n is the number of boxes, at most a handful).
  function permutations(n) {
    if (n === 0) return [[]];
    return permutations(n - 1).flatMap((rest) =>
      Array.from({ length: n }, (_, at) => [...rest.slice(0, at), n - 1, ...rest.slice(at)]),
    );
  }

  function verdictOf(boxes) {
    if (boxes.every((box) => box === "right")) return "right";
    if (boxes.every((box) => box !== "wrong")) return "close";
    return "wrong";
  }

  /**
   * Every box of a question at once. `order: "fixed"` checks box i against part i (picture parts); `"any"`
   * pairs boxes with parts to get the most rights, then the most closes (text parts typed in any order).
   * `boxes[i]` is box i's own result; the verdict is right only when every box is.
   */
  function checkParts(typed, parts, options = {}) {
    const { order = "fixed", ...partOptions } = options;
    const boxText = (i) => typed[i] ?? "";
    if (order !== "any") {
      const boxes = parts.map((part, i) => checkPart(boxText(i), part, partOptions));
      return { verdict: verdictOf(boxes), boxes };
    }
    const results = typed.map((text) => parts.map((part) => checkPart(text, part, partOptions)));
    let best = null;
    for (const assignment of permutations(parts.length)) {
      // assignment[i] is the part box i is checked against.
      const boxes = assignment.map((partIndex, i) => (results[i] ? results[i][partIndex] : "wrong"));
      const rights = boxes.filter((box) => box === "right").length;
      const closes = boxes.filter((box) => box === "close").length;
      if (!best || rights > best.rights || (rights === best.rights && closes > best.closes)) {
        best = { boxes, rights, closes };
      }
    }
    return { verdict: verdictOf(best.boxes), boxes: best.boxes };
  }

  const api = { normalise, allowance, distance, checkPart, checkParts };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    window.cirrusly = window.cirrusly || {};
    window.cirrusly.match = api;
  }
})();
