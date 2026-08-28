(function () {
  "use strict";

  /* Mark JS as available so CSS can opacity:0 the .reveal elements —
     keeps them visible by default for no-JS visitors. */
  document.documentElement.classList.add("js");

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Mobile nav toggle ---------- */
  var navToggle = document.getElementById("nav-toggle");
  var mobileMenu = document.getElementById("mobile-menu");

  function closeMobileMenu() {
    if (!navToggle || !mobileMenu) return;
    navToggle.setAttribute("aria-expanded", "false");
    mobileMenu.setAttribute("data-state", "closed");
  }

  if (navToggle && mobileMenu) {
    navToggle.addEventListener("click", function () {
      var isOpen = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!isOpen));
      mobileMenu.setAttribute("data-state", isOpen ? "closed" : "open");
    });

    mobileMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMobileMenu);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMobileMenu();
    });

    // Close mobile menu automatically if viewport grows past the mobile breakpoint
    var desktopQuery = window.matchMedia("(min-width: 860px)");
    var handleBreakpointChange = function (e) {
      if (e.matches) closeMobileMenu();
    };
    if (typeof desktopQuery.addEventListener === "function") {
      desktopQuery.addEventListener("change", handleBreakpointChange);
    } else if (typeof desktopQuery.addListener === "function") {
      // Safari < 14 fallback
      desktopQuery.addListener(handleBreakpointChange);
    }
  }

  /* ---------- Accordion (FAQ) ---------- */
  var accordion = document.getElementById("accordion");
  if (accordion) {
    var triggers = accordion.querySelectorAll(".accordion__trigger");
    triggers.forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        var panelId = trigger.getAttribute("aria-controls");
        var panel = panelId ? document.getElementById(panelId) : null;
        var isOpen = trigger.getAttribute("aria-expanded") === "true";

        trigger.setAttribute("aria-expanded", String(!isOpen));
        if (panel) panel.hidden = isOpen;
      });
    });
  }

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
      );
      revealEls.forEach(function (el) { observer.observe(el); });
    } else {
      // No IntersectionObserver support: show everything immediately
      revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    }
  }

  /* ---------- Back-to-top button ---------- */
  var toTopBtn = document.getElementById("to-top");
  if (toTopBtn) {
    var toggleToTop = function () {
      var shouldShow = window.scrollY > 480;
      toTopBtn.hidden = !shouldShow;
    };
    toggleToTop();
    window.addEventListener("scroll", toggleToTop, { passive: true });

    toTopBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- Terminal panel animation ---------- */
  var terminalBody = document.getElementById("terminal-body");
  if (terminalBody) {
    var lines = [
      { text: "$ agent.request(quote, USDT-TBILL)", cls: "line-dim" },
      { text: "→ 402 Payment Required (x402)", cls: "" },
      { text: "$ agent.pay(0.004 ETH)", cls: "line-dim" },
      { text: "✓ payment settled · quote received", cls: "line-ok" },
      { text: "$ vault.checkLimits(trade)", cls: "line-dim" },
      { text: "✓ within policy: cap, slippage, allowlist", cls: "line-ok" },
      { text: "$ vault.settle(trade)", cls: "line-dim" },
      { text: "✓ settled on-chain · receipt #0x9f2…", cls: "line-ok" }
    ];

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      terminalBody.innerHTML = lines
        .map(function (l) {
          return '<div class="' + l.cls + '">' + escapeHtml(l.text) + "</div>";
        })
        .join("");
    } else {
      typeLines(terminalBody, lines);
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function typeLines(container, lines) {
    var lineIndex = 0;
    var charIndex = 0;
    var cursor = document.createElement("span");
    cursor.className = "panel__cursor";

    function step() {
      if (lineIndex >= lines.length) {
        // Restart the loop after a pause
        window.setTimeout(function () {
          container.innerHTML = "";
          lineIndex = 0;
          charIndex = 0;
          step();
        }, 2600);
        return;
      }

      var current = lines[lineIndex];
      var lineEl = container.lastElementChild;

      if (charIndex === 0) {
        lineEl = document.createElement("div");
        if (current.cls) lineEl.className = current.cls;
        container.appendChild(lineEl);
      }

      lineEl = container.lastElementChild;
      charIndex += 1;
      lineEl.textContent = current.text.slice(0, charIndex);
      lineEl.appendChild(cursor);

      if (charIndex >= current.text.length) {
        lineIndex += 1;
        charIndex = 0;
        window.setTimeout(step, 420);
      } else {
        window.setTimeout(step, 18);
      }
    }

    step();
  }

  /* ---------- Waitlist form ---------- */
  var waitlistForm = document.getElementById("waitlist-form");
  if (waitlistForm) {
    var emailInput = document.getElementById("email");
    var msgEl = document.getElementById("waitlist-msg");
    var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    waitlistForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!emailInput || !msgEl) return;

      var value = emailInput.value.trim();

      if (!value || !emailPattern.test(value)) {
        msgEl.textContent = "Enter a valid email address.";
        msgEl.setAttribute("data-tone", "error");
        emailInput.focus();
        return;
      }

      msgEl.textContent = "You're on the list — we'll be in touch.";
      msgEl.setAttribute("data-tone", "ok");
      waitlistForm.reset();
    });
  }
})();
