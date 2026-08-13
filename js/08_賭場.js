// ========================================
// 潛淵 - 賭場（H 的賭局）
// ----------------------------------------
// H：藏在潛淵深處的某種存在，愛熱鬧、唯恐天下不亂、但沒有惡意。他不是敵人，是「陪你玩」的莊家。
//
// 兩種場合、兩種貨幣：
//   節點版 🎲（第二層路上的「神秘賭局」）：賭「潛晶 💎」，玩一局就走。
//   避難所賭場（打贏第二層 + 玩過一次節點賭場，兩條件都達成才開）：用「代幣 🪙」，可以久留。
//     ⚠️ 代幣是「單向」貨幣：只能用潛晶換代幣，代幣「不能」換回潛晶。
//        代幣只能在賭場裡花掉（賭博／未來的交易所換東西），這樣經濟才不會被技術型賭局刷爆。
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

// 節點賭場（賭潛晶）的上限：避免靠賭博快速灌爆主貨幣，讓收益跟戰鬥獎勵同量級。
// （避難所賭場用代幣、代幣換不回潛晶，所以不受這些上限限制。數字都做成常數方便日後調整。）
const NODE_BET_CAP = 20;  // 節點賭場單注上限
const NODE_WIN_CAP = 30;  // 節點賭場「單局最多淨贏」的潛晶上限（對照 Boss 掉落 12~18）
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

// 賭場遊戲登錄表：id -> { name, icon, blurb, venue, start(bet) }
// blurb 是下注前顯示的一句話規則說明；start 由各遊戲的實作函式指定。
// venue：這款遊戲出現在哪個賭場——"both"（都有）／"node"（只在節點潛晶場）／"shelter"（只在避難所代幣場）。
//   純技術的遊戲（破譯／記憶）刻意設成 "shelter"：只能用代幣玩，贏的代幣換不回潛晶，才不會被高手刷爆主貨幣。
const CASINO_GAMES = {
  mines: {
    name: "翻礦盤", icon: "⛏️", venue: "both",
    blurb: "翻開礦格累積倍率，隨時可以收手把贏的帶走；翻到「塌方」就全部輸光。埋越多塌方，倍率越高。",
    start: (bet) => minesStart(bet),
  },
  blackjack: {
    name: "逼深骰", icon: "🎴", venue: "both",
    blurb: "不斷「再下潛一層」抽壓力牌累加，越接近臨界壓力 23 賠越多，但超過就被壓爆全輸。H 當莊也會抽。",
    start: (bet) => bjStart(bet),
  },
  liar: {
    name: "騙子骰", icon: "🎲", venue: "both",
    blurb: "你和 H 各擲 5 顆藏起來的骰子，輪流喊「檯面上至少有幾個某點數」，越喊越大——抓到對方唬爛就贏。",
    start: (bet) => liarStart(bet),
  },
  highlow: {
    name: "深淺牌", icon: "🃏", venue: "both",
    blurb: "翻出一張深度牌，猜下一張更深(大)還是更淺(淺)。猜中連莊、倍率累積，隨時收手；猜錯或同深度就清空。翻過的牌都攤著，會算牌的人佔便宜。",
    start: (bet) => highlowStart(bet),
  },
  mastermind: {
    name: "破譯", icon: "🔮", venue: "shelter", ante: 50,
    blurb: "H 藏了一組 4 個符號的密碼，你來猜。每猜一次他會提示「幾個對位、幾個對色不對位」。純鬥智：先付 50 🪙 入場，破解成功用越少次領越多（最早一次就中＝賺 200，只要有猜出來最少也賺 50）；8 次沒解開就賠掉入場費。",
    start: () => mmStart(),
  },
  memory: {
    name: "記憶迴光", icon: "🌟", venue: "shelter", ante: 20,
    blurb: "H 亮出越來越長的發光符文（從 3 個開始，每過一輪多一個、也更快），你照順序點回去。付 20 🪙 入場：撐得越多輪賺越多（不到 3 輪就結束會賠、5 輪開始賺、7 輪約賺 100，上限賺 200）。",
    start: () => memoryStart(),
  },
};

// ---- 技術類遊戲的「入場費 + 依表現給獎」制（見納可要求：太爛會輸錢、獎勵上限 200）----
// 破譯：入場 50，破解成功付「入場費 + 淨賺」，淨賺由 200（1 次就中）線性遞減到 50（8 次才中）；失敗付 0（賠掉入場費）。
const MM_ANTE = 50;
const MM_NET_BEST = 200; // 最快（1 次）破解的淨賺
const MM_NET_WORST = 50; // 有解開就至少淨賺這麼多
function mmPayoutForGuesses(used) {
  let g = clamp(used, 1, MM_MAX_GUESSES);
  let net = Math.round(MM_NET_BEST - (g - 1) * (MM_NET_BEST - MM_NET_WORST) / (MM_MAX_GUESSES - 1));
  return MM_ANTE + net; // 回傳「拿回來的總額」＝入場費 + 淨賺
}
// 記憶迴光：入場 20，依「完整過關的輪數」給獎（payout＝拿回來的總額）。<3 輪淨虧、3 輪打平、5 輪起淨賺、7 輪約淨賺 100、上限淨賺 200。
const MEMORY_ANTE = 20;
const MEMORY_START_LEN = 3; // 第一輪就閃 3 個
const MEMORY_PAYOUT_TABLE = [0, 0, 10, 20, 35, 55, 85, 120, 170, 220]; // index = 完整過關輪數 0~9
function memoryPayoutForRounds(roundsCleared) {
  let r = Math.max(0, roundsCleared);
  let p = r < MEMORY_PAYOUT_TABLE.length ? MEMORY_PAYOUT_TABLE[r] : MEMORY_ANTE + 200;
  return Math.min(p, MEMORY_ANTE + 200); // 淨賺上限 200
}

// ========================================
// 賭場核心：進出、貨幣抽象、下注列、結算
// ========================================

// 目前這場賭局的上下文（進賭場時建立，離開時清掉）
let casinoCtx = null; // { currency:"crystal"|"token", onExit:fn, title }
let casinoBet = { value: 1, max: 1 }; // 下注列目前狀態
let casinoRound = null; // 目前這一局：{ gameId, bet }

// 代幣兌換率（暫定，未來交易所上線後可再調）。刻意「只進不出」：
// 只能潛晶換代幣，代幣不能換回潛晶——避免技術型賭局把代幣刷回主貨幣、拖垮經濟。
const TOKEN_BUY_RATE = 1; // 花 1 潛晶換 1 代幣

function casinoCurrencyIcon() {
  return casinoCtx && casinoCtx.currency === "token" ? "🪙" : "💎";
}
function casinoCurrencyName() {
  return casinoCtx && casinoCtx.currency === "token" ? "代幣" : "潛晶";
}
function casinoBalance() {
  return casinoCtx && casinoCtx.currency === "token" ? gameState.tokens : gameState.crystal;
}
// 節點潛晶場才有的上限；避難所代幣場不設限（回傳 Infinity）
function casinoBetCap() {
  return casinoCtx && casinoCtx.currency === "crystal" ? NODE_BET_CAP : Infinity;
}
function casinoWinCap() {
  return casinoCtx && casinoCtx.currency === "crystal" ? NODE_WIN_CAP : Infinity;
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

// 進入賭場：opts = { currency, onExit, title, intro(是否播 H 開場白), oneShot(只能玩一局就走) }
function casinoEnter(opts) {
  casinoCtx = { currency: opts.currency, onExit: opts.onExit, title: opts.title || "H 的賭局", oneShot: !!opts.oneShot };
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

  // 依場地過濾遊戲：節點潛晶場(node) vs 避難所代幣場(shelter)；venue="both" 兩邊都出現
  let venueKey = isToken ? "shelter" : "node";
  let gameButtons = Object.keys(CASINO_GAMES).filter((gid) => {
    let v = CASINO_GAMES[gid].venue || "both";
    return v === "both" || v === venueKey;
  }).map((gid) => {
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
  let g = CASINO_GAMES[gameId];
  if (g.ante != null) {
    // 技術類：不押注但要付「入場費」，之後依表現給獎（表現爛＝賠掉入場費）。入場費就當作這局的 bet，讓結算的淨額算得出來。
    if (casinoBalance() < g.ante) {
      systemToast(`身上不到 ${g.ante} ${casinoCurrencyName()}，付不起入場費。`, true);
      return;
    }
    casinoAddBalance(-g.ante); // 先付入場費
    casinoRound = { gameId, bet: g.ante };
    gameState.stats.casinoGamesPlayed = (gameState.stats.casinoGamesPlayed || 0) + 1;
    g.start();
    return;
  }
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
  casinoBet.max = Math.min(casinoBalance(), casinoBetCap());
  casinoBet.value = clamp(casinoBet.value, 1, casinoBet.max);
  let capNote = isFinite(casinoWinCap())
    ? `<p class="dim">（節點賭場：單注最多 ${NODE_BET_CAP}、單局最多贏 ${NODE_WIN_CAP} 潛晶。想大殺四方就得等避難所的代幣場開了～）</p>`
    : "";

  showScreen(`
    <h2 class="screen-title">${g.icon} ${g.name}</h2>
    <div class="card"><p class="dim">${g.blurb}</p>${capNote}</div>

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
  let betLimit = Math.min(casinoBalance(), casinoBetCap());
  if (bet < 1 || bet > betLimit) { systemToast("賭注不合法。", true); return; }

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
  let bet = casinoRound ? casinoRound.bet : 0;
  // 節點潛晶場：單局淨贏夾在上限內（避難所代幣場 winCap=Infinity，不受影響）
  let winCap = casinoWinCap();
  let cappedByLimit = false;
  if (isFinite(winCap) && payout - bet > winCap) {
    payout = bet + winCap;
    cappedByLimit = true;
  }
  casinoAddBalance(payout);
  let net = payout - bet;
  if (cappedByLimit) resultLines = (resultLines || []).concat([`<span class="dim">（贏太多啦！這裡單局最多讓你帶走 ${NODE_WIN_CAP} 潛晶，H 只肯付到上限。）</span>`]);
  if (net > 0) gameState.stats.casinoBiggestWin = Math.max(gameState.stats.casinoBiggestWin || 0, net);

  let hLine = outcome === "win" ? pickRandom(H_WIN_LINES)
    : outcome === "push" ? pickRandom(H_PUSH_LINES)
    : pickRandom(H_LOSE_LINES);

  let icon = casinoCurrencyIcon();
  let netHtml = net > 0 ? `<span class="casino-net-win">+${net} ${icon}</span>`
    : net < 0 ? `<span class="casino-net-lose">${net} ${icon}</span>`
    : `<span class="dim">±0</span>`;

  let gameId = casinoRound ? casinoRound.gameId : null;
  let hasAnte = gameId && CASINO_GAMES[gameId].ante != null;
  let oneShot = casinoCtx && casinoCtx.oneShot; // 節點賭局：只能玩一局就走（見納可要求：冒險內賭局只能賭一次）
  let canReplay = !oneShot && gameId && (hasAnte ? casinoBalance() >= CASINO_GAMES[gameId].ante : casinoBalance() >= 1);

  showScreen(`
    <h2 class="screen-title">${outcome === "win" ? "🎉 你贏了" : outcome === "push" ? "🤝 平手" : "💀 你輸了"}</h2>
    <div class="card casino-result-card">
      ${(resultLines || []).map((l) => `<p>${l}</p>`).join("")}
      <div class="casino-result-net">本局結算：${netHtml}</div>
      <div class="casino-hbubble">「${hLine}」<span class="dim">—— H</span></div>
      <div class="dim">目前 ${icon} ${casinoBalance()}</div>
    </div>
    ${oneShot ? `<p class="dim">H 攤了攤手：「這一趟就陪你玩這麼一局，見好就收吧～下次再來！」</p>` : ""}
    ${canReplay ? `<button class="action-btn" onclick="casinoOpenGame('${gameId}')">🔁 再玩一局</button>` : (oneShot ? "" : `<p class="dim">身上的${casinoCurrencyName()}見底了，改天再來吧。</p>`)}
    ${oneShot ? "" : `<button class="action-btn secondary" onclick="renderCasinoHub()">回大廳</button>`}
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
          <button class="bet-quick-btn hold-repeat" onclick="liarAdjQty(-1)">－</button>
          <b>${s.selQty}</b>
          <button class="bet-quick-btn hold-repeat" onclick="liarAdjQty(1)">＋</button>
        </div>
        <div class="ld-stepper"><span class="dim">點數</span>
          <button class="bet-quick-btn hold-repeat" onclick="liarAdjFace(-1)">－</button>
          <b class="ld-die-inline">${DICE_FACES[s.selFace]}</b>
          <button class="bet-quick-btn hold-repeat" onclick="liarAdjFace(1)">＋</button>
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
// 遊戲 4：深淺牌（Higher-Lower + 算牌）
// 一副 1~13 各 4 張（共 52 張）的「深度牌」。翻出一張後猜下一張更深(大)還是更淺(小)。
// 猜中：倍率乘上「這個方向的公平賠率」（越冷門的方向賠越多），可隨時收手；猜錯或翻出同深度就清空。
// 已翻開的牌全部攤在檯面上——會算牌的人能推出剩下每個方向的機率，抓時機重注。
// ========================================

let highlowState = null;

function highlowBuildDeck() {
  let d = [];
  for (let v = 1; v <= 13; v++) for (let n = 0; n < 4; n++) d.push(v);
  return casinoShuffle(d);
}
function highlowCard(v) {
  return v === 1 ? "A" : v === 11 ? "J" : v === 12 ? "Q" : v === 13 ? "K" : String(v);
}

function highlowStart(bet) {
  let deck = highlowBuildDeck();
  let current = deck.pop();
  highlowState = { bet, deck, current, seen: [current], mult: 1, done: false };
  highlowRender();
}

// 剩餘牌中，比目前這張「更深(大)」與「更淺(小)」各有幾張
function highlowCounts() {
  let s = highlowState;
  let higher = s.deck.filter((v) => v > s.current).length;
  let lower = s.deck.filter((v) => v < s.current).length;
  return { higher, lower, total: s.deck.length };
}

function highlowGuess(dir) {
  let s = highlowState;
  if (!s || s.done) return;
  if (s.deck.length === 0) { highlowCashout(); return; }
  let counts = highlowCounts();
  let chosenCount = dir === "higher" ? counts.higher : counts.lower;
  let next = s.deck.pop();
  s.seen.push(next);

  let win = dir === "higher" ? next > s.current : next < s.current;
  if (win && chosenCount > 0) {
    s.mult *= (counts.total / chosenCount) * CASINO_HOUSE_EDGE;
    s.current = next;
    if (s.deck.length === 0) { s.done = true; highlowRender(); setTimeout(() => highlowCashout(true), 500); return; }
    highlowRender();
  } else {
    // 猜錯，或翻出同深度（平手也算輸）：清空
    s.done = true;
    s.current = next;
    highlowRender();
    let why = next === highlowStatePrevCurrent(s) ? "同深度——踩空了。" : "方向錯了。";
    setTimeout(() => casinoResolveGame(0, [
      `翻出的是 <b>${highlowCard(next)}</b>。${why}`,
      "累積的倍率一口氣歸零。",
    ], "lose"), 500);
  }
}
// 取得「這一翻之前」的當前牌（用來判斷是不是平手）——render 已經把 current 換成 next，所以從 seen 倒數第二張拿
function highlowStatePrevCurrent(s) {
  return s.seen.length >= 2 ? s.seen[s.seen.length - 2] : s.current;
}

function highlowCashout(auto) {
  let s = highlowState;
  if (!s) return;
  s.done = true;
  let payout = Math.floor(s.bet * s.mult);
  casinoResolveGame(payout, auto
    ? ["整副牌都被你猜完了！", `倍率 ×${s.mult.toFixed(2)}。`]
    : [`你見好就收，帶著 ×${s.mult.toFixed(2)} 的倍率離場。`], payout > s.bet ? "win" : payout === s.bet ? "push" : "win");
}

function highlowRender() {
  let s = highlowState;
  let counts = highlowCounts();
  let payout = Math.floor(s.bet * s.mult);
  let canCash = !s.done && s.mult > 1;
  // 已翻開的牌（攤給玩家算牌用），最近的排前面
  let seenHtml = s.seen.slice().reverse().map((v, i) =>
    `<span class="hl-seen${i === 0 ? " hl-seen-cur" : ""}">${highlowCard(v)}</span>`).join("");

  showScreen(`
    <h2 class="screen-title">🃏 深淺牌</h2>
    <div class="card mines-status">
      <span>目前倍率 <b>×${s.mult.toFixed(2)}</b></span>
      <span>可收 ${payout} ${casinoCurrencyIcon()}</span>
      <span>牌堆剩 ${counts.total}</span>
    </div>
    <div class="card" style="text-align:center;">
      <div class="dim">目前這張深度牌</div>
      <div class="hl-current">${highlowCard(s.current)}</div>
      <div class="dim">剩餘牌中：更深(大) ${counts.higher} 張 · 更淺(小) ${counts.lower} 張 · 同深度 ${counts.total - counts.higher - counts.lower} 張</div>
    </div>
    ${s.done ? "" : `
    <div class="hl-guess-row">
      <button class="action-btn" onclick="highlowGuess('higher')">⬆️ 更深（比它大）</button>
      <button class="action-btn" onclick="highlowGuess('lower')">⬇️ 更淺（比它小）</button>
    </div>
    <button class="action-btn ${canCash ? "" : "secondary"}" ${canCash ? "" : "disabled"} onclick="highlowCashout(false)">💰 收手（帶走 ${payout} ${casinoCurrencyIcon()}）</button>`}
    <div class="card"><div class="dim">已翻開的牌（可以拿來算牌）：</div><div class="hl-seen-row">${seenHtml}</div></div>
  `, { withTopbar: !!activeDive });
}

// ========================================
// 遊戲 5：破譯（Mastermind，純邏輯，只在避難所代幣場）
// H 藏一組 4 個符號的密碼（符號有 6 種、可重複）。玩家猜，回饋「幾個對位、幾個對色不對位」。
// 8 次內破解就贏，用越少次賠越多；純鬥智，不靠運氣，所以只給代幣、賠率天花板壓低。
// ========================================

let mmState = null;
const MM_SYMBOLS = ["🔴", "🟡", "🟢", "🔵", "🟣", "⚪"];
const MM_LEN = 4;
const MM_MAX_GUESSES = 8;

function mmStart() {
  let code = [];
  for (let i = 0; i < MM_LEN; i++) code.push(randInt(0, MM_SYMBOLS.length - 1));
  mmState = { code, guesses: [], current: [0, 0, 0, 0], done: false };
  mmRender();
}

// 標準 Mastermind 回饋：black=對位、white=對色不對位（正確處理重複符號）
function mmFeedback(guess, code) {
  let black = 0;
  let codeLeft = {}, guessLeft = {};
  for (let i = 0; i < MM_LEN; i++) {
    if (guess[i] === code[i]) black++;
    else { codeLeft[code[i]] = (codeLeft[code[i]] || 0) + 1; guessLeft[guess[i]] = (guessLeft[guess[i]] || 0) + 1; }
  }
  let white = 0;
  Object.keys(guessLeft).forEach((s) => { white += Math.min(guessLeft[s], codeLeft[s] || 0); });
  return { black, white };
}

function mmCycleSlot(i) {
  let s = mmState;
  if (!s || s.done) return;
  s.current[i] = (s.current[i] + 1) % MM_SYMBOLS.length;
  mmRender();
}

function mmSubmit() {
  let s = mmState;
  if (!s || s.done) return;
  let guess = s.current.slice();
  let fb = mmFeedback(guess, s.code);
  s.guesses.push({ guess, fb });

  if (fb.black === MM_LEN) {
    s.done = true;
    let used = s.guesses.length;
    let payout = mmPayoutForGuesses(used);
    mmRender();
    casinoResolveGame(payout, [
      `破譯成功！你用了 ${used} 次就解開了密碼。`,
      `密碼是：${s.code.map((c) => MM_SYMBOLS[c]).join(" ")}`,
      `用越少次賺越多（付了 ${MM_ANTE} 入場費，這次拿回 ${payout} 🪙）。`,
    ], "win");
    return;
  }
  if (s.guesses.length >= MM_MAX_GUESSES) {
    s.done = true;
    mmRender();
    casinoResolveGame(0, [
      "8 次用完，還是沒解開……入場費賠掉了。",
      `密碼是：${s.code.map((c) => MM_SYMBOLS[c]).join(" ")}`,
    ], "lose");
    return;
  }
  mmRender();
}

function mmRender() {
  let s = mmState;
  let history = s.guesses.map((g, idx) => `
    <div class="mm-row">
      <span class="mm-no">${idx + 1}</span>
      <span class="mm-guess">${g.guess.map((c) => MM_SYMBOLS[c]).join("")}</span>
      <span class="mm-fb"><span class="mm-peg-black">⚫×${g.fb.black}</span> <span class="mm-peg-white">⚪×${g.fb.white}</span></span>
    </div>`).join("");
  let slots = s.current.map((c, i) => `<button class="mm-slot" onclick="mmCycleSlot(${i})">${MM_SYMBOLS[c]}</button>`).join("");

  showScreen(`
    <h2 class="screen-title">🔮 破譯</h2>
    <div class="card">
      <div class="dim">H 藏了 4 個符號（有 6 種、可能重複）。⚫ = 對位，⚪ = 對色但位置不對。剩 ${MM_MAX_GUESSES - s.guesses.length} 次。</div>
      <div class="mm-history">${history || '<p class="dim">還沒有猜測紀錄。</p>'}</div>
    </div>
    ${s.done ? "" : `
    <div class="card">
      <div class="dim">點符號可以切換：</div>
      <div class="mm-input">${slots}</div>
      <button class="action-btn" onclick="mmSubmit()">📤 送出這次猜測</button>
    </div>`}
  `, { withTopbar: !!activeDive });
}

// ========================================
// 遊戲 6：記憶迴光（Simon，純記憶，只在避難所代幣場）
// H 亮出一串越來越長的發光符文，玩家照順序點回去。過一輪倍率上升、序列 +1，每輪之間可收手；點錯全輸。
// 倍率：過第 1 輪＝保本(×1.0)，之後每多過一輪 ×1.4；純技術所以只給代幣。
// ========================================

let memoryState = null;
const MEMORY_RUNES = ["🌟", "🔥", "❄️", "🌀", "⚡", "🌙"];

function memoryStart() {
  memoryState = { seq: [], input: [], round: 0, phase: "show", done: false };
  memoryNextRound();
}

// 每輪的閃示速度：越後面的輪數越快（on=亮多久、gap=兩個之間的間隔，單位毫秒）
function memorySpeed(round) {
  return {
    on: Math.max(180, 500 - (round - 1) * 40),
    gap: Math.max(110, 260 - (round - 1) * 25),
  };
}

function memoryNextRound() {
  let s = memoryState;
  s.round++;
  // 每輪重新隨機一整串；長度 = 起始長度 + (輪數-1)，也就是第一輪閃 3 個、之後每輪多一個
  let len = MEMORY_START_LEN + (s.round - 1);
  s.seq = [];
  for (let i = 0; i < len; i++) s.seq.push(randInt(0, MEMORY_RUNES.length - 1));
  s.input = [];
  s.phase = "show";
  memoryRender();
  memoryPlaySequence();
}

// 逐一閃示序列（直接操作既有 DOM，不重繪，避免閃到一半畫面被洗掉）；速度隨輪數加快
function memoryPlaySequence() {
  let s = memoryState;
  let spd = memorySpeed(s.round);
  let i = 0;
  let flashNext = () => {
    if (!memoryState || memoryState !== s) return; // 期間離場就中止
    if (i >= s.seq.length) { s.phase = "input"; memoryRender(); return; }
    let el = document.getElementById("mem-tile-" + s.seq[i]);
    if (el) el.classList.add("mem-flash");
    setTimeout(() => {
      if (el) el.classList.remove("mem-flash");
      i++;
      setTimeout(flashNext, spd.gap);
    }, spd.on);
  };
  setTimeout(flashNext, 420);
}

function memoryTileClick(tile) {
  let s = memoryState;
  if (!s || s.done || s.phase !== "input") return;
  s.input.push(tile);
  let pos = s.input.length - 1;
  if (s.input[pos] !== s.seq[pos]) {
    // 點錯：這輪不算過，依「已完整過關的輪數」結算（撐得越少賺越少，太早就賠掉入場費）
    s.done = true;
    let el = document.getElementById("mem-tile-" + tile);
    if (el) el.classList.add("mem-wrong");
    let cleared = s.round - 1;
    let payout = memoryPayoutForRounds(cleared);
    setTimeout(() => casinoResolveGame(payout, [
      `第 ${pos + 1} 個就記錯了……符文的光一下子全暗了下來。`,
      `完整撐過了 ${cleared} 輪。`,
    ], payout > MEMORY_ANTE ? "win" : payout === MEMORY_ANTE ? "push" : "lose"), 500);
    return;
  }
  if (s.input.length === s.seq.length) {
    s.phase = "cleared"; // 這一輪過關，可選擇收手或再來一輪
    memoryRender();
  } else {
    memoryRender(); // 每點對一個就重繪，讓「已點 x/n」即時更新，玩家不會忘記點到哪
  }
}

function memoryCashout() {
  let s = memoryState;
  if (!s || s.done || s.phase !== "cleared") return;
  s.done = true;
  let payout = memoryPayoutForRounds(s.round);
  casinoResolveGame(payout, [
    `你穩穩記到第 ${s.round} 輪就收手。`,
  ], payout > MEMORY_ANTE ? "win" : payout === MEMORY_ANTE ? "push" : "lose");
}

function memoryRender() {
  let s = memoryState;
  let len = s.seq.length;
  let clearedNow = s.phase === "cleared" ? s.round : s.round - 1; // 目前已完整過關的輪數
  let curPayout = memoryPayoutForRounds(clearedNow);
  let curNet = curPayout - MEMORY_ANTE;
  let netLabel = curNet > 0 ? `淨賺 ${curNet}` : curNet < 0 ? `淨虧 ${-curNet}` : "打平";
  let phaseText = s.phase === "show" ? `👀 看好囉，記住順序……（這輪 ${len} 個）`
    : s.phase === "input" ? `👇 換你！照順序點回去　已點 ${s.input.length} / ${len}`
    : `✅ 第 ${s.round} 輪過關！`;

  let tiles = MEMORY_RUNES.map((r, i) =>
    `<button class="mem-tile" id="mem-tile-${i}" ${s.phase === "input" ? `onclick="memoryTileClick(${i})"` : ""}>${r}</button>`
  ).join("");

  showScreen(`
    <h2 class="screen-title">🌟 記憶迴光</h2>
    <div class="card mines-status">
      <span>第 ${s.round} 輪 · ${len} 個</span>
      <span>目前可收 <b>${Math.max(0, curPayout)} 🪙</b>（${netLabel}）</span>
      <span>入場費 ${MEMORY_ANTE}</span>
    </div>
    <div class="card" style="text-align:center;">
      <div class="mem-phase">${phaseText}</div>
      <div class="mem-pad">${tiles}</div>
    </div>
    ${s.phase === "cleared" && !s.done ? `
    <div class="hl-guess-row">
      <button class="action-btn" onclick="memoryNextRound()">➡️ 再來一輪（更長更快）</button>
      <button class="action-btn secondary" onclick="memoryCashout()">💰 收手（帶走 ${curPayout} 🪙）</button>
    </div>` : ""}
  `, { withTopbar: !!activeDive });
}

// ========================================
// 兌幣 & 交易所（避難所版）
// ========================================

// 兌幣「只進不出」：只能潛晶 → 代幣，代幣不能換回潛晶。
function casinoExchangeModal() {
  openGenericModal("💱 兌幣處", `
    <p class="dim">H：「潛晶在賭桌上不好使，先換成代幣吧～ 目前 1 潛晶 = 1 代幣。」</p>
    <p class="dim">H 壓低聲音、笑得意味深長：「醜話說在前頭——代幣只能在我這兒花掉，<b>換不回潛晶</b>的喔。想清楚再換～」</p>
    <p>💎 潛晶 <b>${gameState.crystal}</b>　🪙 代幣 <b>${gameState.tokens}</b></p>
    <div class="ld-picker" style="margin:10px 0;">
      <input type="number" id="exchange-amount" class="bet-number" min="1" value="1" style="width:100px;">
      <span class="dim">要換多少代幣</span>
    </div>
    <button class="action-btn" onclick="casinoDoExchange()">💎 → 🪙 換代幣</button>
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}

function casinoDoExchange() {
  let input = document.getElementById("exchange-amount");
  let amt = Math.floor(Number(input ? input.value : 0));
  if (!isFinite(amt) || amt < 1) { systemToast("數量不對。", true); return; }
  let cost = amt * TOKEN_BUY_RATE;
  if (gameState.crystal < cost) { systemToast("潛晶不夠。", true); return; }
  gameState.crystal -= cost;
  gameState.tokens += amt;
  systemToast(`換到 🪙${amt} 代幣。（代幣只能在賭場花掉，換不回潛晶喔）`);
  casinoExchangeModal();
  renderCasinoHub();
}

// 交易所商品：只賣「一般版」食材與藥材（稀有版買不到），用代幣。
// 賭場的東西不能影響強度，這些都是「消耗品」（食材煮料理、藥材製魔藥＝暫時性 buff），符合規則；純粹省得玩家一直刷。
// 【定價（納可 2026-08-12 二次拍板）】不拆賣，一律「一組 3 個」：食材一組 100、藥材一組 200。
//   理由：打包 5 個 50 還是太便宜（一局賭下來輕鬆回本），改成每組 3 個、食材 100／藥材 200，
//   讓「用代幣買素材」變成要認真賭一陣子才划算的選擇，不會廉價到失去意義。
const TRADEHOUSE_PACK = 3;            // 交易所不拆賣，一律「一組 3 個」
const TRADEHOUSE_FOOD_PRICE = 100;    // 食材：一組 3 個 = 100 代幣
const TRADEHOUSE_HERB_PRICE = 200;    // 藥材：一組 3 個 = 200 代幣
const TRADEHOUSE_MATERIALS = [
  { title: "🍖 食材（第一圈層）", kind: "food", price: TRADEHOUSE_FOOD_PRICE, ids: ["凝膠凍", "顎獸肉塊", "翅鱗魚片", "水藻脆球"] },
  { title: "🍗 食材（第二圈層）", kind: "food", price: TRADEHOUSE_FOOD_PRICE, ids: ["垂垂耳腿肉", "尖嘴鼠肉"] },
  { title: "🧪 藥材（第二圈層）", kind: "herb", price: TRADEHOUSE_HERB_PRICE, ids: ["刺螯毒腺", "膜翼血囊"] },
];

// 「素材是否見過」＝跟圖鑑一樣的判斷：只有遇過（bestiary 記錄過）會掉這個素材的怪，才算見過、才買得到。
// 目的：沒探索到的圈層素材不該能直接用代幣買到（防暴雷＋合理性，納可要求）。
function isMaterialSeen(kind, id) {
  let key = kind === "food" ? "foodId" : "herbId";
  for (let mid in MONSTERS) {
    if (MONSTERS[mid][key] === id && gameState.bestiary[mid]) return true;
  }
  return false;
}

function casinoTradehouseModal() {
  let sections = TRADEHOUSE_MATERIALS.map((sec) => {
    let rows = sec.ids.map((id) => {
      let def = sec.kind === "food" ? FOODS[id] : HERBS[id];
      if (!def) return "";
      // 沒見過的素材：整條遮成「？？？」、鎖住不能買（防暴雷，跟圖鑑一致）。
      if (!isMaterialSeen(sec.kind, id)) {
        return `<div class="menu-item" style="cursor:default; display:flex; align-items:center; justify-content:space-between; gap:10px; opacity:0.55;">
          <span>？？？ <span class="dim">（還沒遇過）</span></span>
          <button class="action-btn" style="margin:0;" disabled title="要先在深潛中遇過會掉這個素材的怪，才買得到">🔒</button>
        </div>`;
      }
      let inv = sec.kind === "food" ? gameState.rawFoodInventory[id] : gameState.rawHerbInventory[id];
      let have = inv ? (inv.normal || 0) : 0;
      let afford = gameState.tokens >= sec.price;
      return `<div class="menu-item" style="cursor:default; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <span>${def.name} <span class="dim">（庫存 ${have}）</span></span>
        <button class="action-btn" style="margin:0;" ${afford ? "" : "disabled"} onclick="casinoBuyMaterial('${sec.kind}','${id}',${sec.price})">🪙${sec.price} 買 ${TRADEHOUSE_PACK} 個</button>
      </div>`;
    }).join("");
    return `<h3 style="margin:14px 0 6px;">${sec.title}</h3>${rows}`;
  }).join("");

  openGenericModal("🛒 交易所", `
    <p class="dim">H：「懶得一趟趟刷素材？花點代幣，我這兒現貨供應～ 一般貨隨你搬，稀有的可沒得賣喔。沒見過的東西？那我可變不出來，自己去闖闖先。」</p>
    <p>🪙 代幣 <b>${gameState.tokens}</b></p>
    ${sections}
    <button class="action-btn secondary" style="margin-top:12px;" onclick="closeGenericModal()">關閉</button>
  `);
}

function casinoBuyMaterial(kind, id, price) {
  if (gameState.tokens < price) { systemToast("代幣不夠。", true); return; }
  let def = kind === "food" ? FOODS[id] : HERBS[id];
  if (!def) return;
  if (!isMaterialSeen(kind, id)) { systemToast("還沒遇過這個素材，買不了。", true); return; } // 二次防護：防繞過
  gameState.tokens -= price;
  let store = kind === "food" ? gameState.rawFoodInventory : gameState.rawHerbInventory;
  if (!store[id]) store[id] = { normal: 0, rare: 0 };
  store[id].normal += TRADEHOUSE_PACK; // 不拆賣：一次進一組（5 個）
  systemToast(`🛒 買了 ${def.name} x${TRADEHOUSE_PACK}。`);
  casinoTradehouseModal();
  renderCasinoHub();
}

// ========================================
// 對外進入點
// ========================================

// 節點版：第二層路上的「神秘賭局」🎲，賭潛晶。第一次遇到會播 H 開場白並記錄 metH。
function resolveGambleNode() {
  // 冒險內賭局每趟只能賭一次（見納可要求：不然玩家會賺太多）。已經賭過就由 H 婉拒，直接過關。
  if (activeDive && activeDive.gambleUsed) {
    playDialogue([
      { speaker: "H", text: "哎呀，又是你？可惜可惜——這一趟我只陪你玩一次的。貪心可不好喔，下次再來嘛～" },
    ], afterNodeContentResolved);
    return;
  }
  if (activeDive) activeDive.gambleUsed = true;
  let firstTime = !gameState.storyFlags.metH;
  gameState.storyFlags.metH = true;
  checkAchievements();
  casinoEnter({
    currency: "crystal",
    title: firstTime ? "黑暗中的邀約" : "H 的賭局",
    onExit: afterNodeContentResolved,
    intro: firstTime,
    oneShot: true, // 節點賭局只玩一局就走
  });
}

// 避難所版：打贏第二層 + 玩過節點賭場後，避難所旁的賭場入口。用代幣。
function isShelterCasinoUnlocked() {
  return !!(gameState.storyFlags.metH && gameState.storyFlags.layer2Cleared);
}
function showCasinoScreen() {
  casinoEnter({ currency: "token", title: "H 的賭場", onExit: showShelterScreen, intro: false });
}
