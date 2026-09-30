// TEMPORARY: up/down buttons on the right edge for hopping between steps while the site is built.
// To remove them, delete this file and its <script> tag in index.html; nothing else refers to it.
// Uses only the public window.cirrusly API (world.js, start.js).

(() => {
  const style = document.createElement("style");
  style.textContent = `
    .dev-nav {
      position: fixed;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .dev-nav button {
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 50%;
      background: var(--readout-bg);
      color: #fff;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }
    .dev-nav button:disabled {
      opacity: 0.3;
      cursor: default;
    }
  `;
  document.head.append(style);

  const nav = document.createElement("nav");
  nav.className = "dev-nav";
  nav.setAttribute("aria-label", "Steps");
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "▲";
  up.setAttribute("aria-label", "Up one step");
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "▼";
  down.setAttribute("aria-label", "Down one step");
  nav.append(up, down);
  document.body.append(nav);

  const { cirrusly } = window;
  function sync() {
    up.disabled = cirrusly.currentStep() >= cirrusly.stepCount;
    down.disabled = cirrusly.currentStep() <= 1;
  }
  up.addEventListener("click", () => cirrusly.goToStep(cirrusly.currentStep() + 1));
  down.addEventListener("click", () => cirrusly.goToStep(cirrusly.currentStep() - 1));
  window.addEventListener("cirrusly:step", sync);
  sync();

  // After LIFTOFF each step acts as if every question below it was answered correctly: step n shows
  // question n (7 at most) with n - 1 balloons per corner (setBalloons caps them at 6).
  const questionText = document.querySelector(".qtext");
  window.addEventListener("cirrusly:step", ({ detail }) => {
    if (!document.documentElement.classList.contains("lifted-off")) return;
    cirrusly.question.show({ number: Math.min(detail.step, 7), text: questionText.textContent.trim() });
    cirrusly.question.setBalloons(detail.step - 1);
  });
})();
