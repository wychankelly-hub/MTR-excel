// 原創角色插圖（SVG）：陳定、火箭仔、肥站長、八仔，另有喂喂叔、乘客甲。
// 表情：neutral（平常）、happy（開心）、worried（擔心）、surprised（驚訝）、think（思考）
// 說話時嘴巴開合（可按音量做口型同步）；眼睛會定時眨眼。
const SKIN = '#F7D4B8';
const INK = '#26292E';

export const CHARACTERS = {
  chanding: { name: '陳定', role: '實習生', color: '#2F6FB3' },
  rocket: { name: '火箭仔', role: '實習生', color: '#E8711A' },
  fatmaster: { name: '肥站長', role: '站長', color: '#C0392B' },
  bat: { name: '八仔', role: '提示小助手', color: '#7D5CE0' },
  uncle: { name: '喂喂叔', role: '乘客', color: '#8E44AD' },
  passenger: { name: '乘客甲', role: '乘客', color: '#6C7A86' },
};

// ---------------------------------------------------------------- 臉部零件
function eyes(expr, cx1, cx2, cy, r = 6) {
  if (expr === 'happy') {
    return `<g class="eyes"><path d="M${cx1 - 8} ${cy + 2} Q${cx1} ${cy - 8} ${cx1 + 8} ${cy + 2}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M${cx2 - 8} ${cy + 2} Q${cx2} ${cy - 8} ${cx2 + 8} ${cy + 2}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/></g>`;
  }
  const rr = expr === 'surprised' ? r + 2 : r;
  return `<g class="eyes blink"><ellipse cx="${cx1}" cy="${cy}" rx="${rr}" ry="${rr + 1.5}" fill="${INK}"/><ellipse cx="${cx2}" cy="${cy}" rx="${rr}" ry="${rr + 1.5}" fill="${INK}"/><circle cx="${cx1 + 2}" cy="${cy - 2.5}" r="2" fill="#fff"/><circle cx="${cx2 + 2}" cy="${cy - 2.5}" r="2" fill="#fff"/></g>`;
}

function brows(expr, cx1, cx2, cy) {
  const d = { worried: [6, -4], surprised: [-6, -6], think: [0, -5], happy: [-2, -2], neutral: [0, 0] }[expr] || [0, 0];
  return `<g class="brows"><path d="M${cx1 - 10} ${cy + d[0]} L${cx1 + 9} ${cy + d[1]}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M${cx2 - 9} ${cy + d[1]} L${cx2 + 10} ${cy + d[0]}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/></g>`;
}

/** 嘴巴：靜止形狀 + 說話用的張口形狀（以 CSS／JS 切換） */
function mouth(expr, cx, cy, w = 16) {
  const closed = {
    neutral: `<path d="M${cx - w / 2} ${cy} Q${cx} ${cy + 5} ${cx + w / 2} ${cy}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    happy: `<path d="M${cx - w * 0.75} ${cy - 3} Q${cx} ${cy + 14} ${cx + w * 0.75} ${cy - 3} Z" fill="#8C2B2B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M${cx - w * 0.4} ${cy + 5} Q${cx} ${cy + 1} ${cx + w * 0.4} ${cy + 5}" fill="#E86A6A"/>`,
    worried: `<path d="M${cx - w / 2} ${cy + 3} Q${cx - w / 4} ${cy - 3} ${cx} ${cy + 2} Q${cx + w / 4} ${cy + 6} ${cx + w / 2} ${cy}" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
    surprised: `<ellipse cx="${cx}" cy="${cy + 2}" rx="6" ry="8" fill="#8C2B2B" stroke="${INK}" stroke-width="3"/>`,
    think: `<path d="M${cx - w / 3} ${cy + 2} L${cx + w / 2} ${cy - 1}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  }[expr] || '';
  const open = `<g class="mouth-open"><ellipse cx="${cx}" cy="${cy + 3}" rx="${w * 0.55}" ry="8" fill="#8C2B2B" stroke="${INK}" stroke-width="3"/><ellipse cx="${cx}" cy="${cy + 7}" rx="${w * 0.3}" ry="3" fill="#E86A6A"/></g>`;
  return `<g class="mouth-closed">${closed}</g>${open}`;
}

const blush = (x1, x2, y) => `<ellipse cx="${x1}" cy="${y}" rx="9" ry="5" fill="#F29A9A" opacity=".55"/><ellipse cx="${x2}" cy="${y}" rx="9" ry="5" fill="#F29A9A" opacity=".55"/>`;

// ---------------------------------------------------------------- 角色
const DRAW = {
  chanding(e) {
    return `
      <path d="M40 240 Q40 178 100 172 Q160 178 160 240 Z" fill="#23415F" stroke="${INK}" stroke-width="3"/>
      <path d="M84 174 L100 206 L116 174 Z" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
      <path d="M96 182 L104 182 L102 214 L98 214 Z" fill="#2F6FB3"/>
      <rect x="120" y="196" width="26" height="14" rx="3" fill="#fff" stroke="${INK}" stroke-width="2"/><rect x="123" y="200" width="20" height="3" fill="#2F6FB3"/>
      <rect x="88" y="150" width="24" height="26" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="100" cy="104" rx="50" ry="56" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <path d="M50 98 Q48 42 102 42 Q154 44 152 96 Q140 70 118 66 Q92 80 62 74 Q54 84 50 98 Z" fill="#1E1E28" stroke="${INK}" stroke-width="3"/>
      ${brows(e, 80, 120, 86)}
      ${eyes(e, 80, 120, 104, 5)}
      <g fill="none" stroke="${INK}" stroke-width="3"><rect x="65" y="93" width="30" height="22" rx="5"/><rect x="105" y="93" width="30" height="22" rx="5"/><path d="M95 102 L105 102"/></g>
      ${mouth(e, 100, 132, 18)}`;
  },
  rocket(e) {
    return `
      <path d="M38 240 Q40 176 100 170 Q160 176 162 240 Z" fill="#E8711A" stroke="${INK}" stroke-width="3"/>
      <path d="M100 172 L100 240" stroke="#fff" stroke-width="7"/><path d="M58 200 L80 196 M142 200 L120 196" stroke="#fff" stroke-width="5"/>
      <path d="M128 212 l8 -16 l8 16 l-8 -4 Z" fill="#FFD23F" stroke="${INK}" stroke-width="2"/>
      <rect x="88" y="148" width="24" height="26" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="100" cy="106" rx="48" ry="52" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <path d="M50 96 L46 54 L66 72 L70 36 L88 64 L100 26 L112 62 L132 34 L134 70 L156 52 L150 98 Q132 72 100 74 Q70 72 50 96 Z" fill="#3A2410" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M70 36 L76 50 M100 26 L102 42 M132 34 L128 50" stroke="#FF8A2A" stroke-width="5" stroke-linecap="round"/>
      ${brows(e, 80, 120, 88)}
      ${eyes(e, 80, 120, 106, 6)}
      ${e === 'worried' ? '<path d="M150 90 q6 8 0 14 q-6 -6 0 -14" fill="#8FD3FF" stroke="#26292E" stroke-width="2"/>' : ''}
      ${mouth(e === 'neutral' ? 'happy' : e, 100, 134, 20)}`;
  },
  fatmaster(e) {
    return `
      <path d="M22 240 Q26 166 100 160 Q174 166 178 240 Z" fill="#1F2E45" stroke="${INK}" stroke-width="3"/>
      <path d="M92 164 L100 214 L108 164 Z" fill="#C0392B" stroke="${INK}" stroke-width="2"/>
      <circle cx="62" cy="208" r="4" fill="#E8C35A"/><circle cx="138" cy="208" r="4" fill="#E8C35A"/>
      <ellipse cx="100" cy="112" rx="64" ry="58" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <path d="M58 150 Q100 176 142 150" fill="none" stroke="${INK}" stroke-width="3" opacity=".5"/>
      <path d="M34 78 Q36 44 100 40 Q164 44 166 78 Z" fill="#1F2E45" stroke="${INK}" stroke-width="3"/>
      <rect x="30" y="72" width="140" height="14" rx="5" fill="#C0392B" stroke="${INK}" stroke-width="3"/>
      <path d="M38 86 Q100 104 162 86 L166 94 Q100 112 34 94 Z" fill="#14202F" stroke="${INK}" stroke-width="3"/>
      <circle cx="100" cy="58" r="10" fill="#E8C35A" stroke="${INK}" stroke-width="2.5"/><path d="M100 50 L100 66 M92 58 L108 58" stroke="${INK}" stroke-width="2"/>
      ${brows(e, 78, 122, 104)}
      ${eyes(e, 78, 122, 120, 5)}
      ${blush(64, 136, 140)}
      <path d="M72 140 Q86 130 100 138 Q114 130 128 140 Q114 148 100 142 Q86 148 72 140 Z" fill="#4A3426" stroke="${INK}" stroke-width="2.5"/>
      ${mouth(e, 100, 152, 18)}`;
  },
  bat(e) {
    return `
      <g class="tentacles">
        <path d="M58 170 Q36 206 52 226 Q62 214 70 182" fill="#7D5CE0" stroke="${INK}" stroke-width="3"/>
        <path d="M82 182 Q74 222 92 234 Q98 216 96 186" fill="#7D5CE0" stroke="${INK}" stroke-width="3"/>
        <path d="M118 182 Q126 222 108 234 Q102 216 104 186" fill="#7D5CE0" stroke="${INK}" stroke-width="3"/>
        <path d="M142 170 Q164 206 148 226 Q138 214 130 182" fill="#7D5CE0" stroke="${INK}" stroke-width="3"/>
      </g>
      <ellipse cx="100" cy="118" rx="64" ry="66" fill="#8E6CEF" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="80" cy="84" rx="16" ry="10" fill="#B9A4FF" opacity=".7"/>
      <path d="M58 64 Q100 30 142 64 L134 72 Q100 50 66 72 Z" fill="#1F2E45" stroke="${INK}" stroke-width="3"/>
      <rect x="92" y="44" width="16" height="10" rx="3" fill="#E8C35A" stroke="${INK}" stroke-width="2"/>
      <path d="M40 118 Q36 96 52 92" fill="none" stroke="${INK}" stroke-width="3"/><circle cx="40" cy="122" r="7" fill="#1F2E45" stroke="${INK}" stroke-width="2"/>
      ${brows(e, 78, 122, 96)}
      ${eyes(e, 78, 122, 116, 8)}
      ${blush(62, 138, 138)}
      ${mouth(e === 'neutral' ? 'happy' : e, 100, 146, 18)}`;
  },
  uncle(e) {
    return `
      <path d="M36 240 Q40 176 100 170 Q160 176 164 240 Z" fill="#7A5C9E" stroke="${INK}" stroke-width="3"/>
      <rect x="88" y="150" width="24" height="24" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="100" cy="106" rx="50" ry="54" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <path d="M52 100 Q50 70 62 64 M148 100 Q150 70 138 64" fill="none" stroke="#9A9A9A" stroke-width="8" stroke-linecap="round"/>
      <rect x="148" y="98" width="14" height="30" rx="3" fill="#333" stroke="${INK}" stroke-width="2"/>
      ${brows(e, 80, 120, 90)}${eyes(e, 80, 120, 106, 5)}
      ${mouth(e === 'neutral' ? 'happy' : e, 100, 134, 22)}`;
  },
  passenger(e) {
    return `
      <path d="M38 240 Q40 176 100 170 Q160 176 162 240 Z" fill="#5E8C6A" stroke="${INK}" stroke-width="3"/>
      <rect x="88" y="150" width="24" height="24" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <ellipse cx="100" cy="106" rx="48" ry="52" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
      <circle cx="100" cy="46" r="18" fill="#3B2A20" stroke="${INK}" stroke-width="3"/>
      <path d="M52 104 Q50 58 100 56 Q150 58 148 104 Q132 76 100 76 Q68 76 52 104 Z" fill="#3B2A20" stroke="${INK}" stroke-width="3"/>
      ${brows(e === 'neutral' ? 'worried' : e, 80, 120, 90)}${eyes(e, 80, 120, 106, 5)}
      ${mouth(e === 'neutral' ? 'worried' : e, 100, 134, 16)}`;
  },
};

/** 角色 SVG 字串 */
export function characterSVG(id, expr = 'neutral') {
  const draw = DRAW[id] || DRAW.passenger;
  return `<svg class="char-svg char-${id} expr-${expr}" viewBox="0 0 200 240" role="img" aria-label="${CHARACTERS[id]?.name || ''}">${draw(expr)}</svg>`;
}

// ---------------------------------------------------------------- 老師上載的角色圖片（雲端資產庫）
// 每個角色可上載：neutral（必需）、talk（張口，用於說話／口型）、blink（閉眼）、happy、worried、surprised、think。
// 沒有上載的表情會用 neutral 圖片；完全沒有圖片的角色使用內建 SVG。
export let CHARACTER_IMAGES = {};
const instances = new Set();
export const charactersReady = fetch('/api/characters').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((m) => {
  CHARACTER_IMAGES = m || {};
  for (const c of instances) c.render();
  return CHARACTER_IMAGES;
});

/** 可更新的角色元件：表情、說話、口型、彈跳反應 */
export class Character {
  constructor(id, { size = 120, showName = false } = {}) {
    this.id = id;
    this.expr = 'neutral';
    this.mouthOpen = false;
    this.blinking = false;
    this.el = document.createElement('div');
    this.el.className = `char char-${id}`;
    this.el.style.setProperty('--char-size', `${size}px`);
    this.el.style.setProperty('--char-color', CHARACTERS[id]?.color || '#888');
    this.svgBox = document.createElement('div');
    this.svgBox.className = 'char-art';
    this.el.append(this.svgBox);
    if (showName) {
      const n = document.createElement('div');
      n.className = 'char-name';
      n.textContent = CHARACTERS[id]?.name || '';
      this.el.append(n);
    }
    // 不同角色的眨眼時間錯開
    this.el.style.setProperty('--blink-delay', `${(id.length * 0.73) % 3}s`);
    instances.add(this);
    this.render();
  }

  get images() { return CHARACTER_IMAGES[this.id] || null; }

  render() {
    const imgs = this.images;
    if (imgs && (imgs.neutral || imgs[this.expr])) {
      if (!this.img) {
        this.svgBox.innerHTML = '';
        this.img = document.createElement('img');
        this.img.alt = CHARACTERS[this.id]?.name || '';
        this.img.className = 'char-img';
        this.img.decoding = 'async';
        this.svgBox.append(this.img);
        this.el.classList.add('has-img');
        this.startBlink();
      }
      this.updateImage();
      return;
    }
    this.img = null;
    this.el.classList.remove('has-img');
    this.svgBox.innerHTML = characterSVG(this.id, this.expr);
  }

  updateImage() {
    const imgs = this.images;
    if (!this.img || !imgs) return;
    let src = imgs[this.expr] || imgs.neutral;
    if (this.mouthOpen && imgs.talk) src = imgs.talk;
    else if (this.blinking && imgs.blink && this.expr === 'neutral') src = imgs.blink;
    if (this.img.getAttribute('src') !== src) this.img.src = src;
  }

  startBlink() {
    if (this._blinkTimer || !this.images?.blink) return;
    const loop = () => {
      this._blinkTimer = setTimeout(() => {
        this.blinking = true; this.updateImage();
        setTimeout(() => { this.blinking = false; this.updateImage(); loop(); }, 140);
      }, 3500 + Math.random() * 2500);
    };
    loop();
  }

  setExpression(expr) {
    if (expr === this.expr) return;
    this.expr = expr;
    this.render();
  }

  setTalking(on) {
    this.el.classList.toggle('talking', !!on);
    clearInterval(this._talkTimer);
    this._talkTimer = null;
    if (on && this.img && !this.el.classList.contains('lipsync')) {
      this._talkTimer = setInterval(() => { this.mouthOpen = !this.mouthOpen; this.updateImage(); }, 170);
    } else if (!on) { this.mouthOpen = false; this.updateImage(); }
  }

  /** 0–1：按音量開口（口型同步）；null 表示用自動開合 */
  setMouth(level) {
    if (level === null) { this.el.classList.remove('lipsync'); this.mouthOpen = false; this.updateImage(); return; }
    this.el.classList.add('lipsync');
    clearInterval(this._talkTimer);
    this._talkTimer = null;
    this.el.classList.toggle('mouth-on', level > 0.12);
    this.mouthOpen = level > 0.12;
    this.updateImage();
  }

  react(kind, ms = 1600) {
    const expr = { happy: 'happy', celebrate: 'happy', worried: 'worried', surprised: 'surprised', think: 'think' }[kind] || 'neutral';
    this.setExpression(expr);
    this.el.classList.remove('hop', 'shake');
    void this.el.offsetWidth;
    this.el.classList.add(kind === 'worried' ? 'shake' : 'hop');
    clearTimeout(this._t);
    this._t = setTimeout(() => { this.setExpression('neutral'); this.el.classList.remove('hop', 'shake'); }, ms);
  }
}

/** 學生／老師畫面的短反應（角色 + 一句粵語），不遮擋工作表 */
export const REACTIONS = {
  correct: [['chanding', 'happy', '計啱晒！做得好！'], ['rocket', 'happy', '咁快搞掂？勁呀！'], ['bat', 'happy', '啱晒！繼續加油！']],
  partial: [['bat', 'think', '有啲位啱咗，睇吓下面嘅提示再改吓！']],
  wrong: [['bat', 'worried', '唔使驚，睇清楚提示再試吓！'], ['chanding', 'think', '慢慢嚟，先檢查公式同參照。']],
  levelClear: [['fatmaster', 'happy', '呢一關全部搞掂！好嘢！']],
  sync: [['fatmaster', 'worried', '網絡好似有啲問題，唔會扣分，再按一次啦！']],
};
