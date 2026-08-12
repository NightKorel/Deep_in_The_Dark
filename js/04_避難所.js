// ========================================
// 潛淵 - 避難所畫面
// 工坊(V)：強化武器/裝備　家(K)：煮飯/技能管理/整備出發/改名/補充補血藥　煉藥站(L)：救出後解鎖
// ========================================

// 固定小隊，L救出來後會被syncLRoster()/handleBossVictory()動態push進來，不是單純的常數
const SHELTER_PARTY_IDS = ["K", "主角", "V"];

function shelterRosterHtml() {
  return SHELTER_PARTY_IDS.map((id) => {
    let c = CHARACTERS[id];
    let name = id === "主角" ? (gameState.playerName || "你") : c.name;
    let lv = getCharacterLevel(id);
    let atk = (c.baseAtk * getCharacterWeaponMultiplier(id)).toFixed(1);
    let hp = getCharacterMaxHp(id);
    return `<div class="roster-card" style="--char-color:${getCharacterColor(id)};">
      <div class="roster-avatar">${c.icon}</div>
      <div class="roster-info">
        <div class="roster-name">${name} <span class="dim">Lv.${lv}</span></div>
        <div class="dim">武器：${c.weaponName}（攻擊力 ${atk}） ／ 血量 ${hp}</div>
      </div>
    </div>`;
  }).join("");
}

function showShelterScreen() {
  activeDive = null;
  // L 救出後：每次回到避難所自動把補血藥補滿（L 負責後勤，補血藥材料現成、免費），玩家不必再花潛晶買。
  if (gameState.storyFlags.lRescued) gameState.potions = POTION_MAX;
  checkAchievements(); // 回避難所時統一檢查一次成就（等級/強化/潛晶/圖鑑/救出L等被動條件）
  flushRelicIntro();   // 若剛拿到第一個遺物、當時在戰鬥中沒播成，回到避難所時補播 K 的解說
  showScreen(`
    <h2 class="screen-title">避難所</h2>
    <p class="dim">裂谷中的一處平台，兩個簡陋的棚子搭在一起。</p>

    <div class="card">
      <h3>小隊</h3>
      <div class="roster-list">${shelterRosterHtml()}</div>
    </div>

    <div class="shelter-buildings">
      <button class="building-btn" onclick="showWorkshopScreen()">
        <span class="building-icon">🔨</span>
        <span class="building-name">工坊</span>
        <div class="dim">${gameState.storyFlags.lRescued ? "V、L 負責 · 強化裝備／魔藥間製藥" : "V 負責 · 強化武器與裝備"}</div>
      </button>
      <button class="building-btn" onclick="showHomeScreen()">
        <span class="building-icon">🏕️</span>
        <span class="building-name">家</span>
        <div class="dim">K 負責 · 煮飯／技能／出發</div>
      </button>
      ${isShelterCasinoUnlocked() ? `
      <button class="building-btn casino-entrance" onclick="showCasinoScreen()">
        <span class="building-icon">🃏</span>
        <span class="building-name">賭場</span>
        <div class="dim">H 負責 · 用代幣小賭一把（🪙 ${gameState.tokens}）</div>
      </button>` : ""}
    </div>
  `, { withTopbar: true });
}

// ---------- 工坊：強化武器／裝備 ----------

function showWorkshopScreen() {
  if (gameState.workshopSuspended) {
    showScreen(`
      <h2 class="screen-title">工坊</h2>
      <div class="card">
        <p>V 搖搖頭。「維護費還沒補上，工坊的東西暫時動不了。」</p>
      </div>
      <button class="action-btn secondary" onclick="showShelterScreen()">返回避難所</button>
    `, { withTopbar: true });
    return;
  }
  let potionRoomItem = gameState.storyFlags.lRescued
    ? `<div class="menu-item" onclick="showPotionCraftScreen()">🧪 魔藥間（L 製藥）</div>`
    : `<div class="menu-item" style="opacity:0.5; cursor:default;">🧪 魔藥間 <span class="dim">— L 救出後解鎖</span></div>`;
  showScreen(`
    <h2 class="screen-title">工坊</h2>
    <div class="card">
      <div class="menu-item" onclick="showWorkshopUpgradeScreen()">⚔️🛡️ 強化裝備（武器＋防具）</div>
      ${potionRoomItem}
    </div>
    <button class="action-btn secondary" onclick="showShelterScreen()">返回避難所</button>
  `, { withTopbar: true });
}

// 武器＋裝備合併成同一頁（納可要求）：每個角色一張卡，武器、防具各一個強化按鈕；頂部有「一鍵升級」。
function showWorkshopUpgradeScreen() {
  let rows = SHELTER_PARTY_IDS.map((id) => {
    let c = CHARACTERS[id];
    let name = id === "主角" ? (gameState.playerName || "你") : c.name;
    let cur = gameState.characters[id];

    // 武器
    let wLv = cur.weaponLv, wCost = getUpgradeCost(wLv);
    let wCur = (c.baseAtk * getCharacterWeaponMultiplier(id)).toFixed(1);
    let wNext = (c.baseAtk * Math.pow(UPGRADE_GROWTH_RATE, wLv + 1)).toFixed(1);
    let wAfford = gameState.crystal >= wCost;
    // 防具
    let aLv = cur.armorLv, aCost = getUpgradeCost(aLv);
    let aCur = getCharacterMaxHp(id);
    let aNext = Math.ceil(aCur * UPGRADE_GROWTH_RATE);
    let aAfford = gameState.crystal >= aCost;

    return `<div class="menu-item" style="cursor:default;">
      <div><strong>${c.icon} ${name}</strong></div>
      <div class="dim" style="margin-top:4px;">⚔️ 武器 Lv.${wLv}　攻擊力 ${wCur} → ${wNext}</div>
      <button class="action-btn" style="margin-top:4px;" title="花費 💎${wCost}，將${name}的攻擊力從 ${wCur} 提升到 ${wNext}" ${wAfford ? "" : "disabled"} onclick="confirmUpgrade('weapon', '${id}')">強化武器 💎${wCost}</button>
      <div class="dim" style="margin-top:8px;">🛡️ 防具 Lv.${aLv}　血量 ${aCur} → ${aNext}</div>
      <button class="action-btn" style="margin-top:4px;" title="花費 💎${aCost}，將${name}的血量從 ${aCur} 提升到 ${aNext}" ${aAfford ? "" : "disabled"} onclick="confirmUpgrade('armor', '${id}')">強化防具 💎${aCost}</button>
    </div>`;
  }).join("");

  // 一鍵升級：只要「當前最低等級的那項」還升得起就顯示可按（成本最低的一定是等級最低那項）
  let cheapest = collectUpgradeItems().reduce((best, it) => it.lv < best.lv ? it : best);
  let canOneClick = gameState.crystal >= getUpgradeCost(cheapest.lv);

  showScreen(`
    <h2 class="screen-title">強化裝備</h2>
    <div class="card">
      <p class="dim">目前潛晶 💎${gameState.crystal}。武器提升攻擊力、防具提升血量。</p>
      <button class="action-btn" title="盡可能花光潛晶，優先升等級最低的" ${canOneClick ? "" : "disabled"} onclick="oneClickUpgrade()">⚡ 一鍵升級</button>
    </div>
    <div class="card">${rows}</div>
    <button class="action-btn secondary" onclick="showWorkshopScreen()">返回</button>
  `, { withTopbar: true });
}

// 一鍵升級用：把全體「武器＋防具」列成可升項目，順序＝優先序（先所有人武器、再所有人防具，人照 SHELTER_PARTY_IDS）。
function collectUpgradeItems() {
  let items = [];
  SHELTER_PARTY_IDS.forEach((id) => items.push({ id, kind: "weapon", lv: gameState.characters[id].weaponLv }));
  SHELTER_PARTY_IDS.forEach((id) => items.push({ id, kind: "armor", lv: gameState.characters[id].armorLv }));
  return items;
}

function confirmUpgrade(kind, charId) {
  let cur = gameState.characters[charId];
  let curLv = kind === "weapon" ? cur.weaponLv : cur.armorLv;
  let cost = getUpgradeCost(curLv);
  if (gameState.crystal < cost) return;
  gameState.crystal -= cost;
  if (kind === "weapon") cur.weaponLv++;
  else cur.armorLv++;
  systemToast(`✅ 強化完成（花費 💎${cost}）`);
  showWorkshopUpgradeScreen();
}

// 一鍵升級（納可要求）：先問確認，再盡可能花光潛晶。
function oneClickUpgrade() {
  openGenericModal("一鍵升級", `
    <p>確定要一鍵升級嗎？</p>
    <p class="dim">會盡可能把潛晶花完：每次都先升「目前等級最低」的那項；同等級時照順序（先所有人的武器，再所有人的防具），直到潛晶不夠為止。</p>
    <button class="action-btn" onclick="doOneClickUpgrade()">確定，一鍵升級</button>
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">取消</button>
  `);
}

function doOneClickUpgrade() {
  closeGenericModal();
  let spent = 0, count = 0;
  // 每一步重新盤點：挑等級最低的項目（reduce 用「嚴格小於才替換」→ 同級時保留順序在前的＝武器優先、人照序），升它。
  while (count < 999) {
    let items = collectUpgradeItems();
    let target = items.reduce((best, it) => (it.lv < best.lv ? it : best));
    let cost = getUpgradeCost(target.lv);
    if (gameState.crystal < cost) break; // 連最低等級（成本最低）那項都升不起 → 停
    gameState.crystal -= cost;
    if (target.kind === "weapon") gameState.characters[target.id].weaponLv++;
    else gameState.characters[target.id].armorLv++;
    spent += cost; count++;
  }
  if (count > 0) systemToast(`⚡ 一鍵升級完成：共升 ${count} 級，花費 💎${spent}`);
  else systemToast("潛晶不夠，一次都升不了。", true);
  showWorkshopUpgradeScreen();
}

// ---------- 家：煮飯／技能管理／圖鑑／整備出發（補血藥補充已併入整備出發；改名在左上角選單） ----------

function showHomeScreen() {
  showScreen(`
    <h2 class="screen-title">家</h2>
    <div class="card">
      <div class="menu-item" onclick="showCookingScreen()">🍲 煮飯</div>
      <div class="menu-item" onclick="showSkillManagementScreen()">📖 技能遺物</div>
      <div class="menu-item" onclick="showCodexScreen()">📚 圖鑑</div>
      <div class="menu-item" onclick="showDepartScreen()">🎒 整備出發</div>
    </div>
    <button class="action-btn secondary" onclick="showShelterScreen()">返回避難所</button>
  `, { withTopbar: true });
}

// ---- 圖鑑（家）：怪物／料理／魔藥。只顯示「遇過的怪」與「做過的東西」，沒遇過/沒做過的不劇透。 ----

function showCodexScreen() {
  let metCount = Object.keys(MONSTERS).filter((mid) => gameState.bestiary[mid]).length;
  let dishCount = Object.keys(gameState.discoveredDishes || {}).filter((k) => gameState.discoveredDishes[k]).length;
  let potionCount = Object.keys(gameState.discoveredPotions || {}).filter((k) => gameState.discoveredPotions[k]).length;
  showScreen(`
    <h2 class="screen-title">📚 圖鑑</h2>
    <p class="dim">記錄一路上遇過的生物、做過的料理與魔藥。沒親眼見過／親手做過的，還不會出現在這裡。</p>
    <div class="card">
      <div class="menu-item" onclick="showMonsterCodex()">👾 怪物圖鑑 <span class="dim">（已記錄 ${metCount} 種）</span></div>
      <div class="menu-item" onclick="showDishCodex()">🍲 料理圖鑑 <span class="dim">（已記錄 ${dishCount} 種）</span></div>
      <div class="menu-item" onclick="showPotionCodex()">🧪 魔藥圖鑑 <span class="dim">（已記錄 ${potionCount} 種）</span></div>
    </div>
    <button class="action-btn secondary" onclick="showHomeScreen()">返回</button>
  `, { withTopbar: true });
}

function showMonsterCodex() {
  let met = Object.keys(MONSTERS).filter((mid) => gameState.bestiary[mid]);
  let body = met.length === 0
    ? `<p class="dim">還沒有遇過任何生物。出發深潛，親眼見過的怪就會記錄在這裡。</p>`
    : met.map((mid) => {
        let m = MONSTERS[mid];
        // 技能名字們（普攻也照戰鬥意圖列的規則，isBasic 一律顯示「攻擊」，其餘顯示技能本名）
        let skillNames = (m.skillIds || []).map((sid) => {
          let sk = MONSTER_SKILLS[sid];
          if (!sk) return null;
          return sk.isBasic ? "攻擊" : sk.name;
        }).filter(Boolean);
        // 同名去重（避免多個 isBasic 都變「攻擊」重複顯示）
        skillNames = skillNames.filter((n, i) => skillNames.indexOf(n) === i);
        let tag = m.isBoss ? ` <span class="tag">Boss</span>` : "";
        return `<div class="menu-item" style="cursor:default;">
          <strong>${m.icon} ${m.name}</strong>${tag}
          <div class="dim">${m.codex || "圖鑑待補。"}</div>
          <div class="dim">技能：${skillNames.join("、") || "—"}</div>
        </div>`;
      }).join("");
  showScreen(`
    <h2 class="screen-title">👾 怪物圖鑑</h2>
    <div class="card">${body}</div>
    <button class="action-btn secondary" onclick="showCodexScreen()">返回圖鑑</button>
  `, { withTopbar: true });
}

function showDishCodex() {
  let discovered = Object.keys(gameState.discoveredDishes || {}).filter((k) => gameState.discoveredDishes[k]);
  let body = discovered.length === 0
    ? `<p class="dim">還沒做過任何料理。到「煮飯」用食材煮出料理，就會記錄在這裡。</p>`
    : discovered.map((dishId) => {
        let food = Object.values(FOODS).find((f) => f.dishId === dishId);
        if (!food) return "";
        let normalDesc = foodBuffDescForDisplay(food.buff.type, food.buff.value);
        let rareDesc = foodBuffDescForDisplay(food.buff.type, food.buff.rareValue);
        return `<div class="menu-item" style="cursor:default;">
          <strong>🍲 ${food.dishName}</strong> <span class="dim">← ${food.name}</span>
          <div class="dim">${food.flavorText}</div>
          <div class="dim">一般：${normalDesc}｜稀有：${rareDesc}</div>
        </div>`;
      }).filter(Boolean).join("");
  showScreen(`
    <h2 class="screen-title">🍲 料理圖鑑</h2>
    <div class="card">${body}</div>
    <button class="action-btn secondary" onclick="showCodexScreen()">返回圖鑑</button>
  `, { withTopbar: true });
}

function showPotionCodex() {
  let discovered = Object.keys(gameState.discoveredPotions || {}).filter((k) => gameState.discoveredPotions[k]);
  let body = discovered.length === 0
    ? `<p class="dim">還沒製作過任何魔藥。L 救出後，在工坊的「魔藥間」用藥材製作，就會記錄在這裡。</p>`
    : discovered.map((pid) => {
        let p = POTIONS[pid];
        if (!p) return "";
        return `<div class="menu-item" style="cursor:default;">
          <strong>${p.icon} ${p.name}</strong>
          <div class="dim">${p.desc}</div>
          <div class="dim">一般：${potionEffectDesc(p, false)}｜稀有：${potionEffectDesc(p, true)}</div>
        </div>`;
      }).filter(Boolean).join("");
  showScreen(`
    <h2 class="screen-title">🧪 魔藥圖鑑</h2>
    <div class="card">${body}</div>
    <button class="action-btn secondary" onclick="showCodexScreen()">返回圖鑑</button>
  `, { withTopbar: true });
}

// ---- 煮飯 ----

function showCookingScreen() {
  let entries = Object.keys(FOODS).filter((fid) => {
    let inv = gameState.rawFoodInventory[fid];
    return inv && (inv.normal > 0 || inv.rare > 0);
  });

  let body = entries.length === 0
    ? `<p class="dim">目前沒有食材，出征時打怪有機會撿到。</p>`
    : entries.map((fid) => {
        let food = FOODS[fid];
        let inv = gameState.rawFoodInventory[fid];
        let normalDesc = foodBuffDescForDisplay(food.buff.type, food.buff.value);
        let rareDesc = foodBuffDescForDisplay(food.buff.type, food.buff.rareValue);
        return `<div class="menu-item" style="cursor:default;" title="效果：${normalDesc}（稀有版：${rareDesc}）">
          <div><strong>${food.name}</strong> <span class="dim">（一般 x${inv.normal}／稀有 x${inv.rare}）</span></div>
          <div class="dim">做成：${food.dishName} — ${food.flavorText}</div>
          <button class="action-btn" style="margin-top:8px;" title="效果：${normalDesc}" ${inv.normal > 0 ? "" : "disabled"} onclick="cookFood('${fid}', false)">烹飪一般</button>
          <button class="action-btn" title="效果：${rareDesc}" ${inv.rare > 0 ? "" : "disabled"} onclick="cookFood('${fid}', true)">烹飪稀有</button>
        </div>`;
      }).join("");

  showScreen(`
    <h2 class="screen-title">煮飯</h2>
    <div class="card">${body}</div>
    <div class="card">
      <h3>料理背包</h3>
      ${cookedInventoryHtml()}
    </div>
    <button class="action-btn secondary" onclick="showHomeScreen()">返回</button>
  `, { withTopbar: true });
}

function cookedInventoryHtml() {
  let keys = Object.keys(gameState.cookedInventory).filter((k) => {
    let e = gameState.cookedInventory[k];
    return e && (e.normal > 0 || e.rare > 0);
  });
  if (keys.length === 0) return `<p class="dim">目前沒有做好的料理。</p>`;
  return keys.map((dishId) => {
    let e = gameState.cookedInventory[dishId];
    let foodDef = Object.values(FOODS).find((f) => f.dishId === dishId);
    let desc = foodDef ? foodBuffDescForDisplay(foodDef.buff.type, foodDef.buff.value) : "";
    return `<div class="dim" title="效果：${desc}">${dishId} × ${e.normal + e.rare}${e.rare > 0 ? `（含稀有 x${e.rare}）` : ""}</div>`;
  }).join("");
}

function cookFood(foodId, rare) {
  let food = FOODS[foodId];
  let inv = gameState.rawFoodInventory[foodId];
  if (rare) { if (inv.rare <= 0) return; inv.rare--; }
  else { if (inv.normal <= 0) return; inv.normal--; }

  if (!gameState.cookedInventory[food.dishId]) gameState.cookedInventory[food.dishId] = { normal: 0, rare: 0 };
  if (rare) gameState.cookedInventory[food.dishId].rare++;
  else gameState.cookedInventory[food.dishId].normal++;
  gameState.discoveredDishes[food.dishId] = true; // 圖鑑：做過就永久記錄

  systemToast(`🍲 做好了：${food.dishName}${rare ? "（稀有版）" : ""}`);
  gameState.stats.dishesCooked++;
  checkAchievements();
  showCookingScreen();
}

// ---- 技能遺物（技能管理＋遺物裝備，2026-08-12 合併） ----
// 遺物裝備篩選/搜尋的暫存狀態（只是介面狀態，不用存檔）。
let relicFilterCat = "all";
let relicSearchText = "";

function showSkillManagementScreen() {
  let rows = SHELTER_PARTY_IDS.map((id) => {
    let c = CHARACTERS[id];
    let name = id === "主角" ? (gameState.playerName || "你") : c.name;
    let relicCount = (gameState.characters[id].relics || []).length;
    return `<div class="menu-item" onclick="showSkillManagementForChar('${id}')">${c.icon} ${name} <span class="dim">（遺物 ${relicCount}/${RELIC_MAX_PER_CHARACTER}）</span></div>`;
  }).join("");
  let invCount = inventoryRelicIds().length;
  showScreen(`
    <h2 class="screen-title">技能遺物</h2>
    <p class="dim">選一個角色管理技能與遺物。目前有 ${invCount} 個未裝備的遺物可以分配。</p>
    <div class="card">${rows}</div>
    <button class="action-btn secondary" onclick="showHomeScreen()">返回</button>
  `, { withTopbar: true });
}

function showSkillManagementForChar(charId) {
  relicFilterCat = "all"; // 每次進角色頁重置篩選/搜尋，免得沿用上一個角色的狀態造成困惑
  relicSearchText = "";
  let c = CHARACTERS[charId];
  let name = charId === "主角" ? (gameState.playerName || "你") : c.name;
  let lv = getCharacterLevel(charId);
  let equipped = gameState.equippedSkills[charId];

  let rows = c.skillIds.map((skillId, idx) => {
    let skill = SKILLS[skillId];
    let unlockLevel = getSkillUnlockLevel(charId, skillId);
    let unlocked = lv >= unlockLevel;
    let isEquipped = equipped.includes(skillId);
    let desc = skillDescForDisplay(skill, charId);
    if (!unlocked) {
      return `<div class="menu-item disabled">
        <strong>${skill.name}</strong> <span class="dim">需求等級 ${unlockLevel}（尚未解鎖）</span>
      </div>`;
    }
    return `<div class="menu-item" style="${isEquipped ? "border-left-color:#4fa8d8;" : ""}" onclick="toggleEquippedSkill('${charId}', '${skillId}')">
      <strong>${skill.name}</strong> ${isEquipped ? '<span class="tag">已裝備</span>' : ""}
      <div class="dim">${desc}（${skill.maxUses}次）</div>
    </div>`;
  }).join("");

  showScreen(`
    <h2 class="screen-title">${c.icon} ${name} 的技能與遺物</h2>
    <p class="dim">出征前最多裝備4個技能，深潛中不可更換。</p>
    <div class="card">${rows}</div>
    ${relicSectionHtml(charId)}
    <button class="action-btn secondary" onclick="showSkillManagementScreen()">返回</button>
  `, { withTopbar: true });
}

// ---- 遺物裝備區塊（技能遺物頁面的下半段） ----
// 遺物是永久的：裝上去就一直在，除非在這裡拆下來。每人最多 RELIC_MAX_PER_CHARACTER 個。
// 未出戰的角色也能裝，但只有出戰才會生效（遺物本來就作用在該角色身上）。
function relicSectionHtml(charId) {
  let equipped = gameState.characters[charId].relics || [];
  // 三個遺物槽
  let slots = "";
  for (let i = 0; i < RELIC_MAX_PER_CHARACTER; i++) {
    let rid = equipped[i];
    if (rid) {
      let r = RELICS.find((x) => x.id === rid);
      let cat = RELIC_CATEGORIES[r.cat] || { color: "#888", label: "", icon: "🔸" };
      slots += `<div class="relic-slot-card equipped" style="border-color:${cat.color};" title="${r.desc}（點擊拆下）" onclick="unequipRelicFromChar('${charId}', '${rid}')">
        <span class="relic-slot-icon">${cat.icon}</span>
        <span class="relic-slot-name">${r.name}</span>
      </div>`;
    } else {
      slots += `<div class="relic-slot-card empty" title="空槽">空</div>`;
    }
  }

  // 分類篩選按鈕（點按鈕只重畫清單、更新 active，不整頁重繪，才不會清掉搜尋文字）
  let filterBtns = `<button class="relic-filter-btn${relicFilterCat === "all" ? " active" : ""}" onclick="setRelicFilter(this,'${charId}','all')">全部</button>`;
  Object.keys(RELIC_CATEGORIES).forEach((key) => {
    let cat = RELIC_CATEGORIES[key];
    filterBtns += `<button class="relic-filter-btn${relicFilterCat === key ? " active" : ""}" style="border-color:${cat.color};" onclick="setRelicFilter(this,'${charId}','${key}')">${cat.icon} ${cat.label}</button>`;
  });

  return `<div class="card">
    <h3>遺物（${equipped.length}/${RELIC_MAX_PER_CHARACTER}）</h3>
    <div class="relic-slot-row">${slots}</div>
    <p class="dim" style="margin-top:10px;">未裝備的遺物（點擊裝到這個角色身上）：</p>
    <div class="relic-filter-row">${filterBtns}</div>
    <input id="relic-search" class="relic-search" type="text" placeholder="🔍 搜尋遺物名字或效果…" value="${relicSearchText}" oninput="onRelicSearchInput('${charId}', this.value)">
    <div id="relic-inv-list" class="relic-inv-list">${relicInventoryHtml(charId)}</div>
  </div>`;
}

// 一個遺物是否通過目前的分類 + 搜尋文字篩選
function relicPassesFilter(r) {
  if (relicFilterCat !== "all" && r.cat !== relicFilterCat) return false;
  let q = relicSearchText.trim();
  if (q && !(r.name.includes(q) || r.desc.includes(q))) return false;
  return true;
}

// 未裝備遺物清單的 HTML（依分類/搜尋過濾）
function relicInventoryHtml(charId) {
  let charFull = (gameState.characters[charId].relics || []).length >= RELIC_MAX_PER_CHARACTER;
  let list = inventoryRelicIds()
    .map((rid) => RELICS.find((r) => r.id === rid))
    .filter((r) => r && relicPassesFilter(r));
  if (list.length === 0) {
    return `<p class="dim">（沒有符合的未裝備遺物。達成更多成就可以拿到新遺物。）</p>`;
  }
  return list.map((r) => {
    let cat = RELIC_CATEGORIES[r.cat] || { color: "#888", label: "", icon: "🔸" };
    let clickable = !charFull;
    return `<div class="relic-inv-card${clickable ? "" : " disabled"}" style="border-left-color:${cat.color};"
      title="${clickable ? "點擊裝到這個角色身上" : "這個角色的遺物槽已滿"}"
      ${clickable ? `onclick="equipRelicToChar('${charId}', '${r.id}')"` : ""}>
      <div><strong style="color:${cat.color};">${cat.icon}</strong> <strong>${r.name}</strong> <span class="relic-cat-tag" style="background:${cat.color};">${cat.label}</span></div>
      <div class="dim">${r.desc}</div>
    </div>`;
  }).join("");
}

// 只重繪未裝備清單（不整頁重繪，才不會讓搜尋框失焦）
function refreshRelicInventory(charId) {
  let el = document.getElementById("relic-inv-list");
  if (el) el.innerHTML = relicInventoryHtml(charId);
}

function setRelicFilter(btn, charId, cat) {
  relicFilterCat = cat;
  document.querySelectorAll(".relic-filter-row .relic-filter-btn").forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  refreshRelicInventory(charId);
}

function onRelicSearchInput(charId, val) {
  relicSearchText = val;
  refreshRelicInventory(charId);
}

function equipRelicToChar(charId, relicId) {
  let arr = gameState.characters[charId].relics;
  if (arr.length >= RELIC_MAX_PER_CHARACTER) { systemToast("這個角色的遺物槽已經滿了。", true); return; }
  if (!inventoryRelicIds().includes(relicId)) return; // 保險：只能裝「已擁有且未裝備」的遺物
  arr.push(relicId);
  gameState.stats.relicsEquipped++;
  checkAchievements();
  flushRelicIntro();
  showSkillManagementForChar(charId); // 槽位變了，整頁重繪
}

function unequipRelicFromChar(charId, relicId) {
  let arr = gameState.characters[charId].relics;
  let idx = arr.indexOf(relicId);
  if (idx === -1) return;
  arr.splice(idx, 1);
  showSkillManagementForChar(charId);
}

// charId：用來即時計算當前武器/裝備等級後的實際數值，不傳的話顯示未強化的基礎數值
function skillDescForDisplay(skill, charId) {
  if (skill.type === "attack") {
    let mult = charId ? getCharacterWeaponMultiplier(charId) : 1;
    let lo = Math.ceil(skill.dmgRange[0] * mult), hi = Math.ceil(skill.dmgRange[1] * mult);
    let hits = skill.hits || 1;
    let base = `對${skill.targetType === "all-enemies" ? "全體敵人" : "單一敵人"}造成 ${lo}~${hi} 傷害${hits > 1 ? `，共${hits}次` : ""}`;
    if (skill.missRate) base += `，${Math.round(skill.missRate * 100)}%機率未命中`;
    if (skill.applyBleed) base += `，附加流血`;
    if (skill.critRateOverride) base += `，爆擊率${Math.round(skill.critRateOverride * 100)}%`;
    if (skill.stunChance) base += `，${Math.round(skill.stunChance * 100)}%機率震懾`;
    return base;
  }
  if (skill.type === "heal") {
    let mult = charId ? getCharacterHealMultiplier(charId) : 1;
    let lo = Math.ceil(skill.healRange[0] * mult), hi = Math.ceil(skill.healRange[1] * mult);
    return `治療單一隊友 ${lo}~${hi}`;
  }
  if (skill.type === "hot") {
    let mult = charId ? getCharacterHealMultiplier(charId) : 1;
    let perTurn = Math.ceil(skill.hotHealPerTurn * mult);
    return `每回合回復單一隊友 ${perTurn} 點血量，持續 ${skill.hotDuration} 回合`;
  }
  if (skill.type === "guard") return `成為敵方優先目標，受到傷害-30%`;
  if (skill.type === "self-heal-percent") return `立即回復自身最大血量的 ${Math.round(skill.healPercent * 100)}%`;
  if (skill.type === "party-dmg-buff") return `全隊下次攻擊傷害 +${Math.round(skill.dmgBuffPercent * 100)}%`;
  if (skill.type === "self-charge") return `下次任意攻擊傷害 ×${skill.chargeMultiplier}`;
  if (skill.type === "self-dodge") return `這回合自身閃避率 +${Math.round(skill.dodgeChance * 100)}%`;
  if (skill.type === "damage-reduction") return `單一隊友減傷 ${Math.round(skill.damageReduction * 100)}%，持續 ${skill.duration} 回合`;
  return "";
}

// 料理buff的顯示文字（煮飯清單／料理背包／整備出發的攜帶料理挑選都會用到）
// 效果都只到下場戰鬥結束為止，統一在敘述裡註明，不要讓玩家誤以為是永久生效
function foodBuffDescForDisplay(buffType, value) {
  let pct = Math.round(value * 100);
  switch (buffType) {
    case "maxhp-percent": return `下場戰鬥最大血量 +${pct}%`;
    case "damage-percent": return `下場戰鬥造成傷害 +${pct}%`;
    case "dodge-percent": return `下場戰鬥閃避率 +${pct}%`;
    case "damage-reduction-percent": return `下場戰鬥受到傷害 -${pct}%`;
    case "crit-percent": return `下場戰鬥爆擊率 +${pct}%`;
    case "first-turn-dmg-percent": return `下場戰鬥首回合造成傷害 +${pct}%`;
    default: return "";
  }
}

function toggleEquippedSkill(charId, skillId) {
  let equipped = gameState.equippedSkills[charId];
  let idx = equipped.indexOf(skillId);
  if (idx >= 0) {
    equipped.splice(idx, 1);
  } else {
    if (equipped.length >= 4) {
      systemToast("最多只能裝備4個技能。", true);
      return;
    }
    equipped.push(skillId);
  }
  showSkillManagementForChar(charId);
}

// 改名已經移到左上角選單(openRenameModal/confirmRenameModal，見02_介面共用與存讀檔.js)

// ---- 補血藥購買（只用在整備出發、且僅限 L 救出前的花潛晶補充；救出後 L 免費補滿、不再顯示按鈕） ----

function buyPotion(amount, onDone) {
  let need = Math.min(amount, POTION_MAX - gameState.potions);
  let affordable = Math.min(need, Math.floor(gameState.crystal / POTION_REFILL_COST));
  if (affordable <= 0) return;
  gameState.crystal -= affordable * POTION_REFILL_COST;
  gameState.potions += affordable;
  systemToast(`🧪 補充了 ${affordable} 瓶補血藥。`);
  (onDone || showDepartScreen)();
}

// ---- 整備出發 ----

// 攜帶料理背包制：先從「料理背包」點選一份一般/稀有的料理，再點角色的空槽把它分配過去。
// 一般跟稀有是分開的兩張卡片，數量各自顯示，不會像以前那樣被自動吃掉稀有版而玩家看不出來。
// 分配結果存在gameState.foodAssignment（不是session暫存），這樣沒吃掉的料理下次出征會繼續帶著，不用重新分配。
function departAssignedCount(dishId, rare) {
  return SHELTER_PARTY_IDS.filter((id) => {
    let f = gameState.foodAssignment[id];
    return f && f.dishId === dishId && f.rare === rare;
  }).length;
}

function departAvailableCount(dishId, rare) {
  let e = gameState.cookedInventory[dishId];
  let total = e ? (rare ? e.rare : e.normal) : 0;
  return total - departAssignedCount(dishId, rare);
}

// 魔藥攜帶（跟料理各自獨立一格），做法同料理
function departPotionAssignedCount(potionId, rare) {
  return SHELTER_PARTY_IDS.filter((id) => {
    let f = gameState.potionAssignment[id];
    return f && f.potionId === potionId && f.rare === rare;
  }).length;
}
function departPotionAvailableCount(potionId, rare) {
  let e = gameState.craftedPotionInventory[potionId];
  let total = e ? (rare ? e.rare : e.normal) : 0;
  return total - departPotionAssignedCount(potionId, rare);
}

function showDepartScreen() {
  if (window._departSelectedFood === undefined) window._departSelectedFood = null;
  if (window._departSelectedPotion === undefined) window._departSelectedPotion = null;

  let dishIds = Object.keys(gameState.cookedInventory).filter((k) => {
    let e = gameState.cookedInventory[k];
    return e && (e.normal > 0 || e.rare > 0);
  });
  let sel = window._departSelectedFood;

  let backpackCards = [];
  dishIds.forEach((dishId) => {
    let foodDef = Object.values(FOODS).find((f) => f.dishId === dishId);
    [false, true].forEach((rare) => {
      let count = departAvailableCount(dishId, rare);
      if (count <= 0) return;
      let desc = foodDef ? foodBuffDescForDisplay(foodDef.buff.type, rare ? foodDef.buff.rareValue : foodDef.buff.value) : "";
      let isSelected = sel && sel.dishId === dishId && sel.rare === rare;
      backpackCards.push(`<div class="food-pick-card${isSelected ? " selected" : ""}" title="${dishId}${rare ? "（稀有）" : ""}，效果：${desc}" onclick="selectDepartFood('${dishId}', ${rare})">
        <span class="food-pick-icon">${rare ? "✨" : "🍲"}</span>
        <span class="food-pick-label">${dishId}${rare ? "（稀有）" : ""}</span>
        <span class="food-pick-count">x${count}</span>
      </div>`);
    });
  });
  let backpackHtml = backpackCards.length > 0 ? backpackCards.join("") : `<p class="dim">料理背包是空的。</p>`;

  let rows = SHELTER_PARTY_IDS.map((id) => {
    let c = CHARACTERS[id];
    let name = id === "主角" ? (gameState.playerName || "你") : c.name;
    let assigned = gameState.foodAssignment[id];
    let slotHtml;
    if (assigned) {
      let foodDef = Object.values(FOODS).find((f) => f.dishId === assigned.dishId);
      let desc = foodDef ? foodBuffDescForDisplay(foodDef.buff.type, assigned.rare ? foodDef.buff.rareValue : foodDef.buff.value) : "";
      slotHtml = `<div class="relic-slot-card equipped" title="${assigned.dishId}${assigned.rare ? "（稀有）" : ""}，效果：${desc}（點擊拆下回背包）" onclick="unassignDepartFood('${id}')">
        <span class="relic-slot-icon">${assigned.rare ? "✨" : "🍲"}</span>
        <span class="relic-slot-name">${assigned.dishId}${assigned.rare ? "（稀有）" : ""}</span>
      </div>`;
    } else {
      slotHtml = `<div class="relic-slot-card empty${sel ? " placeable" : ""}" title="${sel ? "點擊分配選中的料理" : "空槽"}" onclick="assignDepartFood('${id}')">空</div>`;
    }
    return `<div class="food-assign-col">
      <div class="food-assign-name">${c.icon} ${name}</div>
      ${slotHtml}
    </div>`;
  }).join("");

  // ---- 魔藥攜帶區（只有在有魔藥或已分配時才顯示，避免第一層玩家看到空區塊）----
  let potionIds = Object.keys(gameState.craftedPotionInventory).filter((k) => {
    let e = gameState.craftedPotionInventory[k];
    return e && (e.normal > 0 || e.rare > 0);
  });
  let anyPotionAssigned = SHELTER_PARTY_IDS.some((id) => gameState.potionAssignment[id]);
  let potionSectionHtml = "";
  if (potionIds.length > 0 || anyPotionAssigned) {
    let pSel = window._departSelectedPotion;
    let pBackpack = [];
    potionIds.forEach((pid) => {
      let potion = POTIONS[pid];
      [false, true].forEach((rare) => {
        let count = departPotionAvailableCount(pid, rare);
        if (count <= 0) return;
        let isSel = pSel && pSel.potionId === pid && pSel.rare === rare;
        pBackpack.push(`<div class="food-pick-card${isSel ? " selected" : ""}" title="${potion.name}${rare ? "（稀有）" : ""}：${potionEffectDesc(potion, rare)}" onclick="selectDepartPotion('${pid}', ${rare})">
          <span class="food-pick-icon">${rare ? "✨" : potion.icon}</span>
          <span class="food-pick-label">${potion.name}${rare ? "（稀有）" : ""}</span>
          <span class="food-pick-count">x${count}</span>
        </div>`);
      });
    });
    let pBackpackHtml = pBackpack.length > 0 ? pBackpack.join("") : `<p class="dim">魔藥背包是空的。</p>`;
    let pRows = SHELTER_PARTY_IDS.map((id) => {
      let cc = CHARACTERS[id];
      let nm = id === "主角" ? (gameState.playerName || "你") : cc.name;
      let assigned = gameState.potionAssignment[id];
      let slot;
      if (assigned && POTIONS[assigned.potionId]) {
        let pd = POTIONS[assigned.potionId];
        slot = `<div class="relic-slot-card equipped" title="${pd.name}${assigned.rare ? "（稀有）" : ""}：${potionEffectDesc(pd, assigned.rare)}（點擊拆下回背包）" onclick="unassignDepartPotion('${id}')">
          <span class="relic-slot-icon">${assigned.rare ? "✨" : pd.icon}</span>
          <span class="relic-slot-name">${pd.name}${assigned.rare ? "（稀有）" : ""}</span>
        </div>`;
      } else {
        slot = `<div class="relic-slot-card empty${pSel ? " placeable" : ""}" title="${pSel ? "點擊分配選中的魔藥" : "空槽"}" onclick="assignDepartPotion('${id}')">空</div>`;
      }
      return `<div class="food-assign-col"><div class="food-assign-name">${cc.icon} ${nm}</div>${slot}</div>`;
    }).join("");
    potionSectionHtml = `
    <div class="card">
      <h3>🧪 魔藥背包</h3>
      <p class="dim">每人可帶 1 瓶魔藥（跟料理各自獨立）。戰鬥中使用不消耗回合。先點魔藥再點角色空槽分配。</p>
      <div class="food-pick-row">${pBackpackHtml}</div>
      <div class="food-assign-row" style="margin-top:10px;">${pRows}</div>
    </div>`;
  }

  showScreen(`
    <h2 class="screen-title">整備出發</h2>
    <p class="dim">出發前小隊會恢復到滿血滿狀態，技能次數也會全部回滿。</p>
    <div class="card">
      <strong>🧪 補血藥</strong>
      ${gameState.storyFlags.lRescued
        ? `<span class="dim">L 每次出發前都會幫你補滿（目前 ${gameState.potions} / ${POTION_MAX} 瓶，免費）。</span>`
        : `<span class="dim">目前 ${gameState.potions} / ${POTION_MAX} 瓶，每瓶 💎${POTION_REFILL_COST}</span>
      <div style="margin-top:8px;">
        <button class="action-btn" title="花費 💎${POTION_REFILL_COST} 補充1瓶" ${gameState.potions >= POTION_MAX || gameState.crystal < POTION_REFILL_COST ? "disabled" : ""} onclick="buyPotion(1, showDepartScreen)">+1 瓶</button>
        <button class="action-btn" title="花光潛晶把補血藥補到上限" ${gameState.potions >= POTION_MAX ? "disabled" : ""} onclick="buyPotion(POTION_MAX, showDepartScreen)">一鍵補滿</button>
      </div>`}
    </div>
    <div class="card">
      <h3>料理背包</h3>
      <p class="dim">先點一份料理選中，再點角色的空槽分配過去；點已分配的料理可以拆下回背包。</p>
      <div class="food-pick-row">${backpackHtml}</div>
    </div>
    <div class="card"><h3>隊員攜帶料理</h3><div class="food-assign-row">${rows}</div></div>
    ${potionSectionHtml}
    ${departLayerChoiceHtml()}
    <button class="action-btn secondary" onclick="showHomeScreen()">返回</button>
  `, { withTopbar: true });
}

// 出發圈層選擇：只有第一層時直接一顆出發鈕；解鎖第二層後用「下拉選單」選起點（會記住上次的選擇）。
// 選較深圈層＝略過前面層，下方即時顯示補償說明。
function departLayerChoiceHtml() {
  let unlocked = getUnlockedLayers();
  if (unlocked.length <= 1) {
    let meta = LAYERS_META[1] || { name: "", subtitle: "第一圈層" };
    return `<button class="action-btn" onclick="confirmDepart(1)">🚪 出發，深潛${meta.subtitle}：${meta.name}</button>`;
  }
  // 記住上次選的圈層；若沒紀錄或該層已不可選，退回第一個可選的
  let last = gameState.lastDepartLayer;
  if (!unlocked.includes(last)) last = unlocked[0];
  let selMeta = LAYERS_META[last] || { name: "", subtitle: `第${last}圈層` };
  let skipInfo = last > 1
    ? `<p class="dim">選 ${selMeta.subtitle}＝略過前 ${last - 1} 層：直接從這一層開始，但略過那些層的經驗、潛晶、食材都拿不到（不再有跳關補償）。</p>`
    : `<p class="dim">從第一層開始，完整拿到每一層的收穫。</p>`;
  let options = unlocked.map((ly) => {
    let meta = LAYERS_META[ly] || { name: "", subtitle: `第${ly}圈層` };
    return `<option value="${ly}"${ly === last ? " selected" : ""}>${meta.subtitle}：${meta.name}</option>`;
  }).join("");
  return `<div class="card">
    <h3>選擇出發的圈層</h3>
    <p class="dim">已打通的路線留下了捷徑，可以直接從較深的圈層出發。</p>
    <select id="depart-layer-select" class="depart-layer-select" onchange="onDepartLayerChange(this.value)">
      ${options}
    </select>
    ${skipInfo}
    <button class="action-btn" style="margin-top:12px;" onclick="confirmDepartFromSelect()">🚪 出發深潛</button>
  </div>`;
}

// 下拉選單改變：記住選擇並重繪（讓下方的略過補償說明跟著更新）
function onDepartLayerChange(val) {
  gameState.lastDepartLayer = parseInt(val, 10) || 1;
  showDepartScreen();
}

function confirmDepartFromSelect() {
  let sel = document.getElementById("depart-layer-select");
  let ly = sel ? (parseInt(sel.value, 10) || 1) : (gameState.lastDepartLayer || 1);
  confirmDepart(ly);
}

function selectDepartFood(dishId, rare) {
  if (departAvailableCount(dishId, rare) <= 0) return;
  let sel = window._departSelectedFood;
  window._departSelectedFood = (sel && sel.dishId === dishId && sel.rare === rare) ? null : { dishId, rare };
  showDepartScreen();
}

function assignDepartFood(charId) {
  let sel = window._departSelectedFood;
  if (!sel) return;
  gameState.foodAssignment[charId] = { dishId: sel.dishId, rare: sel.rare };
  window._departSelectedFood = null;
  showDepartScreen();
}

function unassignDepartFood(charId) {
  gameState.foodAssignment[charId] = null;
  showDepartScreen();
}

function selectDepartPotion(potionId, rare) {
  if (departPotionAvailableCount(potionId, rare) <= 0) return;
  let sel = window._departSelectedPotion;
  window._departSelectedPotion = (sel && sel.potionId === potionId && sel.rare === rare) ? null : { potionId, rare };
  showDepartScreen();
}
function assignDepartPotion(charId) {
  let sel = window._departSelectedPotion;
  if (!sel) return;
  gameState.potionAssignment[charId] = { potionId: sel.potionId, rare: sel.rare };
  window._departSelectedPotion = null;
  showDepartScreen();
}
function unassignDepartPotion(charId) {
  gameState.potionAssignment[charId] = null;
  showDepartScreen();
}

function confirmDepart(startLayer) {
  startLayer = startLayer || 1;
  gameState.lastDepartLayer = startLayer; // 記住這次選的圈層，下次出發預設帶出來
  let choice = gameState.foodAssignment || {};

  // 扣掉這次帶走的料理庫存（沒吃掉的話回避難所會還回來、分配也會繼續保留），一般/稀有各自扣自己的
  let foodChoice = {};
  SHELTER_PARTY_IDS.forEach((id) => {
    let f = choice[id];
    if (!f) { foodChoice[id] = null; return; }
    let e = gameState.cookedInventory[f.dishId];
    let have = e ? (f.rare ? e.rare : e.normal) : 0;
    if (have <= 0) { gameState.foodAssignment[id] = null; foodChoice[id] = null; return; }
    if (f.rare) e.rare--; else e.normal--;
    foodChoice[id] = { dishId: f.dishId, rare: f.rare };
  });

  // 扣掉這次帶走的魔藥庫存（沒用掉回程會還回來、分配也會保留）
  let potionChoice = {};
  SHELTER_PARTY_IDS.forEach((id) => {
    let f = gameState.potionAssignment[id];
    if (!f || !POTIONS[f.potionId]) { gameState.potionAssignment[id] = null; potionChoice[id] = null; return; }
    let e = gameState.craftedPotionInventory[f.potionId];
    let have = e ? (f.rare ? e.rare : e.normal) : 0;
    if (have <= 0) { gameState.potionAssignment[id] = null; potionChoice[id] = null; return; }
    if (f.rare) e.rare--; else e.normal--;
    potionChoice[id] = { potionId: f.potionId, rare: f.rare };
  });

  window._departSelectedFood = null;
  window._departSelectedPotion = null;
  startNewDive(foodChoice, potionChoice, startLayer);
}

// ---- 魔藥間（工坊內，L 救出後解鎖）：用藥材製作魔藥 ----

function potionEffectDesc(potion, rare) {
  let e = potion.effect;
  if (e.type === "throw-damage") { let r = rare ? e.rareDmgRange : e.dmgRange; return `全體敵人受 ${r[0]}~${r[1]} 傷害${e.poison ? "並中毒" : ""}`; }
  if (e.type === "self-shield") { return `自身護盾 ${rare ? e.rareShield : e.shield} 點`; }
  return "";
}

function craftedPotionInvHtml() {
  let items = Object.keys(gameState.craftedPotionInventory).map((pid) => {
    let inv = gameState.craftedPotionInventory[pid];
    let p = POTIONS[pid];
    if (!p || !inv || (inv.normal <= 0 && inv.rare <= 0)) return "";
    let parts = [];
    if (inv.normal > 0) parts.push(`${p.name} x${inv.normal}`);
    if (inv.rare > 0) parts.push(`稀有${p.name} x${inv.rare}`);
    return `<div class="dim">${p.icon} ${parts.join("、")}</div>`;
  }).filter(Boolean).join("");
  return items || `<p class="dim">還沒有魔藥。</p>`;
}

function showPotionCraftScreen() {
  if (!gameState.storyFlags.lRescued) { showWorkshopScreen(); return; }
  // 只列出「手上有藥材、現在做得出來」的魔藥（比照煮飯畫面），沒材料的不顯示，避免提前劇透還沒解鎖的魔藥內容。
  let craftable = Object.keys(HERBS).filter((hid) => {
    let inv = gameState.rawHerbInventory[hid];
    return inv && (inv.normal > 0 || inv.rare > 0);
  });
  let rows = craftable.length === 0
    ? `<p class="dim">目前沒有藥材。第二層的刺螯、膜翼等生物身上有機會採到，帶回來 L 就能製藥。</p>`
    : craftable.map((hid) => {
        let herb = HERBS[hid];
        let inv = gameState.rawHerbInventory[hid] || { normal: 0, rare: 0 };
        let potion = POTIONS[herb.potionId];
        return `<div class="menu-item" style="cursor:default;">
          <strong>${potion.icon} ${potion.name}</strong> <span class="dim">← ${herb.name}</span>
          <div class="dim">${potion.desc}</div>
          <div class="dim">一般：${potionEffectDesc(potion, false)}｜稀有：${potionEffectDesc(potion, true)}</div>
          <div style="margin-top:8px;">
            <button class="action-btn" ${inv.normal > 0 ? "" : "disabled"} onclick="craftPotion('${hid}', false)">製作（藥材 ${inv.normal}）</button>
            <button class="action-btn" ${inv.rare > 0 ? "" : "disabled"} onclick="craftPotion('${hid}', true)">製作稀有（藥材 ${inv.rare}）</button>
          </div>
        </div>`;
      }).join("");
  showScreen(`
    <h2 class="screen-title">魔藥間</h2>
    <p class="dim">L 在工作檯前擺弄著藥材。「來，把藥材給我，我幫你製成魔藥。戰鬥中用得上。」</p>
    <div class="card">${rows}</div>
    <div class="card"><h3>目前的魔藥</h3>${craftedPotionInvHtml()}</div>
    <button class="action-btn secondary" onclick="showWorkshopScreen()">返回工坊</button>
  `, { withTopbar: true });
}

function craftPotion(herbId, rare) {
  let herb = HERBS[herbId];
  let inv = gameState.rawHerbInventory[herbId];
  if (!inv || (rare ? inv.rare : inv.normal) <= 0) return;
  if (rare) inv.rare--; else inv.normal--;
  let pid = herb.potionId;
  if (!gameState.craftedPotionInventory[pid]) gameState.craftedPotionInventory[pid] = { normal: 0, rare: 0 };
  if (rare) gameState.craftedPotionInventory[pid].rare++; else gameState.craftedPotionInventory[pid].normal++;
  gameState.discoveredPotions[pid] = true; // 圖鑑：製作過就永久記錄
  systemToast(`🧪 製作了 ${rare ? "稀有" : ""}${POTIONS[pid].name}。`);
  showPotionCraftScreen();
}

// ---- 回避難所結算（由 05_深潛.js 在出征結束時呼叫；此時 activeDive 還沒清空） ----
// 潛晶是即時累加到 gameState.crystal 的（深潛中HUD要能即時顯示、代價交換節點也要能即時花），
// 全滅只是事後「把這趟賺到的部分扣掉一半」，不是延遲到回避難所才入帳。

function applyShelterReturn(resultType) {
  let earned = (activeDive && activeDive.crystalEarnedThisRun) || 0;
  if (resultType === "wipe") {
    let loss = Math.floor(earned * (1 - WIPE_CRYSTAL_KEEP_PERCENT));
    gameState.crystal = Math.max(0, gameState.crystal - loss);
    gameState.stats.wipes++;
  }

  // 沒吃掉的攜帶料理還回背包
  let party = (activeDive && activeDive.party) || {};
  Object.keys(party).forEach((id) => {
    let food = party[id].carriedFood;
    if (food) {
      if (!gameState.cookedInventory[food.dishId]) gameState.cookedInventory[food.dishId] = { normal: 0, rare: 0 };
      if (food.rare) gameState.cookedInventory[food.dishId].rare++;
      else gameState.cookedInventory[food.dishId].normal++;
    }
    // 沒用掉的攜帶魔藥也還回背包
    let potion = party[id].carriedPotion;
    if (potion && POTIONS[potion.potionId]) {
      if (!gameState.craftedPotionInventory[potion.potionId]) gameState.craftedPotionInventory[potion.potionId] = { normal: 0, rare: 0 };
      if (potion.rare) gameState.craftedPotionInventory[potion.potionId].rare++;
      else gameState.craftedPotionInventory[potion.potionId].normal++;
    }
  });

  // 維護費
  if (gameState.crystal >= SHELTER_MAINTENANCE_FEE) {
    gameState.crystal -= SHELTER_MAINTENANCE_FEE;
    gameState.workshopSuspended = false;
  } else {
    gameState.crystal = 0;
    gameState.workshopSuspended = true;
  }

  activeDive = null;

  let msg = resultType === "boss" ? "🏴‍☠️ 擊敗 Boss，滿載而歸。"
    : resultType === "wipe" ? "❄️ 全隊倒下，被冰涼的東西捲走了一半收穫，你們爬回了避難所。"
    : "🚪 主動撤退，安全帶回了收穫。";
  systemToast(msg, resultType === "wipe");
  if (gameState.workshopSuspended) systemToast("⚠️ 維護費不夠，工坊暫時停擺。", true);

  showShelterScreen();
}
