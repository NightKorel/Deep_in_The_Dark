// ========================================
// 潛淵 - 成就系統
// 成就解鎖狀態存在 gameState.achievements（會存檔）；輔助統計存在 gameState.stats。
// 解鎖判定採「條件式」：每個成就有 check() 判斷是否達成，在關鍵時機呼叫 checkAchievements() 統一檢查。
// 事件型的成就（例如全身而退、打倒寶箱怪）用 gameState.stats 記錄，其餘直接看 gameState 現有資料。
// 這個系統是純新增功能，不改動任何既有機制。
// ========================================

const ACHIEVEMENTS = [
  { id: "初次潛淵", name: "初次潛淵", icon: "🌊", desc: "第一次出發深潛。", check: () => (gameState.stats.divesStarted || 0) >= 1 },
  { id: "重逢", name: "重逢", icon: "🧪", desc: "擊敗島鯨，救回失蹤的 L。", check: () => !!gameState.storyFlags.lRescued },
  { id: "海洋圖鑑", name: "海洋圖鑑", icon: "📖", desc: "見過第一層所有生物。", check: () => ["凝膠", "藍顎獸", "翅鱗", "眼藻", "島鯨"].every((m) => gameState.bestiary[m]) },
  { id: "手腳夠快", name: "手腳夠快", icon: "🎁", desc: "在寶箱怪逃走前打倒牠一次。", check: () => (gameState.stats.mimicKills || 0) >= 1 },
  { id: "全身而退", name: "全身而退", icon: "🛡️", desc: "在沒有任何人倒地的情況下贏得一場戰鬥。", check: () => (gameState.stats.flawlessWins || 0) >= 1 },
  { id: "深淵的滋味", name: "深淵的滋味", icon: "❄️", desc: "嘗過一次全隊倒下、被捲回避難所的滋味。", check: () => (gameState.stats.wipes || 0) >= 1 },
  { id: "小廚神", name: "小廚神", icon: "🍲", desc: "煮出第一道料理。", check: () => (gameState.stats.dishesCooked || 0) >= 1 },
  { id: "拾荒者", name: "拾荒者", icon: "🔸", desc: "把一個遺物裝備到角色身上。", check: () => (gameState.stats.relicsEquipped || 0) >= 1 },
  { id: "小富翁", name: "小富翁", icon: "💎", desc: "潛晶一度累積達到 100。", check: () => (gameState.stats.maxCrystalSeen || 0) >= 100 },
  { id: "熟練者", name: "熟練者", icon: "⭐", desc: "讓任一角色達到 4 級。", check: () => Object.values(gameState.characters).some((c) => c.level >= 4) },
  { id: "精益求精", name: "精益求精", icon: "⚔️", desc: "把任一武器強化到 3 級。", check: () => Object.values(gameState.characters).some((c) => c.weaponLv >= 3) },
  { id: "岩洞的盡頭", name: "岩洞的盡頭", icon: "🐍", desc: "擊敗巨岩蚺，打通第二圈層。", check: () => !!gameState.storyFlags.layer2Cleared },
  { id: "岩洞圖鑑", name: "岩洞圖鑑", icon: "🦂", desc: "見過第二層所有生物。", check: () => ["刺螯", "膜翼", "垂垂耳", "尖嘴鼠", "巨岩蚺"].every((m) => gameState.bestiary[m]) },
  { id: "魔藥師", name: "魔藥師", icon: "🧫", desc: "製作出第一瓶魔藥。", check: () => Object.keys(gameState.discoveredPotions || {}).length >= 1 },
  { id: "美食家", name: "美食家", icon: "🍱", desc: "做過 4 種以上不同的料理。", check: () => Object.keys(gameState.discoveredDishes || {}).length >= 4 },
  { id: "深潛老手", name: "深潛老手", icon: "🗺️", desc: "累計出發深潛 10 次。", check: () => (gameState.stats.divesStarted || 0) >= 10 },
  { id: "遺物達人", name: "遺物達人", icon: "🔱", desc: "累計裝備過 5 個遺物。", check: () => (gameState.stats.relicsEquipped || 0) >= 5 },
];

// 統一檢查：更新潛晶峰值，然後把所有「已達成但還沒解鎖」的成就解鎖並跳通知。
function checkAchievements() {
  if (!gameState.stats || !gameState.achievements) return;
  gameState.stats.maxCrystalSeen = Math.max(gameState.stats.maxCrystalSeen || 0, gameState.crystal);
  ACHIEVEMENTS.forEach((a) => {
    if (!gameState.achievements[a.id] && a.check()) {
      gameState.achievements[a.id] = true;
      systemToast(`🏆 成就達成：${a.name}`);
    }
  });
}

// 成就一覽（左上角☰選單開啟）：一律顯示成就圖示（當作小小的暗示）；
// 未解鎖時名字與描述都藏成「？？？」，避免提前暴雷成就內容。
function openAchievementsModal() {
  toggleSettingsMenu();
  checkAchievements();
  let unlockedCount = ACHIEVEMENTS.filter((a) => gameState.achievements[a.id]).length;
  let rows = ACHIEVEMENTS.map((a) => {
    let got = gameState.achievements[a.id];
    return `<div class="menu-item" style="cursor:default; ${got ? "" : "opacity:0.5;"}">
      <strong>${a.icon} ${got ? a.name : "？？？"}</strong>
      <div class="dim">${got ? a.desc : "？？？"}</div>
    </div>`;
  }).join("");
  openGenericModal(`成就（${unlockedCount} / ${ACHIEVEMENTS.length}）`, `
    ${rows}
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}
