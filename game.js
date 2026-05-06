/* Cactus Craze — Vanilla JS Platformer (GitHub Pages friendly)
   - Physics: AABB collisions (axis-separated)
   - Hazards: cactus spikes (ouch)
   - Collectibles: water drops (open exit)
   - Enemies: tumbleweeds (stomp to defeat)
*/

(() => {
  // ===== Canvas setup (virtual resolution) =====
  const V_W = 960, V_H = 540;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Scale for crisp pixels on high-DPI screens
  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(V_W * dpr);
    canvas.height = Math.floor(V_H * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ===== HUD =====
  const hudLevel = document.getElementById("hud-level");
  const hudWater = document.getElementById("hud-water");
  const hudScore = document.getElementById("hud-score");

  // ===== Overlay UI =====
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayBody = document.getElementById("overlay-body");
  const btnPrimary = document.getElementById("btn-primary");
  const btnSecondary = document.getElementById("btn-secondary");

  // ===== Touch buttons =====
  const btnLeft = document.getElementById("btn-left");
  const btnRight = document.getElementById("btn-right");
  const btnJump = document.getElementById("btn-jump");

  // ===== Input =====
  const input = {
    left: false,
    right: false,
    jumpHeld: false,
    jumpPressed: false, // edge trigger
  };

  function setPressed(name, value) {
    if (name === "jumpHeld") {
      if (value && !input.jumpHeld) input.jumpPressed = true;
      input.jumpHeld = value;
    } else {
      input[name] = value;
    }
  }

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowleft","a"].includes(k)) setPressed("left", true);
    if (["arrowright","d"].includes(k)) setPressed("right", true);
    if (["arrowup","w"," "].includes(k)) setPressed("jumpHeld", true);
    if (["arrowleft","arrowright","arrowup"," "].includes(k)) e.preventDefault();
    unlockAudio();
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowleft","a"].includes(k)) setPressed("left", false);
    if (["arrowright","d"].includes(k)) setPressed("right", false);
    if (["arrowup","w"," "].includes(k)) setPressed("jumpHeld", false);
  });

  // Touch / pointer controls: pointerdown ~ keydown, pointerup ~ keyup [2](https://developer.ibm.com/tutorials/wa-games/)
  function bindHold(btn, onDown, onUp) {
    const down = (e) => { e.preventDefault(); onDown(); unlockAudio(); };
    const up = (e) => { e.preventDefault(); onUp(); };
    btn.addEventListener("pointerdown", down, { passive: false });
    btn.addEventListener("pointerup", up, { passive: false });
    btn.addEventListener("pointercancel", up, { passive: false });
    btn.addEventListener("pointerleave", up, { passive: false });
  }
  bindHold(btnLeft,  () => setPressed("left", true),  () => setPressed("left", false));
  bindHold(btnRight, () => setPressed("right", true), () => setPressed("right", false));
  bindHold(btnJump,  () => setPressed("jumpHeld", true), () => setPressed("jumpHeld", false));

  // ===== Audio (tiny synth) =====
  let audioCtx = null;
  function unlockAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }
  function beep(freq = 440, dur = 0.06, type = "sine", vol = 0.05) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  }

  // ===== Helpers =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function drawRoundedRect(x, y, w, h, r) {
    r = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  // ===== Game objects / state =====
  const GRAV = 2200;
  const MOVE_ACCEL = 4200;
  const MAX_SPEED = 420;
  const FRICTION = 0.86;
  const JUMP_V = 760;

  const state = {
    mode: "title", // title | playing | dead | complete | win | help
    levelIndex: 0,
    score: 0,
    cameraX: 0,
    waterCollected: 0,
    waterTotal: 0,

    player: null,
    solids: [],
    hazards: [],
    water: [],
    enemies: [],
    exit: null,
    exitOpen: false,
  };

  function makePlayer(spawn) {
    return {
      x: spawn.x,
      y: spawn.y,
      w: 34,
      h: 48,
      vx: 0,
      vy: 0,
      onGround: false,
      coyote: 0,      // seconds
      jumpBuffer: 0,  // seconds
      facing: 1,
      invuln: 0
    };
  }

  function loadLevel(i) {
    const L = LEVELS[i];
    state.levelIndex = i;
    state.cameraX = 0;
    state.waterCollected = 0;
    state.waterTotal = L.water.length;
    state.exitOpen = false;

    state.solids = L.platforms.map(p => ({...p}));
    state.hazards = L.hazards.map(h => ({...h}));
    state.water = L.water.map(w => ({ x: w.x, y: w.y, r: 12, taken: false }));
    state.enemies = (L.enemies || []).map(e => ({
      x: e.x, y: e.y, w: 40, h: 28,
      vx: 120, vy: 0,
      baseX: e.x, patrol: e.patrol || 220,
      alive: true
    }));
    state.exit = {...L.exit};

    state.player = makePlayer(L.spawn);

    hudLevel.textContent = `Level: ${i + 1} — ${L.name}`;
    hudWater.textContent = `Water: 0/${state.waterTotal}`;
    hudScore.textContent = `Score: ${state.score}`;
  }

  function setOverlay(show, title, body, primaryText, secondaryText) {
    if (show) overlay.classList.remove("hidden");
    else overlay.classList.add("hidden");
    overlayTitle.textContent = title;
    overlayBody.innerHTML = body;
    btnPrimary.textContent = primaryText || "Continue";
    btnSecondary.textContent = secondaryText || "How to Play";
  }

  function toTitle() {
    state.mode = "title";
    state.score = 0;
    loadLevel(0);
    setOverlay(
      true,
      "Cactus Craze",
      `Move with <b>A/D</b> or <b>←/→</b>. Jump with <b>Space</b>/<b>W</b>/<b>↑</b>.<br/>
       Collect <b>all water drops</b> to open the oasis gate.`,
      "Start",
      "How to Play"
    );
  }

  function toHelp() {
    state.mode = "help";
    setOverlay(
      true,
      "How to Play",
      `🌵 <b>Goal:</b> collect all <b>water drops</b> to open the exit gate.<br/>
       ⚠️ <b>Spikes hurt.</b> Avoid cactus patches.<br/>
       🟤 <b>Tumbleweeds:</b> stomp from above to defeat (and score).<br/>
       ✨ <b>Pro tip:</b> You have a tiny “coyote time” window after leaving a ledge.`,
      "Back",
      "Start"
    );
  }

  function startGame() {
    state.mode = "playing";
    setOverlay(false);
    // small “start” sound
    beep(660, 0.05, "triangle", 0.06);
    beep(880, 0.06, "triangle", 0.05);
  }

  function die() {
    if (state.mode !== "playing") return;
    state.mode = "dead";
    beep(140, 0.12, "sawtooth", 0.06);
    setOverlay(
      true,
      "Ouch. That cactus was personal.",
      `Press <b>Start</b> to retry this level.`,
      "Retry",
      "How to Play"
    );
  }

  function completeLevel() {
    state.mode = "complete";
    beep(740, 0.06, "triangle", 0.06);
    beep(990, 0.08, "triangle", 0.05);

    const isLast = state.levelIndex === LEVELS.length - 1;
    if (isLast) {
      state.mode = "win";
      setOverlay(
        true,
        "You found the Oasis! 🏝️",
        `Final Score: <b>${state.score}</b><br/>Thanks for playing <b>Cactus Craze</b>.`,
        "Play Again",
        "How to Play"
      );
    } else {
      setOverlay(
        true,
        "Gate Opened! 🌊",
        `Nice run. Water collected: <b>${state.waterCollected}/${state.waterTotal}</b><br/>
         Ready for the next stretch of desert?`,
        "Next Level",
        "How to Play"
      );
    }
  }

  // ===== Collision resolution =====
  function resolveAxis(entity, solids, axis, dt) {
    if (axis === "x") entity.x += entity.vx * dt;
    else entity.y += entity.vy * dt;

    for (const s of solids) {
      if (!aabb(entity, s)) continue;

      if (axis === "x") {
        if (entity.vx > 0) entity.x = s.x - entity.w;
        else if (entity.vx < 0) entity.x = s.x + s.w;
        entity.vx = 0;
      } else {
        if (entity.vy > 0) {
          entity.y = s.y - entity.h;
          entity.vy = 0;
          entity.onGround = true;
        } else if (entity.vy < 0) {
          entity.y = s.y + s.h;
          entity.vy = 0;
        }
      }
    }
  }

  // ===== Gameplay update =====
  function update(dt) {
    if (state.mode !== "playing") return;

    const L = LEVELS[state.levelIndex];
    const p = state.player;

    // edge-trigger jump consumption
    if (input.jumpPressed) {
      p.jumpBuffer = 0.12;
      input.jumpPressed = false;
    } else {
      p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
    }

    // Horizontal movement
    const ax = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    if (ax !== 0) {
      p.facing = ax;
      p.vx += ax * MOVE_ACCEL * dt;
    } else {
      p.vx *= Math.pow(FRICTION, dt * 60);
    }
    p.vx = clamp(p.vx, -MAX_SPEED, MAX_SPEED);

    // Gravity
    p.vy += GRAV * dt;
    p.vy = clamp(p.vy, -2000, 2000);

    // Coyote time: small grace period after leaving ground
    if (p.onGround) p.coyote = 0.10;
    else p.coyote = Math.max(0, p.coyote - dt);

    // Jump if buffered and allowed
    if (p.jumpBuffer > 0 && (p.onGround || p.coyote > 0)) {
      p.vy = -JUMP_V;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuffer = 0;
      beep(520, 0.05, "square", 0.04);
    }

    // Variable jump height (if released early)
    if (!input.jumpHeld && p.vy < 0) {
      p.vy += GRAV * dt * 0.9; // shorten jump when not held
    }

    // Apply movement + collisions
    p.onGround = false;
    resolveAxis(p, state.solids, "x", dt);
    resolveAxis(p, state.solids, "y", dt);

    // Falling off the world
    if (p.y > V_H + 200) {
      die();
      return;
    }

    // Hazards (spikes)
    for (const h of state.hazards) {
      if (aabb(p, h)) {
        die();
        return;
      }
    }

    // Collect water
    for (const w of state.water) {
      if (w.taken) continue;
      const box = { x: w.x - w.r, y: w.y - w.r, w: w.r * 2, h: w.r * 2 };
      if (aabb(p, box)) {
        w.taken = true;
        state.waterCollected++;
        state.score += 100;
        hudWater.textContent = `Water: ${state.waterCollected}/${state.waterTotal}`;
        hudScore.textContent = `Score: ${state.score}`;
        beep(880, 0.04, "triangle", 0.05);
      }
    }

    // Open exit when all water collected
    if (!state.exitOpen && state.waterCollected >= state.waterTotal) {
      state.exitOpen = true;
      state.score += 250;
      hudScore.textContent = `Score: ${state.score}`;
      beep(660, 0.05, "triangle", 0.06);
      beep(990, 0.07, "triangle", 0.05);
    }

    // Enemies (tumbleweeds)
    for (const e of state.enemies) {
      if (!e.alive) continue;

      // patrol
      const minX = e.baseX - e.patrol * 0.5;
      const maxX = e.baseX + e.patrol * 0.5;
      if (e.x < minX) e.vx = Math.abs(e.vx);
      if (e.x > maxX) e.vx = -Math.abs(e.vx);

      // move + gravity
      e.vy += GRAV * dt;
      e.vy = clamp(e.vy, -2000, 2000);

      // collide with solids
      resolveAxis(e, state.solids, "x", dt);
      resolveAxis(e, state.solids, "y", dt);

      // player collision: stomp vs hit
      if (aabb(p, e)) {
        const pPrevBottom = (p.y - p.vy * dt) + p.h;
        const eTop = e.y;
        const stomp = (p.vy > 0) && (pPrevBottom <= eTop + 6);

        if (stomp) {
          e.alive = false;
          p.vy = -520; // bounce
          state.score += 200;
          hudScore.textContent = `Score: ${state.score}`;
          beep(300, 0.04, "square", 0.05);
          beep(220, 0.05, "square", 0.04);
        } else {
          die();
          return;
        }
      }
    }

    // Exit check
    const gate = state.exit;
    if (state.exitOpen && aabb(p, gate)) {
      completeLevel();
      return;
    }

    // Camera follow
    const target = p.x - V_W * 0.35;
    state.cameraX = clamp(target, 0, L.width - V_W);
  }

  // ===== Rendering =====
  function drawBackground() {
    const L = LEVELS[state.levelIndex];
    const cx = state.cameraX;

    // sky already set by CSS; we paint dunes & sun
    // sun
    ctx.save();
    ctx.translate(0, 0);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(255, 221, 130, 0.95)";
    ctx.beginPath();
    ctx.arc(770, 90, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // parallax dunes
    const dune = (yBase, amp, color, speed) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, V_H);
      for (let x = 0; x <= V_W; x += 24) {
        const worldX = x + cx * speed;
        const y = yBase + Math.sin(worldX * 0.004) * amp + Math.cos(worldX * 0.002) * (amp * 0.35);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(V_W, V_H);
      ctx.closePath();
      ctx.fill();
    };

    dune(390, 20, "rgba(240, 190, 110, .85)", 0.20);
    dune(430, 26, "rgba(232, 174,  92, .85)", 0.35);
    dune(470, 18, "rgba(222, 154,  72, .90)", 0.55);

    // distant silhouettes (cacti)
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#1b2a1b";
    for (let i = 0; i < 12; i++) {
      const x = (i * 220 - (cx * 0.25) % 220) + 20;
      const y = 340 + (i % 3) * 14;
      drawCactusSilhouette(x, y, 22, 64);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawCactusSilhouette(x, y, w, h) {
    // simple cactus shape
    ctx.save();
    ctx.translate(x, y);
    ctx.fillRect(w*0.35, 0, w*0.3, h);
    ctx.fillRect(0, h*0.28, w*0.35, w*0.25);
    ctx.fillRect(w*0.65, h*0.18, w*0.35, w*0.25);
    ctx.restore();
  }

  function drawWorld() {
    const cx = state.cameraX;
    ctx.save();
    ctx.translate(-cx, 0);

    // Platforms
    for (const s of state.solids) {
      // sandy platforms with shaded top
      ctx.fillStyle = "rgba(231, 194, 125, 0.95)";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = "rgba(217, 168, 92, 0.95)";
      ctx.fillRect(s.x, s.y, s.w, Math.min(10, s.h));
      // little pebbles
      ctx.fillStyle = "rgba(120, 80, 40, 0.22)";
      for (let px = s.x + 12; px < s.x + s.w - 12; px += 90) {
        ctx.beginPath();
        ctx.arc(px, s.y + 16, 3, 0, Math.PI*2);
        ctx.fill();
      }
    }

    // Hazards
    for (const h of state.hazards) {
      if (h.type === "spike") drawSpikes(h.x, h.y, h.w, h.h);
    }

    // Exit gate
    drawGate(state.exit, state.exitOpen);

    // Water drops
    for (const w of state.water) {
      if (w.taken) continue;
      drawWater(w.x, w.y, w.r);
    }

    // Enemies
    for (const e of state.enemies) {
      if (!e.alive) continue;
      drawTumbleweed(e.x, e.y, e.w, e.h);
    }

    // Player
    drawPlayer(state.player);

    ctx.restore();
  }

  function drawSpikes(x, y, w, h) {
    ctx.save();
    ctx.translate(x, y);
    // base patch
    ctx.fillStyle = "rgba(27, 42, 27, 0.25)";
    ctx.fillRect(0, h-6, w, 6);

    const spikes = Math.max(2, Math.floor(w / 12));
    const step = w / spikes;

    for (let i = 0; i < spikes; i++) {
      const sx = i * step;
      ctx.beginPath();
      ctx.moveTo(sx, h);
      ctx.lineTo(sx + step * 0.5, 0);
      ctx.lineTo(sx + step, h);
      ctx.closePath();
      ctx.fillStyle = "#2ea05f";
      ctx.fill();
      ctx.strokeStyle = "rgba(10, 20, 10, 0.35)";
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawWater(x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    // glow
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#a8f0ff";
    ctx.beginPath();
    ctx.arc(0, 0, r + 8, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // droplet
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, "#d8fbff");
    grad.addColorStop(1, "#41c7ff");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r, -r*0.2, 0, r);
    ctx.quadraticCurveTo(-r, -r*0.2, 0, -r);
    ctx.fill();

    // highlight
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-r*0.25, -r*0.35, r*0.22, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  }

  function drawGate(g, open) {
    ctx.save();
    ctx.translate(g.x, g.y);

    // frame
    ctx.fillStyle = "rgba(30, 24, 14, 0.9)";
    drawRoundedRect(0, 0, g.w, g.h, 10);

    // inner
    ctx.fillStyle = open ? "rgba(56, 193, 114, 0.35)" : "rgba(0, 0, 0, 0.35)";
    drawRoundedRect(6, 8, g.w - 12, g.h - 16, 8);

    // indicator
    ctx.fillStyle = open ? "#38c172" : "rgba(255,255,255,.25)";
    ctx.beginPath();
    ctx.arc(g.w/2, 18, 6, 0, Math.PI*2);
    ctx.fill();

    // text-ish stripes
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 4; i++) ctx.fillRect(12, 26 + i*12, g.w - 24, 3);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawTumbleweed(x, y, w, h) {
    ctx.save();
    ctx.translate(x, y);
    // body
    ctx.fillStyle = "rgba(110, 70, 30, 0.9)";
    drawRoundedRect(0, 0, w, h, 14);
    // twigs
    ctx.strokeStyle = "rgba(255, 220, 160, 0.45)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const sx = 6 + i*6;
      ctx.beginPath();
      ctx.moveTo(sx, 6);
      ctx.lineTo(sx + 10, h - 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer(p) {
    ctx.save();
    ctx.translate(p.x, p.y);

    // shadow
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(p.w/2, p.h + 6, 16, 6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // body gradient
    const grad = ctx.createLinearGradient(0, 0, 0, p.h);
    grad.addColorStop(0, "#38c172");
    grad.addColorStop(1, "#1e7f4b");
    ctx.fillStyle = grad;
    drawRoundedRect(0, 0, p.w, p.h, 10);

    // face
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.beginPath();
    ctx.arc(p.w*0.35, p.h*0.33, 3, 0, Math.PI*2);
    ctx.arc(p.w*0.62, p.h*0.33, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath();
    ctx.arc(p.w*0.49, p.h*0.45, 4, 0, Math.PI);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.stroke();

    // little “spines”
    ctx.strokeStyle = "rgba(220, 255, 230, .5)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(6 + i*7, 8);
      ctx.lineTo(8 + i*7, 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawUIHint() {
    if (state.mode !== "playing") return;

    // small hint at start of level
    const p = state.player;
    if (p.x < 250 && state.levelIndex === 0 && state.waterCollected === 0) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.25)";
      drawRoundedRect(16, 16, 360, 50, 14);
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("Collect all water drops to open the gate →", 30, 46);
      ctx.restore();
    }
  }

  function render() {
    ctx.clearRect(0, 0, V_W, V_H);
    drawBackground();
    drawWorld();
    drawUIHint();
  }

  // ===== Main loop =====
  let last = performance.now();
  function loop(now) {
    const dt = clamp((now - last) / 1000, 0, 1/20); // cap to avoid huge steps
    last = now;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  // ===== Buttons / overlay logic =====
  btnPrimary.addEventListener("click", () => {
    unlockAudio();
    if (state.mode === "title") {
      startGame();
    } else if (state.mode === "help") {
      // “Back”
      state.mode = "title";
      setOverlay(
        true,
        "Cactus Craze",
        `Move with <b>A/D</b> or <b>←/→</b>. Jump with <b>Space</b>/<b>W</b>/<b>↑</b>.<br/>
         Collect <b>all water drops</b> to open the oasis gate.`,
        "Start",
        "How to Play"
      );
    } else if (state.mode === "dead") {
      // retry
      loadLevel(state.levelIndex);
      startGame();
    } else if (state.mode === "complete") {
      // next level
      loadLevel(state.levelIndex + 1);
      startGame();
    } else if (state.mode === "win") {
      // restart
      state.score = 0;
      loadLevel(0);
      startGame();
    }
  });

  btnSecondary.addEventListener("click", () => {
    unlockAudio();
    if (state.mode === "title") toHelp();
    else if (state.mode === "help") startGame();
    else toHelp();
  });

  // Start at title
  toTitle();
  requestAnimationFrame(loop);

  // Ensure jumpPressed resets each frame even if no update (e.g., overlay)
  setInterval(() => { input.jumpPressed = false; }, 250);
})();
