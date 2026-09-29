/* RSIC 2026, v7. Small enhancements plus the moving background; every page still reads fine without this file. */

(() => {
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // phone menu
  const head = document.querySelector(".site-head");
  const menuBtn = document.querySelector(".menu-btn");
  if (head && menuBtn) {
    root.classList.add("has-menu");
    const setOpen = (open) => {
      head.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
    };
    menuBtn.addEventListener("click", () =>
      setOpen(!head.classList.contains("open")),
    );
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && head.classList.contains("open")) {
        setOpen(false);
        menuBtn.focus();
      }
    });
    addEventListener("resize", () => {
      if (innerWidth > 1040) setOpen(false);
    });
    // the links rise in one after another (CSS reads --n)
    head
      .querySelectorAll(".site-nav a")
      .forEach((a, i) => a.style.setProperty("--n", i));
    // a tap outside the open menu only closes it, so it can't open a card by accident
    document.addEventListener(
      "click",
      (e) => {
        if (head.classList.contains("open") && !head.contains(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
      },
      true,
    );
  }

  // countdown to Friday 13 November 2026, 1:45 PM PKT (RSIC runs 13 to 15 November); each number rolls in when it changes
  const grid = document.querySelector("[data-countdown]");
  if (grid) {
    const target = new Date("2026-11-13T13:45:00+05:00").getTime();
    const cells = ["d", "h", "m", "s"].map((k) =>
      grid.querySelector(`[data-${k}]`),
    );
    const label = document.querySelector("[data-countdown-label]");
    const pad = (n) => String(n).padStart(2, "0");
    let started = false;
    const tick = () => {
      let left = Math.max(0, target - Date.now());
      const d = Math.floor(left / 864e5);
      left %= 864e5;
      const h = Math.floor(left / 36e5);
      left %= 36e5;
      const m = Math.floor(left / 6e4);
      left %= 6e4;
      const s = Math.floor(left / 1e3);
      [d, h, m, s].forEach((v, i) => {
        const cell = cells[i],
          text = pad(v);
        if (cell.textContent === text) return;
        cell.textContent = text;
        if (started && !reduce) {
          cell.classList.remove("tick");
          void cell.offsetWidth;
          cell.classList.add("tick");
        }
      });
      started = true;
      if (target <= Date.now()) {
        if (label) label.textContent = "RSIC is live";
        document.body.classList.add("rsic-live");
      }
    };
    tick();
    grid.classList.add("ready");
    setInterval(tick, 1000);
  }

  // experience list: items fade in as they scroll into view
  const revealItems = document.querySelectorAll(".reveal > li");
  if (revealItems.length && !reduce && "IntersectionObserver" in window) {
    root.classList.add("reveal-on");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("in-view");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.2 },
    );
    revealItems.forEach((el) => io.observe(el));
  }

  // lab: hover, focus or tap a realm to draw its pattern
  const labNodes = [...document.querySelectorAll(".lab-node")];
  if (labNodes.length) {
    const patterns = document.querySelectorAll(".lab-pattern");
    const caption = document.querySelector(".lab-caption");
    const activate = (node) => {
      labNodes.forEach((n) => {
        const on = n === node;
        n.classList.toggle("active", on);
        n.setAttribute("aria-pressed", String(on));
      });
      patterns.forEach((p) =>
        p.classList.toggle("active", p.dataset.for === node.dataset.key),
      );
      if (caption) caption.textContent = node.dataset.caption || "";
    };
    labNodes.forEach((n) =>
      ["mouseenter", "focus", "click"].forEach((ev) =>
        n.addEventListener(ev, () => activate(n)),
      ),
    );

    // touch screens: the list scrolls under the pinned diagram, and the realm passing just below it draws its pattern
    // (a quarter of the way into the free space, so the last realm still gets there before the list runs out)
    const stage = document.querySelector(".lab-stage");
    if (stage && matchMedia("(hover: none)").matches) {
      const list = labNodes[0].parentElement;
      let queued = false;
      const spy = () => {
        queued = false;
        const s = stage.getBoundingClientRect(),
          l = list.getBoundingClientRect();
        const stacked = s.left < l.right && s.right > l.left;
        const top = Math.max(s.bottom, 0);
        const line = stacked
          ? top + (innerHeight - top) * 0.25
          : innerHeight / 2;
        if (l.top > line || l.bottom < line) return;
        let best = null,
          bestD = Infinity;
        for (const n of labNodes) {
          const r = n.getBoundingClientRect(),
            d = Math.abs(r.top + r.height / 2 - line);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        if (best && !best.classList.contains("active")) activate(best);
      };
      addEventListener(
        "scroll",
        () => {
          if (!queued) {
            queued = true;
            requestAnimationFrame(spy);
          }
        },
        { passive: true },
      );
    }
  }

  // realm pages link here with ?realm=key, which ticks that realm
  const wantedRealm = new URLSearchParams(location.search).get("realm");
  if (wantedRealm) {
    const box = document.querySelector(
      `#registrationForm input[name="realms"][value="${CSS.escape(wantedRealm)}"]`,
    );
    if (box && !box.disabled) {
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
})();

/* ===== top bar, wordmark and small reactions ===== */
// Pointer reactions run even with reduced motion on: they're small and only happen when you point at something.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const touchUI = matchMedia("(hover: none)").matches;
  const head = document.querySelector(".site-head");

  // header tightens after you scroll, and a thin pink line shows how far down the page you are
  if (head) {
    const line = document.createElement("span");
    line.className = "scroll-line";
    line.setAttribute("aria-hidden", "true");
    head.appendChild(line);
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      line.style.setProperty(
        "--progress",
        (max > 0 ? Math.min(1, scrollY / max) : 0).toFixed(4),
      );
      head.classList.toggle("scrolled", scrollY > 24);
    };
    addEventListener(
      "scroll",
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    addEventListener("resize", update);
    update();
  }

  // RSIC wordmark: draws itself in on load, then the letters hop and the dot bounces whenever you point at it
  // (on a touch screen: when you tap it, when the menu opens, and when the footer one scrolls into view)
  const waves = new Map();
  document.querySelectorAll(".logo").forEach((logo) => {
    const letters = [...logo.querySelectorAll(".wm i:not(.dot)")];
    letters.forEach((el, i) => el.style.setProperty("--i", i));
    const play = (name) => {
      logo.classList.remove("draw", "wave");
      void logo.getBoundingClientRect();
      logo.classList.add(name);
    };
    logo.addEventListener("animationend", (e) => {
      if (e.target instanceof Element && e.target.classList.contains("dot"))
        logo.classList.remove("draw", "wave");
    });
    if (!reduce && head && head.contains(logo)) play("draw");
    const wave = () => {
      if (!logo.classList.contains("draw")) play("wave");
    };
    logo.addEventListener("pointerenter", wave);
    waves.set(logo, wave);
  });
  const menuBtn = document.querySelector(".menu-btn");
  const headLogo = head && head.querySelector(".logo");
  if (menuBtn && headLogo)
    menuBtn.addEventListener("click", () => {
      if (head.classList.contains("open")) waves.get(headLogo)();
    });

  // the big RSIC on the homepage: each letter nudges up when you point at it, or hops when you tap it
  const heroTitle = document.querySelector(".hero-title");
  if (heroTitle) {
    if (!heroTitle.querySelector(".hl")) {
      const word = heroTitle.textContent.trim();
      heroTitle.setAttribute("aria-label", word);
      heroTitle.innerHTML = [...word]
        .map(
          (c, i) =>
            `<span class="hl" style="--i:${i}" aria-hidden="true">${c}</span>`,
        )
        .join("");
    }
    heroTitle.addEventListener("pointerdown", (e) => {
      const hl =
        e.pointerType !== "mouse" &&
        e.target instanceof Element &&
        e.target.closest(".hl");
      if (hl) {
        hl.classList.remove("pop");
        void hl.offsetWidth;
        hl.classList.add("pop");
      }
    });
    heroTitle.addEventListener("animationend", (e) => {
      if (e.target instanceof Element) e.target.classList.remove("pop");
    });
    // with no hover to discover them, the letters say hello once after the wordmark has drawn itself
    if (touchUI && !reduce)
      setTimeout(() => {
        heroTitle.classList.add("hello");
        setTimeout(() => heroTitle.classList.remove("hello"), 1500);
      }, 1100);
  }

  const SPOT =
    ".realm-strip a,.map a,.principles>div,.disc-list a,.realm-card,.glyph-panel,.facts>div,.pager a,.exp-list li,.org-node,.lab-node,.tile,.info-card,.faq-item,.countdown-grid>div";

  // touch: pressing a box lights it from under your finger and sinks it slightly; a quick tap shows the same.
  // The class waits 70ms, so a scroll that starts on a card doesn't flash it.
  const PRESS =
    SPOT +
    ",.btn,.menu-btn,.site-nav a,.reg-switch button,.foot-links a,.crumb a,.logo";
  let press = null;
  const clearPress = () => {
    if (!press) return;
    clearTimeout(press.timer);
    if (press.el) press.el.classList.remove("is-pressed");
    press = null;
  };
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      clearPress();
      const el = e.target instanceof Element ? e.target.closest(PRESS) : null;
      press = { el, x: e.clientX, y: e.clientY, timer: 0 };
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
      press.timer = setTimeout(() => el.classList.add("is-pressed"), 70);
    },
    { passive: true },
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (
        press &&
        e.pointerType !== "mouse" &&
        Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10
      )
        clearPress();
    },
    { passive: true },
  );
  document.addEventListener("pointercancel", clearPress);
  document.addEventListener("pointerup", (e) => {
    if (!press || e.pointerType === "mouse") return;
    const { el, timer } = press;
    press = null;
    clearTimeout(timer);
    document.dispatchEvent(
      new CustomEvent("rsic:tap", { detail: { x: e.clientX, y: e.clientY } }),
    );
    if (!el) return;
    el.classList.add("is-pressed");
    setTimeout(() => el.classList.remove("is-pressed"), 220);
  });
  // coming back with the browser's back button shouldn't leave anything pressed
  addEventListener("pageshow", () =>
    document
      .querySelectorAll(".is-pressed")
      .forEach((el) => el.classList.remove("is-pressed")),
  );

  if (touchUI) {
    // headings draw their squiggle, glyphs turn and the footer wordmark hops, once, as they scroll into view
    if ("IntersectionObserver" in window) {
      const seen = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (!en.isIntersecting) return;
            seen.unobserve(en.target);
            if (waves.has(en.target)) waves.get(en.target)();
            else en.target.classList.add("in-view");
          }),
        { rootMargin: "0px 0px -12% 0px", threshold: 0.5 },
      );
      document
        .querySelectorAll(
          ".page-head,.section-head,.cta-band-inner,.exp-head,.countdown-inner,.realm-cta,.glyph-panel,.site-foot .logo",
        )
        .forEach((el) => seen.observe(el));
    }

    // the box crossing the middle of the screen gets the look a mouse would give it (one per group)
    const groups = [
      ".realm-grid .realm-card",
      ".realm-strip a",
      ".map a",
      ".principles>div",
      ".disc-list a",
      ".exp-list li",
      ".org-node",
      ".timeline li",
      ".gallery .tile",
      ".reg-side>div",
      ".pager a",
    ]
      .map((sel) => [...document.querySelectorAll(sel)])
      .filter((g) => g.length);
    if (groups.length) {
      let queued = false;
      const focus = () => {
        queued = false;
        const line = innerHeight * 0.48;
        for (const g of groups) {
          let best = null,
            bestD = Infinity;
          for (const el of g) {
            const r = el.getBoundingClientRect();
            if (r.bottom < line - 20 || r.top > line + 20) continue;
            const d = Math.abs(r.top + r.height / 2 - line);
            if (d < bestD) {
              bestD = d;
              best = el;
            }
          }
          for (const el of g)
            if ((el === best) !== el.classList.contains("is-focus"))
              el.classList.toggle("is-focus", el === best);
        }
      };
      addEventListener(
        "scroll",
        () => {
          if (!queued) {
            queued = true;
            requestAnimationFrame(focus);
          }
        },
        { passive: true },
      );
    }
  }

  if (!finePointer) return;

  // magnetic: the wordmark and the main buttons lean a few pixels toward the cursor
  document
    .querySelectorAll(
      ".site-head .logo,.nav-cta,.hero-actions .btn,.cta-band .btn,.realm-cta .btn,.form-actions .btn",
    )
    .forEach((el) => {
      const max = el.classList.contains("logo") ? 4 : 6;
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        el.style.setProperty("--bx", `${(x * max).toFixed(1)}px`);
        el.style.setProperty("--by", `${(y * max * 0.6).toFixed(1)}px`);
      });
      el.addEventListener("pointerleave", () => {
        el.style.removeProperty("--bx");
        el.style.removeProperty("--by");
      });
    });

  // spotlight: cards light up softly under the cursor
  document.addEventListener(
    "pointermove",
    (e) => {
      const el = e.target instanceof Element && e.target.closest(SPOT);
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    },
    { passive: true },
  );
})();

/* ===== night sky, realm drawings, head artwork ===== */
// Speckle stars and V6's realm drawings sit behind the content, and the RSIC head artwork tilts toward the cursor
// with a few hand-drawn doodles around it. With reduced motion on, the sky holds still; the artwork still follows the mouse.
(() => {
  const body = document.body;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const pointer = { x: innerWidth / 2, y: innerHeight / 2, active: false };
  addEventListener(
    "pointermove",
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    },
    { passive: true },
  );
  document.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget) pointer.active = false;
  });
  const rand = Math.random;

  // 1. sky like the Instagram posts: tiny twinkling stars and a few four-point sparkles, no joining lines
  const canvas = document.createElement("canvas");
  canvas.className = "particles";
  canvas.setAttribute("aria-hidden", "true");
  body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  let w = innerWidth,
    h = innerHeight;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const makeStars = () =>
    Array.from(
      { length: Math.min(260, Math.max(90, Math.floor((w * h) / 5200))) },
      () => ({
        x: rand() * w,
        y: rand() * h,
        r: 0.3 + rand() ** 2.2 * 1.2,
        a: 0.2 + rand() * 0.55,
        ph: rand() * 6.28,
        sp: 0.5 + rand() * 1.5,
        depth: 0.3 + rand() * 0.9,
        pink: rand() < 0.16,
      }),
    );
  let stars = makeStars();
  const sparkles = Array.from({ length: 8 }, () => ({
    x: rand(),
    y: rand(),
    size: 2.5 + rand() * 3.5,
    ph: rand() * 6.28,
    sp: 0.25 + rand() * 0.35,
    depth: 0.6 + rand() * 0.8,
    pink: rand() < 0.5,
  }));
  let px = 0,
    py = 0;
  const sparkle = (x, y, s) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
  };
  const drawSky = (t) => {
    const sec = t / 1000;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      if (!reduce) {
        s.y -= 0.012 * s.depth;
        if (s.y < 0) s.y += h;
      }
      let x = (s.x + px * s.depth) % w,
        y = (s.y + py * s.depth) % h;
      if (x < 0) x += w;
      if (y < 0) y += h;
      ctx.globalAlpha =
        s.a * (reduce ? 0.8 : 0.6 + 0.4 * Math.sin(sec * s.sp + s.ph));
      ctx.fillStyle = s.pink ? "#e7a3b6" : "#cfe0f7";
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, 6.283);
      ctx.fill();
    }
    for (const s of sparkles) {
      const tw = reduce
        ? 0.8
        : 0.35 + 0.65 * Math.max(0, Math.sin(sec * s.sp + s.ph));
      ctx.globalAlpha = 0.55 * tw;
      ctx.fillStyle = s.pink ? "#d0768f" : "#a9c8ef";
      const x = (((s.x * w + px * s.depth * 1.4) % w) + w) % w,
        y = (((s.y * h + py * s.depth * 1.4) % h) + h) % h;
      sparkle(x, y, s.size * (0.7 + 0.3 * tw));
    }
    ctx.globalAlpha = 1;
  };

  // 2. v6's realm drawings, styled like the atoms in the Instagram posts (blue lines, pink nuclei)
  const svg = (inner) =>
    `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const dot = (x, y, r) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#d0768f" stroke="none"/>`;
  const shapes = [
    {
      x: 5,
      y: 12,
      size: 260,
      depth: 1.2,
      dur: 64,
      svg: svg(
        `<circle cx="60" cy="60" r="20"/><circle cx="60" cy="60" r="36"/><circle cx="60" cy="60" r="52"/>${dot(80, 60, 2.5)}${dot(60, 24, 2)}`,
      ),
    },
    {
      x: 72,
      y: 6,
      size: 220,
      depth: 0.8,
      dur: 52,
      svg: svg(
        `<ellipse cx="60" cy="60" rx="50" ry="19"/><ellipse cx="60" cy="60" rx="50" ry="19" transform="rotate(60 60 60)"/><ellipse cx="60" cy="60" rx="50" ry="19" transform="rotate(120 60 60)"/>${dot(60, 60, 5)}${dot(110, 60, 2.5)}${dot(35, 17, 2.5)}`,
      ),
    },
    {
      x: 80,
      y: 56,
      size: 300,
      depth: 1.5,
      dur: 72,
      svg: svg(
        `<path d="M10 20H110M10 40H110M10 60H110M10 80H110M10 100H110M20 10V110M40 10V110M60 10V110M80 10V110M100 10V110" stroke-opacity=".55"/><path d="M20 100L100 20"/>`,
      ),
    },
    {
      x: 36,
      y: 70,
      size: 200,
      depth: 1,
      spin: true,
      dur: 90,
      svg: svg(
        `<path d="M60 16L98 38V82L60 104L22 82V38Z"/>${dot(60, 16, 4)}${dot(98, 38, 4)}${dot(98, 82, 4)}${dot(60, 104, 4)}${dot(22, 82, 4)}${dot(22, 38, 4)}`,
      ),
    },
    {
      x: -3,
      y: 60,
      size: 240,
      depth: 0.7,
      pink: true,
      dur: 58,
      svg: svg(
        `<path d="M20 12C50 32 70 32 100 12M20 42C50 62 70 62 100 42M20 72C50 92 70 92 100 72M20 102C50 122 70 122 100 102"/>`,
      ),
    },
    {
      x: 52,
      y: 28,
      size: 170,
      depth: 0.5,
      spin: true,
      dur: 120,
      svg: svg(`<circle cx="60" cy="60" r="44" stroke-dasharray="4 7"/>`),
    },
    {
      x: 22,
      y: 34,
      size: 150,
      depth: 1.8,
      dur: 44,
      svg: svg(
        `<ellipse cx="60" cy="60" rx="46" ry="17"/><ellipse cx="60" cy="60" rx="46" ry="17" transform="rotate(60 60 60)"/><ellipse cx="60" cy="60" rx="46" ry="17" transform="rotate(120 60 60)"/>${dot(60, 60, 5)}`,
      ),
    },
    {
      x: 88,
      y: 32,
      size: 160,
      depth: 1.1,
      pink: true,
      dur: 62,
      svg: svg(
        `<circle cx="60" cy="60" r="42"/><path d="M60 18V38M102 60H82M60 102V82M18 60H38M90 30L76 44M90 90L76 76M30 90L44 76M30 30L44 44"/>`,
      ),
    },
    {
      x: 60,
      y: 84,
      size: 210,
      depth: 0.9,
      dur: 56,
      svg: svg(
        `<path d="M60 14V96M22 92H98M60 14L26 40M60 14L94 40M14 40A12 12 0 0 0 38 40ZM82 40A12 12 0 0 0 106 40Z"/>`,
      ),
    },
  ];
  const layer = document.createElement("div");
  layer.className = "ambient";
  layer.setAttribute("aria-hidden", "true");
  const items = shapes.map((s, i) => {
    const el = document.createElement("div");
    el.className =
      "ambient-item" + (s.pink ? " pink" : "") + (s.spin ? " spin" : "");
    el.style.cssText = `left:${s.x}%;top:${s.y}%;width:${s.size}px;height:${s.size}px`;
    el.innerHTML = `<div class="ambient-shape" style="animation-duration:${s.dur}s;animation-delay:-${i * 7}s">${s.svg}</div>`;
    layer.appendChild(el);
    return { el, s, cx: 0, cy: 0, x: 0, y: 0, near: 0 };
  });
  canvas.after(layer);
  const place = () =>
    items.forEach((it) => {
      it.cx = (it.s.x / 100) * innerWidth + it.s.size / 2;
      it.cy = (it.s.y / 100) * innerHeight + it.s.size / 2;
    });
  place();
  // phone browsers resize the page whenever the address bar slides away; only a new width gets a fresh sky,
  // a new height just stretches the old one, so the stars don't jump while you scroll
  let skyW = w;
  addEventListener("resize", () => {
    const oldH = h;
    resize();
    if (w !== skyW) {
      skyW = w;
      stars = makeStars();
    } else if (oldH) for (const s of stars) s.y *= h / oldH;
    place();
    if (reduce) drawSky(0);
  });
  if (reduce) drawSky(0);

  // 3. the RSIC head artwork: hand-drawn doodles like the poster's, a tilt toward the cursor, and a spin of the doodles when clicked
  const fig = document.querySelector(".hero-poster");
  const heroImg = fig && fig.querySelector("img");
  let doodles = [];
  if (fig) {
    const d = (inner, filled) =>
      `<svg viewBox="0 0 40 40" fill="${filled ? "currentColor" : "none"}" stroke="${filled ? "none" : "currentColor"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const star =
      '<path d="M20 3c1.1 10 5.7 15.4 16.5 17-10.8 1.6-15.4 7-16.5 17C18.9 27 14.3 21.6 3.5 20 14.3 18.4 18.9 13 20 3z"/>';
    const spec = [
      {
        x: 10,
        y: 34,
        k: 6,
        depth: 1.6,
        color: "#d0768f",
        svg: d(star, true),
        ox: -14,
        oy: -8,
      },
      {
        x: 90,
        y: 26,
        k: 4,
        depth: 2.4,
        color: "#a9c8ef",
        svg: d(star, false),
        ox: 14,
        oy: -10,
      },
      {
        x: 13,
        y: 74,
        k: 7,
        depth: 1.1,
        color: "#7fb0e6",
        svg: d(
          '<path d="M21 20.5c1.6-1.6 4.1-.3 3.8 2-.4 3.2-4.6 4-6.9 2-3.3-2.9-2-8.3 2-9.5 5.3-1.6 10.2 2.5 9.8 8-.5 6.6-7.6 10.4-13.5 8"/>',
          false,
        ),
        ox: -12,
        oy: 10,
      },
      {
        x: 87,
        y: 70,
        k: 8,
        depth: 1.8,
        color: "#7fb0e6",
        svg: d(
          '<ellipse cx="20" cy="20" rx="16" ry="6.5" transform="rotate(-25 20 20)"/><circle cx="20" cy="20" r="3.2" fill="#d0768f" stroke="none"/>',
          false,
        ),
        ox: 14,
        oy: 10,
      },
      {
        x: 52,
        y: 7,
        k: 3.5,
        depth: 2.8,
        color: "#d0768f",
        svg: d('<path d="M20 8v24M8 20h24"/>', false),
        ox: 0,
        oy: -14,
      },
      {
        x: 30,
        y: 93,
        k: 4.5,
        depth: 1.4,
        color: "#d0768f",
        svg: d(
          '<circle cx="10" cy="24" r="2.6"/><circle cx="21" cy="15" r="1.9"/><circle cx="30" cy="26" r="1.4"/>',
          true,
        ),
        ox: -8,
        oy: 12,
      },
    ];
    const wrap = document.createElement("div");
    wrap.className = "doodles";
    wrap.setAttribute("aria-hidden", "true");
    doodles = spec.map((s, i) => {
      const el = document.createElement("span");
      el.className = "doodle";
      el.style.cssText = `left:${s.x}%;top:${s.y}%;--k:${s.k};--ox:${s.ox}px;--oy:${s.oy}px;--d:${(4 + i * 0.7).toFixed(1)}s;--delay:-${(i * 1.3).toFixed(1)}s;color:${s.color}`;
      el.innerHTML = s.svg;
      wrap.appendChild(el);
      return { el, depth: s.depth };
    });
    fig.appendChild(wrap);
    let awakeTimer = 0;
    fig.addEventListener("click", () => {
      fig.classList.remove("burst");
      void fig.offsetWidth;
      fig.classList.add("burst");
      // no hover on a touch screen, so a tap also wakes the artwork for a moment: halo up, doodles out
      if (!finePointer) {
        fig.classList.add("awake");
        clearTimeout(awakeTimer);
        awakeTimer = setTimeout(() => fig.classList.remove("awake"), 1800);
      }
    });
    fig.addEventListener("animationend", (e) => {
      if (e.animationName === "doodle-spin") fig.classList.remove("burst");
    });
  }

  // 4. faint page glow that follows the mouse (desktop only)
  let glow = null;
  if (finePointer) {
    glow = document.createElement("div");
    glow.className = "cursor-glow";
    glow.setAttribute("aria-hidden", "true");
    layer.after(glow);
  }

  // 5. touch screens: a tap sends a faint bloom of light through the sky, and nearby drawings drift out of its way
  const tap = { x: 0, y: 0, until: 0 };
  if (!finePointer) {
    const bloom = document.createElement("div");
    bloom.className = "touch-bloom";
    bloom.setAttribute("aria-hidden", "true");
    layer.after(bloom);
    document.addEventListener("rsic:tap", (e) => {
      tap.x = e.detail.x;
      tap.y = e.detail.y;
      tap.until = performance.now() + 900;
      bloom.style.left = `${tap.x}px`;
      bloom.style.top = `${tap.y}px`;
      bloom.classList.remove("on");
      void bloom.offsetWidth;
      bloom.classList.add("on");
    });
  }

  // with reduced motion and no mouse there is nothing left to animate
  if (reduce && !finePointer) return;

  // phones have no cursor to follow, so the artwork leans with the phone itself where the browser shares that
  // without a permission prompt (Android), and tips as you scroll past it everywhere
  const orient = { x: 0, y: 0, on: false };
  if (
    !finePointer &&
    heroImg &&
    "DeviceOrientationEvent" in window &&
    typeof DeviceOrientationEvent.requestPermission !== "function"
  ) {
    let base = null;
    addEventListener("deviceorientation", (e) => {
      if (e.beta == null || e.gamma == null) return;
      if (base === null) base = e.beta;
      base += (e.beta - base) * 0.004; // slowly re-centres, so however you hold the phone counts as level
      orient.x = Math.max(-1, Math.min(1, e.gamma / 20));
      orient.y = Math.max(-1, Math.min(1, (e.beta - base) / 20));
      orient.on = true;
    });
  }

  let gx = pointer.x,
    gy = pointer.y,
    lastScroll = scrollY,
    drag = 0;
  const tilt = { x: 0, y: 0 };
  const frame = (t) => {
    if (!reduce) {
      if (finePointer) {
        const tx = pointer.active ? -(pointer.x - w / 2) * 0.02 : 0;
        const ty = pointer.active ? -(pointer.y - h / 2) * 0.02 : 0;
        px += (tx - px) * 0.04;
        py += (ty - py) * 0.04;
      } else {
        // touch: the stars scroll a little with the page, deeper ones slower, so the sky has depth
        py += (-scrollY * 0.1 - py) * 0.18;
      }
      drawSky(t);

      // touch: the drawings sway with the scroll position and trail a little behind fast scrolls
      const v = scrollY - lastScroll;
      lastScroll = scrollY;
      drag += (Math.max(-40, Math.min(40, -v * 0.8)) - drag) * 0.1;
      const tapping = !finePointer && performance.now() < tap.until;
      const target = finePointer ? pointer : tap;
      const mx = pointer.x - innerWidth / 2,
        my = pointer.y - innerHeight / 2;
      const shrink = !finePointer && innerWidth <= 760 ? " scale(.7)" : "";
      items.forEach((it, i) => {
        // gentle parallax (deeper shapes move more), plus a soft push away from the pointer or the tap
        let ix,
          iy,
          near = 0;
        if (finePointer) {
          ix = -mx * it.s.depth * 0.02;
          iy = -my * it.s.depth * 0.02;
        } else {
          ix = Math.sin(scrollY * 0.0011 + i * 1.7) * 16 * it.s.depth;
          iy =
            drag * it.s.depth +
            Math.cos(scrollY * 0.0009 + i) * 20 * it.s.depth;
        }
        if (finePointer ? pointer.active : tapping) {
          const dx = it.cx + ix - target.x,
            dy = it.cy + iy - target.y,
            dist = Math.hypot(dx, dy) || 1,
            reach = it.s.size / 2 + 140;
          if (dist < reach) {
            const f = 1 - dist / reach;
            ix += (dx / dist) * f * 30;
            iy += (dy / dist) * f * 30;
            near = f;
          }
        }
        it.x += (ix - it.x) * 0.06;
        it.y += (iy - it.y) * 0.06;
        it.near += (near - it.near) * 0.08;
        it.el.style.transform = `translate3d(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px,0)${shrink}`;
        it.el.style.setProperty("--near", it.near.toFixed(3));
      });
    }

    if (glow) {
      const ease = reduce ? 1 : 0.1;
      gx += (pointer.x - gx) * ease;
      gy += (pointer.y - gy) * ease;
      glow.style.transform = `translate3d(${gx.toFixed(1)}px,${gy.toFixed(1)}px,0)`;
      glow.classList.toggle("on", pointer.active);
    }

    if (heroImg) {
      // the artwork turns a little to face the cursor, and the doodles drift further than the head for depth
      const r = fig.getBoundingClientRect();
      let nx = 0,
        ny = 0;
      if (r.bottom > 0 && r.top < innerHeight) {
        if (finePointer) {
          if (pointer.active) {
            nx = Math.max(
              -1,
              Math.min(
                1,
                (pointer.x - (r.left + r.width / 2)) / (r.width * 0.9),
              ),
            );
            ny = Math.max(
              -1,
              Math.min(
                1,
                (pointer.y - (r.top + r.height / 2)) / (r.height * 0.9),
              ),
            );
          }
        } else {
          // touch: tilt the phone and the head follows; scroll it up and it tips forward while the doodles rise past it
          if (orient.on) {
            nx = orient.x;
            ny = orient.y * 0.6;
          }
          ny = Math.max(
            -1,
            Math.min(
              1,
              ny + ((r.top + r.height / 2) / innerHeight - 0.5) * 2.2,
            ),
          );
        }
      }
      tilt.x += (nx - tilt.x) * 0.07;
      tilt.y += (ny - tilt.y) * 0.07;
      heroImg.style.transform = `perspective(1200px) rotateY(${(tilt.x * 9).toFixed(2)}deg) rotateX(${(-tilt.y * 7).toFixed(2)}deg) translate3d(${(tilt.x * 10).toFixed(1)}px,${(tilt.y * 8).toFixed(1)}px,0)`;
      for (const dd of doodles)
        dd.el.style.transform = `translate3d(${(tilt.x * dd.depth * 12).toFixed(1)}px,${(tilt.y * dd.depth * 10).toFixed(1)}px,0)`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();

// ---------------------------------------------------------------- backend
// After deploying the backend, put its address here, e.g.
//   const RSIC_API_BASE = "https://rsic-api.onrender.com";
// Left empty, the site talks to a backend running on this machine.
const RSIC_API_BASE = "";

const rsicApi = (path) => {
  const base =
    RSIC_API_BASE ||
    (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
      ? "http://localhost:5000"
      : "");
  return base.replace(/\/$/, "") + path;
};

// ---------------------------------------------------------------- editable text
// Anything with data-cms="some.key" is filled from the backend, so the admin
// dashboard can change it. If the backend is unreachable the page simply keeps
// the text that is already written into the HTML.
const rsicEscape = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const rsicSafeUrl = (v) => {
  const s = String(v).trim();
  return /^https?:\/\//i.test(s) || s.startsWith("/") ? s : "";
};

const rsicSetText = (el, value) => {
  if (value.includes("*"))
    el.innerHTML = rsicEscape(value).replace(/\*([^*]+)\*/g, "<em>$1</em>");
  else el.textContent = value;
};

const rsicContentReady = (async () => {
  try {
    const res = await fetch(rsicApi("/api/content"));
    if (!res.ok) return null;
    const { content } = await res.json();
    document.querySelectorAll("[data-cms]").forEach((el) => {
      const v = content[el.dataset.cms];
      if (v != null && v !== "") rsicSetText(el, v);
    });
    // links that only exist once a file has been uploaded, e.g. study guides
    document.querySelectorAll("[data-cms-href]").forEach((el) => {
      const v = rsicSafeUrl(content[el.dataset.cmsHref] || "");
      if (v) {
        el.href = v;
        el.hidden = false;
      }
    });

    // photos: set the src and reveal the image, otherwise the initials stay
    document.querySelectorAll("[data-cms-img]").forEach((el) => {
      const v = rsicSafeUrl(content[el.dataset.cmsImg] || "");
      if (v) {
        el.src = v;
        el.hidden = false;
        const box = el.closest(".member-photo");
        if (box) box.classList.add("has-photo");
      }
    });
    const noneNote = document.getElementById("formsNone");
    if (noneNote)
      noneNote.hidden = [...document.querySelectorAll("[data-cms-href]")].some(
        (el) => !el.hidden,
      );

    window.RSIC_CONTENT = content;
    document.dispatchEvent(new CustomEvent("rsic:content", { detail: content }));
    return content;
  } catch (err) {
    return null;
  }
})();

// ---------------------------------------------------------------- registration
// One route only: a school registers a delegation. Two realms are compulsory
// and the delegation picks the rest, within the limits the admin sets.
const regForm = document.getElementById("registrationForm");
const regStatus = document.getElementById("regStatus");
const regNote = document.getElementById("regNote");

if (regForm) {
  const submitBtn = regForm.querySelector('button[type="submit"]');
  const boxes = [...regForm.querySelectorAll('input[name="realms"]')];
  const optional = boxes.filter((b) => b.dataset.locked !== "yes");
  const locked = boxes.filter((b) => b.dataset.locked === "yes");
  const tally = document.getElementById("realmTally");
  const delegates = document.getElementById("s-delegates");
  const delegatesHint = document.getElementById("delegatesHint");
  const peopleField = document.getElementById("peopleField");
  const peopleList = document.getElementById("peopleList");

  const rules = {
    realmsMin: 5,
    realmsMax: 8,
    delegatesMin: 5,
    delegatesMax: 7,
  };
  let isOpen = false;

  const chosen = () =>
    locked.length + optional.filter((b) => b.checked).length;

  const realmsOk = () =>
    chosen() >= rules.realmsMin && chosen() <= rules.realmsMax;

  const delegatesOk = () => {
    const n = parseInt(delegates.value, 10);
    return (
      Number.isFinite(n) && n >= rules.delegatesMin && n <= rules.delegatesMax
    );
  };

  const paintTally = () => {
    const n = chosen();
    tally.textContent =
      n + " of " + rules.realmsMax + " realms chosen" +
      (n < rules.realmsMin
        ? ". Choose at least " + rules.realmsMin + "."
        : n > rules.realmsMax
          ? ". That is too many."
          : ".");
    tally.classList.toggle("is-bad", !realmsOk());
    // stop people going over the limit rather than telling them off afterwards
    optional.forEach((b) => {
      b.disabled = !b.checked && n >= rules.realmsMax;
      b.closest(".realm-pick").classList.toggle("is-full", b.disabled);
      b.closest(".realm-pick").classList.toggle("is-on", b.checked);
    });
    if (submitBtn && isOpen) submitBtn.disabled = !canSubmit();
  };

  const canSubmit = () => realmsOk() && delegatesOk() && peopleOk();
  const paintSubmit = () => {
    if (submitBtn && isOpen) submitBtn.disabled = !canSubmit();
  };

  optional.forEach((b) => b.addEventListener("change", paintTally));
  // One row of name, age and class per delegate. Rows are rebuilt when the
  // headcount changes, and anything already typed is carried over.
  // a rebuilt row cannot keep a chosen file, so the files are held here by index
  const photoFiles = [];

  const peopleValues = () =>
    [...peopleList.querySelectorAll(".person")].map((row) => ({
      name: row.querySelector('[data-f="name"]').value.trim(),
      email: row.querySelector('[data-f="email"]').value.trim(),
      phone: row.querySelector('[data-f="phone"]').value.trim(),
    }));

  const peopleOk = () => {
    const rows = peopleValues();
    return (
      rows.length === Math.max(0, parseInt(delegates.value, 10) - 1) &&
      rows.every((p, i) => p.name && p.email && p.phone && photoFiles[i])
    );
  };

  const buildPeople = () => {
    // the head delegate is collected above, so these are the others
    const wanted = delegatesOk() ? parseInt(delegates.value, 10) - 1 : 0;
    const kept = peopleValues();
    peopleField.hidden = wanted === 0;
    photoFiles.length = wanted;
    if (wanted === 0) return peopleList.replaceChildren();

    const rows = [];
    for (let i = 0; i < wanted; i++) {
      const had = kept[i] || { name: "", email: "", phone: "" };
      const row = document.createElement("div");
      row.className = "person";
      row.innerHTML =
        '<span class="person-n">' +
        (i + 2) +
        '</span><div class="field"><label for="p' +
        i +
        'n">Full name</label><input id="p' +
        i +
        'n" data-f="name" type="text" autocomplete="off"></div>' +
        '<div class="field"><label for="p' +
        i +
        'e">Email</label><input id="p' +
        i +
        'e" data-f="email" type="email" autocomplete="off"></div>' +
        '<div class="field"><label for="p' +
        i +
        'p">Number</label><input id="p' +
        i +
        'p" data-f="phone" type="tel" autocomplete="off"></div>' +
        '<div class="field"><label for="p' +
        i +
        'f">Photo</label><input id="p' +
        i +
        'f" data-f="photo" type="file" accept="image/jpeg,image/png,image/webp"></div>';
      row.querySelector('[data-f="name"]').value = had.name;
      row.querySelector('[data-f="email"]').value = had.email || "";
      row.querySelector('[data-f="phone"]').value = had.phone || "";
      const photo = row.querySelector('[data-f="photo"]');
      const note = document.createElement("small");
      note.className = "person-file";
      if (photoFiles[i]) note.textContent = photoFiles[i].name;
      photo.parentElement.append(note);
      photo.addEventListener("change", () => {
        photoFiles[i] = photo.files[0] || null;
        note.textContent = photoFiles[i] ? photoFiles[i].name : "";
        paintSubmit();
      });
      rows.push(row);
    }
    peopleList.replaceChildren(...rows);
    peopleList
      .querySelectorAll("input")
      .forEach((el) => el.addEventListener("input", paintSubmit));
  };

  delegates.addEventListener("input", () => {
    delegatesHint.classList.toggle(
      "is-bad",
      delegates.value !== "" && !delegatesOk(),
    );
    buildPeople();
    paintSubmit();
  });

  const applyRules = (content) => {
    const num = (key, fallback) => {
      const n = parseInt(content[key], 10);
      return Number.isFinite(n) ? n : fallback;
    };
    rules.realmsMin = num("registration.realms_min", 5);
    rules.realmsMax = num("registration.realms_max", 8);
    rules.delegatesMin = num("registration.delegates_min", 5);
    rules.delegatesMax = num("registration.delegates_max", 7);
    delegates.min = rules.delegatesMin;
    delegates.max = rules.delegatesMax;
    delegatesHint.textContent =
      rules.delegatesMin + " to " + rules.delegatesMax + " delegates.";
    paintTally();
  };

  const setOpenState = (content) => {
    isOpen = (content["registration.open"] || "off").toLowerCase() === "on";
    regForm.dataset.open = isOpen ? "yes" : "no";
    if (submitBtn) {
      submitBtn.textContent = isOpen ? "Register delegation ↗" : "Opens soon";
      submitBtn.disabled = !isOpen || !canSubmit();
    }
    if (regNote) {
      const note = isOpen
        ? content["registration.open_note"]
        : content["registration.closed_note"];
      if (note) rsicSetText(regNote, note);
    }
  };

  // The button starts disabled in the HTML, so an unreachable backend leaves it
  // shut rather than letting someone submit into nothing.
  rsicContentReady.then((content) => {
    if (!content) return paintTally();
    applyRules(content);
    setOpenState(content);
  });
  paintTally();

  regForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (regForm.dataset.open === "no") return;

    const value = (id) => (document.getElementById(id) || {}).value.trim();
    const problems = [];
    const file = (id) => (document.getElementById(id) || {}).files?.[0] || null;
    if (!value("s-school")) problems.push("your school's name");
    if (!value("s-school-email")) problems.push("a school email");
    if (!value("s-team")) problems.push("a team name");
    if (!value("s-sup-name")) problems.push("the supervisor's name");
    if (!value("s-sup-phone")) problems.push("the supervisor's number");
    if (!value("s-sup-email")) problems.push("the supervisor's email");
    if (!value("s-head-name")) problems.push("the head delegate's name");
    if (!value("s-head-email")) problems.push("the head delegate's email");
    if (!value("s-head-phone")) problems.push("the head delegate's number");
    if (!file("s-head-photo")) problems.push("a photo of the head delegate");

    if (!delegatesOk())
      problems.push(
        "between " + rules.delegatesMin + " and " + rules.delegatesMax + " delegates",
      );
    if (!realmsOk())
      problems.push(
        "between " + rules.realmsMin + " and " + rules.realmsMax + " realms",
      );
    if (delegatesOk() && !peopleOk())
      problems.push("a name, email, number and photo for every other delegate");

    if (problems.length) {
      regStatus.className = "reg-status is-bad";
      regStatus.textContent = "We still need " + problems.join(", ") + ".";
      return;
    }

    regStatus.className = "reg-status";
    regStatus.textContent = "Sending...";
    if (submitBtn) submitBtn.disabled = true;

    const payload = {
      route: "school",
      school: value("s-school"),
      schoolEmail: value("s-school-email"),
      teamName: value("s-team"),
      supervisorName: value("s-sup-name"),
      supervisorPhone: value("s-sup-phone"),
      supervisorEmail: value("s-sup-email"),
      headDelegate: {
        name: value("s-head-name"),
        email: value("s-head-email"),
        phone: value("s-head-phone"),
      },
      delegates: value("s-delegates"),
      realms: boxes.filter((b) => b.checked).map((b) => b.value),
      people: peopleValues(),
    };

    // files ride alongside the payload in one request, so nothing is stored
    // unless the whole registration is valid
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    form.append("photoHead", file("s-head-photo"));
    photoFiles.forEach((f, i) => f && form.append("photo" + i, f));

    try {
      const res = await fetch(rsicApi("/api/register"), {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        regStatus.className = "reg-status is-good";
        regStatus.textContent = data.message || "Registration received.";
        regForm.reset();
        photoFiles.length = 0;
        buildPeople();
        paintTally();
      } else {
        regStatus.className = "reg-status is-bad";
        regStatus.textContent =
          data.error || "That didn't go through. Check your details.";
      }
    } catch (err) {
      regStatus.className = "reg-status is-bad";
      regStatus.textContent =
        "We couldn't reach the server. Try again in a moment.";
    } finally {
      if (submitBtn) submitBtn.disabled = !isOpen || !canSubmit();
    }
  });
}
