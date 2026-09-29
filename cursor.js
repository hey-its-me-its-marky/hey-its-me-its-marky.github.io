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

  const CSS_BASE =
    "html.sc-on, html.sc-on * { cursor: none !important; }" +
    ".sc-cursor{position:fixed;left:0;top:0;border-radius:50%;" +
    "pointer-events:none;opacity:0;transition:none!important;" +
    "will-change:transform,opacity}" +
    ".sc-circle{" +  
    "transition:width var(--anim,300ms),height var(--anim,300ms)," +
    "border-radius var(--anim,300ms)!important}" +
    ".sc-ripple{position:fixed;left:0;top:0;width:56px;height:56px;" +
    "margin:-28px 0 0 -28px;border:1px solid;border-radius:50%;" +
    "pointer-events:none;animation:sc-rip .5s cubic-bezier(.25,.6,.3,1) forwards}" +
    "@keyframes sc-rip{" +
    "from{transform:translate3d(var(--x),var(--y),0) scale(.5);opacity:.4}" +
    "to{transform:translate3d(var(--x),var(--y),0) scale(1.6);opacity:0}}" +
    "@media (prefers-reduced-motion:reduce){" +
    ".sc-circle{transition:none!important}}" +
    "@media (pointer:coarse){.sc-cursor,.sc-ripple{display:none!important}}";

  const CSS_FOCUS =
    "a:focus-visible,button:focus-visible,[role=button]:focus-visible," +
    "[data-cursor-hover]:focus-visible{" +
    "outline:2px solid var(--ac,#8FDAFF)!important;outline-offset:3px}";

  let cfg, phys, running = false, rafId = 0, last = 0;
  let styleEl, circleEl, lens = null;  
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

  function spawnRipple(x, y) {
    const r = document.createElement("span");
    r.className = "sc-ripple";
    r.style.zIndex = String(cfg.zIndex - 1000);
    r.style.borderColor = cfg.color;
    if (lens) r.style.mixBlendMode = "difference"; 
    r.style.setProperty("--x", x + "px");
    r.style.setProperty("--y", y + "px");
    document.body.appendChild(r);
    r.addEventListener("animationend", function () { r.remove(); }, { once: true });
  }

  let circle, press, wobble;
  let tx = 0, ty = 0, seen = false, out = false, down = false;
  let hoverEl = null, focusEl = null;  
  let vis = 0, stretch = 0, angle = 0, morphed = false;

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt <= 0 || dt > 0.5) return;    
    dt = Math.min(dt, 1 / 30);


    let target = focusEl || hoverEl;
    let r = null;
    if (target) {
      r = target.getBoundingClientRect();
      if (!r.width && !r.height) {    
        if (target === hoverEl) hoverEl = null;
        target = focusEl || hoverEl;
        r = target ? target.getBoundingClientRect() : null;
      }
    }

    let rtx = tx, rty = ty;
    if (target && r) { rtx = r.left + r.width / 2; rty = r.top + r.height / 2; }

    step2D(circle, rtx, rty, dt);
    stepSpring(press, down ? 1 : 0, dt);
    const wob = stepSpring(wobble, down ? 0.9 : 1, dt);

    const morphOK = !!(target && cfg.morph && r && r.width && r.height &&
      r.width < innerWidth * 0.8 && r.height < innerHeight * 0.8);
    if (morphOK) {
      circleEl.style.width = r.width + "px";
      circleEl.style.height = r.height + "px";
      const cs = getComputedStyle(target);
      circleEl.style.borderRadius =
        cs.borderTopLeftRadius + " " + cs.borderTopRightRadius + " " +
        cs.borderBottomRightRadius + " " + cs.borderBottomLeftRadius;
    } else if (morphed) {
      circleEl.style.width = cfg.circleSize + "px";
      circleEl.style.height = cfg.circleSize + "px";
      circleEl.style.borderRadius = "50%";
    }
    morphed = morphOK;

    const spd = Math.hypot(circle.vx, circle.vy);
    const tSt = Math.min(spd / phys.stretchRef, 1) * phys.stretchMax;
    stretch += (tSt - stretch) * Math.min(1, dt * 14);
    if (spd > 140) {
      const ta = Math.atan2(circle.vy, circle.vx);
      const da = ((ta - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      angle += da * Math.min(1, dt * 12);
    }

    const pd = 1 - press.x * 0.25;      
    const w  = wob * (1 - press.x * 0.08);
    const sx = (1 + stretch)       * pd * w;
    const sy = (1 - stretch * 0.6) * pd * w;
    circleEl.style.transform =
      "translate3d(" + circle.x + "px," + circle.y + "px,0) translate(-50%,-50%)" +
      " rotate(" + angle + "rad) scale(" + sx + "," + sy + ") rotate(" + (-angle) + "rad)";

    vis += ((seen && !out ? 1 : 0) - vis) * Math.min(1, dt * 9);
    circleEl.style.opacity = vis * cfg.circleOpacity;
  }

  function init(overrides) {
    if (running) destroy();
    cfg = Object.assign({}, DEFAULTS, overrides || {});

    if (!matchMedia("(pointer: fine)").matches) return false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    phys = reduced
      ? { stretchMax: 0, stretchRef: 1, ripple: false }
      : { stretchMax: cfg.stretch ? STRETCH_MAX : 0, stretchRef: STRETCH_REF,
          ripple: cfg.ripple };

    styleEl = document.createElement("style");
    styleEl.textContent = CSS_BASE + (cfg.focusOutline ? CSS_FOCUS : "");
    document.head.appendChild(styleEl);

    circleEl = document.createElement("div");
    circleEl.className = "sc-cursor sc-circle";
    circleEl.style.width  = cfg.circleSize + "px";
    circleEl.style.height = cfg.circleSize + "px";
    circleEl.style.zIndex = String(cfg.zIndex);

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
        circleEl.style.webkitBackdropFilter = f;   
        circleEl.style.backdropFilter = f;
        lens = "backdrop";
      } else if (mode === "difference") {
        circleEl.style.background = cfg.color;     
        circleEl.style.mixBlendMode = "difference";
        lens = "difference";
      }
    }
    if (!lens) circleEl.style.background = cfg.color; 

    document.body.appendChild(circleEl);

    if (cfg.hideNative) document.documentElement.classList.add("sc-on");

    circle = mkFollower(CIRCLE.k, CIRCLE.z);
    press  = mkSpring(PRESS.k, PRESS.z);
    wobble = mkSpring(WOBBLE.k, WOBBLE.z);

    tx = innerWidth / 2; ty = innerHeight / 2;
    seen = out = down = false;
    hoverEl = focusEl = null;
    vis = 0; stretch = 0; angle = 0; morphed = false;

    const on = function (t, type, fn, opts) {
      t.addEventListener(type, fn, opts);
      unbinds.push(function () { t.removeEventListener(type, fn, opts); });
    };

    on(window, "pointermove", function (e) {
      if (e.pointerType === "touch") return;
      tx = e.clientX; ty = e.clientY;
      if (!seen) { seen = true; circle.x = tx; circle.y = ty; }
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

    on(document, "focusin", function (e) {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      const t = el.closest(cfg.hoverSelector);
      if (!t) return;
      let kv = true;
      try { kv = el.matches(":focus-visible"); } catch (_) {}
      if (!kv) return;                    
      focusEl = t;
      const r = t.getBoundingClientRect();
      if (r.width || r.height) { tx = r.left + r.width / 2; ty = r.top + r.height / 2; }
      if (!seen) { seen = true; circle.x = tx; circle.y = ty; }
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
    if (circleEl) circleEl.remove();
    if (styleEl) styleEl.remove();
    circleEl = styleEl = null;
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