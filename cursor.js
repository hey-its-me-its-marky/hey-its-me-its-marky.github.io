/*!
 * smooth-cursor.js — quiet / inverted edition
 * tiny dot · morphing hairline ring · HSL value-invert ink · a11y focus
 *
 * USAGE   <script src="smooth-cursor.js"></script>  before </body> — done.
 * CONFIG  SmoothCursor.init({ ...options }) — re-inits with new options
 * CLEANUP SmoothCursor.destroy()
 *
 * Ink effect (hover + keyboard focus): reads the element's computed colors,
 * inverts LIGHTNESS and boosts saturation (hue untouched), then picks text
 * from your --fg / --bg vars for guaranteed contrast. No filter:hue-rotate.
 */
(() => {
  "use strict";
  if (window.SmoothCursor) return;

  /* ============================ TUNE ME ============================ */
  const DEFAULTS = {
    hoverSelector : "a, button, [data-cursor-hover]",
    morph         : true,   // ring morphs into the hovered/focused element
    ink           : true,   // hover/focus: invert lightness + boost saturation
    inkSat        : 1.35,   // saturation multiplier on the flipped ink
    focusOutline  : true,   // thin :focus-visible outline (a11y fallback)
    stretch       : true,   // subtle velocity stretch
    ripple        : false,  // off — quiet mode
    dotSize       : 8,
    ringSize      : 26,
    ringOpacity   : 0.6,
    blend         : "difference", // cursor inverts what it covers
    hideNative    : true,
    zIndex        : 2147483000
  };

  // springs: k = stiffness, z = damping ratio (1 = calm, <1 = slight overshoot)
  const DOT     = { k: 2200, z: 0.88 };  // follows closely, no wobble
  const RING    = { k:  240, z: 1.00 };  // slow drift; morph target while hovering
  const PRESS   = { k:  900, z: 0.75 };  // soft dip, no boing
  const SHRINK  = { k:  300, z: 1.00 };  // dot shrink over interactive elements
  const WOBBLE  = { k:  500, z: 0.70 };  // faint ring pulse on press
  const STRETCH_MAX = 0.15;
  const STRETCH_REF = 3500;
  const VEL_CLAMP   = 8000;   // anti-shake: hard speed cap
  const SETTLE_DIST = 0.4;    // anti-shake: snap when close & slow
  /* ================================================================== */

  // no template literals, on purpose
  const CSS_BASE =
    "html.sc-on, html.sc-on * { cursor: none !important; }" +
    ".sc-cursor{position:fixed;left:0;top:0;border-radius:50%;" +
    "pointer-events:none;opacity:0;transition:none!important;" +
    "will-change:transform,opacity}" +
    ".sc-dot{background:#fff}" +
    ".sc-ring{border:1px solid #fff;" +
    "transition:width var(--anim,300ms),height var(--anim,300ms)," +
    "border-radius var(--anim,300ms)!important}" +
    ".sc-ripple{position:fixed;left:0;top:0;width:56px;height:56px;" +
    "margin:-28px 0 0 -28px;border:1px solid #fff;border-radius:50%;" +
    "pointer-events:none;animation:sc-rip .5s cubic-bezier(.25,.6,.3,1) forwards}" +
    "@keyframes sc-rip{" +
    "from{transform:translate3d(var(--x),var(--y),0) scale(.5);opacity:.4}" +
    "to{transform:translate3d(var(--x),var(--y),0) scale(1.6);opacity:0}}" +
    "@media (prefers-reduced-motion:reduce){" +
    ".sc-ring{transition:none!important}.sc-inked{transition:none!important}}" +
    "@media (pointer:coarse){.sc-cursor,.sc-ripple{display:none!important}}";

  const CSS_FOCUS =
    "a:focus-visible,button:focus-visible,[role=button]:focus-visible," +
    "[data-cursor-hover]:focus-visible{" +
    "outline:2px solid var(--ac,#8FDAFF)!important;outline-offset:3px}";

  let cfg, phys, running = false, rafId = 0, last = 0;
  let styleEl, dotEl, ringEl;
  let unbinds = [];

  /* ---- damped springs (semi-implicit Euler, frame-rate independent) ---- */
  const mkFollower = (k, z) => ({ k: k, c: z * 2 * Math.sqrt(k), x: 0, y: 0, vx: 0, vy: 0 });
  const mkSpring   = (k, z) => ({ k: k, c: z * 2 * Math.sqrt(k), x: 0, v: 0 });

  function step2D(f, tx, ty, dt) {
    f.vx += ((tx - f.x) * f.k - f.vx * f.c) * dt;
    f.vy += ((ty - f.y) * f.k - f.vy * f.c) * dt;
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > VEL_CLAMP) { const s = VEL_CLAMP / sp; f.vx *= s; f.vy *= s; }
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (Math.hypot(tx - f.x, ty - f.y) < SETTLE_DIST && sp < 25) {
      f.x = tx; f.y = ty; f.vx = f.vy = 0;
    }
  }
  function stepSpring(s, target, dt) {
    s.v += ((target - s.x) * s.k - s.v * s.c) * dt;
    s.x += s.v * dt;
    return s.x;
  }

  /* ---- ink: invert lightness + boost saturation, hue untouched ---- */
  function parseColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map(parseFloat);
    if (p.length < 3) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 360, s: s, l: l };
  }
  function flipInk(c) {
    const h = rgbToHsl(c.r, c.g, c.b);
    const s = Math.min(1, h.s * cfg.inkSat);
    const l = 1 - h.l;
    return {
      css: "hsla(" + h.h.toFixed(1) + "," + Math.round(s * 100) + "%," +
           Math.round(l * 100) + "%,1)",
      light: l > 0.45   // flipped patch is light -> use dark text, and vice versa
    };
  }

  let inkedEl = null;
  const inkPrev = { el: null, bg: "", color: "" };

  function applyInk(el) {
    if (!cfg.ink) return;
    const cs = getComputedStyle(el);
    const bg = parseColor(cs.backgroundColor);
    const fg = parseColor(cs.color);
    if (!fg) return;
    // remember any pre-existing inline styles so restore is lossless
    inkPrev.el = el;
    inkPrev.bg = el.style.backgroundColor;
    inkPrev.color = el.style.color;
    const patch = flipInk(bg && bg.a >= 0.5 ? bg : fg);
    el.style.backgroundColor = patch.css;
    // text pulls from the site's own palette -> contrast is guaranteed
    el.style.color = patch.light ? "var(--bg, #000)" : "var(--fg, #fff)";
    el.classList.add("sc-inked");
    inkedEl = el;
  }
  function restoreInk() {
    const el = inkedEl;
    if (!el) return;
    if (inkPrev.el === el) {
      el.style.backgroundColor = inkPrev.bg;
      el.style.color = inkPrev.color;
    } else {
      el.style.backgroundColor = "";
      el.style.color = "";
    }
    el.classList.remove("sc-inked");
    inkedEl = null; inkPrev.el = null;
  }
  function setActive(el) {
    if (el === inkedEl) return;
    restoreInk();
    if (el) applyInk(el);
  }

  function spawnRipple(x, y) {
    const r = document.createElement("span");
    r.className = "sc-ripple";
    r.style.zIndex = String(cfg.zIndex - 1000);
    r.style.setProperty("--x", x + "px");
    r.style.setProperty("--y", y + "px");
    document.body.appendChild(r);
    r.addEventListener("animationend", function () { r.remove(); }, { once: true });
  }

  /* ================================ LOOP ================================ */
  let dot, ring, press, shrinkS, wobble;
  let tx = 0, ty = 0, seen = false, out = false, down = false;
  let hoverEl = null, focusEl = null;   // mouse target / keyboard target
  let vis = 0, stretch = 0, angle = 0, morphed = false;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt <= 0 || dt > 0.5) return;      // tab hidden — skip, don't explode
    dt = Math.min(dt, 1 / 30);

    /* keyboard focus wins over mouse hover (a11y priority) */
    let target = focusEl || hoverEl;
    let r = null;
    if (target) {
      r = target.getBoundingClientRect();
      if (!r.width && !r.height) {        // element vanished from layout
        if (target === hoverEl) hoverEl = null;
        target = focusEl || hoverEl;
        r = target ? target.getBoundingClientRect() : null;
      }
    }
    setActive(target);

    /* ring chases the cursor, or the element's center while morphed */
    let rtx = tx, rty = ty;
    if (target && r) { rtx = r.left + r.width / 2; rty = r.top + r.height / 2; }

    step2D(dot, tx, ty, dt);
    step2D(ring, rtx, rty, dt);
    stepSpring(press, down ? 1 : 0, dt);
    stepSpring(shrinkS, target ? 1 : 0, dt);
    const wob = stepSpring(wobble, down ? 0.9 : 1, dt);

    /* morph: ring box + radius track the element live (reads its current
       computed radius, so it follows hover radius animations too) */
    const morphOK = !!(target && cfg.morph && r && r.width && r.height &&
      r.width < innerWidth * 0.8 && r.height < innerHeight * 0.8);
    if (morphOK) {
      ringEl.style.width = r.width + "px";
      ringEl.style.height = r.height + "px";
      const cs = getComputedStyle(target);
      ringEl.style.borderRadius =
        cs.borderTopLeftRadius + " " + cs.borderTopRightRadius + " " +
        cs.borderBottomRightRadius + " " + cs.borderBottomLeftRadius;
    } else if (morphed) {
      ringEl.style.width = cfg.ringSize + "px";
      ringEl.style.height = cfg.ringSize + "px";
      ringEl.style.borderRadius = "50%";
    }
    morphed = morphOK;

    /* faint stretch along the motion axis */
    const spd = Math.hypot(dot.vx, dot.vy);
    const tSt = Math.min(spd / phys.stretchRef, 1) * phys.stretchMax;
    stretch += (tSt - stretch) * Math.min(1, dt * 14);
    if (spd > 140) {
      const ta = Math.atan2(dot.vy, dot.vx);
      const da = ((ta - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      angle += da * Math.min(1, dt * 12);
    }

    const shrink = 1 - shrinkS.x * 0.4;   // dot shrinks over interactive elements
    const pd = 1 - press.x * 0.25;        // soft press dip
    const sx = (1 + stretch)       * shrink * pd;
    const sy = (1 - stretch * 0.6) * shrink * pd;
    dotEl.style.transform =
      "translate3d(" + dot.x + "px," + dot.y + "px,0) translate(-50%,-50%)" +
      " rotate(" + angle + "rad) scale(" + sx + "," + sy + ") rotate(" + (-angle) + "rad)";
    ringEl.style.transform =
      "translate3d(" + ring.x + "px," + ring.y + "px,0) translate(-50%,-50%)" +
      " scale(" + (wob * (1 - press.x * 0.08)) + ")";

    vis += ((seen && !out ? 1 : 0) - vis) * Math.min(1, dt * 9);
    dotEl.style.opacity = vis;
    ringEl.style.opacity = vis * cfg.ringOpacity;
  }

  /* ============================== LIFECYCLE ============================== */
  function init(overrides) {
    if (running) destroy();
    cfg = Object.assign({}, DEFAULTS, overrides || {});

    if (!matchMedia("(pointer: fine)").matches) return false; // touch -> native cursor
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    phys = reduced
      ? { stretchMax: 0, stretchRef: 1, ripple: false }
      : { stretchMax: cfg.stretch ? STRETCH_MAX : 0, stretchRef: STRETCH_REF,
          ripple: cfg.ripple };

    styleEl = document.createElement("style");
    styleEl.textContent = CSS_BASE + (cfg.focusOutline ? CSS_FOCUS : "");
    document.head.appendChild(styleEl);

    dotEl  = document.createElement("div");
    dotEl.className  = "sc-cursor sc-dot";
    dotEl.style.width  = cfg.dotSize + "px";
    dotEl.style.height = cfg.dotSize + "px";
    ringEl = document.createElement("div");
    ringEl.className = "sc-cursor sc-ring";
    ringEl.style.width  = cfg.ringSize + "px";
    ringEl.style.height = cfg.ringSize + "px";
    ringEl.style.borderRadius = "50%";
    const els = [dotEl, ringEl];
    for (let i = 0; i < els.length; i++) {
      els[i].style.zIndex = String(cfg.zIndex);
      els[i].style.mixBlendMode = cfg.blend;
      document.body.appendChild(els[i]);
    }
    if (cfg.hideNative) document.documentElement.classList.add("sc-on");

    dot     = mkFollower(DOT.k, DOT.z);
    ring    = mkFollower(RING.k, RING.z);
    press   = mkSpring(PRESS.k, PRESS.z);
    shrinkS = mkSpring(SHRINK.k, SHRINK.z);
    wobble  = mkSpring(WOBBLE.k, WOBBLE.z);

    tx = innerWidth / 2; ty = innerHeight / 2;
    seen = out = down = false;
    hoverEl = focusEl = null;
    vis = 0; stretch = 0; angle = 0; morphed = false;

    const on = function (t, type, fn, opts) {
      t.addEventListener(type, fn, opts);
      unbinds.push(function () { t.removeEventListener(type, fn, opts); });
    };

    /* anti-shake: pointermove only records a target — all motion resolves
       once per frame, so high-polling-rate bursts can't shake anything */
    on(window, "pointermove", function (e) {
      if (e.pointerType === "touch") return;
      tx = e.clientX; ty = e.clientY;
      if (!seen) { seen = true; dot.x = ring.x = tx; dot.y = ring.y = ty; }
    }, { passive: true });

    on(window, "pointerdown", function (e) {
      if (e.pointerType === "touch" || e.button !== 0) return;
      down = true;
      wobble.v -= 5;
      if (phys.ripple) spawnRipple(e.clientX, e.clientY);
    });
    on(window, "pointerup",     function () { down = false; wobble.v += 4; });
    on(window, "pointercancel", function () { down = false; });
    on(window, "blur",          function () { down = false; out = true; });
    on(window, "focus",         function () { out = false; });

    on(document, "pointerover", function (e) {
      if (!(e.target instanceof Element)) return;
      hoverEl = e.target.closest(cfg.hoverSelector);
    });
    on(document, "pointerout", function (e) {
      if (!hoverEl) return;
      const rel = e.relatedTarget;
      if (rel instanceof Element && hoverEl.contains(rel)) return;
      hoverEl = null;
    });

    /* keyboard a11y: ink + ring wrap the focused control, and the cursor
       jumps to it so sighted keyboard users can track focus */
    on(document, "focusin", function (e) {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      const t = el.closest(cfg.hoverSelector);
      if (!t) return;
      let kv = true;
      try { kv = el.matches(":focus-visible"); } catch (_) {}
      if (!kv) return;                    // mouse click-focus: no ink
      focusEl = t;
      const r = t.getBoundingClientRect();
      if (r.width || r.height) { tx = r.left + r.width / 2; ty = r.top + r.height / 2; }
      if (!seen) { seen = true; dot.x = ring.x = tx; dot.y = ring.y = ty; }
      wobble.v -= 6;
    });
    function syncFromPoint() {
      if (!document.elementFromPoint) return;
      const el = document.elementFromPoint(tx, ty);
      hoverEl = (el instanceof Element) ? el.closest(cfg.hoverSelector) : null;
    }
    on(document, "focusout", function () { focusEl = null; syncFromPoint(); });

    on(document.documentElement, "mouseleave", function () { out = true; });
    on(document.documentElement, "mouseenter", function () { out = false; });

    last = performance.now();
    running = true;
    rafId = requestAnimationFrame(frame);
    return true;
  }

  function destroy() {
    if (!running && !styleEl) return;
    cancelAnimationFrame(rafId);
    running = false;
    for (let i = 0; i < unbinds.length; i++) unbinds[i]();
    unbinds.length = 0;
    restoreInk();
    if (dotEl)  dotEl.remove();
    if (ringEl) ringEl.remove();
    if (styleEl) styleEl.remove();
    dotEl = ringEl = styleEl = null;
    document.documentElement.classList.remove("sc-on");
    document.querySelectorAll(".sc-ripple").forEach(function (r) { r.remove(); });
  }

  window.SmoothCursor = { init: init, destroy: destroy, get active() { return running; } };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { window.SmoothCursor.init(); }, { once: true });
  } else {
    window.SmoothCursor.init();
  }
})();