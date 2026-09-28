(() => {
    "use strict";

    
    const TRAIL_MS     = 40;   
    const STAMP_GAP    = 2;    
    const SMEAR_ALPHA  = 0.05; 
    const BLUR_PX      = 0;    
    const PRESS_SQUASH = 0.85; 

    const STRETCH_MAX  = 0.6;  
    const STRETCH_SPD  = 30;   
    const STRETCH_THIN = 0.55; 
    const SPRING_K     = 0.18; 
    const SPRING_DAMP  = 0.6;  
    const ANGLE_LERP   = 0.35; 

    const HOTSPOT = { default: [0, 0], pointer: [0, 0] };

    const SRC = {
        default: "/cursors/circle.png",
        pointer: "/cursors/square.png",
    };

    if (!matchMedia("(pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.documentElement.classList.add("cursor-blur");

    const canvas = document.createElement("canvas");
    canvas.className = "cursor-canvas";
    const ctx = canvas.getContext("2d");
    document.body.append(canvas);

    let dead = false;
    function disable() {
        if (dead) return;
        dead = true;
        document.documentElement.classList.remove("cursor-blur");
        canvas.remove();
    }

    const sprites = {};
    for (const [mode, src] of Object.entries(SRC)) {
        const img = new Image();
        const s = { img, soft: null, ready: false };
        sprites[mode] = s;
        img.onload = () => {
            const soft = document.createElement("canvas");
            soft.width = img.naturalWidth;
            soft.height = img.naturalHeight;
            const g = soft.getContext("2d");
            if (typeof g.filter === "string") g.filter = `blur(${BLUR_PX}px)`;
            g.drawImage(img, 0, 0);
            s.soft = soft;
            s.ready = true;
        };
        img.onerror = disable; 
        img.src = src;
    }

    let dpr = 1;
    function resize() {
        dpr = devicePixelRatio || 1;
        canvas.width = innerWidth * dpr;
        canvas.height = innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    addEventListener("resize", resize);
    resize();

    const INTERACTIVE =
        "a, button, [role='button'], input, select, textarea, label, summary";

    let mx = -100, my = -100;
    let px = null, py = null;         
    let vx = 0, vy = 0;               
    let angle = 0;                    
    let stretch = 0, stretchVel = 0;  
    let mode = "default";
    let alpha = 0, targetAlpha = 0;   
    let press = 0, pressTarget = 0;   
    let lastT = 0;
    const trail = [];                 

    addEventListener("mousemove", (e) => {
        mx = e.clientX;
        my = e.clientY;
        targetAlpha = 1;
        mode = e.target instanceof Element && e.target.closest(INTERACTIVE)
            ? "pointer"
            : "default";
    }, { passive: true });

    addEventListener("mousedown", () => (pressTarget = 1));
    addEventListener("mouseup",   () => (pressTarget = 0));

    document.addEventListener("mouseleave", () => (targetAlpha = 0));
    document.addEventListener("mouseenter", () => (targetAlpha = 1));
    addEventListener("blur", () => (targetAlpha = 0));

    function frame(now) {
        if (dead) return;
        requestAnimationFrame(frame);

        const dt = Math.min(Math.max(now - lastT, 1), 100);
        lastT = now;
        const norm = 16.7 / dt;      

        alpha += (targetAlpha - alpha) * 0.18;
        press += (pressTarget - press) * 0.3;

        if (px === null) { px = mx; py = my; }
        vx += ((mx - px) * norm - vx) * 0.3;
        vy += ((my - py) * norm - vy) * 0.3;
        px = mx;
        py = my;

        const speed = Math.hypot(vx, vy);
        if (speed > 0.1) {
            let da = Math.atan2(vy, vx) - angle;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            angle += da * ANGLE_LERP;
        }

        const target = Math.min(speed / STRETCH_SPD, 1) * STRETCH_MAX;
        stretchVel += (target - stretch) * SPRING_K;
        stretchVel *= SPRING_DAMP;
        stretch += stretchVel;

        if (targetAlpha === 0 && alpha < 0.02) {
            trail.length = 0;
            vx = vy = stretch = stretchVel = 0;
            px = py = null;
            ctx.clearRect(0, 0, innerWidth, innerHeight);
            return;
        }

        trail.push({ x: mx, y: my, t: now });
        if (trail.length > 240) trail.shift();
        while (trail.length > 2 && now - trail[0].t > TRAIL_MS) trail.shift();

        ctx.clearRect(0, 0, innerWidth, innerHeight);

        const s = sprites[mode];
        if (!s || !s.ready) return;

        const { img, soft } = s;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const [hx, hy] = HOTSPOT[mode];

        for (let i = 1; i < trail.length; i++) {
            const a = trail[i - 1];
            const b = trail[i];
            const age = (now - b.t) / TRAIL_MS;      
            const fade = (1 - age) * (1 - age);
            const dist = Math.hypot(b.x - a.x, b.y - a.y);
            if (dist < 0.5) continue;                
            const steps = Math.ceil(dist / STAMP_GAP);
            for (let k = 0; k < steps; k++) {
                const f = k / steps;
                ctx.globalAlpha = SMEAR_ALPHA * alpha * fade;
                ctx.drawImage(
                    soft || img,
                    a.x + (b.x - a.x) * f - hx,
                    a.y + (b.y - a.y) * f - hy,
                    w, h
                );
            }
        }

        const scale = 1 - (1 - PRESS_SQUASH) * press;
        const sx = scale * (1 + stretch);
        const sy = scale / (1 + stretch * STRETCH_THIN);

        ctx.globalAlpha = alpha;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(angle);
        ctx.scale(sx, sy);
        ctx.rotate(-angle);
        ctx.drawImage(img, -hx, -hy, w, h);
        ctx.restore();
    }
    requestAnimationFrame(frame);
})();