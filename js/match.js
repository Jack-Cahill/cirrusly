// Answer matching for the game: pure functions, no DOM. The page uses them as window.cirrusly.match; Node
// tests load the same file with require() (module.exports).
//
//   normalise(text)                         the form both sides are compared in
//   joinedForm(text)                        a crossword's (`joined`) form instead: every letter, nothing between them
//   allowance(answer)                       typo edits forgiven for an accepted answer (0, 1 or 2)
//   distance(a, b)                          edit distance; a swap of two neighbouring letters is one edit
//   checkPart(typed, part, options)         "right" | "close" | "vague" | "wrong" for one answer box
//   checkParts(typed, parts, options)       every box of a multi-part question at once ("N of M" pools too), with
//                                           the message for a box that hit its part's close list
//   checkOrder(placed, items)               a drag-to-order question: each place right or wrong, all right to win
//   startOrder(items)                       the order its tiles start in: as listed, unless that is the answer
//
// A part is { accept: [...], reject?: [...], close?: [...], hint? }. Rejects are the traps (Austria for Australia):
// typed exactly (or with the same letters split differently), they are wrong even when they sit within typo reach of
// an accepted answer. "close" means a bigger near-miss that earns one retype; spelling questions (`exact`) never get
// one. "vague" is a close answer: on the right track but not specific enough ("Pyramids" for the Great Pyramid of
// Giza), listed in `close`; it earns the same retype, with the part's `hint` as its message.
// Typo leeway is sized on the whole answer but needs the same number of words ("Xbox Series" is not a typo of
// "Xbox Series S"); a one-word answer under 5 letters gets none, nor a "close" (Iran is not Iraq); and numbers get
// none: "30 Years War" is not a typo of "100 Years War", nor 1970s of 1960s, nor -9 of 9 (a minus sign counts only at
// the start of the box or right after "(": "(2x -1)" is a subtraction). A typo nearer a trap than the answer is
// the trap: wrong; one as near both is at best close. Crosswords (`joined`) take the grid's exact letters, spaces,
// punctuation and capitals aside (no article dropped, no number words read as digits): no typo leeway and no
// "close", though a close-list entry typed exactly is still "vague".
// Two part options widen what counts as right. `range: [low, high]` (with `units`, the words that may follow the
// number) takes any one number in that range, as though the accept list named each one alone and before each unit
// ("Within 5 feet accepted"). `extra: true` takes more words after an accepted answer ("Honda Accord Sport" for
// Honda Accord: a car's trim): the first answer named decides, so the opening words must be right on their own. Not
// when the text has "or", "and", a comma, slash or semicolon (other joining words are not looked for), nor when it
// holds a trap ("Civic Sport Type S" with Civic Type S rejected), nor after one of the part's `makes` (the make
// alone: "Honda Banana" is not a Honda's trim). On a part with `makes` a close answer (a model named alone) takes a
// trim too and stays close: "Accord Sport" is "Accord".

(() => {
  const UNITS = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  ];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const UNIT_VALUE = new Map(UNITS.map((word, value) => [word, value]));
  const TENS_VALUE = new Map(TENS.map((word, i) => [word, i * 10]).filter(([word]) => word));
  const ARTICLES = new Set(["the", "a", "an"]);
  const SUFFIXES = new Set(["jr", "sr"]);
  const HEDGES = new Set(["or", "and"]); // words that offer a second answer: "Honda Accord or Civic"
  // A minus sign, or the word "negative", before a number only at the start of the box or right after an opening
  // bracket, "(" or "[" (spaces allowed): "-9", "( -3 )", "negative nine". Before number words a dash is a sign only
  // when it touches them and they are all the box (or the brackets) holds: "-twenty" and "(-twelve)", but not the
  // titles "- One Direction", "-Ten Things I Hate About You" or "- Seven". Anywhere else a dash is a hyphen or a
  // subtraction ("(2x -1)(x -2)", "1990-1995"). The minus may be any dash a keyboard or phone gives: hyphen-minus,
  // minus sign, en or em dash, Unicode hyphens, fullwidth minus.
  const NUMBER_WORD = `(?:${[...UNITS, ...TENS.filter(Boolean), "hundred"].join("|")})`;
  const NUMBER_AHEAD = `(?=\\d|${NUMBER_WORD}\\b)`;
  const DASH = "[-\u2010-\u2015\u2212\uFF0D]";
  const MINUS_SIGN = new RegExp(`(^|[([])\\s*${DASH}\\s*(?=\\d)`, "gu");
  const MINUS_WORDS = new RegExp(
    `(^|[([])\\s*${DASH}(?=${NUMBER_WORD}(?:[\\s\u2010-\u2015-]+${NUMBER_WORD})*\\s*(?:$|[)\\]]))`,
    "gu",
  );
  const NEGATIVE = new RegExp(`(^|[([])\\s*negative\\s+${NUMBER_AHEAD}`, "gu");
  const DEFAULT_HINT = "Be more specific"; // a close answer's message when its part gives none

  // Word-by-word: "twenty one" -> 21, "one hundred" -> 100, "seven" -> 7. Hyphens are spaces by now, so
  // "twenty-one" arrives as two words. Ordinal words stay words ("Fourth" keeps its typo leeway, and "Fifty First
  // Dates" stays 50): an answer list gives both forms ("4th of July" and "Fourth of July").
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

  /**
   * Lowercase, no accents or punctuation, "&" as "and", "+" as "plus", number words as digits, no ordinal suffix
   * on digits ("26th" is "26"), and no leading
   * "the", "a" or "an" (one of them, and only when more words follow: a bare "A" stays). Dashes and slashes
   * separate words, but only after the article test, so "A-Team" keeps its "a" as "The A-Team" does. A minus sign
   * (or "negative") at the start or right after "(" becomes the word "minus": "-9" is "minus 9", never "9".
   */
  function normalise(text) {
    const tokens = symbolsAsWords(text)
      .replace(MINUS_SIGN, "$1 minus ")
      .replace(MINUS_WORDS, "$1 minus ")
      .replace(NEGATIVE, "$1 minus ")
      .replace(/[^\p{L}\p{N}\s\-‐‑‒–—/\\]/gu, "")
      .split(/\s+/)
      .filter((token) => /[\p{L}\p{N}]/u.test(token));
    if (ARTICLES.has(tokens[0]) && tokens.length > 1) tokens.shift();
    const words = tokens.join(" ").replace(/[-‐‑‒–—/\\]/g, " ").split(/\s+/).filter(Boolean);
    // An ordinal's suffix goes after its digits: "July 4th" is "july 4".
    return numbersToDigits(words)
      .map((word) => word.replace(/^(\d+)(?:st|nd|rd|th)$/, "$1"))
      .join(" ");
  }

  // Lowercase, no accents, "&" as "and" and "+" as "plus": the start of both forms.
  function symbolsAsWords(text) {
    return String(text ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/&/g, " and ")
      .replace(/\+/g, " plus ");
  }

  /**
   * A crossword answer as the grid holds it: every letter and digit in a row, with case, accents, spaces and
   * punctuation ignored and nothing else changed (a leading "A" or "The" is part of the answer, and "ONE" stays
   * letters), so A WAY is AWAY and An Thems is ANTHEMS.
   */
  function joinedForm(text) {
    return symbolsAsWords(text).replace(/[^\p{L}\p{N}]/gu, "");
  }

  function letterCount(normalised) {
    return normalised.replace(/ /g, "").length;
  }

  // Typo edits forgiven for so many letters: none under 5, 1 from 5, 2 from 10.
  function leewayFor(letters) {
    if (letters >= 10) return 2;
    if (letters >= 5) return 1;
    return 0;
  }

  /** Typo edits forgiven for an accepted answer: none under 5 letters, 1 from 5, 2 from 10 (spaces don't count). */
  function allowance(answer) {
    return leewayFor(letterCount(normalise(answer)));
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

  // The form both sides are compared in: a crossword's (`joined`) keeps every letter and drops the spaces.
  function fullForm(text, options) {
    return options.joined ? joinedForm(text) : normalise(text);
  }

  // A full form with a middle initial and a closing Jr or Sr left out, so "Harry S. Truman" is "Harry Truman" and
  // "Martin Luther King Jr." is "Martin Luther King". Only a single letter between two words counts as an initial: a
  // first or last one is part of the name ("A-Team", "Xbox Series X"). Crosswords keep every letter.
  function withoutInitials(full, options) {
    if (options.joined) return full;
    const words = full.split(" ");
    const kept = words.filter((word, at) => at === 0 || at === words.length - 1 || !/^\p{L}$/u.test(word));
    if (kept.length > 1 && SUFFIXES.has(kept[kept.length - 1])) kept.pop();
    return kept.join(" ");
  }

  // The form a pool's boxes are told apart in: "Harry Truman" and "Harry S. Truman" are one answer typed twice.
  function compared(text, options) {
    return withoutInitials(fullForm(text, options), options);
  }

  // Whether typed text (normalised) is a forgiven typo of an accepted answer: the same letters split into words
  // differently ("Good Year" for Goodyear), or the same number of words within the whole answer's allowance
  // ("Breakfast Clob" for The Breakfast Club; "Xbox Series" drops a word of "Xbox Series S", so it is not one).
  function withinLeeway(typed, accept) {
    if (typed.replace(/ /g, "") === accept.replace(/ /g, "")) return true;
    const sameWords = typed.split(" ").length === accept.split(" ").length;
    return sameWords && distance(typed, accept) <= leewayFor(letterCount(accept));
  }

  /**
   * One answer box against one part. `exact` (spelling): only an exact match is right, never "close" (a close
   * answer typed exactly is still "vague"). `joined` (crosswords): both sides are compared as `joinedForm`, every
   * letter with spaces, punctuation and case ignored (OPEN ARMS is OPENARMS, A WAY is AWAY), and as exact as
   * spelling: HOTMIK is wrong for HOTMIC, and only a close answer typed exactly (spaces aside) is "vague", never a
   * typo of one. A close answer never makes a box right. A part's `range` and `extra` (see the top of the file)
   * widen what is right.
   */
  function checkPart(typed, part, options = {}) {
    const answer = fullForm(typed, options);
    if (!answer) return "wrong";
    const added = rangeAccepts(typed, part);
    if (added === null) return "wrong";
    const whole = judge(answer, part, options, added);
    if (!part.extra || whole === "right" || whole === "vague") return whole;
    return withExtraWords(typed, answer, part, options) ?? whole;
  }

  // The accepts a part's `range` adds for typed text: the one number it gives, alone and before each of `units`
  // ("86" and "86 feet" for "86 ft"), when that number is in range. So a range checks exactly as a list naming every
  // number in it would, typos of a unit included ("86 fet"). Null when the number is out of range: wrong, even when
  // it looks like an accept once `normalise` drops its decimal point ("4035" for 403.5).
  function rangeAccepts(typed, part) {
    if (!Array.isArray(part.range)) return [];
    const number = typedNumber(typed);
    if (number === null) return [];
    const [low, high] = part.range;
    if (number.value < low || number.value > high) return null;
    return [number.form, ...(part.units ?? []).map((unit) => `${number.form} ${normalise(unit)}`)];
  }

  // The one number typed text gives: its value, and how `normalise` writes it ("403.5" is 403.5 and "4035";
  // "ninety" 90 and "90"; "-9" -9 and "minus 9"); null for none or more than one. Digits may carry thousands commas
  // and a decimal point or decimal comma ("403,5": a comma before one or two last digits), which `normalise` drops,
  // so they are read from the text; number words and a minus sign are read as `normalise` reads them.
  function typedNumber(typed) {
    const normalised = normalise(typed);
    const digits = normalised.match(/\d+/g) ?? [];
    if (digits.length !== 1) return null;
    const sign = new RegExp(`(?:^| )minus ${digits[0]}(?: |$)`).test(normalised) ? -1 : 1;
    const form = `${sign < 0 ? "minus " : ""}${digits[0]}`;
    const text = symbolsAsWords(typed).replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2"); // a decimal comma
    const written = text.match(/\d+(?:,\d{3})*(?:\.\d+)?|\.\d+/g) ?? [];
    if (written.length === 0) return { value: sign * Number(digits[0]), form }; // number words
    const plain = written.length === 1 ? written[0].replace(/,/g, "") : "";
    return plain.replace(".", "") === digits[0] ? { value: sign * Number(plain), form } : null;
  }


  // With `extra`: the longest run of opening words that is right on its own makes the whole answer right ("honda
  // accord" in "honda accord sport"). On a part with `makes` (a make question, so its close answers are models), a
  // run that is a close answer makes it that close answer ("accord" in "accord sport": vague, with the part's hint);
  // elsewhere a close answer is a make ("Honda" for the Civic Type R) and the words after it name another model
  // ("Honda Accord"), not a trim. Not when the answer hedges ("or", "and", a comma, slash or semicolon: other joining
  // words are not caught, but then the first answer named must already be right), nor when it or a longer opening
  // run is a trap, typed exactly or within its typo leeway ("Civic Type S Sport" with Civic Type S rejected is wrong
  // though Civic is accepted), nor when the extra words hold what sets a trap apart from that run ("Civic Hatchback
  // Type S": the reject's "type s" after "civic"). A run that is one of the part's `makes` (typos included) counts
  // for nothing: trim words follow a model. Null when no run decides.
  function withExtraWords(typed, answer, part, options) {
    const words = answer.split(" ");
    if (/[,/;]/.test(typed) || words.some((word) => HEDGES.has(word))) return null;
    const traps = (part.reject ?? []).map((text) => fullForm(text, options)).filter(Boolean);
    const isTrap = (text) =>
      traps.some((trap) => distance(spaceless(text), spaceless(trap)) <= leewayFor(letterCount(trap)));
    if (isTrap(answer)) return null;
    for (let k = words.length - 1; k >= 1; k -= 1) {
      const head = words.slice(0, k);
      const run = judge(head.join(" "), part, options, []);
      if (run === "right" || (run === "vague" && part.makes)) {
        if (judge(head.join(" "), { accept: part.makes ?? [] }, options, []) === "right") return null;
        const accepts = (part.accept ?? []).map((text) => fullForm(text, options)).filter(Boolean);
        return traps.some((trap) => trapTail(trap.split(" "), head, words.slice(k), accepts)) ? "wrong" : run;
      }
      if (isTrap(head.join(" "))) return "wrong";
    }
    return null;
  }

  // What is left of `words` after the opening words it shares with `head` ("type s" of "civic type s" after
  // "civic").
  function tailAfter(words, head) {
    let shared = 0;
    while (shared < words.length && shared < head.length && words[shared] === head[shared]) shared += 1;
    return words.slice(shared);
  }

  // Whether `extra` words hold a trap's own words: its tail after the opening `head` ("type s" after "civic"; "s"
  // after "civic type r"), anywhere among them, within that tail's leeway and strictly nearer it than every tail an
  // accept leaves after the same head (nearest wins: "type r" in "Civic Hatchback Type R" is the accept's "type r",
  // one letter from the trap's "type s").
  function trapTail(trap, head, extra, accepts) {
    const tail = tailAfter(trap, head);
    if (tail.length === 0 || tail.length > extra.length) return false;
    const trapText = spaceless(tail.join(" "));
    const acceptTexts = accepts
      .map((accept) => spaceless(tailAfter(accept.split(" "), head).join(" ")))
      .filter(Boolean);
    const allowed = leewayFor(trapText.length);
    for (let at = 0; at + tail.length <= extra.length; at += 1) {
      const run = spaceless(extra.slice(at, at + tail.length).join(" "));
      const toTrap = distance(run, trapText);
      if (toTrap <= allowed && acceptTexts.every((text) => toTrap < distance(run, text))) return true;
    }
    return false;
  }


  function spaceless(text) {
    return text.replace(/ /g, "");
  }


  // checkPart's rules for text already in its compared form, with `added` accepts (a range's) beside the part's own.
  function judge(answer, part, options, added) {
    const squash = (text) => fullForm(text, options);
    const accepts = [...(part.accept ?? []).map(squash).filter(Boolean), ...added];
    if (accepts.includes(answer)) return "right";
    // A reject matches as an accept's letters do: exactly, or split into words differently ("Xbox SeriesX").
    const spaceless = (text) => text.replace(/ /g, "");
    const rejects = (part.reject ?? []).map(squash).filter(Boolean).map(spaceless);
    if (rejects.includes(spaceless(answer))) return "wrong";
    // Close answers match as rejects do, and still in spelling and crosswords: a vaguer answer is not a misspelling.
    const closes = (part.close ?? []).map(squash).filter(Boolean);
    if (closes.map(spaceless).includes(spaceless(answer))) return "vague";
    // A crossword's grid fixes its letters, so a slip in one is another answer: no leeway, no "close".
    if (options.exact || options.joined) return "wrong";
    const nearest = (list) => Math.min(...list.map((text) => distance(spaceless(answer), text)));
    const toAccept = nearest(accepts.map(spaceless));
    const toTrap = nearest(rejects); // Infinity with no rejects
    // Typo leeway is for spelling: a changed number (16th for 26th) is another answer, never right or close. The
    // full forms go first; a name's middle initial or Jr/Sr left out on both sides is a second chance, only for
    // accepts and close answers (the rejects have their say through the nearest-wins rule).
    const numbers = (text) => (text.match(/(?:minus )?\d+/g) ?? []).join(" "); // -9 is not a typo of 9
    const loose = (text) => withoutInitials(text, options);
    const forgiven = (text) =>
      numbers(text) === numbers(answer) && (withinLeeway(answer, text) || withinLeeway(loose(answer), loose(text)));
    // A typo of a close answer is that close answer ("Pyramyds"), when it is nearer that close answer than every
    // accepted answer and every trap; a tie with either leaves it to the rules below, which ignore close answers, so
    // a close list never makes a trap's typo right or less wrong.
    const vague = closes.filter(forgiven);
    const toVague = nearest(vague.map(spaceless));
    if (toVague < toAccept && toVague < toTrap) return "vague";
    // Nearest wins: text nearer a trap than every accepted answer is the trap mistyped ("Fedralism" with Federalism
    // rejected for Feudalism), so it is wrong. Text exactly as near both ("Slovekia": Slovenia or rejected Slovakia)
    // is at best "close", so the player retypes the one they meant.
    const trap = rejects.length > 0 ? toTrap - toAccept : 1;
    if (trap < 0) return "wrong";
    if (accepts.some(forgiven)) return trap === 0 ? "close" : "right";
    const near = accepts.filter((accept) => numbers(accept) === numbers(answer));
    // Close is sized on the whole answer: up to 2 edits past its leeway, and no more than 40% of it. A one-word
    // answer under 5 letters is never close: one letter off is most often another real answer (Iran for Iraq).
    const closeTo = (accept) => {
      const letters = letterCount(accept);
      if (!accept.includes(" ") && letters < 5) return false;
      const d = distance(answer, accept);
      return d <= leewayFor(letters) + 2 && d <= 0.4 * letters;
    };
    return near.some(closeTo) ? "close" : "wrong";
  }

  // results[i][p] is box i checked against part p. Each box gets a different part (a box left over once every part
  // is taken is wrong), choosing the pairing with the most rights, then the most closes (a vague box is a close);
  // returns each box's part, or null for a box left over.
  // A depth-first search that drops a branch once even all-right from there on could not beat the best found, so a
  // pool of 10 parts for 5 boxes stays in the tens of thousands of steps at worst.
  function bestAssignment(results, partCount) {
    const taken = new Array(partCount).fill(false);
    const current = [];
    let best = null;
    function visit(box, rights, closes) {
      const ceiling = rights + results.length - box;
      if (best && (ceiling < best.rights || (ceiling === best.rights && closes <= best.closes))) return;
      if (box === results.length) {
        best = { parts: [...current], rights, closes };
        return;
      }
      const free = taken.flatMap((used, part) => (used ? [] : [part]));
      for (const part of free) {
        const result = results[box][part];
        taken[part] = true;
        current.push(part);
        visit(box + 1, rights + (result === "right"), closes + (result === "close" || result === "vague"));
        current.pop();
        taken[part] = false;
      }
      if (free.length === 0) {
        current.push(null);
        visit(box + 1, rights, closes);
        current.pop();
      }
    }
    visit(0, 0, 0);
    return best.parts;
  }

  // Each box's result and part (null for a box with none) -> the boxes as right, close or wrong, the message of
  // each vague box (its part's hint) and the verdict.
  function outcome(results, parts) {
    const boxes = results.map((result) => (result === "vague" ? "close" : result));
    const hints = results.map((result, i) => (result === "vague" ? parts[i].hint ?? DEFAULT_HINT : null));
    return { verdict: verdictOf(boxes), boxes, hints };
  }

  function verdictOf(boxes) {
    if (boxes.every((box) => box === "right")) return "right";
    if (boxes.every((box) => box !== "wrong")) return "close";
    return "wrong";
  }

  /**
   * Every box of a question at once. `order: "fixed"` checks box i against part i (picture parts); `"any"`
   * gives each box a different part, pairing them to get the most rights, then the most closes (text parts typed
   * in any order). `boxes` (any order only; default one per part) is how many boxes there are: "name 3 of these 7"
   * is 3 boxes and a pool of 7 parts. In any order a box repeating an earlier box's answer is wrong, so one answer
   * typed twice never counts twice, even when two parts accept it. `boxes[i]` in the result is box i's own result
   * ("right", "close" or "wrong"), `hints[i]` its message when it hit its part's close list (the part's `hint`, or
   * "Be more specific"), else null; the verdict is right only when every box is, and close only when none is wrong.
   */
  function checkParts(typed, parts, options = {}) {
    const { order = "fixed", boxes: boxCount = parts.length, ...partOptions } = options;
    const boxText = (i) => typed[i] ?? "";
    if (order !== "any") {
      const results = parts.map((part, i) => checkPart(boxText(i), part, partOptions));
      return outcome(results, parts);
    }
    const earlier = new Set();
    const results = Array.from({ length: boxCount }, (_, i) => {
      const text = boxText(i);
      const key = compared(text, partOptions);
      const repeat = key !== "" && earlier.has(key);
      earlier.add(key);
      return parts.map((part) => (repeat ? "wrong" : checkPart(text, part, partOptions)));
    });
    const chosen = bestAssignment(results, parts.length);
    return outcome(
      chosen.map((part, i) => (part === null ? "wrong" : results[i][part])),
      chosen.map((part) => (part === null ? null : parts[part])),
    );
  }

  /**
   * A drag-to-order question as it stands: `placed` is the item indices from the top down, `items` the question's
   * `[{ text, rank }]` (rank 1 at the top). `boxes[k]` says whether the item in place k (from 0) has rank k + 1; the
   * verdict is right only when every one has. There is no "close": an order is right or wrong.
   */
  function checkOrder(placed, items) {
    const boxes = placed.map((item, k) => (items[item].rank === k + 1 ? "right" : "wrong"));
    return { verdict: boxes.every((box) => box === "right") ? "right" : "wrong", boxes };
  }

  /**
   * The order a drag-to-order question's tiles start in, as item indices from the top down: as the question lists
   * them, unless that is already the right order (an instant Submit would win), then that list rotated up by one,
   * which is wrong for any 2 or more items (the item ranked 2nd is on top).
   */
  function startOrder(items) {
    const listed = items.map((_, i) => i);
    return checkOrder(listed, items).verdict === "right" ? [...listed.slice(1), listed[0]] : listed;
  }

  const api = { normalise, joinedForm, allowance, distance, checkPart, checkParts, checkOrder, startOrder };
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    window.cirrusly = window.cirrusly || {};
    window.cirrusly.match = api;
  }
})();
