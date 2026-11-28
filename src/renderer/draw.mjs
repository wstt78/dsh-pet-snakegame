// 鲸鱼娘桌宠贪吃蛇 · 画面层
// 只负责把 game-core 的状态画出来：透明画布、蛇身链条、能量球、两套收尾动画。

const angerImg = new Image();
angerImg.src = new URL('../../assets/anger.png', import.meta.url).href;
const ballCloud = new Image();
ballCloud.src = new URL('../../assets/ball-cloud.png', import.meta.url).href;
const ballBubble = new Image();
ballBubble.src = new URL('../../assets/ball-bubble.png', import.meta.url).href;
const ballRice = new Image();
ballRice.src = new URL('../../assets/ball-rice.png', import.meta.url).href;

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
// 出现时先冲过头一点点再回弹，像“啵”地冒出来
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp(t, 0, 1) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
};


// 60% 键盘布局：label / vk / 宽度（单位键）
const WORK_KEYS = [
  [['Esc', 0x1b, 1], ['1', 0x31, 1], ['2', 0x32, 1], ['3', 0x33, 1], ['4', 0x34, 1], ['5', 0x35, 1], ['6', 0x36, 1], ['7', 0x37, 1], ['8', 0x38, 1], ['9', 0x39, 1], ['0', 0x30, 1], ['-', 0xbd, 1], ['=', 0xbb, 1], ['Back', 0x08, 2]],
  [['Tab', 0x09, 1.5], ['Q', 0x51, 1], ['W', 0x57, 1], ['E', 0x45, 1], ['R', 0x52, 1], ['T', 0x54, 1], ['Y', 0x59, 1], ['U', 0x55, 1], ['I', 0x49, 1], ['O', 0x4f, 1], ['P', 0x50, 1], ['[', 0xdb, 1], [']', 0xdd, 1], ['\\', 0xdc, 1.5]],
  [['Caps', 0x14, 1.75], ['A', 0x41, 1], ['S', 0x53, 1], ['D', 0x44, 1], ['F', 0x46, 1], ['G', 0x47, 1], ['H', 0x48, 1], ['J', 0x4a, 1], ['K', 0x4b, 1], ['L', 0x4c, 1], [';', 0xba, 1], ["'", 0xde, 1], ['Enter', 0x0d, 2.25]],
  [['Shift', 0xa0, 2.25], ['Z', 0x5a, 1], ['X', 0x58, 1], ['C', 0x43, 1], ['V', 0x56, 1], ['B', 0x42, 1], ['N', 0x4e, 1], ['M', 0x4d, 1], [',', 0xbc, 1], ['.', 0xbe, 1], ['/', 0xbf, 1], ['Shift', 0xa1, 2.75]],
  [['Ctrl', 0xa2, 1.25], ['Win', 0x5b, 1.25], ['Alt', 0xa4, 1.25], ['Space', 0x20, 6.25], ['Alt', 0xa5, 1.25], ['Win', 0x5c, 1.25], ['Menu', 0x5d, 1.25], ['Ctrl', 0xa3, 1.25]],
];

// shift/ctrl/alt 的左右键码不一致，高亮时互通
const KEY_FAMILY = [
  [0x10, 0xa0, 0xa1],
  [0x11, 0xa2, 0xa3],
  [0x12, 0xa4, 0xa5],
];

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.image = null;
    this.headViews = {};
    this.headReadyCount = 0;
    for (const name of ['front', 'side', 'back']) {
      const img = new Image();
      img.onload = () => { this.headReadyCount += 1; this.headViews[name] = img; };
      img.src = new URL(`../../assets/head-${name}.png`, import.meta.url).href;
    }
    this.headAngle = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setImage(img) {
    this.image = img;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(now) {
    const ctx = this.ctx;
    const g = this.game;
    ctx.clearRect(0, 0, this.w, this.h);

    // 让画面在窗口尺寸变化后仍居中
    if (Math.abs(this.w - g.width) > 1 || Math.abs(this.h - g.height) > 1) g.resize(this.w, this.h);

    const active = g.state === 'wander' || g.state === 'coursing';
    const fading = (g.state === 'dying' || g.state === 'quietExit') && this.snakeAlpha() > 0.01;

    if (g.state === 'angry') {
      // 变回原形：蛇先淡出，能量块留在原地，然后小鲸鱼冲它发脾气
      if (g.stateT < 240) this.drawSnake(now, this.snakeAlpha());
      this.drawFood(now);
      this.drawAngryPet(now);
    } else {
      // 障碍只在吃块状态画；待机漫游哪怕状态里混进障碍也不显示，避免“看得到撞不到”
      if (g.cfg.obstaclesEnabled && g.state === 'coursing') this.drawObstacles(now);

      const snakeAlpha = this.snakeAlpha();
      if (active || fading) {
        if (active) this.drawFood(now);
        this.drawSnake(now, snakeAlpha);
      }

      if (g.state === 'sleep') this.drawSleepPet(now);
      else if (g.state === 'dying') this.drawDyingPet(now);
      else if (g.state === 'quietExit') this.drawQuietPet(now);
      else if (g.state === 'work') {
        this.drawWorkPet(now);
      }
    }
  }

  snakeAlpha() {
    const g = this.game;
    if (g.state === 'dying') return clamp(1 - g.stateT / 240, 0, 1);
    if (g.state === 'quietExit') return clamp(1 - g.stateT / 260, 0, 1);
    if (g.state === 'angry') return clamp(1 - g.stateT / 240, 0, 1);
    return 1;
  }

  // ---------- 宠物 ----------

  petMetrics(scale = 1) {
    const img = this.image;
    if (!img) return { w: 160, h: 210 };
    const h = this.game.cfg.petSize * scale;
    const w = h * (img.width / img.height);
    return { w, h };
  }

  drawPetBody(x, bottomY, { scale = 1, rot = 0, alpha = 1, shadow = true } = {}) {
    const img = this.image;
    if (!img) return;
    const ctx = this.ctx;
    const { w, h } = this.petMetrics(scale);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (shadow) {
      const sg = ctx.createRadialGradient(x, bottomY - 4, 2, x, bottomY - 4, w * 0.42);
      sg.addColorStop(0, 'rgba(0,0,0,0.34)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(x, bottomY - 4);
      ctx.scale(1, 0.22);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.42, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.translate(x, bottomY);
    ctx.rotate(rot);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }

  drawSleepPet(now) {
    const g = this.game;
    const a = g.petAnchor();
    const bob = Math.sin(now / 1500) * 3.2;
    const breath = 1 + Math.sin(now / 1700) * 0.008;
    this.drawPetBody(a.x, a.y + 12 + bob, { scale: breath });
    this.drawZzz(a.x + 40, a.y - 170 + bob, now);
  }

  /** 工作模式的宠物：不睡，轻微呼吸起伏。 */
  drawWorkPet(now) {
    const g = this.game;
    const a = g.petAnchor();
    let recent = (g.recentKeys || []).slice(-3);
    if (!recent.length && g.poseSnapshot) {
      recent = [
        { vk: 0x41, t: now - 210 },
        { vk: 0x53, t: now - 110 },
        { vk: 0x44, t: now - 15 },
      ];
    }
    const lastAge = recent.length ? now - recent[recent.length - 1].t : 9999;
    const pulse = clamp(1 - lastAge / 260, 0, 1);
    const sway = Math.sin(now / 240) * 0.045 + Math.sin(now / 90) * 0.007;
    const bob = Math.sin(now / 300) * 2.6 - pulse * 2.2;
    this.drawPetBody(a.x, a.y + 12 + bob, { scale: 1 + pulse * 0.018, rot: sway });
    this.drawHappyFace(a, now, pulse);
    this.drawTypingScene(a, now, recent, pulse);
  }

  /** 欢快表情：盖住原图的中性眼睛，画开心眯眯眼 + 腮红 + 笑口 */
  drawHappyFace(a, now, pulse) {
    const g = this.game;
    const ctx = this.ctx;
    const s = g.cfg.petSize;
    const bottom = a.y + 12;
    const eyeY = bottom - s * 0.53;
    const eyeDx = s * 0.125;
    const blushY = eyeY + s * 0.06;
    const blushDx = s * 0.125;
    const mouthY = eyeY + s * 0.105;

    ctx.save();
    ctx.fillStyle = '#ffe1d0';
    for (const dx of [-eyeDx, eyeDx]) {
      ctx.beginPath();
      ctx.ellipse(a.x + dx, eyeY, s * 0.078, s * 0.058, 0, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#2d3352';
    ctx.lineWidth = Math.max(2, s * 0.016);
    ctx.lineCap = 'round';
    for (const dx of [-eyeDx, eyeDx]) {
      ctx.beginPath();
      ctx.arc(a.x + dx, eyeY + s * 0.012, s * 0.04, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,140,152,0.38)';
    for (const dx of [-blushDx, blushDx]) {
      ctx.beginPath();
      ctx.ellipse(a.x + dx, blushY, s * 0.036, s * 0.02, 0, 0, TAU);
      ctx.fill();
    }
    const open = 0.5 + pulse * 0.5;
    ctx.fillStyle = '#7e3a44';
    ctx.beginPath();
    ctx.ellipse(a.x, mouthY, s * 0.03, s * 0.033 * open, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ff9aa4';
    ctx.beginPath();
    ctx.ellipse(a.x, mouthY + s * 0.013, s * 0.018, s * 0.014 * open, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255,196,92,${0.55 + pulse * 0.35})`;
    ctx.font = `${Math.round(s * 0.08)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('♪', a.x + s * 0.38, bottom - s * 0.72 + Math.sin(now / 300) * 4);
    ctx.restore();
  }

  workRows() {
    return ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  }

  drawTypingScene(a, now, recent, pulse) {
    const g = this.game;
    const ctx = this.ctx;
    const s = g.cfg.petSize;
    const rows = this.workRows();
    const kw = Math.round(s * 0.08);
    const kh = Math.round(s * 0.065);
    const gap = 2;
    const step = kw + gap;
    const kbW = rows[0].length * step - gap;
    const baseX = a.x - kbW / 2;
    const boardH = rows.length * kh + (rows.length - 1) * gap;
    const topY = a.y + 2 - boardH;
    const rowY = (i) => topY + i * (kh + gap);

    // 尾巴从身后伸出来（先画，藏在键盘后面）
    this.drawTailBack(a, baseX + kbW * 0.66, rowY(1), now);

    ctx.save();
    ctx.fillStyle = 'rgba(16,22,40,0.84)';
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    this.roundRectPath(baseX - 9, topY - 7, kbW + 18, boardH + 14, 9);
    ctx.fill();
    ctx.stroke();

    const activeVk = (recent || []).map((k) => k.vk);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const offset = (kbW - (row.length * step - gap)) / 2;
      for (let i = 0; i < row.length; i++) {
        const label = row[i];
        const vk = this.vkOfLabel(label);
        const x = baseX + offset + i * step;
        const y = rowY(r);
        const idx = activeVk.lastIndexOf(vk);
        const age = idx >= 0 ? now - recent[idx].t : 9999;
        const hot = age < 700;
        const press = hot ? Math.min(2, (700 - age) / 160) : 0;
        ctx.fillStyle = hot
          ? `rgba(255,186,80,${0.55 + (1 - age / 700) * 0.4})`
          : 'rgba(255,255,255,0.10)';
        this.roundRectPath(x, y + press, kw, kh, 4);
        ctx.fill();
        if (!hot) {
          ctx.strokeStyle = 'rgba(255,255,255,0.10)';
          ctx.stroke();
        }
        ctx.fillStyle = hot ? '#2b1a08' : 'rgba(230,236,255,0.72)';
        ctx.font = `600 ${Math.max(8, Math.round(kh * 0.52))}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + kw / 2, y + press + kh / 2 + 1);
      }
    }
    ctx.restore();

    // 左右手 + 尾巴三下
    const handY = rowY(2) + kh * 0.55;
    const leftX = baseX + step * 1.0 + kw / 2;
    const rightX = baseX + kbW - step * 1.0 - kw / 2;
    const last = recent[recent.length - 1];
    const second = recent[recent.length - 2];
    const third = recent[recent.length - 3];
    const pressOf = (k, w = 150) => (k && now - k.t < w ? 1 - (now - k.t) / w : 0);

    this.drawHand(leftX, handY, pressOf(third || second), -1);
    this.drawHand(rightX, handY, pressOf(second || last), 1);

    const tailPress = pressOf(third, 420);
    this.drawTailTip(baseX + kbW * 0.66, rowY(1), now, tailPress);

    for (let i = 0; i < recent.length; i++) {
      const k = recent[i];
      const label = this.labelOfVk(k.vk);
      if (!label) continue;
      const age = now - k.t;
      if (age > 950) continue;
      const x = baseX + kbW * (0.32 + i * 0.18);
      const y = topY - 26 - age * 0.045;
      const alpha = clamp(1 - age / 950, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(255,250,240,0.94)';
      ctx.strokeStyle = 'rgba(40,44,60,0.18)';
      ctx.lineWidth = 1;
      this.roundRectPath(x - 11, y - 11, 22, 22, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2d3352';
      ctx.font = `700 ${Math.round(s * 0.062)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 1);
      ctx.restore();
    }

    this.drawMiniMouse(baseX - 40, topY + boardH - 34, now);
  }

  drawHand(x, y, press, side) {
    const ctx = this.ctx;
    const s = this.game.cfg.petSize;
    const lift = press * 8;
    const r = s * 0.042;
    ctx.save();
    // 袖口
    ctx.fillStyle = '#2b3a66';
    ctx.beginPath();
    ctx.ellipse(x + side * 10, y + 12 - lift * 0.3, s * 0.072, s * 0.045, side * 0.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#e9f0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + side * 3, y + 4 - lift * 0.45, r * 1.22, Math.PI * 0.15, Math.PI * 0.85, false);
    ctx.stroke();
    // 手背
    ctx.fillStyle = '#ffe3d3';
    ctx.strokeStyle = '#d2a894';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y - lift, r * 1.05, r * 1.15, side * 0.15, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // 三根手指
    ctx.fillStyle = '#ffd8c4';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.ellipse(x + i * r * 0.5, y - lift + r * 0.7, r * 0.2, r * 0.3, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTailBack(a, tx, ty, now) {
    const g = this.game;
    const ctx = this.ctx;
    const s = g.cfg.petSize;
    const startX = a.x + s * 0.18;
    const startY = a.y + 12 - s * 0.02;
    const endX = tx + Math.sin(now / 150) * 3;
    const endY = ty + 8;
    ctx.save();
    ctx.strokeStyle = '#3f6cc0';
    ctx.lineWidth = Math.max(4, s * 0.02);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(a.x + s * 0.30, a.y + 12 - s * 0.16, endX, endY);
    ctx.stroke();
    ctx.restore();
  }

  drawTailTip(tx, ty, now, press) {
    const g = this.game;
    const ctx = this.ctx;
    const s = g.cfg.petSize;
    const x = tx + Math.sin(now / 150) * 3;
    const y = ty + 8 - press * 9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.5 - press * 0.5);
    ctx.fillStyle = '#4f7fd8';
    ctx.strokeStyle = '#24406f';
    ctx.lineWidth = 1.4;
    const fl = s * 0.055;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(fl * 0.8, -fl * 0.9, fl * 1.7, -fl * 0.5);
    ctx.quadraticCurveTo(fl * 1.1, 0, fl * 1.7, fl * 0.5);
    ctx.quadraticCurveTo(fl * 0.8, fl * 0.9, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawMiniMouse(x, y, now) {
    const ctx = this.ctx;
    const w = 24;
    const h = 34;
    const r = 12;
    const hot = (btn) => this.clickAge(btn, 240);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = 'rgba(22,28,46,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    const half = (hx, b) => {
      const t = hot(b);
      if (t <= 0.02) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(hx, y, w / 2, h * 0.55);
      ctx.clip();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = `rgba(255,186,80,${0.2 + t * 0.65})`;
      ctx.fill();
      ctx.restore();
    };
    half(x, 'L');
    half(x + w / 2, 'R');
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 2);
    ctx.lineTo(x + w / 2, y + h * 0.55);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.roundRect(x + w / 2 - 2, y + 6, 4, 8, 2);
    ctx.fill();
    ctx.restore();
  }

  roundRectPath(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  allWorkKeys() {
    return WORK_KEYS.flat();
  }

  vkOfLabel(label) {
    for (const k of this.allWorkKeys()) if (k[0] === label) return k[1];
    return -1;
  }

  labelOfVk(vk) {
    for (const k of this.allWorkKeys()) if (k[1] === vk) return k[0];
    if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
    if (vk >= 0x41 && vk <= 0x5a) return String.fromCharCode(vk);
    if (vk === 0x20) return 'Space';
    return null;
  }

  flashAge(vk, win) {
    const g = this.game;
    if (g.hudDemoKeys && g.hudDemoKeys.includes(vk)) return 1;
    let hot = null;
    for (const fam of KEY_FAMILY) {
      if (fam.includes(vk)) {
        hot = fam;
        break;
      }
    }
    const codes = hot || [vk];
    let best = 0;
    for (const c of codes) {
      const t = g.keyFlash && g.keyFlash.get(c);
      if (!t) continue;
      const age = g.now - t;
      if (age < win) best = Math.max(best, 1 - age / win);
    }
    return best;
  }

  drawKeycap(x, y, w, h, label, hot) {
    const ctx = this.ctx;
    const r = 5;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (hot > 0.02) {
      ctx.fillStyle = `rgba(255,196,92,${0.2 + hot * 0.75})`;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
    }
    ctx.fill();
    ctx.strokeStyle = hot > 0.02 ? `rgba(255,224,160,${0.35 + hot * 0.5})` : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = hot > 0.35 ? 'rgba(38,26,8,0.95)' : 'rgba(226,236,255,0.8)';
    const fs = label.length > 2 ? 9 : 11;
    ctx.font = `600 ${fs}px "Microsoft YaHei", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    ctx.restore();
  }

  drawMouseHud(x, y, now) {
    const g = this.game;
    const ctx = this.ctx;
    const w = 52;
    const h = 74;
    const r = 26;
    const leftHot = this.clickAge('L', 240);
    const rightHot = this.clickAge('R', 240);
    const midHot = this.clickAge('M', 240);
    const body = () => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    };
    ctx.save();
    body();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const half = (hx, hot) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(hx, y, w / 2, h * 0.62);
      ctx.clip();
      body();
      ctx.fillStyle = hot > 0.02 ? `rgba(255,196,92,${0.16 + hot * 0.72})` : 'rgba(255,255,255,0.03)';
      ctx.fill();
      ctx.restore();
    };
    half(x, leftHot);
    half(x + w / 2, rightHot);

    // 左右键分割线 + 滚轮
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 2);
    ctx.lineTo(x + w / 2, y + h * 0.62);
    ctx.moveTo(x + 2, y + h * 0.62);
    ctx.lineTo(x + w - 2, y + h * 0.62);
    ctx.stroke();

    ctx.fillStyle = midHot > 0.02 ? `rgba(255,196,92,${0.3 + midHot * 0.6})` : 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.roundRect(x + w / 2 - 3, y + 10, 6, 16, 3);
    ctx.fill();
    ctx.restore();
  }

  clickAge(button, win) {
    const g = this.game;
    if (g.hudDemoClick === button) return 1;
    const t = g.clickFlash && g.clickFlash.get(button);
    if (!t) return 0;
    const age = g.now - t;
    return age < win ? 1 - age / win : 0;
  }

  drawZzz(x, y, now) {
    const ctx = this.ctx;
    const cycle = 3200;
    const t = (now % cycle) / cycle;
    if (t > 0.72) return;
    const p = t / 0.72;
    ctx.save();
    ctx.font = '600 15px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const q = clamp(p * 1.5 - i * 0.24, 0, 1);
      if (q <= 0) continue;
      const alpha = Math.sin(q * Math.PI) * 0.8;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#d8ecff';
      const size = 12 + i * 5;
      ctx.font = `600 ${size}px "Microsoft YaHei", "Segoe UI", sans-serif`;
      ctx.fillText('z', x + q * 26 + i * 11, y - q * 58 - i * 16);
    }
    ctx.restore();
  }

  drawDyingPet(now) {
    const g = this.game;
    if (!g.death) return;
    const dur = g.cfg.dyingMs;
    const t = clamp(g.stateT / dur, 0, 1);
    const anchor = g.petAnchor();
    const slide = easeOutCubic((g.stateT - dur * 0.6) / (dur * 0.4));
    const x = lerp(g.death.x, anchor.x, slide);
    const y = lerp(g.death.y + 40, anchor.y + 12, slide);
    const pop = clamp(g.stateT / 160, 0, 1);
    const scale = lerp(0.55, 1.08, easeOutCubic(pop)) * (1 - slide * 0.12);
    const rot = Math.sin(g.stateT * 0.028) * 0.13 * (1 - slide * 0.5);
    this.drawPetBody(x, y, { scale, rot });
    this.drawDizzyStars(x, y - 205 * scale, g.stateT, 1 - slide * 0.4);
    // “撞晕”的冲击线
    if (g.stateT < 420) {
      const ctx = this.ctx;
      const a = 1 - g.stateT / 420;
      ctx.save();
      ctx.strokeStyle = `rgba(255,226,140,${a * 0.9})`;
      ctx.lineWidth = 3;
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * TAU + 0.3;
        const r0 = 40 + (1 - a) * 10;
        const r1 = r0 + 16;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r0, y - 100 + Math.sin(ang) * r0 * 0.7);
        ctx.lineTo(x + Math.cos(ang) * r1, y - 100 + Math.sin(ang) * r1 * 0.7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawQuietPet(now) {
    const g = this.game;
    if (!g.quiet) return;
    const t = clamp(g.stateT / g.cfg.quietMs, 0, 1);
    const e = easeOutCubic(t);
    const anchor = g.petAnchor();
    const x = lerp(g.quiet.x, anchor.x, e);
    const y = lerp(g.quiet.y + 30, anchor.y + 12, e);
    const scale = lerp(1, 0.55, e);
    const alpha = 1 - e * 0.92;
    this.drawPetBody(x, y, { scale, alpha, shadow: alpha > 0.2 });
  }

  /** 光标静止 3s：变回原形、吃不到能量块而生气（抖动 + 💢 + 蒸汽 + 哼！）。 */
  drawAngryPet(now) {
    const g = this.game;
    if (!g.angry) return;
    const ctx = this.ctx;
    const dur = g.cfg.angryMs;
    const anchor = g.petAnchor();
    const settle = easeOutCubic(clamp((g.stateT - dur * 0.72) / (dur * 0.28), 0, 1));
    const shake = (1 - settle) * 3.2;
    const x = lerp(g.angry.x, anchor.x, settle) + Math.sin(g.stateT * 0.028) * shake;
    const y = lerp(g.angry.y + 24, anchor.y + 12, settle);
    const pop = clamp(g.stateT / 140, 0, 1);
    const scale = lerp(0.62, 1, easeOutCubic(pop)) * (1 - settle * 0.18);
    const rot = Math.sin(g.stateT * 0.018) * 0.06 * (1 - settle);
    this.drawPetBody(x, y, { scale, rot });

    const { w, h } = this.petMetrics(scale);
    const headY = y - h * 0.8;
    const angry = 1 - settle;
    if (angry <= 0.02) return;

    // 漫画式怒气符号（怒筋爆点），不是准星
    const ax = x + w * 0.42;
    const ay = y - h * 0.86;
    const r = 22 + Math.sin(g.stateT / 90) * 2.5;
    this.drawAngerMark(ax, ay, r, angry, g.stateT);

    // 头顶蒸汽
    for (let i = 0; i < 2; i++) {
      const ph = (g.stateT / 700 + i * 0.45) % 1;
      const alpha = (0.4 + 0.25 * Math.sin(ph * Math.PI * 2)) * angry;
      if (alpha <= 0.02) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + (i === 0 ? -1 : 1) * w * 0.26, headY - 6 - ph * 34, 7 + ph * 8, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // 哼！
    ctx.save();
    ctx.globalAlpha = angry;
    ctx.font = '700 24px "Microsoft YaHei", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(26, 34, 62, 0.72)';
    ctx.fillStyle = '#fff1f5';
    const tx = x + w * 0.16 + Math.sin(g.stateT * 0.025) * 2;
    const ty = y - h - 16 + Math.cos(g.stateT * 0.022) * 2;
    ctx.strokeText('哼！', tx, ty);
    ctx.fillText('哼！', tx, ty);
    ctx.restore();
  }

  /** 漫画“怒筋”：直接用 💢 图形（Twemoji，CC-BY 4.0）。 */
  drawAngerMark(cx, cy, size, alpha, t = 0) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(cx, cy);
    ctx.rotate(-0.06 + Math.sin(t * 0.012) * 0.09);
    const s = size * 2.6 * (1 + Math.sin(t * 0.02) * 0.05);
    if (angerImg.complete && angerImg.naturalWidth > 0) {
      ctx.drawImage(angerImg, -s / 2, -s / 2, s, s);
    } else {
      // 图还没解码出来时的占位：红色 X
      ctx.strokeStyle = '#e2233f';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s * 0.22, -s * 0.22);
      ctx.lineTo(s * 0.22, s * 0.22);
      ctx.moveTo(s * 0.22, -s * 0.22);
      ctx.lineTo(-s * 0.22, s * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDizzyStars(x, y, stateT, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * TAU + stateT * 0.006;
      const rx = 46;
      const ry = 17;
      const px = x + Math.cos(ang) * rx;
      const py = y + Math.sin(ang) * ry - 8;
      const tw = 0.65 + 0.35 * Math.sin(stateT * 0.012 + i * 1.7);
      this.star(px, py, 7 * tw, ang + stateT * 0.004, '#ffd76a', 'rgba(255,196,64,0.55)');
    }
    ctx.restore();
  }

  star(x, y, r, rot, fill, glow) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = (i / 10) * TAU - Math.PI / 2;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 10;
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  // ---------- 蛇 ----------

  drawSnake(now, alpha) {
    const g = this.game;
    const ctx = this.ctx;
    const segs = g.snake.segments;
    if (!segs || segs.length < 2 || alpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 鲸鱼体型：靠近头最粗，中段保持饱满，末段快速收细；
    // 尾端再叠一点偶尔加大的左右摆尾。
    const n = segs.length;
    const bsegs = segs.map((p) => ({ x: p.x, y: p.y }));
    const flickBase = Math.max(0, Math.sin(now / 1700));
    const flick = 0.28 + 0.72 * Math.pow(flickBase, 6);
    const wiggleFrom = Math.max(3, Math.floor(n * 0.55));
    for (let i = wiggleFrom; i < n; i++) {
      const p = segs[i];
      const prev = segs[i - 1] || p;
      const next = segs[i + 1] || p;
      let tx = prev.x - next.x;
      let ty = prev.y - next.y;
      const d = Math.hypot(tx, ty) || 1;
      const nx = -ty / d;
      const ny = tx / d;
      const t = (i - wiggleFrom) / Math.max(1, n - 1 - wiggleFrom);
      const off = Math.sin(now / 190 + i * 1.05) * g.cfg.bodyRadius * 0.45 * flick * t;
      bsegs[i].x += nx * off;
      bsegs[i].y += ny * off;
    }
    const widths = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      let whale;
      if (t < 0.3) whale = 0.95 + 0.5 * (t / 0.3);
      else if (t < 0.72) whale = 1.45 - 1.15 * ((t - 0.3) / 0.42);
      else whale = 0.3 - 0.24 * ((t - 0.72) / 0.28);
      widths[i] = Math.max(2.0, g.cfg.bodyRadius * whale * (g.sizeScale || 1));
    }
    const bodyPts = this.bodyOutline(bsegs, widths);
    const shadowPts = this.bodyOutline(bsegs, widths, 4, 9);

    // 地面投影
    ctx.save();
    ctx.fillStyle = 'rgba(0, 10, 40, 0.18)';
    ctx.shadowColor = 'rgba(0, 8, 30, 0.3)';
    ctx.shadowBlur = 10;
    this.pathPoly(shadowPts);
    ctx.fill();
    ctx.restore();

    // 尾鳍（鲸鱼尾）：先画，压在身上，接缝藏在身下
    this.drawFluke(bsegs, widths, now);

    // 身体底色
    const head = segs[0];
    const tail = segs[segs.length - 1];
    const grad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    grad.addColorStop(0, '#6f9bff');
    grad.addColorStop(0.4, '#3f63d8');
    grad.addColorStop(0.78, '#22358f');
    grad.addColorStop(1, '#141f60');
    this.pathPoly(bodyPts);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(8, 16, 54, 0.92)';
    ctx.stroke();

    // 腹部浅色带（沿身体中线）
    const belly = this.bodyOutline(bsegs, widths.map((w) => w * 0.46));
    ctx.save();
    ctx.globalAlpha = 0.32;
    this.pathPoly(belly);
    ctx.fillStyle = '#a8d4ff';
    ctx.fill();
    ctx.restore();

    // 背鳞：一圈圈淡弧，让长身体有节奏
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#dff0ff';
    ctx.lineWidth = 1.2;
    for (let i = 2; i < bsegs.length - 2; i += 2) {
      const p = bsegs[i];
      const prev = bsegs[i - 1];
      const next = bsegs[i + 1];
      const a = Math.atan2(prev.y - next.y, prev.x - next.x);
      const w = widths[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.82, -0.95, 0.95);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // 背脊高光：贴着上缘的一条细线
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < bsegs.length; i++) {
      const p = bsegs[i];
      const w = widths[i];
      if (i === 0) ctx.moveTo(p.x - w * 0.25, p.y - w * 0.55);
      else ctx.lineTo(p.x - w * 0.25, p.y - w * 0.55);
    }
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(206, 236, 255, 0.38)';
    ctx.stroke();
    ctx.restore();

    // 背部小光斑，让长身体有节奏
    for (let i = 3; i < bsegs.length - 1; i += 3) {
      const p = bsegs[i];
      const r = widths[i];
      ctx.beginPath();
      ctx.ellipse(p.x - r * 0.25, p.y - r * 0.42, r * 0.42, r * 0.2, 0, 0, TAU);
      ctx.fillStyle = 'rgba(235, 248, 255, 0.2)';
      ctx.fill();
    }

    if (this.headReadyCount === 3) this.drawHeadSprite(head, now);
    else this.drawHead(head, now);
    ctx.restore();
  }

  /** 沿脊椎左右偏移出一条闭合的身体轮廓 */
  bodyOutline(segs, widths, dx = 0, dy = 0) {
    const n = segs.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const p = segs[i];
      const prev = segs[i === 0 ? 0 : i - 1];
      const next = segs[i === n - 1 ? n - 1 : i + 1];
      let tx = prev.x - next.x;
      let ty = prev.y - next.y;
      const d = Math.hypot(tx, ty) || 1;
      tx /= d;
      ty /= d;
      const nx = -ty;
      const ny = tx;
      const w = widths[i];
      left.push({ x: p.x + nx * w, y: p.y + ny * w });
      right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }
    const pts = left.concat(right.reverse());
    return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  pathPoly(pts) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();
  }

  // 尾端的鲸鱼尾鳍：两片叶子 + 中间凹口，顺身体方向摆动
  drawFluke(segs, widths, now) {
    const ctx = this.ctx;
    const n = segs.length;
    if (n < 2) return;
    const p = segs[n - 1];
    const q = segs[n - 2];
    const ang = Math.atan2(p.y - q.y, p.x - q.x);
    const scale = this.game.sizeScale || 1;
    const r = this.game.cfg.headRadius * scale;
    const w = Math.max(3, widths[n - 1]);
    const L = r * 1.9;
    const S = L * 0.9;
    const bw = Math.max(6, w * 1.8);
    const tipX = L * 0.98;
    const tipY = S * 0.66;
    const notchX = L * 0.42;
    const sway = Math.sin(now / 300) * 0.18 + Math.sin(now / 170) * 0.05;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang + sway);

    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(0, -bw);
      ctx.bezierCurveTo(L * 0.22, -S * 0.42, L * 0.62, -S * 0.95, tipX, -tipY);
      ctx.quadraticCurveTo(L * 0.82, -S * 0.30, notchX, 0);
      ctx.quadraticCurveTo(L * 0.82, S * 0.30, tipX, tipY);
      ctx.bezierCurveTo(L * 0.62, S * 0.95, L * 0.22, S * 0.42, 0, bw);
      ctx.closePath();
    };

    // 尾柄：从身体末端平滑加宽到尾鳍根部
    const neckGrad = ctx.createLinearGradient(-L * 0.5, 0, 0, 0);
    neckGrad.addColorStop(0, '#1a2a7a');
    neckGrad.addColorStop(1, '#2c4cc8');
    ctx.beginPath();
    ctx.moveTo(-L * 0.5, -bw * 0.4);
    ctx.quadraticCurveTo(-L * 0.16, -bw * 0.6, 0, -bw);
    ctx.lineTo(0, bw);
    ctx.quadraticCurveTo(-L * 0.16, bw * 0.6, -L * 0.5, bw * 0.4);
    ctx.closePath();
    ctx.fillStyle = neckGrad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(8,16,54,0.85)';
    ctx.stroke();

    const grad = ctx.createLinearGradient(0, -S * 0.4, L, S * 0.4);
    grad.addColorStop(0, '#1d348f');
    grad.addColorStop(0.42, '#2f55d6');
    grad.addColorStop(0.75, '#1b2f92');
    grad.addColorStop(1, '#0f1d63');
    trace();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineJoin = 'miter';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(6, 12, 46, 0.95)';
    ctx.stroke();

    // 以下都裁进尾鳍轮廓
    ctx.save();
    trace();
    ctx.clip();

    // 半透明涂层：扇形的鳍条 + 一层薄光泽，做出“透光膜”的质感
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#cfe6ff';
    ctx.lineWidth = 1.1;
    for (let k = -4; k <= 4; k++) {
      const ty = (k / 4) * S * 0.62;
      ctx.beginPath();
      ctx.moveTo(L * 0.06, ty * 0.18);
      ctx.quadraticCurveTo(L * 0.45, ty * 0.55, L * 0.9, ty);
      ctx.stroke();
    }
    ctx.restore();

    const sheen = ctx.createRadialGradient(L * 0.42, -S * 0.12, L * 0.04, L * 0.42, -S * 0.12, L * 0.55);
    sheen.addColorStop(0, 'rgba(190, 226, 255, 0.28)');
    sheen.addColorStop(0.55, 'rgba(150, 200, 255, 0.10)');
    sheen.addColorStop(1, 'rgba(120, 180, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-L * 0.1, -S * 1.1, L * 1.2, S * 2.2);

    // 白色蕾丝边：沿两条前缘排白点，做出波浪内缘
    const edgePts = (mirror) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const u = 1 - t;
        const x = u * u * u * 0 + 3 * u * u * t * (L * 0.22) + 3 * u * t * t * (L * 0.62) + t * t * t * tipX;
        const y = -(u * u * u * (bw * 0.92) + 3 * u * u * t * (S * 0.42) + 3 * u * t * t * (S * 0.95) + t * t * t * tipY);
        pts.push({ x, y: mirror ? -y : y });
      }
      return pts;
    };
    for (const mirror of [false, true]) {
      const pts = edgePts(mirror);
      for (let i = 1; i < pts.length - 1; i += 1) {
        const pt = pts[i];
        const wob = 0.045 + 0.012 * Math.sin(i * 1.7 + (mirror ? 2 : 0));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(236, 246, 255, 0.86)';
        ctx.arc(pt.x, pt.y * 0.955, L * wob, 0, TAU);
        ctx.fill();
      }
    }

    // 星点
    const stars = [
      [0.2, -0.1, 0.024], [0.34, 0.08, 0.02], [0.46, -0.36, 0.026],
      [0.58, 0.3, 0.022], [0.7, -0.14, 0.022], [0.8, 0.16, 0.018],
      [0.28, 0.3, 0.016], [0.62, -0.44, 0.018], [0.42, 0.2, 0.014],
    ];
    ctx.fillStyle = 'rgba(206, 234, 255, 0.66)';
    for (const [fx, fy, fr] of stars) {
      ctx.beginPath();
      ctx.arc(fx * L, fy * S, fr * L, 0, TAU);
      ctx.fill();
    }

    // 参考图的白色椭圆斑
    ctx.save();
    ctx.translate(L * 0.52, -S * 0.3);
    ctx.rotate(-0.3);
    ctx.fillStyle = 'rgba(238, 249, 255, 0.9)';
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.095, L * 0.052, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(48, 88, 220, 0.85)';
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.05, L * 0.026, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // 内侧细白边
    trace();
    ctx.strokeStyle = 'rgba(226, 242, 255, 0.55)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  drawHeadSprite(head, now) {
    const g = this.game;
    const ctx = this.ctx;
    const r = g.cfg.headRadius;
    const V = this.headViews;
    let target = Math.atan2(g.snake.dirY, g.snake.dirX);
    if (this.headAngle === null) this.headAngle = target;
    let diff = Math.atan2(Math.sin(target - this.headAngle), Math.cos(target - this.headAngle));
    this.headAngle += diff * 0.22;
    const a = this.headAngle;

    // 四个朝向锚点：右(0°)=侧面镜像、下(90°)=正脸、左(180°)=侧面、上(270°)=后脑
    const anchors = [
      { d: 0, key: 'side', mirror: true, off: 0.6 },
      { d: Math.PI / 2, key: 'front', mirror: false, off: 0.66 },
      { d: Math.PI, key: 'side', mirror: false, off: 0.6 },
      { d: (Math.PI * 3) / 2, key: 'back', mirror: false, off: 0.58 },
    ];
    let best = anchors[0];
    let bestDist = 99;
    for (const an of anchors) {
      let d = Math.atan2(Math.sin(a - an.d), Math.cos(a - an.d));
      if (Math.abs(d) < Math.abs(bestDist)) { best = an; bestDist = d; }
    }
    const img = V[best.key];
    const sizeScale = g.sizeScale || 1;
    const h = r * 3.4 * sizeScale;
    const w = (img.width / img.height) * h;
    const sx = best.mirror ? -1 : 1;
    const rot = bestDist * 0.5 * sx;

    // 头下软影
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#0a1030';
    ctx.beginPath();
    ctx.ellipse(head.x, head.y + r * 0.9 * sizeScale, r * 1.05 * sizeScale, r * 0.34 * sizeScale, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(head.x, head.y + Math.sin(now / 260) * 0.9);
    // 脖子处的深蓝底，先铺在头后面，盖住身体顶端
    const ng = ctx.createRadialGradient(0, h * 0.28, 2, 0, h * 0.28, w * 0.42);
    ng.addColorStop(0, 'rgba(27,46,115,0.92)');
    ng.addColorStop(0.65, 'rgba(31,52,128,0.6)');
    ng.addColorStop(1, 'rgba(31,52,128,0)');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.ellipse(0, h * 0.28, w * 0.42, h * 0.16, 0, 0, TAU);
    ctx.fill();

    ctx.scale(sx, 1);
    ctx.rotate(rot);
    ctx.drawImage(img, -w * 0.5, -h * best.off, w, h);
    ctx.restore();

    // 接头处的接触阴影，盖住裁切边
    const back = a + Math.PI;
    const jx = head.x + Math.cos(back) * r * 0.3;
    const jy = head.y + Math.sin(back) * r * 0.3;
    const sg = ctx.createRadialGradient(jx, jy, r * 0.1, jx, jy, r * 0.95);
    sg.addColorStop(0, 'rgba(8,14,40,0.42)');
    sg.addColorStop(0.55, 'rgba(8,14,40,0.22)');
    sg.addColorStop(1, 'rgba(8,14,40,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(jx, jy, r * 0.95, 0, TAU);
    ctx.fill();
  }

  drawHead(head, now) {
    const g = this.game;
    const ctx = this.ctx;
    const r = g.cfg.headRadius;
    const ang = Math.atan2(g.snake.dirY, g.snake.dirX);
    const blink = (now % 5200) < 130 ? 0.15 : 1;
    const faceX = r * 0.36;
    const faceRX = r * 0.52;
    const faceRY = r * 0.58;

    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(ang);

    // 鲸鱼鳍耳（从头两侧向后探出）
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(-r * 0.16, s * r * 0.64);
      ctx.rotate(s * 0.72);
      ctx.beginPath();
      ctx.moveTo(-r * 0.05, 0);
      ctx.bezierCurveTo(r * 0.18, s * r * 0.36, -r * 0.04, s * r * 0.92, -r * 0.62, s * r * 0.96);
      ctx.bezierCurveTo(-r * 0.7, s * r * 0.58, -r * 0.46, s * r * 0.2, -r * 0.05, 0);
      ctx.fillStyle = '#9adbff';
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#13245e';
      ctx.stroke();
      ctx.restore();
    }

    // 头发底盘
    const hairGrad = ctx.createRadialGradient(-r * 0.35, -r * 0.5, r * 0.1, 0, 0, r * 1.12);
    hairGrad.addColorStop(0, '#5d86ff');
    hairGrad.addColorStop(0.5, '#2f4fb4');
    hairGrad.addColorStop(1, '#15245c');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = hairGrad;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#081238';
    ctx.stroke();

    // 奶白针织帽：只占后脑，脸会盖住前半
    const hatX = -r * 0.52;
    const hatY = -r * 0.02;
    const hatR = r * 0.6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.985, 0, TAU);
    ctx.clip();
    const hatGrad = ctx.createRadialGradient(hatX - r * 0.28, hatY - r * 0.3, r * 0.05, hatX, hatY, hatR * 1.2);
    hatGrad.addColorStop(0, '#fffdf7');
    hatGrad.addColorStop(0.55, '#f4e9d7');
    hatGrad.addColorStop(1, '#d3bd9f');
    ctx.beginPath();
    ctx.arc(hatX, hatY, hatR, 0, TAU);
    ctx.fillStyle = hatGrad;
    ctx.fill();

    // 针织 V 针脚
    ctx.save();
    ctx.beginPath();
    ctx.arc(hatX, hatY, hatR - 1, 0, TAU);
    ctx.clip();
    ctx.strokeStyle = 'rgba(198,178,147,0.7)';
    ctx.lineWidth = Math.max(1, r * 0.05);
    ctx.lineCap = 'round';
    for (let row = -4; row <= 4; row++) {
      const v = hatY + row * r * 0.16;
      for (let col = -4; col <= 4; col++) {
        const u = hatX + col * r * 0.19 + (row % 2 ? r * 0.095 : 0);
        ctx.beginPath();
        ctx.moveTo(u - r * 0.05, v - r * 0.045);
        ctx.lineTo(u, v + r * 0.03);
        ctx.lineTo(u + r * 0.05, v - r * 0.045);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 毛线帽檐（只画外缘）
    ctx.beginPath();
    ctx.arc(hatX, hatY, hatR + r * 0.005, 0, TAU);
    ctx.strokeStyle = '#cbb38f';
    ctx.lineWidth = Math.max(1.4, r * 0.055);
    ctx.stroke();
    ctx.restore();

    // 脸（大脸，盖住帽子前半）
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.985, 0, TAU);
    ctx.clip();
    const faceGrad = ctx.createRadialGradient(faceX - r * 0.12, -r * 0.2, r * 0.05, faceX, 0, faceRX * 1.1);
    faceGrad.addColorStop(0, '#ffe9dd');
    faceGrad.addColorStop(1, '#ffd2c0');
    ctx.beginPath();
    ctx.ellipse(faceX, 0, faceRX, faceRY, 0, 0, TAU);
    ctx.fillStyle = faceGrad;
    ctx.fill();
    ctx.restore();

    // 发际线：沿脸后半圈的一条蓝发带
    ctx.beginPath();
    ctx.ellipse(faceX, 0, faceRX * 0.98, faceRY * 0.98, 0, Math.PI * 0.62, Math.PI * 1.38);
    ctx.strokeStyle = '#2b47a6';
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 两颊边的长发
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(r * 0.34, s * r * 0.6, r * 0.24, r * 0.13, s * 0.55, 0, TAU);
      ctx.fillStyle = '#26418f';
      ctx.fill();
      ctx.strokeStyle = '#0b1a4d';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // 腮红
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(r * 0.5, s * r * 0.42, r * 0.1, r * 0.055, 0, 0, TAU);
      ctx.fillStyle = 'rgba(255,150,170,0.42)';
      ctx.fill();
    }

    // 眼睛
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(r * 0.46, s * r * 0.22);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.18, r * 0.21 * blink, 0, 0, TAU);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(r * 0.02, s * r * 0.01, r * 0.145, r * 0.175 * blink, 0, 0, TAU);
      ctx.fillStyle = '#2b63d6';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(r * 0.02, s * r * 0.01, r * 0.09, r * 0.115 * blink, 0, 0, TAU);
      ctx.fillStyle = '#0a1230';
      ctx.fill();
      if (blink > 0.5) {
        ctx.beginPath();
        ctx.arc(-r * 0.02, -r * 0.07, r * 0.05, 0, TAU);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();
    }

    // 嘴
    ctx.beginPath();
    ctx.arc(r * 0.8, 0, r * 0.045, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = '#a35b63';
    ctx.lineWidth = Math.max(1, r * 0.04);
    ctx.stroke();

    // 帽侧蝴蝶结
    ctx.save();
    ctx.translate(-r * 0.66, -r * 0.44);
    ctx.rotate(-0.35);
    const bow = r * 0.26;
    ctx.fillStyle = '#5fb8ff';
    ctx.strokeStyle = '#0d1c52';
    ctx.lineWidth = 1.4;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(s * bow, -bow * 0.72);
      ctx.lineTo(s * bow * 0.85, bow * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.08, 0, TAU);
    ctx.fillStyle = '#d8f3ff';
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  // ---------- 能量块 ----------

  drawFood(now) {
    const g = this.game;
    if (!g.foods || !g.foods.length) return;
    const ctx = this.ctx;
    const dur = g.cfg.spawnScaleMs || 1500;
    for (const f of g.foods) {
      const age = Math.max(0, g.now - (f.born || 0));
      const t = clamp(age / dur, 0, 1);
      const sc = 0.12 + 0.88 * easeOutBack(t);
      const alpha = clamp(age / 260, 0, 1);
      const bob = Math.sin(now / 420) * 2.5;
      const pulse = 1 + Math.sin(now / 260) * 0.06;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = 'transparent'; // 别把蛇的投影状态带进来（否则贴图会投出方形影子）
      ctx.shadowBlur = 0;
      ctx.translate(f.x, f.y + bob);
      ctx.scale(sc, sc);

      const warm = f.variant !== 'bubble';
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 48 * pulse);
      glow.addColorStop(0, warm ? 'rgba(255, 240, 210, 0.55)' : 'rgba(190, 235, 255, 0.55)');
      glow.addColorStop(0.55, warm ? 'rgba(255, 220, 170, 0.16)' : 'rgba(120, 200, 255, 0.18)');
      glow.addColorStop(1, 'rgba(120, 200, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 48 * pulse, 0, TAU);
      ctx.fill();

      // token 能量球：三种皮，各 1/3（见 game-core.pickFoodVariant）
      const img = f.variant === 'bubble' ? ballBubble : f.variant === 'rice' ? ballRice : ballCloud;
      const ready = img.complete && img.naturalWidth > 0;
      ctx.save();
      ctx.rotate(Math.sin(now / 900 + (f.seed || 0)) * 0.05);
      if (ready) {
        const size = 60;
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
      } else {
        // 素材还没载入时的兜底
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, TAU);
        ctx.fillStyle = f.variant === 'bubble' ? '#bfe6ff' : '#fffaf0';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 140, 180, 0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();

      // 闪光
      for (let i = 0; i < 3; i++) {
        const a = now / 600 + i * 2.1;
        const sx = Math.cos(a) * 24;
        const sy = Math.sin(a * 1.3) * 20;
        this.star(sx, sy, 3.2 + Math.sin(a * 2) * 1.1, a, '#ffffff', 'rgba(150,220,255,0.8)');
      }
      ctx.restore();
    }
  }

  drawObstacles(now) {
    const ctx = this.ctx;
    const g = this.game;
    const dur = g.cfg.spawnScaleMs || 1500;
    for (const o of g.obstacles) {
      const age = Math.max(0, g.now - (o.born || 0));
      const t = clamp(age / dur, 0, 1);
      const sc = 0.15 + 0.85 * easeOutBack(t);
      ctx.save();
      ctx.globalAlpha = clamp(age / 220, 0, 1);
      ctx.translate(o.x, o.y);
      ctx.rotate(now / 4000);
      ctx.scale(sc, sc);
      ctx.beginPath();
      const spikes = 10;
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? o.r : o.r * 0.62;
        const a = (i / (spikes * 2)) * TAU;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 96, 96, 0.92)';
      ctx.fill();
      ctx.strokeStyle = '#7a1020';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, o.r * 0.34, 0, TAU);
      ctx.fillStyle = '#ffd0d0';
      ctx.fill();
      ctx.restore();
    }
  }
}
