// ========================================
// 潛淵 - 深潛（探索）畫面
// 節點圖選路、非戰鬥事件解析、深潛中的操作(補血藥/料理/撤回)
// 戰鬥本身交給 06_戰鬥.js 的 startBattle()，這裡只負責觸發戰鬥與處理戰鬥結果
// ========================================

function displayName(charId) {
  return charId === "主角" ? (gameState.playerName || "你") : CHARACTERS[charId].name;
}

// ---------- 圈層工具（深潛系統依 activeDive.layer 取用對應的節點配置／怪物池／Boss） ----------
function getLayerConfig(layer) {
  return LAYER_NODE_CONFIGS[layer] || LAYER1_NODE_CONFIG;
}
function getLayerDepth(layer) {
  return getLayerConfig(layer).length;
}
function getLayerMonsterPool(layer) {
  return LAYER_MONSTER_POOLS[layer] || LAYER1_MONSTER_POOL;
}
function getLayerEliteGroups(layer) {
  return LAYER_ELITE_GROUPS[layer] || ENEMY_GROUPS_LAYER1;
}
function getLayerBoss(layer) {
  return LAYER_BOSS[layer] || "島鯨";
}
// 目前已解鎖、可作為出發起點的圈層清單。第一層永遠可選；通關第一層（救出 L）後解鎖第二層。
function getUnlockedLayers() {
  let layers = [1];
  if (gameState.storyFlags.firstLayerCleared) layers.push(2);
  return layers;
}

function getCharacterColor(charId) {
  return charId === "主角" ? gameState.playerColor : CHARACTERS[charId].color;
}

function addRunCrystal(amount) {
  gameState.crystal += amount;
  if (activeDive) activeDive.crystalEarnedThisRun += amount;
  gameState.stats.maxCrystalSeen = Math.max(gameState.stats.maxCrystalSeen, gameState.crystal); // 成就用：記錄潛晶峰值
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

function addRawHerb(herbId, rare) {
  if (!gameState.rawHerbInventory[herbId]) gameState.rawHerbInventory[herbId] = { normal: 0, rare: 0 };
  if (rare) gameState.rawHerbInventory[herbId].rare++;
  else gameState.rawHerbInventory[herbId].normal++;
}

// ---------- 出發：初始化 activeDive ----------

function startNewDive(foodChoice, potionChoice, startLayer) {
  startLayer = startLayer || 1;
  if (!getUnlockedLayers().includes(startLayer)) startLayer = 1; // 保險：沒解鎖的圈層一律退回第一層
  let party = {};
  SHELTER_PARTY_IDS.forEach((id) => {
    // 帶上這個角色永久裝著的遺物（新版遺物系統）；出戰才生效，就是把永久遺物複製進本趟戰鬥用的暫存隊伍。
    let charRelics = gameState.characters[id].relics.slice();
    let maxHp = getCharacterMaxHp(id);
    // 「最大血量+X%」類遺物在這裡一次墊高（等同永久裝備的加成），血量算好再開打。
    let hpBonus = relicSum({ relics: charRelics }, "maxhp-percent");
    if (hpBonus > 0) maxHp = Math.round(maxHp * (1 + hpBonus));
    let uses = {};
    gameState.equippedSkills[id].forEach((skillId) => { if (isSkillUnlocked(id, skillId)) uses[skillId] = SKILLS[skillId].maxUses; });
    let carried = foodChoice ? foodChoice[id] : null; // {dishId, rare} | null，已在 confirmDepart 扣過庫存
    let carriedPotionSel = potionChoice ? potionChoice[id] : null; // {potionId, rare} | null，已在 confirmDepart 扣過庫存
    party[id] = {
      hp: maxHp, maxHp,
      fallen: false,
      skillUses: uses,
      bleedStacks: 0, bleedDuration: 0,
      poisonDuration: 0,
      hotHealPerTurn: 0, hotDuration: 0,
      guardActive: false,
      chargeReady: false,
      stunTurns: 0,
      shield: 0,
      dmgBuffNextAttack: 0, // K_輕靈：下次攻擊傷害+%，消耗於該角色下次造成傷害時
      chargeMultiplier: 1, // V_蓄力：下次任意攻擊傷害×N，消耗於該角色下次造成傷害時
      dodgeBuffThisTurn: 0, // V_隱步：施放的那個回合閃避率+%，下回合開始重置
      damageReduction: 0, damageReductionDuration: 0, // L_冰盾：減傷%，持續N回合
      relics: charRelics, // 這趟戰鬥生效的遺物（＝該角色永久裝備的遺物）
      carriedFood: carried,
      carriedPotion: carriedPotionSel, // 攜帶的魔藥（戰鬥中使用，用掉變 null；沒用掉回程還回庫存）
      critBuffNextBattle: 0,
      multiBattleCritBonus: 0, // 代價交換「犧牲換爆擊率」用，持續多場戰鬥
      multiBattleCritRemaining: 0,
      foodBuffActive: null,
    };
  });

  activeDive = {
    layer: startLayer,
    nodeIndex: 0,
    restUsed: false,
    crystalEarnedThisRun: 0,
    globalBuffs: [],
    nextBattleDmgDebuff: 0,
    nextBattleDmgBonus: 0, // 休息點「養精蓄銳」的專注buff：下場戰鬥傷害+10%
    shopOffer: null, // 商店這次進來時抽到的商品，離開後清空
    gambleUsed: false, // 本趟是否已經玩過一次節點賭場（H 的冒險內賭局每趟只能賭一次）
    party,
  };

  // （2026-08-12）選深層跳關「不再自動補償任何增益或遺物」——納可拍板，就單純跳過前面圈層。

  systemToast("整裝完畢，出發深潛。");
  gameState.stats.divesStarted++;
  checkAchievements();

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
  return icons.join("");
}

function renderDiveScreen() {
  flushRelicIntro(); // 若剛拿到第一個遺物（例如第一次出發拿到的「初次潛淵」），在這裡補播 K 的解說
  let nodeIndex = activeDive.nodeIndex;
  let layer = activeDive.layer;
  let depth = getLayerDepth(layer);

  // Boss門前(最後一格)第一次抵達時，讓K先講一段話，玩家可以在那之後自由整備再進去。
  // 用gameState.storyFlags(整個存檔只播一次)而不是activeDive(每趟深潛都會重置)，
  // 不然玩家全滅或撤退後重新出征、再次走到最後一格，這段劇情會重複播放。
  if (nodeIndex === depth - 1 && layer === 1 && !gameState.storyFlags.bossDoorShown) {
    gameState.storyFlags.bossDoorShown = true;
    playDialogue([
      { speaker: "K", text: "等一下。" },
      { speaker: "", text: "K 的表情嚴肅起來。" },
      { speaker: "K", text: "……感覺不對。" },
      { speaker: "", text: "V 點了一下頭，握緊刀柄。" },
      { speaker: "K", text: "有東西在前面。我不確定那是什麼……但 L 失蹤的地方，就在這附近。" },
      { speaker: "K", text: "如果 L 還被困在裡面，我們必須過去。" },
      { speaker: "K", text: `${displayName("主角")}，走吧。` },
    ], renderDiveScreen, { id: "第一層Boss門前", title: "第一圈層・Boss 門前", order: 10 });
    return;
  }
  // 第二層 Boss 門前（巨岩蚺）第一次抵達
  if (nodeIndex === depth - 1 && layer === 2 && !gameState.storyFlags.boss2DoorShown) {
    gameState.storyFlags.boss2DoorShown = true;
    playDialogue([
      { speaker: "", text: "前方的通道被一堆巨大的石頭堵住了大半。" },
      { speaker: "K", text: "咦，這……" },
      { speaker: "L", text: "那不全是石頭。" },
      { speaker: "", text: "L 的聲音壓得很低。" },
      { speaker: "V", text: "……在呼吸。別靠太近。" },
      { speaker: "K", text: "藥材就在牠守著的地方？" },
      { speaker: "L", text: "依我的記憶，多半是。" },
      { speaker: "K", text: `${displayName("主角")}，小心點。這傢伙……不好惹。` },
    ], renderDiveScreen, { id: "第二層Boss門前", title: "第二圈層・Boss 門前", order: 30 });
    return;
  }

  // 第一次以完整隊伍面對選路時的教學提示
  let forkHintHtml = "";
  if (nodeIndex === 0 && !gameState.storyFlags.forkHintShown) {
    gameState.storyFlags.forkHintShown = true;
    forkHintHtml = `<p class="dim" style="text-align:center;">前方的路分開了。圖示代表可能遭遇的事物，但在親眼見到之前，你不會知道具體是什麼。</p>`;
  }

  let config = getLayerConfig(layer)[nodeIndex];

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

  let layerName = (LAYERS_META[layer] && LAYERS_META[layer].name) || "";
  showScreen(`
    <h2 class="screen-title">深潛 · 圈層 ${layer}${layerName ? "：" + layerName : ""}</h2>
    <div class="dive-progress">第 ${nodeIndex + 1} / ${depth} 格</div>
    <div class="dive-hud">${diveHudHtml()}</div>
    <div class="dive-effects-row">${diveEffectsHtml()}</div>
    ${forkHintHtml}
    <div class="node-path">${optionsHtml}</div>
    <div class="dive-actions">
      <button class="action-btn" onclick="usePotionAction()">🧪 使用補血藥</button>
      <button class="action-btn" onclick="eatFoodAction()">🍲 食用料理</button>
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
  if (nodeType === "gamble") return resolveGambleNode(); // 賭場節點🎲，實作在08_賭場.js
}

// ---------- 戰鬥節點 ----------

// 隨機決定2或3隻，從四種小怪(凝膠/藍顎獸/翅鱗/眼藻)中不重複抽選
function generateRandomMonsterGroup() {
  let count = randInt(2, 3);
  let pool = getLayerMonsterPool(activeDive.layer).slice();
  let group = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    let idx = randInt(0, pool.length - 1);
    group.push(pool.splice(idx, 1)[0]);
  }
  if (chance(MIMIC_AMBUSH_CHANCE)) group.push("寶箱怪"); // 額外混入，不佔原本2~3隻的名額
  return group;
}

function resolveMonsterNode(nodeType) {
  let group = nodeType === "elite" ? pickRandom(getLayerEliteGroups(activeDive.layer).菁英) : generateRandomMonsterGroup();

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
  let layer = activeDive.layer;
  let bossId = getLayerBoss(layer);
  let intro = layer === 2
    ? [
        { speaker: "", text: "那根巨大的「石柱」忽然動了——鱗片摩擦著岩壁，一雙冷硬的眼睛睜開。" },
        { speaker: "L", text: "來了。小心牠的尾巴。" },
      ]
    : [
        { speaker: "", text: "水面下的巨影緩緩移動著，發出低沉的共鳴。" },
        { speaker: "K", text: "那就是……" },
        { speaker: "", text: "V 握緊了匕首。" },
      ];
  playDialogue(intro, () => {
    startBattle([bossId], { isBoss: true, allowFlee: false, rewardMult: 1, onResult: handleBossBattleResult });
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
  let layer = activeDive ? activeDive.layer : 1;
  if (layer === 2) return handleLayer2BossVictory();
  return handleLayer1BossVictory();
}

function handleLayer1BossVictory() {
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
    { speaker: "", text: "水面下傳出微弱的動靜，然後是氣泡——一個人浮了上來，銀白色的長髮在水中漂浮。" },
    { speaker: "K", text: "——L！！" },
    { speaker: "", text: "K、V和你一起把人拉上岸邊。那人咳了些水，癱坐在地喘著氣，綠眼睛半閉著。" },
    { speaker: "", text: "K一把抱住了他。" },
    { speaker: "K", text: "……找到了，終於找到了……" },
    { speaker: "", text: "V蹲下來輕拍著K的肩膀，深藍的眸子卻看向你。他眨了眨眼。" },
    { speaker: "", text: "你從那個眼神讀出了一絲感謝。" },
    { speaker: "", text: "……" },
    // ---- 回到避難所後：L 恢復、道謝，K 的真心話 ----
    { speaker: "", text: "回到避難所。L 靠著棚子的牆坐了很久，K 替他重新包紮了傷，又硬塞了半壺水過去。" },
    { speaker: "", text: "過了好一會，L 的臉色終於有了點血色。" },
    { speaker: "K", text: "……感覺怎麼樣？還撐得住嗎？" },
    { speaker: "L", text: "死不了。" },
    { speaker: "L", text: "……我沒事了。別這樣盯著我，怪滲人的。" },
    { speaker: "K", text: "哈，還有力氣嫌我，那就真的沒事了。" },
    { speaker: "", text: "L 轉向你，沉默了一下。" },
    { speaker: "L", text: "你……我們素昧平生。" },
    { speaker: "L", text: "謝謝你。為不認識的人冒險，這種傻事一般人是不會做的。" },
    { speaker: "V", text: "他是在道謝。" },
    { speaker: "", text: "V小聲地說，L瞥了他一眼。" },
    { speaker: "L", text: "我知道我在說什麼。" },
    { speaker: "", text: "L站起身，環顧避難所，目光在幾個空掉的架子上停了停。" },
    { speaker: "L", text: "魔藥的庫存……全空了，補血藥也剩得不多。這段日子，你們過得很省吧。" },
    { speaker: "L", text: "補血藥很簡單，我來做。以後每次出發前，我都會幫你把補血藥補滿，不用再花潛晶買了。" },
    { speaker: "L", text: "魔藥就不行了，需要特定的藥材。我之前看到過幾種還算合適的素材，既然要往下走，順路去找找看吧。" },
    { speaker: "", text: "K 張了張嘴，似乎想說什麼，最後又把話嚥了回去。" },
    { speaker: "L", text: "……我去把製藥的工具整理一下。" },
    { speaker: "", text: "L 撐著牆站起來，慢慢走向工坊。" },
    { speaker: "", text: "等 L 走遠，K 才壓低了聲音。" },
    { speaker: "K", text: "他嘴上不饒人。其實我們三個裡面，最想帶著大家離開潛淵的，就是他。" },
    { speaker: "K", text: "V 的腳有舊傷，在這種地方根本沒法好好養；我喜歡嘗試各種市井小菜，但在這什麼都缺的鬼地方，連這點念想都算奢侈。" },
    { speaker: "V", text: "……嗯。" },
    { speaker: "K", text: "L 一直說，一定有辦法出去的。回到潛淵之上，去過我們該有的、平凡但珍貴的日子。我、V，我們都想相信他。" },
    { speaker: "K", text: `能重新聚在一起……真的太好了。謝謝你，${displayName("主角")}。` },
  ], () => applyShelterReturn("boss"), { id: "救出L", title: "第一圈層・救出 L", order: 20 });
}

function handleLayer2BossVictory() {
  let isFirstClear = !gameState.storyFlags.layer2Cleared;
  gameState.storyFlags.layer2Cleared = true; // 解鎖避難所賭場的條件之一（另一個是 metH）
  gameState.storyFlags.potionApplyUnlocked = true; // 解鎖補血藥「外敷」用法（重打也保持解鎖）
  checkAchievements();

  if (!isFirstClear) {
    applyShelterReturn("boss");
    return;
  }
  playDialogue([
    { speaker: "", text: "巨岩蚺龐大的身軀癱軟下來，石堆轟然崩落，揚起漫天塵灰。" },
    { speaker: "L", text: "……成了。" },
    { speaker: "", text: "L 蹲下身，在崩塌的碎石與那東西守著的角落裡翻找，採集了些什麼，仔細收好。" },
    { speaker: "L", text: "夠了。這些拿回去，應該能做出像樣的藥。有一些想法可以嘗試。" },
    // 外敷機制解說：戰鬥裡「直飲／外敷」兩顆按鈕在此戰後解鎖，保留說明讓玩家知道多了一種用法。
    { speaker: "L", text: "比如說補血藥——不一定要一口灌下去。敷在傷口上，藥效能拖著慢慢滲，撐得比較久。" },
    { speaker: "L", text: "回去我改一批新的。之後戰鬥裡你們自己選：急著保命就直飲，想撐久一點就外敷。" },
    { speaker: "K", text: "……又一個區域，我們過了。" },
    { speaker: "L", text: "別高興得太早。往下只會更難走。" },
  ], () => applyShelterReturn("boss"), { id: "第二層結局", title: "第二圈層・巨岩蚺之後", order: 40 });
}

// 作弊共用：清掉殘留的對話框覆蓋層、確保過了新手教學、把第一層路上只播一次的教學/劇情標記成看過
// （避免之後真的出征時，在L已入隊狀態下又跳出第一層的開場白/岔路/意圖/Boss門前劇情，跟現況矛盾）。
function cheatPrepMarkLayer1Seen() {
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
  gameState.storyFlags.firstDiveStarted = true;
  gameState.storyFlags.forkHintShown = true;
  gameState.storyFlags.intentHintShown = true;
  gameState.storyFlags.bossDoorShown = true;
  // 墊一點潛晶，避免回避難所時因維護費不足誤觸「工坊停擺」提示，干擾看劇情
  if (gameState.crystal < SHELTER_MAINTENANCE_FEE) gameState.crystal = SHELTER_MAINTENANCE_FEE;
}

// 作弊：打完第一層——播放島鯨戰後「救出 L」的完整結局劇情，再回避難所（方便驗證這段劇情）。
function cheatCompleteLayer1() {
  cheatPrepMarkLayer1Seen();
  if (gameState.storyFlags.lRescued) {
    showShelterScreen();
    systemToast("第一圈層已經打完過了。");
    return;
  }
  // 不預先設 lRescued，交給 handleLayer1BossVictory 播完救援劇情後才設，這樣劇情才會播出來
  handleLayer1BossVictory();
}

// 作弊：打完第二層 Boss——先把第一層前置補齊（不重播第一層劇情），再播巨岩蚺戰後的結局劇情。
function cheatCompleteLayer2() {
  cheatPrepMarkLayer1Seen();
  // 第二層前置：第一層必須先通關（L 已入隊）。這裡直接補齊、不重播第一層劇情。
  gameState.storyFlags.firstLayerCleared = true;
  gameState.storyFlags.lRescued = true;
  gameState.storyFlags.boss2DoorShown = true;
  syncLRoster();
  if (gameState.storyFlags.layer2Cleared) {
    showShelterScreen();
    systemToast("第二圈層已經打完過了。");
    return;
  }
  handleLayer2BossVictory();
}

function applyBattleRewards(result) {
  addRunCrystal(result.crystalEarned);
  let fallenIds = result.fallenIds || [];
  SHELTER_PARTY_IDS.forEach((id) => {
    let exp = fallenIds.includes(id) ? Math.round(result.expEarned * 0.5) : result.expEarned;
    addExp(id, exp);
  });
  (result.foodDrops || []).forEach((drop) => addRawFood(drop.foodId, drop.rare));
  (result.herbDrops || []).forEach((drop) => addRawHerb(drop.herbId, drop.rare));
  let foodMsg = result.foodDropsText ? `、${result.foodDropsText}` : "";
  let herbMsg = result.herbDropsText ? `、${result.herbDropsText}` : "";
  let fallenMsg = fallenIds.length > 0 ? `（${fallenIds.map(displayName).join("、")}這場中途倒地過，經驗只拿一半）` : "";
  systemToast(`⚔️ 戰鬥勝利！獲得 💎${result.crystalEarned}、經驗 ${result.expEarned}${foodMsg}${herbMsg}${fallenMsg}`);
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
    if (opt.effect.type === "pay-crystal-for-buff-choice") {
      return GLOBAL_BUFFS.some((b) => !activeDive.globalBuffs.includes(b.id));
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
          // 遺物改成成就獎勵後，打倒寶箱怪改成給潛晶＋一個隨機增益
          let bonus = randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]) + 3;
          addRunCrystal(bonus);
          let available = GLOBAL_BUFFS.filter((b) => !activeDive.globalBuffs.includes(b.id));
          if (available.length > 0) grantGlobalBuff(pickRandom(available));
          systemToast(`💎 寶箱怪掉了 ${bonus} 顆潛晶！`);
          playDialogue([{ speaker: "K", text: "還好動作夠快。" }], afterNodeContentResolved);
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

// 遺物改成成就獎勵後，寶藏不再給遺物。改成二選一：拿一大筆潛晶，或拿一個增益（本趟深潛限定，睡覺後消失）。
// 「拿增益」多給一點潛晶當作代價感的平衡，兩邊都有價值、看玩家這趟缺錢還是缺強度。
function resolveTreasureNode() {
  let crystalAmount = Math.round(randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]) * (LAYER_FIND_MULT[activeDive.layer] || 1)); // 越深的圈層寶藏潛晶越多
  let bumpedCrystal = crystalAmount + Math.round(crystalAmount * 0.5); // 「只拿潛晶」比「拿增益」多一半，補償沒拿到增益
  let available = GLOBAL_BUFFS.filter((b) => !activeDive.globalBuffs.includes(b.id));

  let choices = [];
  if (available.length > 0) {
    let buff = pickRandom(available);
    choices.push({ label: `拿走增益：${buff.name}（${buff.desc}）`, onSelect: () => {
      grantGlobalBuff(buff);
      afterNodeContentResolved();
    } });
    choices.push({ label: `只拿潛晶（💎${crystalAmount}）`, onSelect: () => {
      addRunCrystal(crystalAmount);
      afterNodeContentResolved();
    } });
  } else {
    // 增益已全滿：直接給比較多的潛晶
    choices.push({ label: `拿走潛晶（💎${bumpedCrystal}）`, onSelect: () => {
      addRunCrystal(bumpedCrystal);
      afterNodeContentResolved();
    } });
  }

  playDialogue([{ speaker: "寶藏", text: "前方有被遺留下來的東西。", choices }], () => {});
}

// ---------- 商人 💰（補丁v1修改3：第一圈層也有商店） ----------

function resolveShopNode() {
  if (activeDive.shopLooted) {
    playDialogue([{ speaker: "", text: "這裡的角落空蕩蕩的，什麼也沒有留下。" }], afterNodeContentResolved);
    return;
  }
  if (!activeDive.shopOffer) {
    // 遺物改成成就獎勵後，商店改賣「食材 + 增益」。增益是本趟深潛限定（睡覺後消失）。
    let foodDef = pickRandom(Object.values(FOODS));
    let pool = GLOBAL_BUFFS.filter((b) => !activeDive.globalBuffs.includes(b.id));
    let buffIds = [];
    for (let i = 0; i < 2 && pool.length > 0; i++) {
      let idx = randInt(0, pool.length - 1);
      buffIds.push(pool.splice(idx, 1)[0].id);
    }
    activeDive.shopOffer = { foodDishId: foodDef.dishId, buffIds };
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

  let buffRows = offer.buffIds.length > 0
    ? offer.buffIds.map((buffId) => {
        let b = GLOBAL_BUFFS.find((x) => x.id === buffId);
        return `<div class="menu-item" style="cursor:default;">
          <strong>✨ ${b.name}</strong>
          <div class="dim">${b.desc}（本趟深潛限定）</div>
          <div class="dim">💎${SHOP_PRICES.buff}</div>
          <button class="action-btn" title="${b.desc}" onclick="buyShopBuff('${buffId}')">購買</button>
        </div>`;
      }).join("")
    : `<div class="menu-item" style="cursor:default;"><span class="dim">✨ 增益已經賣完了。</span></div>`;

  showScreen(`
    <h2 class="screen-title">遺留物資</h2>
    <p class="dim">角落堆著一些物資，旁邊放著幾顆潛晶，像是以物易物的規矩。</p>
    <div class="card">${foodRow}${buffRows}</div>
    <button class="action-btn secondary" onclick="leaveShop()">繼續前進</button>
  `, { withTopbar: true });
}

function buyShopFood() {
  if (gameState.crystal < SHOP_PRICES.food) { handleShopAnger(); return; }
  gameState.crystal -= SHOP_PRICES.food;
  let dishId = activeDive.shopOffer.foodDishId;
  if (!gameState.cookedInventory[dishId]) gameState.cookedInventory[dishId] = { normal: 0, rare: 0 };
  gameState.cookedInventory[dishId].normal++;
  gameState.discoveredDishes[dishId] = true; // 圖鑑：取得過就記錄
  systemToast(`🍲 買了一份 ${dishId}。`);
  renderShopScreen();
}

function buyShopBuff(buffId) {
  let offer = activeDive.shopOffer;
  let idx = offer.buffIds.indexOf(buffId);
  if (idx === -1) return;
  if (activeDive.globalBuffs.includes(buffId)) { offer.buffIds.splice(idx, 1); renderShopScreen(); return; } // 保險：已經有了就不重複賣
  if (gameState.crystal < SHOP_PRICES.buff) { handleShopAnger(); return; }
  gameState.crystal -= SHOP_PRICES.buff;
  let buff = GLOBAL_BUFFS.find((b) => b.id === buffId);
  grantGlobalBuff(buff); // 增益是本趟深潛限定，買了立即生效
  offer.buffIds.splice(idx, 1);
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

// 打贏偷襲後，這次商店剩下的東西(增益+料理)全部免費拿走，之後這格就空了
function handleShopLoot() {
  let offer = activeDive.shopOffer;
  if (offer.buffIds) offer.buffIds.forEach((bid) => {
    if (!activeDive.globalBuffs.includes(bid)) grantGlobalBuff(GLOBAL_BUFFS.find((b) => b.id === bid));
  });
  if (offer.foodDishId) {
    if (!gameState.cookedInventory[offer.foodDishId]) gameState.cookedInventory[offer.foodDishId] = { normal: 0, rare: 0 };
    gameState.cookedInventory[offer.foodDishId].normal++;
    gameState.discoveredDishes[offer.foodDishId] = true;
  }
  activeDive.shopOffer = null;
  activeDive.shopLooted = true;
  playDialogue([{ speaker: "", text: "那個冰冷的氣息消失了。角落的物資任你取用。" }], afterNodeContentResolved);
}

// 註（2026-08-12）：遺物改成「成就永久獎勵、在避難所『技能遺物』頁面裝備」後，
// 原本深潛中的遺物背包與遺物管理畫面（getOwnedRelicIdsThisRun / grantRandomRelic /
// showRelicManagementScreen / equipSelectedRelic 等）整組已移除。裝備介面見 04_避難所.js。

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
    // 舊 alias（資料已不再引用；保險留著，改成扣血後給一個隨機增益）
    case "damage-all-flat-and-relic": {
      damageAllFlat(effect.value);
      systemToast(`全隊損失 ${effect.value} 血，但感覺到一絲能量。`, true);
      let available = GLOBAL_BUFFS.filter((b) => !activeDive.globalBuffs.includes(b.id));
      if (available.length > 0) grantGlobalBuff(pickRandom(available));
      break;
    }
    case "find-crystal": {
      let v = Math.round(randInt(effect.range[0], effect.range[1]) * (LAYER_FIND_MULT[activeDive.layer] || 1)); // 越深的圈層撿到的潛晶越多
      addRunCrystal(v);
      systemToast(`💎 找到了 ${v} 顆潛晶。`);
      break;
    }
    case "find-potion": {
      let v = randInt(effect.range[0], effect.range[1]);
      gameState.potions = clamp(gameState.potions + v, 0, POTION_MAX);
      systemToast(`🧪 找到了 ${v} 瓶補血藥。`);
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
    // 換掉一個現有增益、換成一個不同的新增益（共鳴殘響事件）；沒有可換的舊增益就直接送一個新的。
    case "swap-random-buff": {
      let owned = activeDive.globalBuffs;
      let removable = owned.filter((id) => id !== "強韌體質"); // 強韌體質會墊高最大血量，換掉不好還原，排除
      let available = GLOBAL_BUFFS.filter((b) => !owned.includes(b.id));
      if (available.length === 0) { systemToast("似乎沒有更多不同的增益可以換了。"); break; }
      if (removable.length === 0) { grantGlobalBuff(pickRandom(available)); break; }
      let removeId = pickRandom(removable);
      owned.splice(owned.indexOf(removeId), 1);
      let removedName = (GLOBAL_BUFFS.find((b) => b.id === removeId) || {}).name || removeId;
      let newBuff = pickRandom(available);
      grantGlobalBuff(newBuff);
      systemToast(`🔄 增益「${removedName}」變成了「${newBuff.name}」。`);
      break;
    }
    // 註（2026-08-12）：原本操作遺物的 reroll-random-relic／gamble-relic 已隨遺物系統大改移除，
    // 對應的事件（遺物熔爐／遺物賭盤）也改成純增益版本（增益熔爐／共鳴賭盤）。
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
    case "sacrifice-hp-for-buff":
      pickPartyMemberFlow("犧牲誰的 10% 當前血量來換取增益？", (memberId) => {
        let m = activeDive.party[memberId];
        let dmg = Math.max(1, Math.round(m.hp * effect.value));
        m.hp = Math.max(1, m.hp - dmg);
        systemToast(`${displayName(memberId)} 損失了 ${dmg} 血。`, true);
        let available = GLOBAL_BUFFS.filter((b) => !activeDive.globalBuffs.includes(b.id));
        if (available.length > 0) grantGlobalBuff(pickRandom(available));
        else { let v = randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]); addRunCrystal(v); systemToast(`沒有更多增益了，改成找到 💎${v}。`); }
        onDone();
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
        systemToast("補血藥不夠，無法交換。", true);
      }
      break;
    case "pay-crystal-for-buff-choice": {
      if (gameState.crystal < effect.cost) { systemToast("潛晶不夠，無法交換。", true); break; }
      let available = GLOBAL_BUFFS.filter((b) => !activeDive.globalBuffs.includes(b.id));
      if (available.length === 0) { systemToast("目前沒有更多增益可以選了。", true); break; }
      gameState.crystal -= effect.cost;
      let pool = available.slice();
      let offered = [];
      while (offered.length < 3 && pool.length > 0) offered.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
      let choices = offered.map((b) => ({
        label: `${b.name}（${b.desc}）`,
        onSelect: () => { grantGlobalBuff(b); onDone(); },
      }));
      playDialogue([{ speaker: "", text: "選一個帶走（本趟深潛限定）：", choices }], () => {});
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
  if (gameState.potions <= 0) { systemToast("補血藥用完了。", true); return; }
  pickPartyMemberFlow("誰要喝補血藥？", (memberId) => {
    let m = activeDive.party[memberId];
    gameState.potions--;
    let healPercent = activeDive.globalBuffs.includes("藥效強化") ? 0.45 : POTION_HEAL_PERCENT;
    m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * healPercent));
    systemToast(`🧪 ${displayName(memberId)} 喝下補血藥，回復了血量。`);
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
