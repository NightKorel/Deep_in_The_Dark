// ========================================
// 潛淵 - 成就系統（＋遺物來源）
// 成就解鎖狀態存在 gameState.achievements（會存檔）；輔助統計存在 gameState.stats。
// 解鎖判定採「條件式」：每個成就有 check() 判斷是否達成，在關鍵時機呼叫 checkAchievements() 統一檢查。
//
// 【2026-08-12 大改：成就＝遺物的唯一來源】
//   · 每個成就都對應「一個遺物」（relic 欄位，id 對到 01_資料庫.js 的 RELICS）。達成成就＝拿到那個遺物。
//   · 所以「玩家擁有的遺物」＝「已解鎖成就對應的遺物」——不另外存一份清單，直接從成就推出來（見 ownedRelicIds）。
//   · 遺物是永久的，在避難所「技能遺物」頁面裝到角色身上（見 04_避難所.js）。
//   · hint：每個成就都有一句「語焉不詳的提示」，成就一覽裡就算還沒解鎖也會顯示這句提示當線索
//     （名字與描述仍然遮成？？？，防暴雷）。提示要謎一點、短一點，但不要暗示到「怎麼做都做不到」的坐牢成就。
//   · 世界觀：第一次拿到遺物時，K 會解釋潛淵的怪現象（RELIC_INTRO_LINES）。只播一次。
// ========================================

const ACHIEVEMENTS = [
  { id: "初次潛淵", name: "初次潛淵", icon: "🌊", desc: "第一次出發深潛。", hint: "第一次，總得有人先往黑裡跳。", relic: "初潛之勇", check: () => (gameState.stats.divesStarted || 0) >= 1 },
  { id: "重逢", name: "重逢", icon: "🧪", desc: "擊敗島鯨，救回失蹤的 L。", hint: "有人在很深的地方，等了很久。", relic: "重逢餘溫", check: () => !!gameState.storyFlags.lRescued },
  { id: "海洋圖鑑", name: "海洋圖鑑", icon: "📖", desc: "見過第一層所有生物。", hint: "把海裡的每張臉，都認過一遍。", relic: "洋流羅盤", check: () => ["凝膠", "藍顎獸", "翅鱗", "眼藻", "島鯨"].every((m) => gameState.bestiary[m]) },
  { id: "手腳夠快", name: "手腳夠快", icon: "🎁", desc: "在寶箱怪逃走前打倒牠一次。", hint: "禮物會跑，你得更快。", relic: "疾手之爪", check: () => (gameState.stats.mimicKills || 0) >= 1 },
  { id: "全身而退", name: "全身而退", icon: "🛡️", desc: "在沒有任何人倒地的情況下贏得一場戰鬥。", hint: "一滴都沒濺到身上。", relic: "無瑕之盾", check: () => (gameState.stats.flawlessWins || 0) >= 1 },
  { id: "深淵的滋味", name: "深淵的滋味", icon: "❄️", desc: "嘗過一次全隊倒下、被捲回避難所的滋味。", hint: "嚐過最苦的那一口，才記得住。", relic: "不熄餘燼", check: () => (gameState.stats.wipes || 0) >= 1 },
  { id: "小廚神", name: "小廚神", icon: "🍲", desc: "煮出第一道料理。", hint: "火候剛好的那一刻。", relic: "飽足護身", check: () => (gameState.stats.dishesCooked || 0) >= 1 },
  { id: "拾荒者", name: "拾荒者", icon: "🔸", desc: "把一個遺物裝備到角色身上。", hint: "撿起別人留下的東西，戴上。", relic: "拾荒者之眼", check: () => (gameState.stats.relicsEquipped || 0) >= 1 },
  { id: "小富翁", name: "小富翁", icon: "💎", desc: "潛晶一度累積達到 100。", hint: "數到某個整齊的數字。", relic: "潛晶碎鑽", check: () => (gameState.stats.maxCrystalSeen || 0) >= 100 },
  { id: "熟練者", name: "熟練者", icon: "⭐", desc: "讓任一角色達到 4 級。", hint: "有人開始獨當一面。", relic: "熟練刻印", check: () => Object.values(gameState.characters).some((c) => c.level >= 4) },
  { id: "精益求精", name: "精益求精", icon: "⚔️", desc: "把任一武器強化到 3 級。", hint: "同一把刀，磨了又磨。", relic: "精鍛核心", check: () => Object.values(gameState.characters).some((c) => c.weaponLv >= 3) },
  { id: "岩洞的盡頭", name: "岩洞的盡頭", icon: "🐍", desc: "擊敗巨岩蚺，打通第二圈層。", hint: "石頭會動的那一端。", relic: "岩蚺之牙", check: () => !!gameState.storyFlags.layer2Cleared },
  { id: "岩洞圖鑑", name: "岩洞圖鑑", icon: "🦂", desc: "見過第二層所有生物。", hint: "把岩縫裡的每雙眼睛，都數清楚。", relic: "岩鱗甲片", check: () => ["刺螯", "膜翼", "垂垂耳", "尖嘴鼠", "巨岩蚺"].every((m) => gameState.bestiary[m]) },
  { id: "魔藥師", name: "魔藥師", icon: "🧫", desc: "製作出第一瓶魔藥。", hint: "第一次，瓶子裡冒出了顏色。", relic: "藥師之瓶", check: () => Object.keys(gameState.discoveredPotions || {}).length >= 1 },
  { id: "美食家", name: "美食家", icon: "🍱", desc: "做過 4 種以上不同的料理。", hint: "餐桌上，擺得下四種以上。", relic: "饗宴之力", check: () => Object.keys(gameState.discoveredDishes || {}).length >= 4 },
  { id: "深潛老手", name: "深潛老手", icon: "🗺️", desc: "累計出發深潛 10 次。", hint: "來回夠多趟，黑暗開始眼熟。", relic: "老手護符", check: () => (gameState.stats.divesStarted || 0) >= 10 },
  { id: "遺物達人", name: "遺物達人", icon: "🔱", desc: "累計裝備過 5 個遺物。", hint: "身上，慢慢掛滿了別人的故事。", relic: "萬物歸一", check: () => (gameState.stats.relicsEquipped || 0) >= 5 },
];

// 第一次拿到遺物時 K 的解說（世界觀）。角色講話、不是旁白（照介面規則不用括號旁白）。
const RELIC_INTRO_LINES = [
  { speaker: "K", text: "喔，這個啊——潛淵裡偶爾會有的怪現象。有些東西會莫名其妙冒出來，也有些會莫名其妙消失，沒人說得清為什麼。" },
  { speaker: "K", text: "不過……要是冒出來的是有用的東西，那就收著吧，別跟它客氣。" },
];
// 剛解鎖成就、拿到第一個遺物但當下在戰鬥中，先掛起來，等回到安全畫面再播 K 的解說。
let pendingRelicIntro = false;

// ---------- 遺物擁有狀態（從「已解鎖的成就」推出來，不另存清單） ----------
// 玩家擁有的所有遺物 id（已解鎖成就對應的遺物）。
function ownedRelicIds() {
  return ACHIEVEMENTS.filter((a) => gameState.achievements[a.id] && a.relic).map((a) => a.relic);
}
// 目前已經裝在某個角色身上的遺物 id（跨全部角色）。
function equippedRelicIds() {
  let out = [];
  Object.keys(gameState.characters).forEach((id) => out.push(...(gameState.characters[id].relics || [])));
  return out;
}
// 已擁有、但還沒裝在任何角色身上的遺物 id（＝遺物背包／可裝清單）。
function inventoryRelicIds() {
  let equipped = equippedRelicIds();
  return ownedRelicIds().filter((rid) => !equipped.includes(rid));
}

// 統一檢查：更新潛晶峰值，然後把所有「已達成但還沒解鎖」的成就解鎖並跳通知（＝同時發遺物）。
function checkAchievements() {
  if (!gameState.stats || !gameState.achievements) return;
  gameState.stats.maxCrystalSeen = Math.max(gameState.stats.maxCrystalSeen || 0, gameState.crystal);
  let gotRelic = false;
  ACHIEVEMENTS.forEach((a) => {
    if (!gameState.achievements[a.id] && a.check()) {
      gameState.achievements[a.id] = true;
      let relic = a.relic ? RELICS.find((r) => r.id === a.relic) : null;
      if (relic) {
        systemToast(`🏆 成就達成：${a.name}　🔸 獲得遺物：${relic.name}`);
        gotRelic = true;
      } else {
        systemToast(`🏆 成就達成：${a.name}`);
      }
    }
  });
  // 第一次拿到遺物→掛起 K 的解說，等安全畫面再播（不打斷戰鬥）。
  if (gotRelic && !gameState.storyFlags.firstRelicSeen) pendingRelicIntro = true;
}

// 在「安全的畫面」（避難所/家/深潛節點畫面）呼叫：如果有掛起的第一次遺物解說，就把它播出來。
// 用 activeBattle 當「是否在戰鬥中」的判斷，戰鬥中一律不播、繼續掛著。
function flushRelicIntro() {
  if (!pendingRelicIntro || gameState.storyFlags.firstRelicSeen) return;
  if (typeof activeBattle !== "undefined" && activeBattle) return; // 戰鬥中不播
  pendingRelicIntro = false;
  gameState.storyFlags.firstRelicSeen = true;
  playDialogue(RELIC_INTRO_LINES, function () {});
}

// 成就一覽（左上角☰選單開啟）：一律顯示成就圖示（當作小小的暗示）＋一句語焉不詳的提示；
// 未解鎖時名字與描述都藏成「？？？」、遺物名也不顯示，避免提前暴雷成就內容。
function openAchievementsModal() {
  toggleSettingsMenu();
  checkAchievements();
  let unlockedCount = ACHIEVEMENTS.filter((a) => gameState.achievements[a.id]).length;
  let rows = ACHIEVEMENTS.map((a) => {
    let got = gameState.achievements[a.id];
    let relic = a.relic ? RELICS.find((r) => r.id === a.relic) : null;
    let rewardLine = got && relic
      ? `<div class="dim">🔸 遺物：${relic.name}（${relic.desc}）</div>`
      : "";
    return `<div class="menu-item" style="cursor:default; ${got ? "" : "opacity:0.6;"}">
      <strong>${a.icon} ${got ? a.name : "？？？"}</strong>
      <div class="dim">${got ? a.desc : "？？？"}</div>
      <div class="dim" style="font-style:italic; opacity:0.75;">「${a.hint}」</div>
      ${rewardLine}
    </div>`;
  }).join("");
  openGenericModal(`成就（${unlockedCount} / ${ACHIEVEMENTS.length}）`, `
    <p class="dim">每個成就都藏著一句提示，達成後會拿到一個專屬遺物。</p>
    ${rows}
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}
