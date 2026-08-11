// ========================================
// 潛淵 - 賭場（H 的賭局）
// ----------------------------------------
// H：藏在潛淵深處的某種存在，愛熱鬧、唯恐天下不亂、但沒有惡意。他不是敵人，是「陪你玩」的莊家。
//
// 兩種場合、兩種貨幣：
//   節點版 🎲（第二層路上的「神秘賭局」）：賭「潛晶 💎」，玩一局就走。
//   避難所賭場（打贏第二層 + 玩過一次節點賭場，兩條件都達成才開）：用「代幣 🪙」，可以久留。
//     代幣目前用潛晶兌換（1:1，暫定），未來會有「交易所」拿代幣換酷東西／消耗品（尚未實作）。
//
// 這個檔案自成一個子系統：H 的台詞、共用下注列、以及各款賭場遊戲的資料與邏輯都放這裡，
// 方便日後接手的人一次看懂整組賭場，不用在多個檔案間跳。
//
// 首發遊戲（刻意讓每個的核心決策都不一樣，不是換皮的同一套）：
//   1. 翻礦盤   — 風險管理（翻格子累積倍率，隨時收手；翻到塌方全輸）
//   2. 逼深骰   — 對莊決策（主題化 21 點，逼近臨界壓力 23 別爆掉，H 當莊）
//   3. 騙子骰   — 讀心＋機率（雙方各擲 5 顆藏起來，輪流喊價、抓對方唬爛）
// ========================================

const H_ICON = "🃏"; // H 在賭場畫面上的代表圖示（小丑牌）

const CASINO_HOUSE_EDGE = 0.95; // 賭場抽水：純機率遊戲的期望值略偏莊家，避免被玩爛
const DICE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"]; // 骰子點數的 Unicode 圖示（index 1~6）

// ---- H 的台詞池（依情境隨機挑一句，讓 H 顯得活） ----

const H_INTRO_LINES = [
  { speaker: "", text: "腳邊的陰影裡，忽然傳來一個愉快的聲音。" },
  { speaker: "？？？", text: "哦哦哦——有客人？稀客稀客！這種鬼地方居然還有活人晃過來，太棒了太棒了～" },
  { speaker: "？？？", text: "別緊張別緊張，我沒惡意的啦。我只是……很無聊。你懂那種被困在黑漆漆的地方、一百年沒人陪玩的感覺嗎？不懂？沒關係！" },
  { speaker: "？？？", text: "這樣吧——陪我玩一局。賭一點你那些亮晶晶的潛晶，贏了算你的，輸了嘛……嘿嘿，就當交個朋友的學費嘍。" },
  { speaker: "H", text: "對了，你可以叫我 H。來吧來吧，想玩哪個？" },
];

const H_GREET_LINES = [
  "又來啦？我就知道你捨不得我～",
  "來來來，今天手氣如何？讓我瞧瞧。",
  "歡迎回到我的小天地。要玩點什麼壞事？",
  "哈囉哈囉！錢帶夠了嗎？沒帶夠也沒關係，賭注可以很小的。",
];
const H_WIN_LINES = [ // 玩家贏了（H 輸）
  "……嘖。你贏了。（我下次不會手下留情囉。）",
  "哇喔，運氣不錯嘛！哼，只是運氣而已啦。",
  "可惡可惡！再來一局，我不服氣！",
  "行啊你——這把算你厲害，我記下了喔。",
];
const H_LOSE_LINES = [ // 玩家輸了（H 贏）
  "哎呀呀～沒了沒了，都是我的了，謝謝惠顧～",
  "嘿嘿嘿，這就是陪我玩的代價嘛，別哭別哭。",
  "運氣這種東西，來得快去得也快呀。要不要再賭一把翻本？",
  "多謝多謝！你這種客人我最喜歡了，再來嘛再來嘛。",
];
const H_PUSH_LINES = [ // 平手
  "平手？真沒意思，這樣我很難炒熱氣氛欸。",
  "打平啦，誰也沒佔到便宜。再一局？",
];
const H_ALLIN_LINES = [ // 玩家全下
  "哦——？全部？我喜歡你！來吧來吧來吧！",
  "全下！啊哈哈這才對嘛！要嘛滿載而歸，要嘛……嘿嘿。",
];
const H_SMALLBET_LINES = [ // 玩家下很小
  "這麼小家子氣？沒關係，我等得起～",
  "才這麼一點點？膽子跟你身材一樣嗎——開玩笑的開玩笑的。",
];

// 賭場遊戲登錄表：id -> { name, icon, blurb, start(bet) }
// blurb 是下注前顯示的一句話規則說明；start 由各遊戲的實作函式指定。
const CASINO_GAMES = {
  mines: {
    name: "翻礦盤", icon: "⛏️",
    blurb: "翻開礦格累積倍率，隨時可以收手把贏的帶走；翻到「塌方」就全部輸光。埋越多塌方，倍率越高。",
    start: (bet) => minesStart(bet),
  },
  blackjack: {
    name: "逼深骰", icon: "🎴",
    blurb: "不斷「再下潛一層」抽壓力牌累加，越接近臨界壓力 23 賠越多，但超過就被壓爆全輸。H 當莊也會抽。",
    start: (bet) => bjStart(bet),
  },
  liar: {
    name: "騙子骰", icon: "🎲",
    blurb: "你和 H 各擲 5 顆藏起來的骰子，輪流喊「檯面上至少有幾個某點數」，越喊越大——抓到對方唬爛就贏。",
    start: (bet) => liarStart(bet),
  },
};

// ========================================
// 賭場核心：進出、貨幣抽象、下注列、結算
// ========================================

// 目前這場賭局的上下文（進賭場時建立，離開時清掉）
let casinoCtx = null; // { currency:"crystal"|"token", onExit:fn, title }
let casinoBet = { value: 1, max: 1 }; // 下注列目前狀態
let casinoRound = null; // 目前這一局：{ gameId, bet }

// 代幣兌換率（暫定 1:1，未來交易所上線後可再調）
const TOKEN_BUY_RATE = 1; // 花 1 潛晶換 1 代幣
const TOKEN_SELL_RATE = 1; // 賣 1 代幣換回 1 潛晶

function casinoCurrencyIcon() {
  return casinoCtx && casinoCtx.currency === "token" ? "🪙" : "💎";
}
function casinoCurrencyName() {
  return casinoCtx && casinoCtx.currency === "token" ? "代幣" : "潛晶";
}
function casinoBalance() {
  return casinoCtx && casinoCtx.currency === "token" ? gameState.tokens : gameState.crystal;
}
// 統一的加減錢：正數＝贏／退還，負數＝下注扣除。
// 潛晶版要小心 crystalEarnedThisRun：只累加正的、扣除時夾在 0 以上，
// 不然它變負數會讓「全滅損失 = floor(負數×0.5)」倒扣成退錢（見 04_避難所.js applyShelterReturn）。
function casinoAddBalance(delta) {
  if (casinoCtx && casinoCtx.currency === "token") {
    gameState.tokens = Math.max(0, gameState.tokens + delta);
    return;
  }
  gameState.crystal = Math.max(0, gameState.crystal + delta);
  if (activeDive) activeDive.crystalEarnedThisRun = Math.max(0, activeDive.crystalEarnedThisRun + delta);
  gameState.stats.maxCrystalSeen = Math.max(gameState.stats.maxCrystalSeen, gameState.crystal);
}

// 進入賭場：opts = { currency, onExit, title, intro(是否播 H 開場白) }
function casinoEnter(opts) {
  casinoCtx = { currency: opts.currency, onExit: opts.onExit, title: opts.title || "H 的賭局" };
  if (opts.intro) {
    playDialogue(H_INTRO_LINES, renderCasinoHub);
  } else {
    renderCasinoHub();
  }
}

function casinoLeave() {
  let exit = casinoCtx ? casinoCtx.onExit : null;
  casinoCtx = null;
  casinoRound = null;
  if (exit) exit();
}

// ---------- 賭場大廳 ----------

function renderCasinoHub() {
  let isToken = casinoCtx.currency === "token";
  let icon = casinoCurrencyIcon();
  let greet = pickRandom(H_GREET_LINES);

  let gameButtons = Object.keys(CASINO_GAMES).map((gid) => {
    let g = CASINO_GAMES[gid];
    return `<button class="casino-game-btn" onclick="casinoOpenGame('${gid}')">
      <span class="casino-game-icon">${g.icon}</span>
      <span class="casino-game-name">${g.name}</span>
      <span class="dim casino-game-blurb">${g.blurb}</span>
    </button>`;
  }).join("");

  // 避難所版多出「兌幣」與「交易所」
  let extraButtons = "";
  if (isToken) {
    extraButtons = `
      <div class="casino-side-actions">
        <button class="action-btn secondary" onclick="casinoExchangeModal()">💱 兌幣（潛晶 ⇄ 代幣）</button>
        <button class="action-btn secondary" onclick="casinoTradehouseModal()">🛒 交易所</button>
      </div>`;
  }

  let balanceLine = isToken
    ? `<span class="casino-balance">🪙 代幣 <b>${gameState.tokens}</b></span> <span class="dim">（💎 潛晶 ${gameState.crystal}）</span>`
    : `<span class="casino-balance">💎 潛晶 <b>${gameState.crystal}</b></span>`;

  showScreen(`
    <div class="casino-header">
      <h2 class="screen-title">${H_ICON} ${casinoCtx.title}</h2>
      <div class="casino-hbubble">「${greet}」<span class="dim">—— H</span></div>
      <div class="casino-balance-row">${balanceLine}</div>
    </div>
    <div class="casino-game-list">${gameButtons}</div>
    ${extraButtons}
    <button class="action-btn danger" style="margin-top:14px;" onclick="casinoLeave()">🚪 離開賭桌</button>
  `, { withTopbar: !!activeDive });
}

function casinoOpenGame(gameId) {
  if (casinoBalance() < 1) {
    systemToast(`身上一枚${casinoCurrencyName()}都沒有，H 嫌你窮。`, true);
    return;
  }
  renderBetScreen(gameId);
}

// ---------- 共用下注列 ----------

function renderBetScreen(gameId) {
  let g = CASINO_GAMES[gameId];
  let icon = casinoCurrencyIcon();
  casinoBet.max = casinoBalance();
  casinoBet.value = clamp(casinoBet.value, 1, casinoBet.max);

  showScreen(`
    <h2 class="screen-title">${g.icon} ${g.name}</h2>
    <div class="card"><p class="dim">${g.blurb}</p></div>

    <div class="card bet-bar">
      <div class="bet-bar-top">
        <span>賭注</span>
        <input type="number" id="casino-bet-number" class="bet-number" min="1" max="${casinoBet.max}" value="${casinoBet.value}" oninput="casinoSetBet(this.value)">
        <span class="dim">${icon} 目前有 ${casinoBalance()}</span>
      </div>
      <input type="range" id="casino-bet-slider" class="bet-slider" min="1" max="${casinoBet.max}" value="${casinoBet.value}" oninput="casinoSetBet(this.value)">
      <div class="bet-quick-row">
        <button class="bet-quick-btn" onclick="casinoBetMin()">最小</button>
        <button class="bet-quick-btn" onclick="casinoBetHalf()">½</button>
        <button class="bet-quick-btn" onclick="casinoBetDouble()">×2</button>
        <button class="bet-quick-btn" onclick="casinoBetMax()">全下</button>
      </div>
    </div>

    <button class="action-btn" id="casino-bet-confirm" onclick="casinoConfirmBet('${gameId}')">下注 ${casinoBet.value} ${icon} 開始</button>
    <button class="action-btn secondary" onclick="renderCasinoHub()">返回大廳</button>
  `, { withTopbar: !!activeDive });
}

// 設定賭注並讓滑條／數字框／確認鈕三邊同步
function casinoSetBet(v) {
  let n = Math.floor(Number(v));
  if (!isFinite(n) || n < 1) n = 1;
  if (n > casinoBet.max) n = casinoBet.max;
  casinoBet.value = n;
  let slider = document.getElementById("casino-bet-slider");
  let number = document.getElementById("casino-bet-number");
  let confirm = document.getElementById("casino-bet-confirm");
  if (slider) slider.value = n;
  if (number) number.value = n;
  if (confirm) confirm.textContent = `下注 ${n} ${casinoCurrencyIcon()} 開始`;
}
function casinoBetMin() { casinoSetBet(1); }
function casinoBetHalf() { casinoSetBet(Math.floor(casinoBalance() / 2)); }
function casinoBetDouble() { casinoSetBet(casinoBet.value * 2); }
function casinoBetMax() { casinoSetBet(casinoBalance()); }

function casinoConfirmBet(gameId) {
  let bet = casinoBet.value;
  if (bet < 1 || bet > casinoBalance()) { systemToast("賭注不合法。", true); return; }

  // H 對賭注大小的即時吐槽
  if (bet >= casinoBalance()) systemToast("H：" + pickRandom(H_ALLIN_LINES));
  else if (bet <= Math.max(1, Math.floor(casinoBalance() * 0.05))) systemToast("H：" + pickRandom(H_SMALLBET_LINES));

  casinoAddBalance(-bet); // 下注鎖定：開牌前先扣，避免中途反悔凹錢
  casinoRound = { gameId, bet };
  gameState.stats.casinoGamesPlayed = (gameState.stats.casinoGamesPlayed || 0) + 1;
  CASINO_GAMES[gameId].start(bet);
}

// 遊戲結束統一結算：payout = 這局「拿回來」的總額（0＝全輸；下注 10 贏一倍就 payout 20）
// resultLines = 顯示在結果畫面的敘述（陣列），outcome 決定 H 用哪組台詞。
function casinoResolveGame(payout, resultLines, outcome) {
  casinoAddBalance(payout);
  let bet = casinoRound ? casinoRound.bet : 0;
  let net = payout - bet;
  if (net > 0) gameState.stats.casinoBiggestWin = Math.max(gameState.stats.casinoBiggestWin || 0, net);

  let hLine = outcome === "win" ? pickRandom(H_WIN_LINES)
    : outcome === "push" ? pickRandom(H_PUSH_LINES)
    : pickRandom(H_LOSE_LINES);

  let icon = casinoCurrencyIcon();
  let netHtml = net > 0 ? `<span class="casino-net-win">+${net} ${icon}</span>`
    : net < 0 ? `<span class="casino-net-lose">${net} ${icon}</span>`
    : `<span class="dim">±0</span>`;

  let gameId = casinoRound ? casinoRound.gameId : null;
  let canReplay = casinoBalance() >= 1 && gameId;

  showScreen(`
    <h2 class="screen-title">${outcome === "win" ? "🎉 你贏了" : outcome === "push" ? "🤝 平手" : "💀 你輸了"}</h2>
    <div class="card casino-result-card">
      ${(resultLines || []).map((l) => `<p>${l}</p>`).join("")}
      <div class="casino-result-net">本局結算：${netHtml}</div>
      <div class="casino-hbubble">「${hLine}」<span class="dim">—— H</span></div>
      <div class="dim">目前 ${icon} ${casinoBalance()}</div>
    </div>
    ${canReplay ? `<button class="action-btn" onclick="renderBetScreen('${gameId}')">🔁 再玩一局</button>` : `<p class="dim">身上的${casinoCurrencyName()}見底了，改天再來吧。</p>`}
    <button class="action-btn secondary" onclick="renderCasinoHub()">回大廳</button>
    ${activeDive ? `<button class="action-btn danger" onclick="casinoLeave()">🚪 離開賭桌，繼續深潛</button>` : ""}
  `, { withTopbar: !!activeDive });
}

// 小工具：Fisher-Yates 洗牌（回傳新陣列）
function casinoShuffle(arr) {
  let a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    let j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========================================
// 遊戲 1：翻礦盤（Mines）
// 5×5＝25 格，先選埋幾顆塌方（3/5/8），翻開安全格倍率往上跳，隨時收手；翻到塌方全輸。
// 倍率用標準 Mines 公式：每翻開一格安全格，乘上「剩餘格 /（剩餘格 − 塌方數）」，收手時再乘抽水。
// ========================================

let minesState = null;
const MINES_GRID = 25;
const MINES_PRESETS = [
  { mines: 3, label: "3 顆塌方（穩健）" },
  { mines: 5, label: "5 顆塌方（刺激）" },
  { mines: 8, label: "8 顆塌方（瘋狂）" },
];

function minesStart(bet) {
  let rows = MINES_PRESETS.map((p) =>
    `<button class="action-btn" style="margin-top:8px;" onclick="minesBegin(${bet}, ${p.mines})">${p.label}</button>`
  ).join("");
  showScreen(`
    <h2 class="screen-title">⛏️ 翻礦盤</h2>
    <div class="card">
      <p>這盤要埋幾顆塌方？埋越多越危險，但每一鏟的倍率也越高。</p>
      <p class="dim">賭注 ${casinoRound.bet} ${casinoCurrencyIcon()} 已鎖定。</p>
      ${rows}
    </div>
  `, { withTopbar: !!activeDive });
}

function minesBegin(bet, mineCount) {
  let idx = casinoShuffle([...Array(MINES_GRID).keys()]);
  let mines = new Set(idx.slice(0, mineCount));
  minesState = { bet, mineCount, mines, revealed: new Set(), mult: 1, done: false, boom: false };
  minesRender();
}

function minesCurrentPayout() {
  return Math.floor(minesState.bet * minesState.mult * CASINO_HOUSE_EDGE);
}

function minesReveal(i) {
  let s = minesState;
  if (!s || s.done || s.revealed.has(i)) return;

  if (s.mines.has(i)) {
    // 踩到塌方：全輸
    s.done = true; s.boom = true; s.boomIndex = i;
    minesRender();
    setTimeout(() => casinoResolveGame(0, [
      `你把鏟子插進第 ${i + 1} 格——轟隆一聲，整片礦壁塌了下來。`,
      "剛才累積的一切，全埋在碎石底下。",
    ], "lose"), 900);
    return;
  }

  // 安全格：倍率跳升
  let remainingBefore = MINES_GRID - s.revealed.size; // 這一鏟之前還沒翻開的格數
  s.mult *= remainingBefore / (remainingBefore - s.mineCount);
  s.revealed.add(i);

  if (s.revealed.size === MINES_GRID - s.mineCount) {
    // 把所有安全格都翻完了：自動最大獲勝
    s.done = true;
    minesRender();
    setTimeout(() => minesCashout(true), 600);
    return;
  }
  minesRender();
}

function minesCashout(auto) {
  let s = minesState;
  if (!s || (s.done && !auto)) return;
  s.done = true;
  let payout = minesCurrentPayout();
  casinoResolveGame(payout, auto
    ? ["你翻遍了整個礦盤，一顆塌方都沒碰到——把礦全掏空了！", `倍率 ×${s.mult.toFixed(2)}。`]
    : [`你見好就收，帶著 ×${s.mult.toFixed(2)} 的收穫從礦坑爬了出來。`], "win");
}

function minesRender() {
  let s = minesState;
  let cells = [];
  for (let i = 0; i < MINES_GRID; i++) {
    let revealed = s.revealed.has(i);
    let isMine = s.mines.has(i);
    let cls = "mine-cell";
    let content = "";
    if (revealed) { cls += " mine-cell-safe"; content = "💎"; }
    else if (s.done && isMine) { cls += " mine-cell-boom"; content = i === s.boomIndex ? "💥" : "💣"; }
    else if (s.done) { cls += " mine-cell-dim"; content = ""; }
    let clickable = !s.done && !revealed;
    cells.push(`<button class="${cls}" ${clickable ? `onclick="minesReveal(${i})"` : "disabled"}>${content}</button>`);
  }
  let payout = minesCurrentPayout();
  let canCash = !s.done && s.revealed.size > 0;
  showScreen(`
    <h2 class="screen-title">⛏️ 翻礦盤</h2>
    <div class="card mines-status">
      <span>塌方 💣×${s.mineCount}</span>
      <span>目前倍率 <b>×${s.mult.toFixed(2)}</b></span>
      <span>可收 ${payout} ${casinoCurrencyIcon()}</span>
    </div>
    <div class="mines-grid">${cells.join("")}</div>
    <button class="action-btn ${canCash ? "" : "secondary"}" ${canCash ? "" : "disabled"} onclick="minesCashout(false)">💰 收手（帶走 ${payout} ${casinoCurrencyIcon()}）</button>
  `, { withTopbar: !!activeDive });
}

// ========================================
// 遊戲 2：逼深骰（主題化 21 點，臨界壓力 = 23）
// 牌堆：1~11 各 4 張（共 44 張）。玩家可一直要牌，超過 23 爆掉；停牌後莊家 H 抽到 ≥19 才停。
// 賠付：贏 ×2；壓線剛好 23 且贏 ×2.5；平手退還賭注；輸／爆掉全輸。
// ========================================

let bjState = null;
const BJ_TARGET = 23;
const BJ_DEALER_STAND = 19;

function bjBuildShoe() {
  let shoe = [];
  for (let v = 1; v <= 11; v++) for (let n = 0; n < 4; n++) shoe.push(v);
  return casinoShuffle(shoe);
}
function bjSum(hand) { return hand.reduce((a, b) => a + b, 0); }

function bjStart(bet) {
  let shoe = bjBuildShoe();
  let player = [shoe.pop(), shoe.pop()];
  let dealer = [shoe.pop(), shoe.pop()];
  bjState = { bet, shoe, player, dealer, done: false, revealDealer: false };
  bjRender();
}

function bjHit() {
  let s = bjState;
  if (!s || s.done) return;
  s.player.push(s.shoe.pop());
  let total = bjSum(s.player);
  if (total > BJ_TARGET) { bjRender(); setTimeout(() => bjFinish(), 500); return; } // 爆掉
  if (total === BJ_TARGET) { bjStand(); return; } // 剛好 23，自動停牌
  bjRender();
}

function bjStand() {
  let s = bjState;
  if (!s || s.done) return;
  s.revealDealer = true;
  while (bjSum(s.dealer) < BJ_DEALER_STAND) s.dealer.push(s.shoe.pop());
  bjRender();
  setTimeout(() => bjFinish(), 500);
}

function bjFinish() {
  let s = bjState;
  s.done = true; s.revealDealer = true;
  let p = bjSum(s.player), d = bjSum(s.dealer);
  let lines = [`你的壓力值：<b>${p}</b>　／　H 的壓力值：<b>${d}</b>`];
  let outcome, payout;

  if (p > BJ_TARGET) { outcome = "lose"; payout = 0; lines.push("你潛得太深，被水壓活活壓爆了。"); }
  else if (d > BJ_TARGET) { outcome = "win"; lines.push("H 貪心多抽了一張，自己爆了！"); }
  else if (p > d) { outcome = "win"; }
  else if (p < d) { outcome = "lose"; lines.push("H 的壓力比你更逼近極限。"); }
  else { outcome = "push"; }

  if (outcome === "win") {
    payout = (p === BJ_TARGET) ? Math.floor(s.bet * 2.5) : s.bet * 2;
    if (p === BJ_TARGET) lines.push("而且你剛好壓在 23 這條線上——完美深度，額外加碼！");
  } else if (outcome === "push") {
    payout = s.bet;
  } else {
    payout = 0;
  }
  bjRender();
  casinoResolveGame(payout, lines, outcome);
}

function bjCardHtml(v, hidden) {
  return `<span class="bj-card${hidden ? " bj-card-hidden" : ""}">${hidden ? "❓" : v}</span>`;
}
function bjRender() {
  let s = bjState;
  let dealerCards = s.dealer.map((v, i) => bjCardHtml(v, !s.revealDealer && i > 0)).join("");
  let dealerTotal = s.revealDealer ? bjSum(s.dealer) : "?";
  let playerTotal = bjSum(s.player);
  showScreen(`
    <h2 class="screen-title">🎴 逼深骰</h2>
    <div class="card">
      <div class="bj-side"><span class="bj-label">${H_ICON} H（莊家）壓力 ${dealerTotal}</span><div class="bj-hand">${dealerCards}</div></div>
      <div class="bj-side"><span class="bj-label">你的壓力 ${playerTotal} <span class="dim">/ 臨界 ${BJ_TARGET}</span></span><div class="bj-hand">${s.player.map((v) => bjCardHtml(v, false)).join("")}</div></div>
    </div>
    ${s.done ? "" : `<button class="action-btn" onclick="bjHit()">⬇️ 再下潛一層（要牌）</button>
    <button class="action-btn secondary" onclick="bjStand()">✋ 停在這個深度（停牌）</button>`}
  `, { withTopbar: !!activeDive });
}

// ========================================
// 遊戲 3：騙子骰（Liar's Dice，1 對 1 對 H）
// 雙方各擲 5 顆藏起來（玩家看得到自己的），檯面共 10 顆。
// 輪流喊價（至少有 N 個 X 點），必須比上一口大（數量更多，或同數量點數更大）。
// 不喊價可改「抓包」上一口：攤牌數實際點數，喊的人若「至少 N 個」成立則抓的人輸，否則喊的人輸。
// 玩家先手。單局定勝負：贏 ×2、輸全輸。
// ========================================

let liarState = null;

function liarRoll5() { return [randInt(1, 6), randInt(1, 6), randInt(1, 6), randInt(1, 6), randInt(1, 6)]; }

function liarStart(bet) {
  liarState = {
    bet,
    playerDice: liarRoll5(),
    hDice: liarRoll5(),
    currentBid: null, // { qty, face, by:"player"|"H" }
    log: [],
    done: false,
    reveal: false,
    // 下注列裡選好的下一口
    selQty: 1, selFace: 1,
  };
  // 玩家先手預設一口合法的最小值
  liarState.selQty = 1; liarState.selFace = 1;
  liarRender();
}

// 計算檯面所有 10 顆骰子中，某個點數出現的實際數量
function liarCountFace(face) {
  let all = liarState.playerDice.concat(liarState.hDice);
  return all.filter((d) => d === face).length;
}

// 二項分布：n 顆骰子中「至少 k 顆是某點數」的機率（單顆命中 1/6）
function liarProbAtLeast(k, n) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let p = 1 / 6, total = 0;
  for (let i = k; i <= n; i++) {
    let comb = 1;
    for (let j = 0; j < i; j++) comb = comb * (n - j) / (j + 1);
    total += comb * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return total;
}

function liarBidValid(qty, face) {
  let cur = liarState.currentBid;
  if (qty < 1 || qty > 10 || face < 1 || face > 6) return false;
  if (!cur) return true;
  return qty > cur.qty || (qty === cur.qty && face > cur.face);
}

function liarSetSel(qty, face) {
  liarState.selQty = clamp(qty, 1, 10);
  liarState.selFace = clamp(face, 1, 6);
  liarRender();
}
function liarAdjQty(d) { liarSetSel(liarState.selQty + d, liarState.selFace); }
function liarAdjFace(d) { liarSetSel(liarState.selQty, liarState.selFace + d); }

// 玩家喊價
function liarPlayerBid() {
  let s = liarState;
  if (s.done) return;
  let { selQty, selFace } = s;
  if (!liarBidValid(selQty, selFace)) { systemToast("這口沒有比上一口大，喊大聲一點。", true); return; }
  s.currentBid = { qty: selQty, face: selFace, by: "player" };
  s.log.push(`<b>你</b>：至少有 ${selQty} 個 ${DICE_FACES[selFace]}。`);
  liarRender();
  setTimeout(liarHTurn, 650);
}

// 玩家抓包（抓 H 上一口）
function liarPlayerChallenge() {
  let s = liarState;
  if (s.done || !s.currentBid || s.currentBid.by !== "H") return;
  liarResolveChallenge("player");
}

// H 的回合：決定要抓包還是加碼
function liarHTurn() {
  let s = liarState;
  if (s.done) return;
  let cur = s.currentBid; // 一定是玩家喊的
  let known = s.hDice.filter((d) => d === cur.face).length; // H 自己有幾個這點數
  let needed = cur.qty - known; // 還需要玩家那 5 顆湊出幾個
  let p = liarProbAtLeast(needed, 5); // 這口為真的機率

  // H 愛亂：機率低就傾向抓包，但偶爾亂抓／亂吹以炒熱氣氛
  let challenge;
  if (needed <= 0) challenge = false; // 光 H 自己就湊滿了，這口鐵定真，不可能抓
  else if (cur.qty >= 10) challenge = true; // 已經喊到頂，只能抓
  else if (p < 0.28) challenge = chance(0.9);
  else if (p < 0.5) challenge = chance(0.35);
  else challenge = chance(0.08); // 明明很可能為真，H 偶爾還是耍賴抓一把

  if (challenge) {
    s.log.push(`<b>H</b>：「騙人！我才不信有那麼多～」`);
    liarRender();
    setTimeout(() => liarResolveChallenge("H"), 500);
    return;
  }

  // 加碼：H 傾向喊自己手上多的點數，數量抓在「自己的量 + 期望玩家貢獻」附近，偶爾灌水唬人
  let bid = liarHMakeBid(cur);
  s.currentBid = { qty: bid.qty, face: bid.face, by: "H" };
  let taunt = chance(0.5) ? "「嘿嘿，我加碼——」" : "「這點小場面，跟你拚了！」";
  s.log.push(`<b>H</b>：${taunt}至少有 ${bid.qty} 個 ${DICE_FACES[bid.face]}。`);
  liarRender();
}

function liarHMakeBid(cur) {
  // H 最擅長的點數（自己手上最多的）
  let counts = [0, 0, 0, 0, 0, 0, 0];
  liarState.hDice.forEach((d) => counts[d]++);
  let bestFace = 1;
  for (let f = 1; f <= 6; f++) if (counts[f] > counts[bestFace]) bestFace = f;

  // 候選：同數量、更大的點數（若 bestFace 比現在大）
  if (counts[bestFace] >= 1 && bestFace > cur.face && liarBidValid(cur.qty, bestFace)) {
    // 偶爾灌水加一顆唬人
    let qty = cur.qty + (chance(0.3) ? 1 : 0);
    if (qty > 10) qty = 10;
    if (liarBidValid(qty, bestFace)) return { qty, face: bestFace };
  }
  // 否則就數量 +1，點數挑自己手上的（或沿用），必要時灌水
  let qty = cur.qty + 1;
  let face = counts[bestFace] > 0 ? bestFace : cur.face;
  if (qty > 10) { qty = 10; face = Math.min(6, cur.face + 1); }
  if (!liarBidValid(qty, face)) face = Math.min(6, Math.max(cur.face + 1, face));
  if (!liarBidValid(qty, face)) { qty = Math.min(10, cur.qty + 1); face = 6; }
  return { qty, face };
}

function liarResolveChallenge(challenger) {
  let s = liarState;
  s.done = true; s.reveal = true;
  let bid = s.currentBid;
  let actual = liarCountFace(bid.face);
  let bidTrue = actual >= bid.qty; // 喊的人是否為真
  // 抓包成立條件：喊的人若唬爛（bidTrue=false），抓的人贏
  let bidder = bid.by; // "player" or "H"
  let playerWins;
  if (challenger === "player") {
    // 玩家抓 H：H 唬爛(false) → 玩家贏
    playerWins = !bidTrue;
  } else {
    // H 抓玩家：玩家唬爛(false) → 玩家輸
    playerWins = bidTrue;
  }

  let lines = [
    `攤牌！這口是「至少 ${bid.qty} 個 ${DICE_FACES[bid.face]}」，檯面實際有 <b>${actual}</b> 個。`,
    `你的骰：${s.playerDice.map((d) => DICE_FACES[d]).join(" ")}　H 的骰：${s.hDice.map((d) => DICE_FACES[d]).join(" ")}`,
    challenger === "player"
      ? (playerWins ? "你一把掀桌抓包成功——H 果然在唬爛！" : "你抓錯了，H 這口是真的。")
      : (playerWins ? "H 不信邪跳出來抓包，結果你這口是真的！" : "H 一眼識破你在吹牛。"),
  ];
  casinoResolveGame(playerWins ? s.bet * 2 : 0, lines, playerWins ? "win" : "lose");
}

function liarRender() {
  let s = liarState;
  let cur = s.currentBid;
  let canChallenge = !s.done && cur && cur.by === "H";
  let canBid = !s.done && liarBidValid(s.selQty, s.selFace);

  let playerDiceHtml = s.playerDice.map((d) => `<span class="ld-die">${DICE_FACES[d]}</span>`).join("");
  let hDiceHtml = s.reveal
    ? s.hDice.map((d) => `<span class="ld-die">${DICE_FACES[d]}</span>`).join("")
    : `<span class="ld-die">❓</span><span class="ld-die">❓</span><span class="ld-die">❓</span><span class="ld-die">❓</span><span class="ld-die">❓</span>`;

  let curText = cur ? `目前這口（${cur.by === "H" ? "H" : "你"} 喊的）：至少 ${cur.qty} 個 ${DICE_FACES[cur.face]}` : "還沒有人喊——由你先開口。";

  let controls = s.done ? "" : `
    <div class="card ld-controls">
      <div class="ld-picker">
        <div class="ld-stepper"><span class="dim">數量</span>
          <button class="bet-quick-btn" onclick="liarAdjQty(-1)">－</button>
          <b>${s.selQty}</b>
          <button class="bet-quick-btn" onclick="liarAdjQty(1)">＋</button>
        </div>
        <div class="ld-stepper"><span class="dim">點數</span>
          <button class="bet-quick-btn" onclick="liarAdjFace(-1)">－</button>
          <b class="ld-die-inline">${DICE_FACES[s.selFace]}</b>
          <button class="bet-quick-btn" onclick="liarAdjFace(1)">＋</button>
        </div>
      </div>
      <button class="action-btn ${canBid ? "" : "secondary"}" ${canBid ? "" : "disabled"} onclick="liarPlayerBid()">📣 喊價：至少 ${s.selQty} 個 ${DICE_FACES[s.selFace]}</button>
      <button class="action-btn danger ${canChallenge ? "" : "secondary"}" ${canChallenge ? "" : "disabled"} onclick="liarPlayerChallenge()">🫵 抓包（騙人！）</button>
    </div>`;

  showScreen(`
    <h2 class="screen-title">🎲 騙子骰</h2>
    <div class="card">
      <div class="ld-side"><span class="ld-label">${H_ICON} H 的骰（5 顆）</span><div class="ld-dice">${hDiceHtml}</div></div>
      <div class="ld-side"><span class="ld-label">你的骰（5 顆）</span><div class="ld-dice">${playerDiceHtml}</div></div>
      <div class="ld-current">${curText}</div>
    </div>
    ${controls}
    ${s.log.length ? `<div class="card ld-log">${s.log.map((l) => `<p>${l}</p>`).join("")}</div>` : ""}
  `, { withTopbar: !!activeDive });
}

// ========================================
// 兌幣 & 交易所（避難所版）
// ========================================

function casinoExchangeModal() {
  openGenericModal("💱 兌幣處", `
    <p class="dim">H：「潛晶在賭桌上不好使，先換成代幣吧～ 目前 1 潛晶 = 1 代幣。」</p>
    <p>💎 潛晶 <b>${gameState.crystal}</b>　🪙 代幣 <b>${gameState.tokens}</b></p>
    <div class="ld-picker" style="margin:10px 0;">
      <input type="number" id="exchange-amount" class="bet-number" min="1" value="1" style="width:100px;">
      <span class="dim">數量</span>
    </div>
    <button class="action-btn" onclick="casinoDoExchange('buy')">💎 → 🪙 買代幣</button>
    <button class="action-btn secondary" onclick="casinoDoExchange('sell')">🪙 → 💎 換回潛晶</button>
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}

function casinoDoExchange(dir) {
  let input = document.getElementById("exchange-amount");
  let amt = Math.floor(Number(input ? input.value : 0));
  if (!isFinite(amt) || amt < 1) { systemToast("數量不對。", true); return; }
  if (dir === "buy") {
    let cost = amt * TOKEN_BUY_RATE;
    if (gameState.crystal < cost) { systemToast("潛晶不夠。", true); return; }
    gameState.crystal -= cost;
    gameState.tokens += amt;
    systemToast(`換到 🪙${amt} 代幣。`);
  } else {
    if (gameState.tokens < amt) { systemToast("代幣不夠。", true); return; }
    gameState.tokens -= amt;
    gameState.crystal += amt * TOKEN_SELL_RATE;
    systemToast(`換回 💎${amt * TOKEN_SELL_RATE} 潛晶。`);
  }
  casinoExchangeModal();
  renderCasinoHub();
}

function casinoTradehouseModal() {
  openGenericModal("🛒 交易所", `
    <p>H 攤了攤手：「哎呀，架上還空著呢——好東西還在進貨啦！大量代幣以後可以在這換一些很酷的玩意兒，或是省得你一直刷食材藥材的消耗品。」</p>
    <p class="dim">（交易所商品尚在設計中，敬請期待。）</p>
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}

// ========================================
// 對外進入點
// ========================================

// 節點版：第二層路上的「神秘賭局」🎲，賭潛晶。第一次遇到會播 H 開場白並記錄 metH。
function resolveGambleNode() {
  let firstTime = !gameState.storyFlags.metH;
  gameState.storyFlags.metH = true;
  checkAchievements();
  casinoEnter({
    currency: "crystal",
    title: firstTime ? "黑暗中的邀約" : "H 的賭局",
    onExit: afterNodeContentResolved,
    intro: firstTime,
  });
}

// 避難所版：打贏第二層 + 玩過節點賭場後，避難所旁的賭場入口。用代幣。
function isShelterCasinoUnlocked() {
  return !!(gameState.storyFlags.metH && gameState.storyFlags.layer2Cleared);
}
function showCasinoScreen() {
  casinoEnter({ currency: "token", title: "H 的賭場", onExit: showShelterScreen, intro: false });
}
