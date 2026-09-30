(() => {
  "use strict";
  if (window.SmoothCursor) return;

  const DEFAULTS = {
    hoverSelector : "a, button, [data-cursor-hover]",
    morph         : true,
    ink           : true,
    inkSat        : 1.35,
    focusOutline  : true,
    stretch       : true,
    ripple        : true,
    color         : "#fff",
    circleSize    : 20,
    circleOpacity : 1,
    lensMode      : "auto",
    hideNative    : true,
    zIndex        : 2147483000
  };

  const CIRCLE  = { k:  300, z: 1.00 };
  const PRESS   = { k:  900, z: 0.75 };
  const WOBBLE  = { k:  500, z: 0.70 };
  const STRETCH_MAX = 0.15;
  const STRETCH_REF = 2500;
  const VEL_CLAMP   = 8000;
  const SETTLE_DIST = 0.4;
  const LOCK_MARGIN = 8;

  const CSS_BASE =
    "html.sc-on,html.sc-on *{cursor:none!important}" +
    ".sc-cursor{position:fixed;left:0;top:0;pointer-events:none;opacity:0;" +
    "transition:none!important;will-change:transform,opacity}" +
    // sites with "*{transition:all}" (yours does, with an overshooting --anim)
    // must NOT animate the cursor box — JS owns all size/radius motion:
    ".sc-ring,.sc-ret{transition:none!important}" +
    ".sc-ret i{position:absolute;pointer-events:none}" +
    ".sc-tk{background:var(--scc,#fff);width:2px;height:9px;opacity:0;" +
    "transition:transform .26s cubic-bezier(.2,1.2,.3,1),opacity .18s!important}" +
    ".sc-tk.n{left:50%;bottom:100%;margin:0 0 4px -1px;transform:translate(-50%,-9px)}" +
    ".sc-tk.s{left:50%;top:100%;margin:4px 0 0 -1px;transform:translate(-50%,9px)}" +
    ".sc-tk.w{top:50%;right:100%;width:9px;height:2px;margin:-1px 4px 0 0;transform:translate(-9px,-50%)}" +
    ".sc-tk.e{top:50%;left:100%;width:9px;height:2px;margin:-1px 0 0 4px;transform:translate(9px,-50%)}" +
    ".sc-aim .sc-tk{opacity:1}" +
    ".sc-aim .sc-tk.n,.sc-aim .sc-tk.s{transform:translate(-50%,0)}" +
    ".sc-aim .sc-tk.w,.sc-aim .sc-tk.e{transform:translate(0,-50%)}" +
    ".sc-dt{left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;" +
    "background:var(--scc,#fff);opacity:0;transform:scale(0);" +
    "transition:transform .24s cubic-bezier(.2,1.5,.4,1),opacity .15s!important}" +
    ".sc-aim .sc-dt{opacity:1;transform:scale(1)}" +
    ".sc-bk{width:11px;height:11px;border:0 solid var(--scc,#fff);opacity:0;" +
    "transition:transform .34s cubic-bezier(.2,1.2,.35,1),opacity .2s!important}" +
    ".sc-bk.tl{left:-16px;top:-16px;border-top-width:2px;border-left-width:2px;transform:translate(14px,14px) rotate(-45deg)}" +
    ".sc-bk.tr{right:-16px;top:-16px;border-top-width:2px;border-right-width:2px;transform:translate(-14px,14px) rotate(45deg)}" +
    ".sc-bk.bl{left:-16px;bottom:-16px;border-bottom-width:2px;border-left-width:2px;transform:translate(14px,-14px) rotate(45deg)}" +
    ".sc-bk.br{right:-16px;bottom:-16px;border-bottom-width:2px;border-right-width:2px;transform:translate(-14px,-14px) rotate(-45deg)}" +
    ".sc-lock .sc-bk{opacity:1;transform:translate(0,0)}" +
    ".sc-pl{inset:-4px;border:1px solid var(--scc,#fff);border-radius:inherit;opacity:0;" +
    "transition:opacity .3s}" +
    ".sc-lock .sc-pl{opacity:1;animation:sc-pulse 1.5s cubic-bezier(.2,.55,.35,1) infinite}" +
    ".sc-flat i{box-shadow:0 0 0 .5px rgba(0,0,0,.35)}" +
    ".sc-ripple{position:fixed;left:0;top:0;width:56px;height:56px;margin:-28px 0 0 -28px;" +
    "border:1px solid;border-radius:50%;pointer-events:none;" +
    "animation:sc-rip .5s cubic-bezier(.25,.6,.3,1) forwards}" +
    "@keyframes sc-rip{from{transform:translate3d(var(--x),var(--y),0) scale(calc(.5*var(--s,1)));opacity:.4}" +
    "to{transform:translate3d(var(--x),var(--y),0) scale(calc(1.6*var(--s,1)));opacity:0}}" +
    "@keyframes sc-pulse{0%{transform:scale(.92);opacity:.5}60%{opacity:0}100%{transform:scale(1.3);opacity:0}}" +
    "@media (prefers-reduced-motion:reduce){.sc-ret i{transition:none!important}" +
    ".sc-lock .sc-pl{animation:none!important}}" +
    "@media (pointer:coarse){.sc-cursor,.sc-ripple{display:none!important}}";

  const CSS_FOCUS =
    "a:focus-visible,button:focus-visible,[role=button]:focus-visible," +
    "[data-cursor-hover]:focus-visible{" +
    "outline:2px solid var(--ac,#8FDAFF)!important;outline-offset:3px}";

  let cfg, phys, running = false, rafId = 0, last = 0;
  let styleEl, ringEl, retEl, lens = null;
  let unbinds = [];

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

  function spawnRipple(x, y, s) {
    const r = document.createElement("span");
    r.className = "sc-ripple";
    r.style.zIndex = String(cfg.zIndex - 1000);
    r.style.borderColor = cfg.color;
    if (lens) r.style.mixBlendMode = "difference";
    r.style.setProperty("--x", x + "px");
    r.style.setProperty("--y", y + "px");
    if (s && s !== 1) r.style.setProperty("--s", String(s));
    document.documentElement.appendChild(r);   // <html>, not <body> (see init)
    r.addEventListener("animationend", function () { r.remove(); }, { once: true });
  }

  let circle, press, wobble;
  let mx = 0, my = 0, mouseSeen = false;   // real mouse position; focus never overwrites it
  let seen = false, out = false, down = false;
  let hoverEl = null, lockEl = null, lockKey = false;
  let vis = 0, stretch = 0, angle = 0;
  // live size/radius state (eased in JS — no CSS transitions on the box)
  let curW = 0, curH = 0, curR = null, lastW = "", lastH = "", lastR = "";

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return (r.width || r.height) ? r : null;
  }

  function applyBox() {
    const w = curW.toFixed(2) + "px", h = curH.toFixed(2) + "px";
    if (w !== lastW) { lastW = w; ringEl.style.width = w; retEl.style.width = w; }
    if (h !== lastH) { lastH = h; ringEl.style.height = h; retEl.style.height = h; }
  }
  function applyRadius(str) {
    if (str === lastR) return;
    lastR = str;
    ringEl.style.borderRadius = str;
    retEl.style.borderRadius = str;
  }

  function acquireLock(el, fromKey) {
    const again = lockEl === el;
    lockEl = el;
    lockKey = !!fromKey;
    retEl.classList.add("sc-aim", "sc-lock");
    if (!again) {
      wobble.v -= 6;
      if (phys.ripple) {
        const r = el.getBoundingClientRect();
        if (r.width || r.height) spawnRipple(r.left + r.width / 2, r.top + r.height / 2, 1.35);
      }
    }
    if (!mouseSeen) {           // keyboard-only session: snap to the element
      seen = true;
      const r = el.getBoundingClientRect();
      if (r.width || r.height) { circle.x = r.left + r.width / 2; circle.y = r.top + r.height / 2; }
    }
  }

  function releaseLock(kick) {
    if (!lockEl) return;
    lockEl = null;
    lockKey = false;
    retEl.classList.remove("sc-lock");
    if (!down) retEl.classList.remove("sc-aim");
    if (kick) wobble.v += 4;
    if (!mouseSeen) seen = false;
    syncFromPoint();
  }

  function syncFromPoint() {
    if (!document.elementFromPoint) return;
    const el = document.elementFromPoint(mx, my);
    hoverEl = (el instanceof Element) ? el.closest(cfg.hoverSelector) : null;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt <= 0 || dt > 0.5) return;
    dt = Math.min(dt, 1 / 30);

    let target = lockEl || hoverEl;
    let r = null;
    if (target) {
      r = rectOf(target);
      if (!r) {                                // element vanished / zero-size
        const wasLock = target === lockEl;
        if (wasLock) releaseLock(false);
        target = wasLock ? hoverEl : null;
        r = target ? rectOf(target) : null;
      }
    }

    // mouse lock breaks when the pointer leaves the element (+ slack)
    if (lockEl && !lockKey && r) {
      if (mx < r.left - LOCK_MARGIN || mx > r.right + LOCK_MARGIN ||
          my < r.top - LOCK_MARGIN || my > r.bottom + LOCK_MARGIN) {
        releaseLock(true);
        target = hoverEl;
        r = target ? rectOf(target) : null;
      }
    }

    let rtx = mx, rty = my;
    if (target && r) { rtx = r.left + r.width / 2; rty = r.top + r.height / 2; }

    step2D(circle, rtx, rty, dt);
    stepSpring(press, down ? 1 : 0, dt);
    const wob = stepSpring(wobble, down ? 0.9 : 1, dt);

    const morphOK = !!(target && cfg.morph && r && r.width && r.height &&
      r.width < innerWidth * 0.8 && r.height < innerHeight * 0.8);

    // Size + corner-radius targets, read LIVE every frame — never cached.
    // Your buttons change radius on :hover/:focus and your corner script toggles
    // corner-* classes (22px/5.5px asymmetric mixes); caching any of it = wrong corners.
    let tw = cfg.circleSize, th = cfg.circleSize, tRad = null, rawRad = null;
    if (morphOK) {
      tw = r.width; th = r.height;
      const cs = getComputedStyle(target);
      // TL, TR, BR, BL — same order as the CSS shorthand
      const c = [cs.borderTopLeftRadius, cs.borderTopRightRadius,
                 cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
      let pct = false;
      for (let i = 0; i < 4; i++) if (c[i].indexOf("%") >= 0) { pct = true; break; }
      // % radii (.close: 25% -> 100%) can't be eased as px — copy verbatim
      if (pct) rawRad = c; else tRad = c.map(parseFloat);
    }

    const es = phys.snap ? 1 : 1 - Math.exp(-18 * dt);  // frame-rate-independent ease
    curW += (tw - curW) * es;
    curH += (th - curH) * es;
    applyBox();

    if (rawRad) {
      curR = null;
      applyRadius(rawRad.join(" "));
    } else {
      const half = cfg.circleSize / 2;
      const t4 = tRad || [half, half, half, half];
      if (!curR) curR = [curW / 2, curW / 2, curW / 2, curW / 2];
      for (let i = 0; i < 4; i++) curR[i] += (t4[i] - curR[i]) * es;
      applyRadius(curR[0].toFixed(2) + "px " + curR[1].toFixed(2) + "px " +
                  curR[2].toFixed(2) + "px " + curR[3].toFixed(2) + "px");
    }

    // no stretch/tilt while shaped like an element (or locked) —
    // a stretched button-shaped lens reads as a glitch
    const spd = Math.hypot(circle.vx, circle.vy);
    const tSt = (lockEl || morphOK) ? 0 : Math.min(spd / phys.stretchRef, 1) * phys.stretchMax;
    stretch += (tSt - stretch) * Math.min(1, dt * 14);
    if (!lockEl && !morphOK && spd > 140) {
      const ta = Math.atan2(circle.vy, circle.vx);
      const da = ((ta - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      angle += da * Math.min(1, dt * 12);
    }

    const pd = 1 - press.x * 0.25;
    const w  = wob * (1 - press.x * 0.08);
    const sx = (1 + stretch) * pd * w;
    const sy = (1 - stretch * 0.6) * pd * w;
    const tf = "translate3d(" + circle.x + "px," + circle.y + "px,0) translate(-50%,-50%)" +
      " rotate(" + angle + "rad) scale(" + sx + "," + sy + ") rotate(" + (-angle) + "rad)";
    ringEl.style.transform = tf;
    retEl.style.transform = tf;

    vis += ((seen && !out ? 1 : 0) - vis) * Math.min(1, dt * 9);
    const op = String(vis * cfg.circleOpacity);
    ringEl.style.opacity = op;
    retEl.style.opacity = op;
  }

  function init(overrides) {
    if (running) destroy();
    cfg = Object.assign({}, DEFAULTS, overrides || {});

    if (!matchMedia("(pointer: fine)").matches) return false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    phys = reduced
      ? { stretchMax: 0, stretchRef: 1, ripple: false, snap: true }
      : { stretchMax: cfg.stretch ? STRETCH_MAX : 0, stretchRef: STRETCH_REF,
          ripple: cfg.ripple, snap: false };

    styleEl = document.createElement("style");
    styleEl.textContent = CSS_BASE + (cfg.focusOutline ? CSS_FOCUS : "");
    document.head.appendChild(styleEl);

    ringEl = document.createElement("div");           // the lens/dot cursor
    ringEl.className = "sc-cursor sc-ring";
    ringEl.style.width = ringEl.style.height = cfg.circleSize + "px";
    ringEl.style.borderRadius = "50%";
    ringEl.style.zIndex = String(cfg.zIndex);

    retEl = document.createElement("div");            // reticle overlay
    retEl.className = "sc-cursor sc-ret";
    retEl.style.width = retEl.style.height = cfg.circleSize + "px";
    retEl.style.borderRadius = "50%";
    retEl.style.zIndex = String(cfg.zIndex);
    retEl.style.setProperty("--scc", cfg.color);

    ["n", "s", "w", "e"].forEach(function (d) {
      const t = document.createElement("i"); t.className = "sc-tk " + d; retEl.appendChild(t);
    });
    ["tl", "tr", "bl", "br"].forEach(function (d) {
      const b = document.createElement("i"); b.className = "sc-bk " + d; retEl.appendChild(b);
    });
    const dot = document.createElement("i"); dot.className = "sc-dt"; retEl.appendChild(dot);
    const pl  = document.createElement("i"); pl.className  = "sc-pl"; retEl.appendChild(pl);

    // Mount on <html>, NOT <body>: your body runs `animation: popin` which
    // animates filter+transform — for those 350ms body becomes a containing
    // block for position:fixed and a backdrop root, breaking the lens/position.
    document.documentElement.appendChild(ringEl);
    document.documentElement.appendChild(retEl);

    lens = null;
    if (cfg.ink) {
      let mode = cfg.lensMode;
      if (mode === "auto") {
        const bfOK = typeof CSS !== "undefined" && CSS.supports &&
          (CSS.supports("backdrop-filter", "invert(1)") ||
           CSS.supports("-webkit-backdrop-filter", "invert(1)"));
        mode = bfOK ? "backdrop" : "difference";
      }
      if (mode === "backdrop") {
        const f = "invert(1) hue-rotate(180deg)" +
          (cfg.inkSat && cfg.inkSat !== 1 ? " saturate(" + cfg.inkSat + ")" : "");
        ringEl.style.webkitBackdropFilter = f;
        ringEl.style.backdropFilter = f;
        retEl.style.mixBlendMode = "difference";
        lens = "backdrop";
      } else if (mode === "difference") {
        ringEl.style.background = cfg.color;
        ringEl.style.mixBlendMode = "difference";
        retEl.style.mixBlendMode = "difference";
        lens = "difference";
      }
    }
    if (!lens) {
      ringEl.style.background = cfg.color;
      retEl.classList.add("sc-flat");
    }

    if (cfg.hideNative) document.documentElement.classList.add("sc-on");

    circle = mkFollower(CIRCLE.k, CIRCLE.z);
    press  = mkSpring(PRESS.k, PRESS.z);
    wobble = mkSpring(WOBBLE.k, WOBBLE.z);

    mx = innerWidth / 2; my = innerHeight / 2;
    mouseSeen = seen = out = down = false;
    hoverEl = lockEl = null; lockKey = false;
    vis = 0; stretch = 0; angle = 0;
    curW = curH = cfg.circleSize;
    curR = [cfg.circleSize / 2, cfg.circleSize / 2, cfg.circleSize / 2, cfg.circleSize / 2];
    lastW = lastH = lastR = "";

    const on = function (t, type, fn, opts) {
      t.addEventListener(type, fn, opts);
      unbinds.push(function () { t.removeEventListener(type, fn, opts); });
    };

    on(window, "pointermove", function (e) {
      if (e.pointerType === "touch") return;
      mx = e.clientX; my = e.clientY;
      mouseSeen = true;
      if (!seen) { seen = true; circle.x = mx; circle.y = my; }
    }, { passive: true });

    on(window, "pointerdown", function (e) {
      if (e.pointerType === "touch" || e.button !== 0) return;
      mx = e.clientX; my = e.clientY;
      mouseSeen = true;
      if (!seen) { seen = true; circle.x = mx; circle.y = my; }
      down = true;
      wobble.v -= 5;
      retEl.classList.add("sc-aim");                  // crosshair ticks pop on every click
      if (phys.ripple) spawnRipple(mx, my, 1);
      const el = e.target instanceof Element ? e.target.closest(cfg.hoverSelector) : null;
      if (el) acquireLock(el, false);                 // lock onto the clicked element
    });

    on(window, "pointerup", function (e) {
      if (e.pointerType === "touch" || e.button !== 0) return;
      down = false;
      wobble.v += 4;
      if (!lockEl) retEl.classList.remove("sc-aim");
    });
    on(window, "pointercancel", function () {
      down = false;
      if (!lockEl) retEl.classList.remove("sc-aim");
    });
    on(window, "blur", function () { down = false; out = true; });
    on(window, "focus", function () { out = false; });

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

    on(document, "focusin", function (e) {
      if (!(e.target instanceof Element)) return;
      const t = e.target.closest(cfg.hoverSelector);
      if (!t) return;
      let kv = true;
      try { kv = e.target.matches(":focus-visible"); } catch (_) {}
      if (!kv) return;
      acquireLock(t, true);
    });
    on(document, "focusout", function () {
      if (lockEl && lockKey) releaseLock(true);       // returns to TRUE mouse position
      else syncFromPoint();
    });

    on(window, "keydown", function (e) {
      if (e.key === "Escape" && lockEl) { releaseLock(true); return; }
      if (lockEl && lockKey && !e.repeat && (e.key === "Enter" || e.key === " ")) {
        wobble.v -= 8; press.v -= 3;
        const r = lockEl.getBoundingClientRect();
        if (phys.ripple && r.width) spawnRipple(r.left + r.width / 2, r.top + r.height / 2, 1.35);
      }
    });

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
    if (ringEl) ringEl.remove();
    if (retEl) retEl.remove();
    if (styleEl) styleEl.remove();
    ringEl = retEl = styleEl = null;
    lens = null;
    hoverEl = lockEl = null; lockKey = false;
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