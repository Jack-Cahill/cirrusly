// The reveal's lists and lines: what the player said, the marked order or sort, and the photo credits. Part
// of the game (game.js).

(() => {
  const { hiddenText } = window.cirrusly.game; // game-text.js
  const form = document.querySelector(".qbox");
  const el = (selector) => form.querySelector(selector);
  const reveal = el(".qreveal");
  const answerLine = reveal.querySelector(".qright");

  // A wrong reveal's line of what the player gave, above the answer: the typed text struck through in red, or each
  // box's text, a right one green with ✓ and a wrong one struck through (a blank box as "—"). Screen readers hear
  // "You said:" and "(wrong)". Nothing typed at all, a right answer, or a match or order question (no `given`): no
  // line.
  const saidLine = document.createElement("p");
  saidLine.className = "qsaid";
  saidLine.hidden = true;
  answerLine.before(saidLine);

  function showGiven(answer) {
    const { given } = answer;
    const boxes = typeof given === "string" ? [{ text: given }] : (given ?? []);
    const typed = answer.verdict === "wrong" && boxes.some((box) => box.text.trim() !== "");
    saidLine.hidden = !typed;
    saidLine.replaceChildren();
    if (!typed) return;
    const struck = (text) => {
      const wrong = document.createElement("s");
      wrong.className = "qsaid-wrong";
      wrong.textContent = text;
      return wrong;
    };
    saidLine.append(hiddenText("You said: "));
    if (typeof given === "string") {
      saidLine.append(struck(given.trim()));
      return;
    }
    boxes.forEach((box, i) => {
      const text = box.text.trim() || "—";
      if (i > 0) saidLine.append(" · ");
      if (box.result !== "right") {
        saidLine.append(struck(text), hiddenText(" (wrong)"));
        return;
      }
      const right = document.createElement("b");
      right.className = "qsaid-right";
      const mark = document.createElement("span");
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", "right");
      mark.textContent = "✓";
      right.append(text, " ", mark);
      saidLine.append(right);
    });
  }

  // The reveal's photo credits (the question's pictures and the reveal's), under the reveal's pictures: "Photo:", or
  // "Map:" for a map (`kind: "map"`). The links open a new tab, so the game stays where it is.
  const creditList = document.createElement("ul");
  creditList.className = "qcredits";
  creditList.hidden = true;
  el(".qreveal-pics").after(creditList);

  function outsideLink(href, text) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = text;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  function creditLine(credit) {
    const line = document.createElement("li");
    line.append(
      credit.kind === "map" ? "Map: " : "Photo: ",
      outsideLink(credit.source_url, `“${credit.title}”`),
      ` by ${credit.author}, `,
      outsideLink(credit.licence_url, credit.licence),
      credit.changes ? `. ${credit.changes}.` : ".",
    );
    return line;
  }

  // An order question's reveal: the right order once, numbered, each tile marked right if the player had it in that
  // place and wrong if not, as the match reveal marks its titles: the answer and the player's result in one list.
  const orderResult = document.createElement("ol");
  orderResult.className = "qorder-result qscroll"; // scrolls inside the box, as the match reveal does, so Next shows
  orderResult.hidden = true;
  answerLine.before(orderResult);

  function markedOrder(q, placed) {
    const right = q.items.map((_, i) => i).sort((a, b) => q.items[a].rank - q.items[b].rank);
    return right.map((item, k) => {
      const row = document.createElement("li");
      row.className = "qorder-row";
      const number = document.createElement("span");
      number.className = "qorder-num";
      number.setAttribute("aria-hidden", "true");
      number.textContent = String(k + 1);
      const here = placed[k] === item;
      row.append(
        number,
        markedTile("span", q.items[item].text, here, here ? " (you had it here)" : " (you had it elsewhere)"),
      );
      return row;
    });
  }

  // A tile as it was checked: its rim and mark show right or wrong, and a screen reader hears "(right)"/"(wrong)", or
  // `said` in their place.
  function markedTile(tagName, text, right, said = right ? " (right)" : " (wrong)") {
    const tile = document.createElement(tagName);
    tile.className = `qmatch-item qorder-placed is-${right ? "right" : "wrong"}`;
    const mark = document.createElement("span");
    mark.className = "qorder-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = right ? "✓" : "✗";
    const heard = document.createElement("span");
    heard.className = "qorder-said";
    heard.textContent = said;
    tile.append(text, heard, mark);
    return tile;
  }

  // A match question's reveal: the right sort, each title under its own group and marked right if the player put it
  // there, wrong if not (one left unsorted included), as the order reveal marks its places: the answer and the
  // player's result in one list. A screen reader hears where a wrong one went ("(you put this in DreamWorks)").
  const matchResult = document.createElement("div");
  matchResult.className = "qmatch-result qscroll"; // scrolls inside the box, as the match's tiles do, so Next shows
  matchResult.hidden = true;
  answerLine.before(matchResult);

  function markedSort(q, sorted) {
    const groups = document.createElement("div");
    groups.className = "qmatch-groups";
    groups.classList.toggle("rows", q.groups.length > 2);
    for (const [g, name] of q.groups.entries()) {
      const group = document.createElement("div");
      group.className = "qmatch-group";
      const heading = document.createElement("p");
      heading.className = "qmatch-name";
      heading.textContent = name;
      const list = document.createElement("ul");
      list.className = "qmatch-slot";
      list.append(
        ...q.items.flatMap((item, i) => (item.group === g ? [sortedTile(item.text, sorted[i], g, q.groups)] : [])),
      );
      group.append(heading, list);
      groups.append(group);
    }
    return groups;
  }

  // A title under its own group `home`, marked by the group the player put it in (`put`, null: not sorted).
  function sortedTile(text, put, home, groups) {
    if (put === home) return markedTile("li", text, true);
    const said = put === null ? " (you left this unsorted)" : ` (you put this in ${groups[put]})`;
    return markedTile("li", text, false, said);
  }

  window.cirrusly.game = {
    ...window.cirrusly.game,
    showGiven, creditList, creditLine, orderResult, markedOrder, matchResult, markedSort,
  };
})();
