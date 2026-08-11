// ========================================
// 潛淵 - 深潛（探索）畫面
// 節點圖選路、非戰鬥事件解析、深潛中的操作(藥水/料理/撤回)
// 戰鬥本身交給 06_戰鬥.js 的 startBattle()，這裡只負責觸發戰鬥與處理戰鬥結果
// ========================================

function displayName(charId) {
  return charId === "主角" ? (gameState.playerName || "你") : CHARACTERS[charId].name;
}

function getCharacterColor(charId) {
  return charId === "主角" ? gameState.playerColor : CHARACTERS[charId].color;
}

function addRunCrystal(amount) {
  gameState.crystal += amount;
  if (activeDive) activeDive.crystalEarnedThisRun += amount;
}

function addExp(charId, amount) {
  let c = gameState.characters[charId];
  c.exp += amount;
  while (c.level < LEVEL_CAP && c.exp >= getExpNeeded(c.level)) {
    c.exp -= getExpNeeded(c.level);
    c.level++;
    systemToast(`🎉 ${displayName(charId)} 升到 ${c.level} 級！`);
  }
}

function addRawFood(foodId, rare) {
  if (!gameState.rawFoodInventory[foodId]) gameState.rawFoodInventory[foodId] = { normal: 0, rare: 0 };
  if (rare) gameState.rawFoodInventory[foodId].rare++;
  else gameState.rawFoodInventory[foodId].normal++;
}

// ---------- 出發：初始化 activeDive ----------

function startNewDive(foodChoice) {
  let party = {};
  SHELTER_PARTY_IDS.forEach((id) => {
    let maxHp = getCharacterMaxHp(id);
    let uses = {};
    gameState.equippedSkills[id].forEach((skillId) => { if (isSkillUnlocked(id, skillId)) uses[skillId] = SKILLS[skillId].maxUses; });
    let carried = foodChoice ? foodChoice[id] : null; // {dishId, rare} | null，已在 confirmDepart 扣過庫存
    party[id] = {
      hp: maxHp, maxHp,
      fallen: false,
      skillUses: uses,
      bleedStacks: 0, bleedDuration: 0,
      hotHealPerTurn: 0, hotDuration: 0,
      guardActive: false,
      chargeReady: false,
      stunnedNextTurn: false,
      shield: 0,
      dmgBuffNextAttack: 0, // K_輕靈：下次攻擊傷害+%，消耗於該角色下次造成傷害時
      chargeMultiplier: 1, // V_蓄力：下次任意攻擊傷害×N，消耗於該角色下次造成傷害時
      dodgeBuffThisTurn: 0, // V_隱步：施放的那個回合閃避率+%，下回合開始重置
      damageReduction: 0, damageReductionDuration: 0, // L_冰盾：減傷%，持續N回合
      relics: [],
      carriedFood: carried,
      critBuffNextBattle: 0,
      multiBattleCritBonus: 0, // 代價交換「犧牲換爆擊率」用，持續多場戰鬥
      multiBattleCritRemaining: 0,
      foodBuffActive: null,
    };
  });

  activeDive = {
    layer: 1,
    nodeIndex: 0,
    restUsed: false,
    crystalEarnedThisRun: 0,
    globalBuffs: [],
    nextBattleDmgDebuff: 0,
    nextBattleDmgBonus: 0, // 休息點「養精蓄銳」的專注buff：下場戰鬥傷害+10%
    shopOffer: null, // 商店這次進來時抽到的商品，離開後清空
    relicBackpack: [], // 還沒裝備的遺物，用「遺物管理」畫面分配到角色身上
    relicManagementSelected: null, // 目前選中準備裝備的背包遺物id
    party,
  };

  systemToast("整裝完畢，出發深潛。");

  if (!gameState.storyFlags.firstDiveStarted) {
    gameState.storyFlags.firstDiveStarted = true;
    playDialogue([{ speaker: "K", text: "走吧。注意腳下，這裡什麼都有可能冒出來。" }], renderDiveScreen);
  } else {
    renderDiveScreen();
  }
}

// ---------- 畫面渲染 ----------

function diveHudHtml() {
  return SHELTER_PARTY_IDS.map((id) => {
    let m = activeDive.party[id];
    let c = CHARACTERS[id];
    let foodIcon = m.carriedFood ? "🍲" : "🍽️";
    let foodTitle = "沒有攜帶料理";
    if (m.carriedFood) {
      let foodDef = Object.values(FOODS).find((f) => f.dishId === m.carriedFood.dishId);
      let value = foodDef ? (m.carriedFood.rare ? foodDef.buff.rareValue : foodDef.buff.value) : 0;
      let buffDesc = foodDef ? foodBuffDescForDisplay(foodDef.buff.type, value) : "";
      foodTitle = `攜帶：${m.carriedFood.dishId}${m.carriedFood.rare ? "（稀有）" : ""}，效果：${buffDesc}`;
    }
    let bleedHtml = "";
    if (m.bleedStacks > 0) {
      let dmgPerTick = m.bleedStacks * BLEED_DAMAGE_PER_STACK;
      bleedHtml = ` <span title="流血：每回合受到${dmgPerTick}點傷害，剩${m.bleedDuration}回合">🩸x${m.bleedStacks}</span>`;
    }
    let critMarkHtml = m.multiBattleCritRemaining > 0
      ? `<span title="爆擊率+${Math.round(m.multiBattleCritBonus * 100)}%，剩${m.multiBattleCritRemaining}場戰鬥">🎯x${m.multiBattleCritRemaining}</span> `
      : "";
    return `<div class="dive-hud-member${m.fallen ? " fallen" : ""}" style="--char-color:${getCharacterColor(id)};">
      <div class="dive-hud-name">${c.icon} ${displayName(id)}</div>
      <div class="dim">${critMarkHtml}</div>
      <div class="bar-track"><div class="bar-fill hp-fill${m.hp <= m.maxHp / 2 ? " hp-low" : ""}" style="width:${(m.hp / m.maxHp) * 100}%;"></div></div>
      <div class="hp-text">${m.hp}/${m.maxHp}</div>
      <div class="dive-hud-icons"><span title="${foodTitle}">${foodIcon}</span>${bleedHtml}</div>
    </div>`;
  }).join("");
}

function diveEffectsHtml() {
  let icons = activeDive.globalBuffs.map((id) => {
    let b = GLOBAL_BUFFS.find((x) => x.id === id);
    return `<span class="dive-effect-icon" title="${b.desc}">✨ ${b.name}</span>`;
  });
  let relicIcons = [];
  if (activeDive.relicBackpack.length > 0) {
    let names = activeDive.relicBackpack.map((rid) => RELICS.find((r) => r.id === rid).name).join("、");
    relicIcons.push(`<span class="dive-effect-icon" title="背包裡還沒裝備的遺物：${names}">🎒 遺物背包 x${activeDive.relicBackpack.length}</span>`);
  }
  return icons.concat(relicIcons).join("");
}

function renderDiveScreen() {
  let nodeIndex = activeDive.nodeIndex;

  // Boss門前(第10格)第一次抵達時，讓K先講一段話，玩家可以在那之後自由整備再進去
  // 用gameState.storyFlags(整個存檔只播一次)而不是activeDive(每趟深潛都會重置)，
  // 不然玩家全滅或撤退後重新出征、再次走到第10格，這段劇情會重複播放。
  if (nodeIndex === LAYER1_DEPTH - 1 && !gameState.storyFlags.bossDoorShown) {
    gameState.storyFlags.bossDoorShown = true;
    playDialogue([
      { speaker: "K", text: "等一下。" },
      { speaker: "", text: "K 的表情嚴肅起來。" },
      { speaker: "K", text: "前面……感覺不對。很大。" },
      { speaker: "K", text: "V。" },
      { speaker: "", text: "V 點了一下頭。" },
      { speaker: "K", text: "有東西堵在前面。我不確定那是什麼——但 L 失蹤的那個坑，就在這附近。" },
      { speaker: "K", text: "如果 L 還在裡面，我們必須過去。" },
      { speaker: "K", text: `${displayName("主角")}，準備好了就走吧。藥水記得留著。` },
    ], renderDiveScreen);
    return;
  }

  // 第一次以完整隊伍面對選路時的教學提示
  let forkHintHtml = "";
  if (nodeIndex === 0 && !gameState.storyFlags.forkHintShown) {
    gameState.storyFlags.forkHintShown = true;
    forkHintHtml = `<p class="dim" style="text-align:center;">前方的路分開了。圖示代表可能遭遇的事物，但在親眼見到之前，你不會知道具體是什麼。</p>`;
  }

  let config = LAYER1_NODE_CONFIG[nodeIndex];

  let optionsHtml = config.options.map((type) => {
    let discovered = gameState.discoveredNodeTypes[type];
    let icon = NODE_ICONS[type];
    let label = discovered ? NODE_NAMES[type] : "？？？";
    if (type === "boss") label = "(......)"; // Boss節點固定顯示
    return `<button class="node-btn" onclick="chooseNode('${type}')">
      <span class="node-icon">${icon}</span>
      <span class="node-label">${label}</span>
    </button>`;
  }).join("");

  showScreen(`
    <h2 class="screen-title">深潛 · 圈層 ${activeDive.layer}</h2>
    <div class="dive-progress">第 ${nodeIndex + 1} / ${LAYER1_DEPTH} 格</div>
    <div class="dive-hud">${diveHudHtml()}</div>
    <div class="dive-effects-row">${diveEffectsHtml()}</div>
    ${forkHintHtml}
    <div class="node-path">${optionsHtml}</div>
    <div class="dive-actions">
      <button class="action-btn" onclick="usePotionAction()">🧪 使用藥水</button>
      <button class="action-btn" onclick="eatFoodAction()">🍲 食用料理</button>
      <button class="action-btn" onclick="showRelicManagementScreen()">🔸 遺物管理</button>
      <button class="action-btn danger" onclick="retreatAction()">🚪 撤回避難所</button>
    </div>
  `, { withTopbar: true });
}

function afterNodeContentResolved() {
  activeDive.nodeIndex++;
  renderDiveScreen();
}

// ---------- 節點分派 ----------

function chooseNode(nodeType) {
  gameState.discoveredNodeTypes[nodeType] = true;

  if (nodeType === "monster" || nodeType === "elite") return resolveMonsterNode(nodeType);
  if (nodeType === "boss") return resolveBossNode();
  if (nodeType === "rest") return resolveRestNode();
  if (nodeType === "oddity") return resolveOddityNode();
  if (nodeType === "cost_exchange") return resolveCostExchangeNode();
  if (nodeType === "event") return resolveEventNode();
  if (nodeType === "treasure") return resolveTreasureNode();
  if (nodeType === "shop") return resolveShopNode();
}

// ---------- 戰鬥節點 ----------

// 隨機決定2或3隻，從四種小怪(凝膠/藍顎獸/翅鱗/眼藻)中不重複抽選
function generateRandomMonsterGroup() {
  let count = randInt(2, 3);
  let pool = LAYER1_MONSTER_POOL.slice();
  let group = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    let idx = randInt(0, pool.length - 1);
    group.push(pool.splice(idx, 1)[0]);
  }
  if (chance(MIMIC_AMBUSH_CHANCE)) group.push("寶箱怪"); // 額外混入，不佔原本2~3隻的名額
  return group;
}

function resolveMonsterNode(nodeType) {
  let group = nodeType === "elite" ? pickRandom(ENEMY_GROUPS_LAYER1.菁英) : generateRandomMonsterGroup();

  let launch = () => startBattle(group, { isElite: nodeType === "elite", allowFlee: true, rewardMult: 1, onResult: handleNodeBattleResult });

  // 第一次遇到「已經打過的怪物種類」時，提示一次意圖圖示怎麼看
  if (!gameState.storyFlags.intentHintShown && group.some((mid) => gameState.bestiary[mid])) {
    gameState.storyFlags.intentHintShown = true;
    playDialogue([{ speaker: "", text: "你見過這種生物。它的意圖會以圖示顯示在它頭上。⚔️ = 攻擊、☠️ = 異常、🌀 = 蓄力(這回合不會動)、❓ = 其他。" }], launch);
    return;
  }
  launch();
}

function resolveBossNode() {
  playDialogue([
    { speaker: "", text: "水面下的巨影緩緩移動著，發出低沉的共鳴。" },
    { speaker: "K", text: "那就是……" },
    { speaker: "", text: "V 握緊了匕首。" },
  ], () => {
    startBattle(["島鯨"], { isBoss: true, allowFlee: false, rewardMult: 1, onResult: handleBossBattleResult });
  });
}

function handleNodeBattleResult(result) {
  if (result.outcome === "win") {
    applyBattleRewards(result);
    afterNodeContentResolved();
  } else if (result.outcome === "flee") {
    systemToast("🏃 逃跑成功，退回原路。");
    renderDiveScreen();
  } else if (result.outcome === "wipe") {
    applyShelterReturn("wipe");
  }
}

function handleBossBattleResult(result) {
  if (result.outcome === "win") {
    applyBattleRewards(result);
    handleBossVictory();
  } else if (result.outcome === "wipe") {
    applyShelterReturn("wipe");
  }
}

function handleBossVictory() {
  let isFirstClear = !gameState.storyFlags.lRescued;
  gameState.storyFlags.firstLayerCleared = true;
  gameState.storyFlags.lRescued = true;
  syncLRoster(); // L正式入隊：往SHELTER_PARTY_IDS/PARTY_ORDER_LAYER1補上"L"

  if (!isFirstClear) {
    // 救L的劇情只在第一次打贏島鯨時播放，之後重打Boss就不重複了
    applyShelterReturn("boss");
    return;
  }

  playDialogue([
    { speaker: "", text: "島鯨龐大的身軀漸漸沉入水底，不再動彈。" },
    { speaker: "", text: "水面下傳出微弱的動靜——是被吞下去的 L，暈乎乎的，但還活著。" },
    { speaker: "K", text: "……找到了。終於找到了。" },
  ], () => applyShelterReturn("boss"));
}

// 作弊：直接跳到「第一圈層已通關、L已救出入隊」的狀態，不用真的走10格打Boss
function cheatCompleteLayer1() {
  closeGenericModal();
  dialogueQueue = [];
  dialogueOnComplete = null;
  document.getElementById("dialogue-overlay").classList.add("hidden");
  activeDive = null;

  if (!gameState.storyFlags.introDone) {
    gameState.bestiary.凝膠 = true;
    gameState.storyFlags.introDone = true;
    gameState.potions = 3;
  }
  // 既然直接跳到「已通關」，第一圈層路上那些只播一次的劇情/教學提示也要一併標記成看過，
  // 不然之後玩家真的出征時，會在L已經入隊的狀態下又看到「K的第一次出征開場白」「岔路/意圖教學」，
  // 甚至Boss門前那段「不確定L還在不在裡面」的劇情——跟已經救出來的現況矛盾，很奇怪。
  gameState.storyFlags.firstDiveStarted = true;
  gameState.storyFlags.forkHintShown = true;
  gameState.storyFlags.intentHintShown = true;
  gameState.storyFlags.bossDoorShown = true;
  gameState.storyFlags.firstLayerCleared = true;
  gameState.storyFlags.lRescued = true;
  syncLRoster();
  showShelterScreen();
  systemToast("已通關第一圈層，L已加入隊伍。");
}

function applyBattleRewards(result) {
  addRunCrystal(result.crystalEarned);
  let fallenIds = result.fallenIds || [];
  SHELTER_PARTY_IDS.forEach((id) => {
    let exp = fallenIds.includes(id) ? Math.round(result.expEarned * 0.5) : result.expEarned;
    addExp(id, exp);
  });
  (result.foodDrops || []).forEach((drop) => addRawFood(drop.foodId, drop.rare));
  let foodMsg = result.foodDropsText ? `、${result.foodDropsText}` : "";
  let fallenMsg = fallenIds.length > 0 ? `（${fallenIds.map(displayName).join("、")}這場中途倒地過，經驗只拿一半）` : "";
  systemToast(`⚔️ 戰鬥勝利！獲得 💎${result.crystalEarned}、經驗 ${result.expEarned}${foodMsg}${fallenMsg}`);
}

// ---------- 休息點 ⛺ ----------

// 補丁v1修改2：休息點改成雙選項——處理傷口(回血) vs 養精蓄銳(下場戰鬥傷害+10%，跟其他增傷疊加不相乘)
const REST_FOCUS_DMG_BONUS = 0.10;

function resolveRestNode() {
  playDialogue([{
    speaker: "K", text: activeDive.restUsed ? "再喘口氣吧。要先處理傷口，還是養精蓄銳？" : "稍微喘口氣吧。要先處理傷口，還是養精蓄銳？",
    choices: [
      { label: `處理傷口 — 全隊回復 ${Math.round(REST_HEAL_PERCENT * 100)}% 血量`, onSelect: () => {
        activeDive.restUsed = true;
        healAllPercent(REST_HEAL_PERCENT);
        systemToast(`⛺ 全隊回復了 ${Math.round(REST_HEAL_PERCENT * 100)}% 血量。`);
        afterNodeContentResolved();
      } },
      { label: `養精蓄銳 — 下場戰鬥傷害 +${Math.round(REST_FOCUS_DMG_BONUS * 100)}%`, onSelect: () => {
        activeDive.restUsed = true;
        activeDive.nextBattleDmgBonus += REST_FOCUS_DMG_BONUS;
        systemToast(`⛺ 全隊進入「專注」狀態，下場戰鬥傷害提升。`);
        afterNodeContentResolved();
      } },
    ],
  }], () => {});
}

// ---------- 奇異地形 🔮 ----------

function resolveOddityNode() {
  let entry = pickRandom(ODDITY_EVENTS);
  let choices = buildOptionChoices(entry.options, afterNodeContentResolved);
  choices.push({ label: "跳過", onSelect: () => afterNodeContentResolved() });
  playDialogue([{ speaker: entry.name, text: entry.desc, choices }], () => {});
}

// ---------- 代價交換 ♻️ ----------

function getFeasibleCostExchangeOptions() {
  return COST_EXCHANGE_OPTIONS.filter((opt) => {
    if (opt.effect.type === "trade-food-for-crystal") {
      return SHELTER_PARTY_IDS.some((id) => activeDive.party[id].carriedFood);
    }
    if (opt.effect.type === "trade-potions-for-dmg-buff") {
      return gameState.potions >= opt.effect.potionCost;
    }
    if (opt.effect.type === "pay-crystal-for-relic-choice") {
      let owned = getOwnedRelicIdsThisRun();
      return RELICS.some((r) => !owned.includes(r.id));
    }
    return true;
  });
}

function resolveCostExchangeNode() {
  let pool = getFeasibleCostExchangeOptions();
  let picked = [];
  pool = pool.slice();
  while (picked.length < 2 && pool.length > 0) {
    let idx = randInt(0, pool.length - 1);
    picked.push(pool.splice(idx, 1)[0]);
  }
  let choices = picked.map((opt) => ({
    label: opt.label,
    onSelect: () => applyDiveEffect(opt.effect, afterNodeContentResolved),
  }));
  choices.push({ label: "都不選", onSelect: () => afterNodeContentResolved() });
  playDialogue([{ speaker: "代價交換", text: "眼前出現了幾個奇怪的選項。", choices }], () => {});
}

// ---------- 隨機事件 ❔ ----------

// 補丁v1修改5：隨機事件全面重做成10種，6個有選擇+4個無選擇；寶箱怪事件另外走專屬流程
function resolveEventNode() {
  let entry = pickRandom(RANDOM_EVENTS);
  if (entry.isMimic) { resolveMimicEvent(entry); return; }
  if (entry.options) {
    let choices = buildOptionChoices(entry.options, afterNodeContentResolved);
    playDialogue([{ speaker: entry.name, text: entry.desc, choices }], () => {});
    return;
  }
  playDialogue([{ speaker: entry.name, text: entry.desc }], () => {
    applyDiveEffect(entry.effect, afterNodeContentResolved);
  });
}

// 寶箱怪：血量18、天生常駐50%閃避，第1回合會攻擊一次(⚔️)，第2回合開始時自動逃走消失(沒有獎勵)
function resolveMimicEvent(entry) {
  playDialogue([{ speaker: entry.name, text: entry.desc }], () => {
    startBattle(["寶箱怪"], {
      allowFlee: true, suppressRewards: true,
      onResult: (result) => {
        if (result.outcome === "win") {
          grantRandomRelic(() => {
            playDialogue([{ speaker: "K", text: "還好動作夠快。" }], afterNodeContentResolved);
          });
        } else if (result.outcome === "escaped" || result.outcome === "flee") {
          playDialogue([{ speaker: "K", text: "跑了……下次手腳快點。" }], afterNodeContentResolved);
        } else if (result.outcome === "wipe") {
          applyShelterReturn("wipe");
        }
      },
    });
  });
}

// ---------- 寶藏 🪎 ----------

// 補丁v1修改7：先秀出具體是哪個遺物、什麼效果，玩家在「拿走遺物」跟「拿走潛晶」之間二選一，不是盲盒
function resolveTreasureNode() {
  let owned = getOwnedRelicIdsThisRun();
  let available = RELICS.filter((r) => !owned.includes(r.id));
  let crystalAmount = randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]);

  let choices = [];
  if (available.length > 0) {
    let relic = pickRandom(available);
    choices.push({ label: `拿走遺物：${relic.name}（${relic.desc}）`, onSelect: () => {
      activeDive.relicBackpack.push(relic.id);
      systemToast(`🔸 獲得遺物：${relic.name}，收進了遺物背包。`);
      afterNodeContentResolved();
    } });
  }
  choices.push({ label: `拿走潛晶（💎${crystalAmount}）`, onSelect: () => {
    addRunCrystal(crystalAmount);
    afterNodeContentResolved();
  } });

  playDialogue([{ speaker: "寶藏", text: "前方有被遺留下來的東西。", choices }], () => {});
}

// ---------- 商人 💰（補丁v1修改3：第一圈層也有商店） ----------

function resolveShopNode() {
  if (activeDive.shopLooted) {
    playDialogue([{ speaker: "", text: "這裡的角落空蕩蕩的，什麼也沒有留下。" }], afterNodeContentResolved);
    return;
  }
  if (!activeDive.shopOffer) {
    let foodDef = pickRandom(Object.values(FOODS));
    let owned = getOwnedRelicIdsThisRun();
    let pool = RELICS.filter((r) => !owned.includes(r.id));
    let relicIds = [];
    for (let i = 0; i < 2 && pool.length > 0; i++) {
      let idx = randInt(0, pool.length - 1);
      relicIds.push(pool.splice(idx, 1)[0].id);
    }
    activeDive.shopOffer = { foodDishId: foodDef.dishId, relicIds };
  }
  playDialogue([{ speaker: "", text: "角落堆著一些東西，看起來是之前經過的人留下的。旁邊放著幾顆潛晶，像是某種交換的規矩。" }], renderShopScreen);
}

function renderShopScreen() {
  let offer = activeDive.shopOffer;
  let foodDef = Object.values(FOODS).find((f) => f.dishId === offer.foodDishId);

  let foodRow = `<div class="menu-item" style="cursor:default;">
    <strong>🍲 ${offer.foodDishId}</strong>
    <div class="dim">${foodDef.flavorText}｜效果：${foodBuffDescForDisplay(foodDef.buff.type, foodDef.buff.value)}</div>
    <div class="dim">💎${SHOP_PRICES.food}</div>
    <button class="action-btn" title="效果：${foodBuffDescForDisplay(foodDef.buff.type, foodDef.buff.value)}" onclick="buyShopFood()">購買</button>
  </div>`;

  let relicRows = offer.relicIds.length > 0
    ? offer.relicIds.map((relicId) => {
        let r = RELICS.find((x) => x.id === relicId);
        return `<div class="menu-item" style="cursor:default;">
          <strong>🔸 ${r.name}</strong>
          <div class="dim">${r.desc}</div>
          <div class="dim">💎${SHOP_PRICES.relic}</div>
          <button class="action-btn" title="${r.desc}" onclick="buyShopRelic('${relicId}')">購買</button>
        </div>`;
      }).join("")
    : `<div class="menu-item" style="cursor:default;"><span class="dim">🔸 遺物已經賣完了。</span></div>`;

  showScreen(`
    <h2 class="screen-title">遺留物資</h2>
    <p class="dim">角落堆著一些物資，旁邊放著幾顆潛晶，像是以物易物的規矩。</p>
    <div class="card">${foodRow}${relicRows}</div>
    <button class="action-btn secondary" onclick="leaveShop()">繼續前進</button>
  `, { withTopbar: true });
}

function buyShopFood() {
  if (gameState.crystal < SHOP_PRICES.food) { handleShopAnger(); return; }
  gameState.crystal -= SHOP_PRICES.food;
  let dishId = activeDive.shopOffer.foodDishId;
  if (!gameState.cookedInventory[dishId]) gameState.cookedInventory[dishId] = { normal: 0, rare: 0 };
  gameState.cookedInventory[dishId].normal++;
  systemToast(`🍲 買了一份 ${dishId}。`);
  renderShopScreen();
}

function buyShopRelic(relicId) {
  let offer = activeDive.shopOffer;
  let idx = offer.relicIds.indexOf(relicId);
  if (idx === -1) return;
  if (gameState.crystal < SHOP_PRICES.relic) { handleShopAnger(); return; }
  gameState.crystal -= SHOP_PRICES.relic;
  activeDive.relicBackpack.push(relicId);
  let relic = RELICS.find((r) => r.id === relicId);
  systemToast(`🔸 買了遺物：${relic.name}，收進了遺物背包。`);
  offer.relicIds.splice(idx, 1);
  renderShopScreen();
}

function leaveShop() {
  activeDive.shopOffer = null;
  afterNodeContentResolved();
}

// 潛晶不夠還硬拿：第一次只是警告，第二次觸發隱藏戰鬥(四隻小怪各一隻、全部菁英化)
function handleShopAnger() {
  if (!activeDive.shopWarned) {
    activeDive.shopWarned = true;
    systemToast("你感覺到一股冰冷的氣息沿著脊椎爬上來。你縮回了手。");
    return;
  }
  activeDive.shopAngered = true;
  playDialogue([
    { speaker: "", text: "你再次伸手。這一次，冰冷的氣息變得清晰——某種存在在盯著你。你似乎惹怒了某種存在……" },
  ], startShopAmbushBattle);
}

function startShopAmbushBattle() {
  startBattle(["凝膠", "藍顎獸", "翅鱗", "眼藻"], {
    isElite: true, allowFlee: true, suppressRewards: true,
    onResult: (result) => {
      if (result.outcome === "win") {
        handleShopLoot();
      } else if (result.outcome === "wipe") {
        applyShelterReturn("wipe");
      } else {
        renderShopScreen();
      }
    },
  });
}

// 打贏偷襲後，這次商店剩下的東西(遺物+料理)全部免費拿走，之後這格就空了
function handleShopLoot() {
  let offer = activeDive.shopOffer;
  if (offer.relicId) activeDive.relicBackpack.push(offer.relicId);
  if (offer.foodDishId) {
    if (!gameState.cookedInventory[offer.foodDishId]) gameState.cookedInventory[offer.foodDishId] = { normal: 0, rare: 0 };
    gameState.cookedInventory[offer.foodDishId].normal++;
  }
  activeDive.shopOffer = null;
  activeDive.shopLooted = true;
  playDialogue([{ speaker: "", text: "那個冰冷的氣息消失了。角落的物資任你取用。" }], afterNodeContentResolved);
}

// ---------- 遺物背包（補丁v1：獲得遺物不當場分配，進遺物背包，玩家自己到「遺物管理」裝備） ----------

function getOwnedRelicIdsThisRun() {
  let owned = activeDive.relicBackpack.slice();
  SHELTER_PARTY_IDS.forEach((id) => owned.push(...activeDive.party[id].relics));
  return owned;
}

// 隨機抽一個這趟還沒拿過的遺物，直接放進背包（不用選人）
function grantRandomRelic(onDone) {
  onDone = onDone || function () {};
  let owned = getOwnedRelicIdsThisRun();
  let available = RELICS.filter((r) => !owned.includes(r.id));
  if (available.length === 0) {
    systemToast("你翻了翻，只找到一些潛晶。");
    addRunCrystal(randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]));
    onDone();
    return;
  }
  let relic = pickRandom(available);
  activeDive.relicBackpack.push(relic.id);
  systemToast(`🔸 獲得遺物：${relic.name}，收進了遺物背包。`);
  onDone();
}

function showRelicManagementScreen() {
  let selected = activeDive.relicManagementSelected;

  let backpackHtml = activeDive.relicBackpack.length === 0
    ? `<p class="dim">背包是空的。</p>`
    : activeDive.relicBackpack.map((rid) => {
        let r = RELICS.find((x) => x.id === rid);
        let isSelected = selected === rid;
        return `<div class="relic-slot-card${isSelected ? " selected" : ""}" title="${r.desc}" onclick="selectBackpackRelic('${rid}')">
          <span class="relic-slot-icon">🔸</span>
          <span class="relic-slot-name">${r.name}</span>
        </div>`;
      }).join("");

  let partyHtml = SHELTER_PARTY_IDS.map((id) => {
    let c = CHARACTERS[id];
    let m = activeDive.party[id];
    let slots = [];
    for (let i = 0; i < RELIC_MAX_PER_CHARACTER; i++) {
      let rid = m.relics[i];
      if (rid) {
        let r = RELICS.find((x) => x.id === rid);
        slots.push(`<div class="relic-slot-card equipped" title="${r.desc}（點擊拆下回背包）" onclick="unequipRelic('${id}', '${rid}')">
          <span class="relic-slot-icon">🔸</span>
          <span class="relic-slot-name">${r.name}</span>
        </div>`);
      } else {
        slots.push(`<div class="relic-slot-card empty${selected ? " placeable" : ""}" title="${selected ? "點擊裝備選中的遺物" : "空槽"}" onclick="equipSelectedRelic('${id}')">空</div>`);
      }
    }
    return `<div class="menu-item" style="cursor:default;">
      <strong>${c.icon} ${displayName(id)}</strong>
      <div class="relic-slot-row">${slots.join("")}</div>
    </div>`;
  }).join("");

  showScreen(`
    <h2 class="screen-title">遺物管理</h2>
    <p class="dim">點背包裡的遺物選中，再點角色的空槽裝備上去；點已裝備的遺物可以拆下回背包。</p>
    <div class="card">
      <h3>遺物背包</h3>
      <div class="relic-slot-row">${backpackHtml}</div>
    </div>
    <div class="card">${partyHtml}</div>
    <button class="action-btn secondary" onclick="renderDiveScreen()">返回</button>
  `, { withTopbar: true });
}

function selectBackpackRelic(relicId) {
  activeDive.relicManagementSelected = activeDive.relicManagementSelected === relicId ? null : relicId;
  showRelicManagementScreen();
}

function equipSelectedRelic(charId) {
  let relicId = activeDive.relicManagementSelected;
  if (!relicId) return;
  let m = activeDive.party[charId];
  if (m.relics.length >= RELIC_MAX_PER_CHARACTER) { systemToast("這個角色的遺物槽已經滿了。", true); return; }
  let idx = activeDive.relicBackpack.indexOf(relicId);
  if (idx === -1) return;
  activeDive.relicBackpack.splice(idx, 1);
  m.relics.push(relicId);
  activeDive.relicManagementSelected = null;
  showRelicManagementScreen();
}

function unequipRelic(charId, relicId) {
  let m = activeDive.party[charId];
  let idx = m.relics.indexOf(relicId);
  if (idx === -1) return;
  m.relics.splice(idx, 1);
  activeDive.relicBackpack.push(relicId);
  showRelicManagementScreen();
}

// 增益效果是全隊性的，加進globalBuffs後立即生效；「強韌體質」要當場把maxHp/hp都墊高
function grantGlobalBuff(buff) {
  activeDive.globalBuffs.push(buff.id);
  if (buff.id === "強韌體質") {
    SHELTER_PARTY_IDS.forEach((id) => {
      let m = activeDive.party[id];
      let bonus = Math.ceil(m.maxHp * buff.effect.value);
      m.maxHp += bonus;
      m.hp += bonus;
    });
  }
  systemToast(`✨ 獲得增益效果：${buff.name}`);
}

// ---------- 節點選項共用：帶劇情文字的機率結果、灰色不可選判斷 ----------
// 用在奇異地形／隨機事件的選項上。一個選項可以是：
//   { label, text, effect }                 純文字結果，直接套用效果
//   { label, outcomes: [{chance,text,effect}, ...] }  機率結果，每個結果各自的劇情文字
//   { label, requiresCarriedFood / requiresCrystal, upfrontCost }  可搭配上面兩種，用來灰掉選項或先扣代價

function pickWeightedOutcome(outcomes) {
  let roll = Math.random();
  let cumulative = 0;
  for (let i = 0; i < outcomes.length; i++) {
    cumulative += outcomes[i].chance;
    if (roll < cumulative) return outcomes[i];
  }
  return outcomes[outcomes.length - 1];
}

function isChoiceFeasible(opt) {
  if (opt.requiresCarriedFood && !SHELTER_PARTY_IDS.some((id) => activeDive.party[id].carriedFood)) return false;
  if (opt.requiresCrystal != null && gameState.crystal < opt.requiresCrystal) return false;
  return true;
}

function resolveChoiceOutcome(opt, onDone) {
  if (opt.upfrontCost && opt.upfrontCost.crystal) gameState.crystal -= opt.upfrontCost.crystal;
  if (opt.outcomes) {
    let outcome = pickWeightedOutcome(opt.outcomes);
    playDialogue([{ speaker: "", text: outcome.text }], () => applyDiveEffect(outcome.effect, onDone));
  } else if (opt.text) {
    playDialogue([{ speaker: "", text: opt.text }], () => applyDiveEffect(opt.effect, onDone));
  } else {
    applyDiveEffect(opt.effect, onDone);
  }
}

// 把 options 陣列轉成 playDialogue 的 choices，統一處理灰色/不可選
function buildOptionChoices(options, onDone) {
  let choices = options.map((opt) => ({
    label: opt.label,
    disabled: !isChoiceFeasible(opt),
    disabledReason: opt.requiresCarriedFood ? "沒有人攜帶料理" : opt.requiresCrystal != null ? "潛晶不夠" : "",
    onSelect: () => resolveChoiceOutcome(opt, onDone),
  }));
  return choices;
}

function pickPartyMemberFlow(promptText, onPicked, allowCancel) {
  let choices = SHELTER_PARTY_IDS.map((id) => ({
    label: `${CHARACTERS[id].icon} ${displayName(id)}`,
    onSelect: () => onPicked(id),
  }));
  if (allowCancel) choices.push({ label: "取消", onSelect: () => {} });
  playDialogue([{ speaker: "", text: promptText, choices }], () => {});
}

// ---------- 深潛效果解析 ----------

function healAllPercent(percent) {
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * percent));
  });
}
function damageAllPercent(percent) {
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    m.hp = Math.max(1, m.hp - Math.ceil(m.maxHp * percent)); // 深潛地圖上的非戰鬥傷害不會讓人陣亡
  });
}
function healAllFlat(value) {
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    m.hp = Math.min(m.maxHp, m.hp + value);
  });
}
function damageAllFlat(value) {
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    m.hp = Math.max(1, m.hp - value);
  });
}

// onDone 一定要在效果「真的完全解析完」才呼叫——如果效果內部會彈出巢狀對話框（例如選人），
// 一定要把 onDone 傳下去讓它在使用者選完之後才觸發，不能在對話框還開著的時候就提前呼叫，
// 不然呼叫端(afterNodeContentResolved)會在對話框還沒關掉時就把畫面切走，導致那個看不見的
// 對話框覆蓋層還留在最上層擋住後面所有點擊（風刃「有時候沒反應」的bug就是這樣來的）。
function applyDiveEffect(effect, onDone) {
  onDone = onDone || function () {};
  switch (effect.type) {
    case "chance": {
      let branch = chance(effect.chance) ? effect.success : effect.fail;
      applyDiveEffect(branch, onDone);
      return;
    }
    case "noop": break;
    case "forced-battle": {
      let rewardMult = effect.rewardMult != null ? effect.rewardMult : 1;
      startBattle(effect.group, {
        rewardMult, allowFlee: true, suppressRewards: !!effect.suppressRewards,
        onResult: (result) => {
          if (result.outcome === "win") { if (!effect.suppressRewards) applyBattleRewards(result); onDone(); }
          else if (result.outcome === "flee" || result.outcome === "escaped") { onDone(); }
          else if (result.outcome === "wipe") { applyShelterReturn("wipe"); }
        },
      });
      return;
    }
    case "compound": {
      let applyNext = (i) => {
        if (i >= effect.effects.length) { onDone(); return; }
        applyDiveEffect(effect.effects[i], () => applyNext(i + 1));
      };
      applyNext(0);
      return;
    }
    case "random-one-of":
      applyDiveEffect(pickRandom(effect.options), onDone);
      return;
    case "grant-relic":
      grantRandomRelic(onDone);
      return;
    case "damage-random-member-percent": {
      let id = pickRandom(SHELTER_PARTY_IDS);
      let m = activeDive.party[id];
      let dmg = Math.max(1, Math.round(m.hp * effect.value));
      m.hp = Math.max(1, m.hp - dmg);
      systemToast(`${displayName(id)} 損失了 ${dmg} 血。`, true);
      break;
    }
    case "heal-all-percent": healAllPercent(effect.value); systemToast(`全隊回復 ${Math.round(effect.value * 100)}% 血量。`); break;
    case "damage-all-percent": damageAllPercent(effect.value); systemToast(`全隊損失 ${Math.round(effect.value * 100)}% 血量。`, true); break;
    case "heal-all-flat": healAllFlat(effect.value); systemToast(`全隊回復 ${effect.value} 血。`); break;
    case "damage-all-flat": damageAllFlat(effect.value); systemToast(`全隊損失 ${effect.value} 血。`, true); break;
    case "damage-all-flat-and-relic":
      damageAllFlat(effect.value);
      systemToast(`全隊損失 ${effect.value} 血，但發現了東西。`, true);
      grantRandomRelic(onDone);
      return;
    case "find-crystal": {
      let v = randInt(effect.range[0], effect.range[1]);
      addRunCrystal(v);
      systemToast(`💎 找到了 ${v} 顆潛晶。`);
      break;
    }
    case "find-potion": {
      let v = randInt(effect.range[0], effect.range[1]);
      gameState.potions = clamp(gameState.potions + v, 0, POTION_MAX);
      systemToast(`🧪 找到了 ${v} 瓶藥水。`);
      break;
    }
    case "random-member-crit-buff": {
      let id = pickRandom(SHELTER_PARTY_IDS);
      activeDive.party[id].critBuffNextBattle = effect.value;
      systemToast(`${displayName(id)} 下場戰鬥爆擊率 +${Math.round(effect.value * 100)}%。`);
      break;
    }
    case "random-buff": {
      let owned = activeDive.globalBuffs;
      let available = GLOBAL_BUFFS.filter((b) => !owned.includes(b.id));
      if (available.length === 0) { systemToast("似乎沒有更多增益效果了。"); break; }
      grantGlobalBuff(pickRandom(available));
      break;
    }
    // 補丁v1修改4：嗡鳴晶簇改成3選1（增益效果本身是全隊性的，所以選完直接生效，不用再選角色）
    case "choose-one-of-three-buffs": {
      let owned = activeDive.globalBuffs;
      let available = GLOBAL_BUFFS.filter((b) => !owned.includes(b.id));
      if (available.length === 0) {
        systemToast("似乎沒有更多增益效果了，改成給你一些潛晶。");
        addRunCrystal(randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]));
        break;
      }
      let pool = available.slice();
      let offered = [];
      while (offered.length < 3 && pool.length > 0) offered.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
      let choices = offered.map((b) => ({
        label: `${b.name}（${b.desc}）`,
        onSelect: () => { grantGlobalBuff(b); onDone(); },
      }));
      playDialogue([{ speaker: "", text: "晶體的共鳴在你腦中激起了三道不同的回響。", choices }], () => {});
      return;
    }
    case "next-battle-dmg-debuff":
      activeDive.nextBattleDmgDebuff = effect.value;
      systemToast("下場戰鬥全隊傷害下降。", true);
      break;
    case "sacrifice-hp-for-relic":
      pickPartyMemberFlow("犧牲誰的 10% 當前血量來換取遺物？", (memberId) => {
        let m = activeDive.party[memberId];
        let dmg = Math.max(1, Math.round(m.hp * effect.value));
        m.hp = Math.max(1, m.hp - dmg);
        systemToast(`${displayName(memberId)} 損失了 ${dmg} 血。`, true);
        grantRandomRelic(onDone);
      });
      return;
    case "pay-crystal-for-heal":
      if (gameState.crystal >= effect.cost) {
        gameState.crystal -= effect.cost;
        healAllPercent(effect.healPercent);
        systemToast(`支付 💎${effect.cost}，全隊回復血量。`);
      } else {
        systemToast("潛晶不夠，無法交換。", true);
      }
      break;
    case "trade-food-for-crystal": {
      let candidates = SHELTER_PARTY_IDS.filter((id) => activeDive.party[id].carriedFood);
      if (candidates.length === 0) { systemToast("沒有攜帶中的料理可以交換。", true); break; }
      let doTrade = (memberId) => {
        activeDive.party[memberId].carriedFood = null;
        gameState.foodAssignment[memberId] = null;
        let v = randInt(effect.range[0], effect.range[1]);
        addRunCrystal(v);
        systemToast(`交出了料理，換到 💎${v}。`);
        onDone();
      };
      if (candidates.length === 1) doTrade(candidates[0]);
      else pickPartyMemberFlow("交出誰攜帶的料理？", doTrade);
      return;
    }
    case "trade-potions-for-dmg-buff":
      if (gameState.potions >= effect.potionCost) {
        gameState.potions -= effect.potionCost;
        activeDive.nextBattleDmgBonus += effect.value;
        systemToast(`獻上 🧪${effect.potionCost}，全隊進入「激昂」狀態，下場戰鬥傷害提升。`);
      } else {
        systemToast("藥水不夠，無法交換。", true);
      }
      break;
    case "pay-crystal-for-relic-choice": {
      if (gameState.crystal < effect.cost) { systemToast("潛晶不夠，無法交換。", true); break; }
      let owned = getOwnedRelicIdsThisRun();
      let available = RELICS.filter((r) => !owned.includes(r.id));
      if (available.length === 0) { systemToast("目前沒有更多遺物可以選了。", true); break; }
      gameState.crystal -= effect.cost;
      let pool = available.slice();
      let offered = [];
      while (offered.length < 3 && pool.length > 0) offered.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
      let choices = offered.map((r) => ({
        label: `${r.name}（${r.desc}）`,
        onSelect: () => {
          activeDive.relicBackpack.push(r.id);
          systemToast(`🔸 獲得遺物：${r.name}，收進了遺物背包。`);
          onDone();
        },
      }));
      playDialogue([{ speaker: "", text: "選一個帶走：", choices }], () => {});
      return;
    }
    case "sacrifice-hp-for-multi-battle-crit":
      pickPartyMemberFlow("犧牲誰的 20% 當前血量來換取爆擊率？", (memberId) => {
        let m = activeDive.party[memberId];
        let dmg = Math.max(1, Math.round(m.hp * effect.value));
        m.hp = Math.max(1, m.hp - dmg);
        m.multiBattleCritBonus = effect.critBonus;
        m.multiBattleCritRemaining = effect.battles;
        systemToast(`${displayName(memberId)} 損失了 ${dmg} 血，接下來 ${effect.battles} 場戰鬥爆擊率提升。`, true);
        onDone();
      });
      return;
    default:
      break;
  }
  onDone();
}

// ---------- 深潛中的非戰鬥操作 ----------

function usePotionAction() {
  if (gameState.potions <= 0) { systemToast("藥水用完了。", true); return; }
  pickPartyMemberFlow("誰要喝藥水？", (memberId) => {
    let m = activeDive.party[memberId];
    gameState.potions--;
    let healPercent = activeDive.globalBuffs.includes("藥效強化") ? 0.45 : POTION_HEAL_PERCENT;
    m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * healPercent));
    systemToast(`🧪 ${displayName(memberId)} 喝下藥水，回復了血量。`);
    renderDiveScreen();
  }, true);
}

function eatFoodAction() {
  let candidates = SHELTER_PARTY_IDS.filter((id) => activeDive.party[id].carriedFood);
  if (candidates.length === 0) { systemToast("目前沒有人攜帶料理。", true); return; }
  let choices = candidates.map((id) => {
    let food = activeDive.party[id].carriedFood;
    let foodDef = Object.values(FOODS).find((f) => f.dishId === food.dishId);
    return { label: `${displayName(id)}：${food.dishId}${food.rare ? "（稀有）" : ""}`, onSelect: () => {
      let m = activeDive.party[id];
      let value = foodDef ? (food.rare ? foodDef.buff.rareValue : foodDef.buff.value) : 0;
      m.foodBuffActive = foodDef ? { type: foodDef.buff.type, value } : null;
      m.carriedFood = null;
      gameState.foodAssignment[id] = null;
      if (foodDef && foodDef.buff.type === "maxhp-percent") {
        // 最大血量類的buff要立即生效（不是戰鬥中才判定），下場戰鬥結束時再還原
        let bonus = Math.ceil(m.maxHp * value);
        m.foodBuffActive.appliedMaxHpBonus = bonus;
        m.maxHp += bonus;
        m.hp += bonus;
      }
      systemToast(`${displayName(id)} 吃下了 ${food.dishId}，效果會持續到下場戰鬥結束。`);
      renderDiveScreen();
    } };
  });
  choices.push({ label: "取消", onSelect: () => {} });
  playDialogue([{ speaker: "", text: "誰要吃隨身攜帶的料理？", choices }], () => {});
}

function retreatAction() {
  playDialogue([{
    speaker: "", text: "確定要撤回避難所嗎？這次的收穫會保留下來。",
    choices: [
      { label: "撤回避難所", onSelect: () => applyShelterReturn("retreat") },
      { label: "繼續深潛", onSelect: () => {} },
    ],
  }], () => {});
}
