(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const stateCard = document.getElementById("state-card");
  const stateSubtitle = document.getElementById("state-subtitle");
  const stateTitle = document.getElementById("state-title");
  const stateDetail = document.getElementById("state-detail");
  const playAgain = document.getElementById("play-again");
  const share = document.getElementById("share");
  const resetBtn = document.getElementById("reset");
  const toggleHelp = document.getElementById("toggle-help");

  const ui = {
    lives: document.getElementById("ui-lives"),
    score: document.getElementById("ui-score"),
    bombs: document.getElementById("ui-bombs"),
    range: document.getElementById("ui-range"),
    speed: document.getElementById("ui-speed"),
  };

  const config = {
    cols: 15,
    rows: 13,
    baseTile: 48,
    enemyCount: 5,
    blockChance: 0.62,
    fuseMs: 2200,
    flameMs: 520,
    baseSpeed: 3.1,
    startingLives: 3,
  };

  let tileSize = config.baseTile;
  let dpr = window.devicePixelRatio || 1;

  let rng = mulberry32(Date.now() >>> 0);
  let currentSeed = Date.now() >>> 0;

  let grid = [];
  let bombs = [];
  let flames = [];
  let powerups = [];
  let enemies = [];
  let particles = [];

  let lastTime = performance.now();
  const input = { left: false, right: false, up: false, down: false, last: null };
  let gameState = "playing"; // playing | paused | gameover | win

  const player = {
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    moving: false,
    target: null,
    dir: { x: 0, y: 0 },
    speed: config.baseSpeed,
    bombCapacity: 1,
    bombStock: 1,
    flameRange: 2,
    lives: config.startingLives,
    invuln: 0,
    score: 0,
    id: "player",
  };

  let primaryAction = () => startRun();
  let secondaryAction = () => copySeed();

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function setSeed(seed) {
    currentSeed = seed >>> 0;
    rng = mulberry32(currentSeed);
  }

  function rand() {
    return rng();
  }

  function startRun(seed = Math.floor(Math.random() * 1_000_000_000)) {
    setSeed(seed);
    buildLevel();
    gameState = "playing";
    hideCard();
    lastTime = performance.now();
  }

  function buildLevel() {
    grid = [];
    bombs = [];
    flames = [];
    powerups = [];
    enemies = [];
    particles = [];

    player.bombCapacity = 1;
    player.bombStock = 1;
    player.flameRange = 2;
    player.speed = config.baseSpeed;
    player.lives = config.startingLives;
    player.invuln = 0;
    player.score = 0;
    player.moving = false;
    player.target = null;
    player.dir = { x: 0, y: 0 };

    const spawn = { x: 1, y: 1 };
    for (let y = 0; y < config.rows; y++) {
      const row = [];
      for (let x = 0; x < config.cols; x++) {
        const border = y === 0 || x === 0 || y === config.rows - 1 || x === config.cols - 1;
        const solidPillar = x % 2 === 1 && y % 2 === 1;
        if (border || solidPillar) {
          row.push("solid");
          continue;
        }
        const nearSpawn = Math.abs(x - spawn.x) + Math.abs(y - spawn.y) <= 2 || (x === 1 && y === 2) || (x === 2 && y === 1);
        if (nearSpawn) {
          row.push("empty");
          continue;
        }
        row.push(rand() < config.blockChance ? "soft" : "empty");
      }
      grid.push(row);
    }

    player.tx = spawn.x;
    player.ty = spawn.y;
    player.x = (spawn.x + 0.5) * tileSize;
    player.y = (spawn.y + 0.5) * tileSize;

    for (let i = 0; i < config.enemyCount; i++) {
      const pos = randomEmptyTile(4);
      enemies.push({
        x: (pos.x + 0.5) * tileSize,
        y: (pos.y + 0.5) * tileSize,
        speed: config.baseSpeed * 0.9,
        dir: pickDir(),
        changeTimer: 0.8 + rand() * 1.2,
        id: `enemy-${i}`,
      });
    }

    updateUI();
  }

  function randomEmptyTile(padding = 1) {
    let attempts = 0;
    while (attempts < 200) {
      const x = Math.floor(rand() * config.cols);
      const y = Math.floor(rand() * config.rows);
      if (x < padding && y < padding) {
        attempts++;
        continue;
      }
      if (grid[y] && grid[y][x] === "empty") {
        return { x, y };
      }
      attempts++;
    }
    return { x: padding, y: padding };
  }

  function resize() {
    const prevTile = tileSize || config.baseTile;
    const usableW = Math.min(window.innerWidth - 24, 1180);
    const usableH = Math.min(window.innerHeight - 260, 920);
    const candidate = Math.min(usableW / config.cols, usableH / config.rows);
    tileSize = Math.max(28, Math.floor(candidate));
    const scale = tileSize / prevTile;
    player.x = (player.tx + 0.5) * tileSize;
    player.y = (player.ty + 0.5) * tileSize;
    enemies.forEach((e) => {
      const tx = Math.floor(e.x / prevTile);
      const ty = Math.floor(e.y / prevTile);
      e.x = (tx + 0.5) * tileSize;
      e.y = (ty + 0.5) * tileSize;
    });
    particles.forEach((p) => {
      p.x *= scale;
      p.y *= scale;
    });
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(tileSize * config.cols * dpr);
    canvas.height = Math.floor(tileSize * config.rows * dpr);
    canvas.style.width = `${tileSize * config.cols}px`;
    canvas.style.height = `${tileSize * config.rows}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function tileFromPos(x, y) {
    return {
      x: Math.floor(x / tileSize),
      y: Math.floor(y / tileSize),
    };
  }

  function posFromTile(tx, ty) {
    return {
      x: tx * tileSize + tileSize / 2,
      y: ty * tileSize + tileSize / 2,
    };
  }

  function isBlocked(tx, ty) {
    if (ty < 0 || ty >= config.rows || tx < 0 || tx >= config.cols) return true;
    const tile = grid[ty][tx];
    return tile === "solid" || tile === "soft";
  }

  function bombBlocking(tx, ty, entity) {
    for (const bomb of bombs) {
      if (bomb.tx === tx && bomb.ty === ty) {
        if (entity && bomb.owner === entity.id) {
          const tile = tileFromPos(entity.x, entity.y);
          if (tile.x === tx && tile.y === ty) return false;
          if (bomb.grace > 0) return false;
        }
        return true;
      }
    }
    return false;
  }

  function collides(x, y, entity) {
    const radius = tileSize * 0.32;
    const left = x - radius;
    const right = x + radius;
    const top = y - radius;
    const bottom = y + radius;
    const minTileX = Math.floor(left / tileSize);
    const maxTileX = Math.floor(right / tileSize);
    const minTileY = Math.floor(top / tileSize);
    const maxTileY = Math.floor(bottom / tileSize);

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        if (isBlocked(tx, ty)) return true;
        if (bombBlocking(tx, ty, entity)) return true;
      }
    }
    return false;
  }

  function keyToDir(key) {
    const k = key.toLowerCase();
    if (k === "arrowleft" || k === "a") return "left";
    if (k === "arrowright" || k === "d") return "right";
    if (k === "arrowup" || k === "w") return "up";
    if (k === "arrowdown" || k === "s") return "down";
    return null;
  }

  function dirVector(name) {
    switch (name) {
      case "left":
        return { x: -1, y: 0 };
      case "right":
        return { x: 1, y: 0 };
      case "up":
        return { x: 0, y: -1 };
      case "down":
        return { x: 0, y: 1 };
      default:
        return { x: 0, y: 0 };
    }
  }

  function desiredDirs() {
    const base = ["left", "right", "up", "down"];
    if (input.last && base.includes(input.last)) {
      return [input.last, ...base.filter((d) => d !== input.last)];
    }
    return base;
  }

  function canEnter(tx, ty) {
    if (isBlocked(tx, ty)) return false;
    const bomb = bombs.find((b) => b.tx === tx && b.ty === ty);
    if (!bomb) return true;
    if (bomb.owner === player.id) {
      const onBombTile = player.tx === tx && player.ty === ty;
      if (onBombTile) return true;
      if (bomb.grace > 0.05) return true;
    }
    return false;
  }

  function movePlayer(dt) {
    if (!player.moving) {
      for (const dirName of desiredDirs()) {
        if (!input[dirName]) continue;
        const dir = dirVector(dirName);
        const targetX = player.tx + dir.x;
        const targetY = player.ty + dir.y;
        if (canEnter(targetX, targetY)) {
          player.dir = dir;
          player.moving = true;
          player.target = { x: targetX, y: targetY };
          break;
        }
      }
    }

    if (player.moving && player.target) {
      const targetPos = posFromTile(player.target.x, player.target.y);
      const dx = targetPos.x - player.x;
      const dy = targetPos.y - player.y;
      const dist = Math.hypot(dx, dy);
      const speed = player.speed * tileSize;
      const step = speed * dt;
      if (step >= dist || dist === 0) {
        player.x = targetPos.x;
        player.y = targetPos.y;
        player.tx = player.target.x;
        player.ty = player.target.y;
        player.moving = false;
        player.target = null;
        movePlayer(0); // allow instant chaining when holding a key
      } else {
        player.x += (dx / dist) * step;
        player.y += (dy / dist) * step;
      }
    }
  }

  function placeBomb() {
    if (gameState !== "playing") return;
    if (player.bombStock <= 0) return;
    const tx = player.tx;
    const ty = player.ty;
    const existing = bombs.some((b) => b.tx === tx && b.ty === ty);
    if (existing) return;
    player.bombStock -= 1;
    bombs.push({
      tx,
      ty,
      timer: config.fuseMs,
      owner: player.id,
      grace: 0.25,
      range: player.flameRange,
      id: `${tx}-${ty}-${Date.now()}`,
    });
  }

  function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const bomb = bombs[i];
      bomb.timer -= dt * 1000;
      if (flames.some((f) => f.tx === bomb.tx && f.ty === bomb.ty)) {
        bomb.timer = 0;
      }
      bomb.grace = Math.max(0, bomb.grace - dt);
      if (bomb.timer <= 0) {
        explodeBomb(i);
      }
    }
  }

  function explodeBomb(index) {
    const bomb = bombs[index];
    bombs.splice(index, 1);
    player.bombStock = Math.min(player.bombCapacity, player.bombStock + 1);
    spawnFlame(bomb.tx, bomb.ty);
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    for (const dir of dirs) {
      for (let i = 1; i <= bomb.range; i++) {
        const tx = bomb.tx + dir.x * i;
        const ty = bomb.ty + dir.y * i;
        if (isBlocked(tx, ty)) {
          if (grid[ty] && grid[ty][tx] === "soft") {
            grid[ty][tx] = "empty";
            player.score += 25;
            maybeSpawnPowerup(tx, ty);
            spawnParticles(tx, ty);
            updateUI();
          }
          break;
        }
        const hitBomb = bombs.findIndex((b) => b.tx === tx && b.ty === ty);
        spawnFlame(tx, ty);
        if (hitBomb >= 0) {
          explodeBomb(hitBomb);
          break;
        }
      }
    }
  }

  function spawnFlame(tx, ty) {
    flames.push({
      tx,
      ty,
      ttl: config.flameMs,
    });
  }

  function maybeSpawnPowerup(tx, ty) {
    const roll = rand();
    if (roll >= 0.2) return;
    let type = "bomb";
    if (roll > 0.17) type = "speed";
    else if (roll > 0.1) type = "range";
    else if (roll < 0.04) type = "heart";
    powerups.push({ tx, ty, type, pulse: rand() * Math.PI * 2 });
  }

  function updateFlames(dt) {
    for (let i = flames.length - 1; i >= 0; i--) {
      const flame = flames[i];
      flame.ttl -= dt * 1000;
      if (flame.ttl <= 0) {
        flames.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.ttl -= dt;
      if (p.ttl <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function spawnParticles(tx, ty) {
    const center = posFromTile(tx, ty);
    for (let i = 0; i < 8; i++) {
      const angle = rand() * Math.PI * 2;
      const speed = 40 + rand() * 60;
      particles.push({
        x: center.x,
        y: center.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ttl: 0.4 + rand() * 0.2,
      });
    }
  }

  function updatePowerups() {
    for (let i = powerups.length - 1; i >= 0; i--) {
      const pu = powerups[i];
      if (player.tx === pu.tx && player.ty === pu.ty) {
        applyPowerup(pu.type);
        powerups.splice(i, 1);
        continue;
      }
      pu.pulse += 0.05;
    }
  }

  function applyPowerup(type) {
    switch (type) {
      case "bomb":
        player.bombCapacity += 1;
        player.bombStock += 1;
        break;
      case "range":
        player.flameRange = Math.min(8, player.flameRange + 1);
        break;
      case "speed":
        player.speed = Math.min(player.speed + 0.25, 5);
        break;
      case "heart":
        player.lives += 1;
        break;
    }
    player.score += 120;
    updateUI();
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      enemy.changeTimer -= dt;
      if (enemy.changeTimer <= 0) {
        enemy.dir = pickDir();
        enemy.changeTimer = 0.5 + rand();
      }
      const nextX = enemy.x + enemy.dir.x * enemy.speed * tileSize * dt;
      const nextY = enemy.y + enemy.dir.y * enemy.speed * tileSize * dt;
      const blockedX = collides(nextX, enemy.y, enemy);
      const blockedY = collides(enemy.x, nextY, enemy);
      if (!blockedX) enemy.x = nextX;
      if (!blockedY) enemy.y = nextY;
      if (blockedX || blockedY) {
        enemy.dir = pickDir();
      }

      if (flameHits(enemy.x, enemy.y)) {
        removeEnemy(enemy, i);
        continue;
      }

      const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      if (dist < tileSize * 0.55) {
        damagePlayer();
      }
    }
  }

  function removeEnemy(enemy, idxOverride) {
    const idx = idxOverride ?? enemies.indexOf(enemy);
    if (idx !== -1) enemies.splice(idx, 1);
    player.score += 250;
    updateUI();
  }

  function flameHits(x, y) {
    const { x: tx, y: ty } = tileFromPos(x, y);
    return flames.some((f) => f.tx === tx && f.ty === ty);
  }

  function pickDir() {
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    return dirs[Math.floor(rand() * dirs.length)];
  }

  function damagePlayer() {
    if (player.invuln > 0 || gameState !== "playing") return;
    player.lives -= 1;
    player.invuln = 1.6;
    const spawn = posFromTile(1, 1);
    player.tx = 1;
    player.ty = 1;
    player.x = spawn.x;
    player.y = spawn.y;
    player.moving = false;
    player.target = null;
    player.score = Math.max(0, player.score - 150);
    updateUI();
    if (player.lives <= 0) {
      gameState = "gameover";
      showCard({
        subtitle: "Run ended",
        title: "You were vaporized",
        detail: "Drop another set of neon bombs and clear the grid.",
        primaryText: "Restart",
        primaryAction: () => startRun(),
        secondaryText: "Share seed",
        secondaryAction: () => copySeed(),
      });
    }
  }

  function updatePlayer(dt) {
    movePlayer(dt);
    if (player.invuln > 0) {
      player.invuln -= dt;
    }
    if (flameHits(player.x, player.y)) {
      damagePlayer();
    }
  }

  function update(dt) {
    updatePlayer(dt);
    updatePowerups();
    updateBombs(dt);
    updateFlames(dt);
    updateEnemies(dt);
    updateParticles(dt);
    if (gameState === "playing" && enemies.length === 0) {
      gameState = "win";
      player.score += 500;
      updateUI();
      showCard({
        subtitle: "Board cleared",
        title: "Victory",
        detail: "You cleared every foe. Try a fresh seed for a tougher run.",
        primaryText: "Play new run",
        primaryAction: () => startRun(),
        secondaryText: "Share seed",
        secondaryAction: () => copySeed(),
      });
    }
  }

  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#0b1023";
    ctx.fillRect(0, 0, tileSize * config.cols, tileSize * config.rows);
    drawGrid();
    drawPowerups();
    drawBombs();
    drawFlames();
    drawEnemies();
    drawPlayer();
    drawParticles();
    ctx.restore();
  }

  function drawGrid() {
    for (let y = 0; y < config.rows; y++) {
      for (let x = 0; x < config.cols; x++) {
        const tile = grid[y][x];
        const px = x * tileSize;
        const py = y * tileSize;
        ctx.save();
        if (tile === "solid") {
          const grad = ctx.createLinearGradient(px, py, px + tileSize, py + tileSize);
          grad.addColorStop(0, "#0e142c");
          grad.addColorStop(1, "#182349");
          ctx.fillStyle = grad;
          ctx.fillRect(px, py, tileSize, tileSize);
          ctx.strokeStyle = "rgba(255,255,255,0.04)";
          ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.02)";
          ctx.fillRect(px, py, tileSize, tileSize);
          const gridLine = 2;
          ctx.strokeStyle = "rgba(255,255,255,0.03)";
          ctx.lineWidth = 1;
          ctx.strokeRect(px + gridLine, py + gridLine, tileSize - gridLine * 2, tileSize - gridLine * 2);
          if (tile === "soft") {
            const grad = ctx.createLinearGradient(px, py, px, py + tileSize);
            grad.addColorStop(0, "rgba(94, 146, 255, 0.5)");
            grad.addColorStop(1, "rgba(86, 255, 210, 0.4)");
            ctx.fillStyle = grad;
            ctx.fillRect(px + 4, py + 4, tileSize - 8, tileSize - 8);
            ctx.strokeStyle = "rgba(255,255,255,0.2)";
            ctx.strokeRect(px + 4, py + 4, tileSize - 8, tileSize - 8);
          }
        }
        ctx.restore();
      }
    }
  }

  function drawBombs() {
    for (const bomb of bombs) {
      const pos = posFromTile(bomb.tx, bomb.ty);
      const radius = tileSize * 0.32 + Math.sin((bomb.timer / config.fuseMs) * Math.PI * 2) * 2;
      const glow = ctx.createRadialGradient(pos.x, pos.y, radius * 0.2, pos.x, pos.y, radius * 1.2);
      glow.addColorStop(0, "rgba(88, 255, 246, 0.9)");
      glow.addColorStop(1, "rgba(88, 255, 246, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 1.2, 0, Math.PI * 2);
      ctx.fill();

      const shell = ctx.createLinearGradient(pos.x - radius, pos.y - radius, pos.x + radius, pos.y + radius);
      shell.addColorStop(0, "#1b243a");
      shell.addColorStop(1, "#24345a");
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawFlames() {
    for (const flame of flames) {
      const pos = posFromTile(flame.tx, flame.ty);
      const life = flame.ttl / config.flameMs;
      const radius = tileSize * (0.5 + (1 - life) * 0.15);
      const grad = ctx.createRadialGradient(pos.x, pos.y, radius * 0.1, pos.x, pos.y, radius);
      grad.addColorStop(0, "rgba(255, 255, 255, 0.9)");
      grad.addColorStop(0.45, "rgba(255, 200, 120, 0.9)");
      grad.addColorStop(1, "rgba(255, 85, 185, 0.0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPowerups() {
    for (const pu of powerups) {
      const pos = posFromTile(pu.tx, pu.ty);
      const size = tileSize * 0.3 + Math.sin(pu.pulse) * 2;
      const gradient = ctx.createLinearGradient(pos.x - size, pos.y - size, pos.x + size, pos.y + size);
      if (pu.type === "bomb") {
        gradient.addColorStop(0, "#5cf0ff");
        gradient.addColorStop(1, "#5b7bff");
      } else if (pu.type === "range") {
        gradient.addColorStop(0, "#ffc857");
        gradient.addColorStop(1, "#ff6f91");
      } else if (pu.type === "speed") {
        gradient.addColorStop(0, "#6dfab6");
        gradient.addColorStop(1, "#2dd3a8");
      } else {
        gradient.addColorStop(0, "#ff7dc1");
        gradient.addColorStop(1, "#ffd9f2");
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(pos.x - size, pos.y - size, size * 2, size * 2, 8);
      } else {
        ctx.rect(pos.x - size, pos.y - size, size * 2, size * 2);
      }
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.stroke();
    }
  }

  function drawEnemies() {
    for (const enemy of enemies) {
      const radius = tileSize * 0.32;
      const grad = ctx.createLinearGradient(enemy.x - radius, enemy.y - radius, enemy.x + radius, enemy.y + radius);
      grad.addColorStop(0, "#ff8f70");
      grad.addColorStop(1, "#ff3d7f");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(enemy.x - radius * 0.35, enemy.y - 3, 4, 0, Math.PI * 2);
      ctx.arc(enemy.x + radius * 0.35, enemy.y - 3, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPlayer() {
    const radius = tileSize * 0.34;
    const flicker = player.invuln > 0 ? Math.sin(player.invuln * 20) > 0 : true;
    if (!flicker) return;
    const grad = ctx.createLinearGradient(player.x - radius, player.y - radius, player.x + radius, player.y + radius);
    grad.addColorStop(0, "#6cf7ff");
    grad.addColorStop(1, "#7f7bff");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#0c1227";
    ctx.beginPath();
    ctx.arc(player.x - radius * 0.3, player.y - 2, 4, 0, Math.PI * 2);
    ctx.arc(player.x + radius * 0.3, player.y - 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = Math.max(0, p.ttl / 0.6);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function updateUI() {
    ui.lives.textContent = Math.max(0, player.lives);
    ui.score.textContent = player.score.toString().padStart(4, "0");
    ui.bombs.textContent = `${player.bombStock}/${player.bombCapacity}`;
    ui.range.textContent = player.flameRange;
    ui.speed.textContent = `${player.speed.toFixed(1)}x`;
  }

  function showCard({ subtitle, title, detail, primaryText, primaryAction: pAction, secondaryText, secondaryAction: sAction }) {
    stateSubtitle.textContent = subtitle;
    stateTitle.textContent = title;
    stateDetail.textContent = detail;
    playAgain.textContent = primaryText;
    share.textContent = secondaryText;
    primaryAction = pAction;
    secondaryAction = sAction;
    stateCard.classList.remove("hidden");
  }

  function hideCard() {
    stateCard.classList.add("hidden");
  }

  function copySeed() {
    const text = `Neon Bomber seed: ${currentSeed}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      stateDetail.textContent = "Seed copied. Share it with a friend.";
      stateCard.classList.remove("hidden");
    } else {
      alert(text);
    }
  }

  function togglePause() {
    if (gameState === "win" || gameState === "gameover") return;
    if (gameState === "paused") {
      gameState = "playing";
      hideCard();
    } else if (gameState === "playing") {
      gameState = "paused";
      showCard({
        subtitle: "Mid-run",
        title: "Paused",
        detail: "Use bombs to carve paths, grab powerups, and clear enemies.",
        primaryText: "Resume",
        primaryAction: () => togglePause(),
        secondaryText: "Restart run",
        secondaryAction: () => startRun(),
      });
    }
  }

  function loop(timestamp) {
    const dt = Math.min(0.05, (timestamp - lastTime) / 1000);
    lastTime = timestamp;
    if (gameState === "playing") {
      update(dt);
    }
    draw();
    requestAnimationFrame(loop);
  }

  document.addEventListener("keydown", (e) => {
    if ([" ", "Spacebar", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) || e.code === "Space") {
      e.preventDefault();
    }
    const dir = keyToDir(e.key) || keyToDir(e.code);
    if (dir) {
      input[dir] = true;
      input.last = dir;
    }
    if (e.code === "Space" || e.key === " ") {
      placeBomb();
    } else if (e.key === "r" || e.key === "R") {
      startRun();
    } else if (e.key === "Escape") {
      togglePause();
    }
  });

  document.addEventListener("keyup", (e) => {
    const dir = keyToDir(e.key) || keyToDir(e.code);
    if (dir) {
      input[dir] = false;
    }
  });

  window.addEventListener("blur", () => {
    input.left = input.right = input.up = input.down = false;
    player.moving = false;
    player.target = null;
  });

  playAgain.addEventListener("click", () => primaryAction());
  share.addEventListener("click", () => secondaryAction());
  resetBtn.addEventListener("click", () => startRun());
  toggleHelp.addEventListener("click", () => togglePause());
  window.addEventListener("resize", resize);

  resize();
  startRun();
  requestAnimationFrame(loop);
})();
