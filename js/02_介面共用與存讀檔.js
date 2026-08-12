// ========================================
// 潛淵 - 介面共用邏輯與存讀檔
// gameState：基地的永久進度（會存檔）
// activeDive：目前深潛中的暫存狀態（不存檔，中途關掉視窗＝這趟放棄）
// ========================================

const SAVE_VERSION = 1;

let gameState = {
  saveVersion: SAVE_VERSION,
  playerName: "",
  playerColor: DEFAULT_PLAYER_COLOR,
  crystal: 0,
  tokens: 0, // 賭場代幣：避難所賭場專用貨幣，用潛晶兌換，未來可在交易所換東西（見08_賭場.js）
  potions: POTION_MAX,
  workshopSuspended: false,
  storyFlags: {
    introDone: false,
    lRescued: false,
    firstLayerCleared: false,
    firstDiveStarted: false, // 是否已經播過第一次出征時K的開場白
    forkHintShown: false, // 是否已經播過第一次岔路提示
    intentHintShown: false, // 是否已經播過第一次意圖圖示提示
    bossDoorShown: false, // 是否已經播過第一層Boss門前K的完整台詞
    boss2DoorShown: false, // 是否已經播過第二層Boss（巨岩蚺）門前的台詞
    metH: false, // 是否已經在節點賭場遇過H（解鎖避難所賭場的條件之一）
    layer2Cleared: false, // 是否已通關第二圈層（解鎖避難所賭場的條件之一）
    potionApplyUnlocked: false, // 是否已解鎖補血藥「外敷」用法（第二層Boss戰後L研發出來的新藥）
    firstRelicSeen: false, // 是否已經播過「第一次拿到遺物時 K 解釋潛淵怪現象」的台詞（只播一次）
  },
  bestiary: {}, // { 凝膠: true, ... } 是否已經遇過該種怪物
  discoveredNodeTypes: {}, // { monster: true, oddity: true, ... } 是否已經遇過該種節點類型（沒遇過顯示？？？）
  discoveredDishes: {}, // { 彈牙凍飲: true, ... } 曾經做過/取得過的料理（圖鑑用，做過就永久記錄）
  discoveredPotions: {}, // { 腐蝕彈: true, ... } 曾經製作過的魔藥（圖鑑用）
  characters: {
    // relics：這個角色永久裝著的遺物 id 陣列（最多 RELIC_MAX_PER_CHARACTER 個）。
    // 遺物是永久的，裝上去就一直在、除非在「技能遺物」頁面拆下來（不像舊版單趟深潛就重置）。
    主角: { level: 1, exp: 0, weaponLv: 0, armorLv: 0, relics: [] },
    K: { level: 1, exp: 0, weaponLv: 0, armorLv: 0, relics: [] },
    V: { level: 1, exp: 0, weaponLv: 0, armorLv: 0, relics: [] },
    L: { level: 1, exp: 0, weaponLv: 0, armorLv: 0, relics: [] },
  },
  rawFoodInventory: {}, // { 凝膠凍: {normal: 0, rare: 0}, ... }
  cookedInventory: {}, // { 彈牙凍飲: {normal: 0, rare: 0}, ... }
  rawHerbInventory: {}, // 藥材庫存 { 刺螯毒腺: {normal:0, rare:0}, ... }（第二層，刺螯/膜翼掉落）
  craftedPotionInventory: {}, // 魔藥庫存 { 腐蝕彈: {normal:0, rare:0}, ... }（工坊魔藥間製作）
  equippedSkills: {
    主角: CHARACTERS.主角.skillIds.slice(),
    K: CHARACTERS.K.skillIds.slice(),
    V: CHARACTERS.V.skillIds.slice(),
    L: CHARACTERS.L.skillIds.slice(),
  }, // 出征前最多裝備4個技能，深潛中不可更換
  foodAssignment: { 主角: null, K: null, V: null, L: null }, // 每個角色目前分配到的攜帶料理({dishId,rare}或null)，沒吃掉的話下次出征會繼續帶著，不用重新分配
  potionAssignment: { 主角: null, K: null, V: null, L: null }, // 每個角色攜帶的魔藥({potionId,rare}或null)，跟料理各自獨立一格；沒用掉下次出征繼續帶
  lastDepartLayer: 1, // 出發畫面上次選的圈層，下次進來預設帶出這個（下拉選單記住選擇用）
  storyLog: {}, // 劇情回顧：{ 場景id: {title, order, lines:[{speaker,text}]} }，玩到哪記到哪（防暴雷：沒看過的不會出現）
  settings: {
    autoTargetSingleEnemy: true, // 敵方只剩1隻時，普攻/單體技能自動選定目標、不用手動點
    typewriter: true, // 劇情文字逐字打字動畫（關掉就整句直接顯示）
    autoMode: "off", // 劇情自動下一句：off/slow/normal/fast（對話框右下角Auto按鈕循環切換、會記住）
  },
  achievements: {}, // 成就解鎖狀態 { 初次潛淵: true, ... }
  stats: { // 成就用的輔助統計（不是玩家直接看的數值）
    divesStarted: 0, mimicKills: 0, flawlessWins: 0, wipes: 0,
    dishesCooked: 0, relicsEquipped: 0, maxCrystalSeen: 0,
    casinoGamesPlayed: 0, casinoBiggestWin: 0,
  },
};

// 深潛中的暫存狀態，中途放棄或關視窗不會被存下來
let activeDive = null;

// ---------- 小工具 ----------

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function chance(p) {
  return Math.random() < p;
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function pickRandom(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// ---------- 角色數值計算（依賴 gameState.characters 的等級/強化） ----------

function getCharacterMaxHp(charId) {
  let base = CHARACTERS[charId].baseHp;
  let armorLv = gameState.characters[charId].armorLv;
  let hp = base;
  for (let i = 0; i < armorLv; i++) hp = Math.ceil(hp * UPGRADE_GROWTH_RATE);
  return hp;
}
function getCharacterWeaponMultiplier(charId) {
  let weaponLv = gameState.characters[charId].weaponLv;
  return Math.pow(UPGRADE_GROWTH_RATE, weaponLv); // 內部存小數，傷害計算時才進位
}
// 治療類技能(heal/hot)的成長依據：武器與裝備等級取平均、四捨五入，兩邊都有投資才會加快治療成長
function getCharacterHealMultiplier(charId) {
  let c = gameState.characters[charId];
  let avgLv = Math.round((c.weaponLv + c.armorLv) / 2);
  return Math.pow(UPGRADE_GROWTH_RATE, avgLv);
}
function getCharacterLevel(charId) {
  return gameState.characters[charId].level;
}
function getCharacterExpNeeded(charId) {
  return getExpNeeded(gameState.characters[charId].level);
}

// 技能池裡第N個技能(idx從0起)要求Lv(N+1)才解鎖：第1個Lv1就有，第2個Lv2，第3個Lv3，第4個Lv4。
// 04_避難所.js的技能管理畫面也要顯示同樣的需求等級，所以共用這個函式，不要各自寫一份公式。
function getSkillUnlockLevel(charId, skillId) {
  let idx = CHARACTERS[charId].skillIds.indexOf(skillId);
  return idx === -1 ? null : idx + 1;
}

// 「裝備」跟「解鎖」是兩回事：預設全部技能都在equippedSkills裡，但沒到等級的話即使掛在裝備清單也不能用。
function isSkillUnlocked(charId, skillId) {
  let requiredLevel = getSkillUnlockLevel(charId, skillId);
  if (requiredLevel === null) return false;
  return getCharacterLevel(charId) >= requiredLevel;
}

// ---------- 畫面切換 ----------

function showScreen(html, opts) {
  opts = opts || {};
  document.getElementById("main-screen").innerHTML = html;
  document.getElementById("main-screen").className = opts.withTopbar ? "with-topbar" : "";
  document.getElementById("top-status-bar").classList.toggle("hidden", !opts.withTopbar);
  // 左上角選單(存讀檔/改名)一開始就要能用，不跟著withTopbar開關
  if (opts.withTopbar) updateTopStatusBar();
}

function updateTopStatusBar() {
  document.getElementById("top-crystal").textContent = gameState.crystal;
  document.getElementById("top-potion").textContent = gameState.potions;
  document.getElementById("top-potion-max").textContent = POTION_MAX;
  let layerEl = document.getElementById("top-layer-progress");
  if (activeDive) {
    let depth = (LAYER_NODE_CONFIGS[activeDive.layer] || LAYER1_NODE_CONFIG).length;
    layerEl.textContent = `圈層 ${activeDive.layer} — 第 ${activeDive.nodeIndex}/${depth} 格`;
  } else {
    layerEl.textContent = "";
  }
}

function toggleSettingsMenu() {
  document.getElementById("settings-menu").classList.toggle("active");
}

// ---------- 通用彈窗 ----------

function openGenericModal(title, bodyHtml) {
  document.getElementById("generic-modal-title").textContent = title;
  document.getElementById("generic-modal-body").innerHTML = bodyHtml;
  // index.html裡這個元素初始有"hidden"這個class(display:none!important)，一定要在這裡拿掉，
  // 不然只加"active"沒用——"hidden"的!important會蓋掉".modal-overlay.active"的display:flex，
  // 彈窗永遠不會真的顯示出來。
  document.getElementById("generic-modal").classList.remove("hidden");
  document.getElementById("generic-modal").classList.add("active");
}
function closeGenericModal() {
  document.getElementById("generic-modal").classList.remove("active");
}

// ---------- 改名（左上角選單，任何畫面都能用） ----------

function openRenameModal() {
  toggleSettingsMenu();
  if (!gameState.storyFlags.introDone) {
    systemToast("還沒決定名字之前不能改名喔。", true);
    return;
  }
  openGenericModal("改名", `
    <input type="text" id="rename-modal-input" class="dialogue-choice-btn" style="width:100%; margin-bottom: 12px;" maxlength="12" value="${gameState.playerName}" placeholder="輸入新名字">
    <button class="action-btn" onclick="confirmRenameModal()">確定</button>
    <button class="action-btn secondary" onclick="closeGenericModal()">取消</button>
  `);
  setTimeout(() => {
    let input = document.getElementById("rename-modal-input");
    if (input) { input.focus(); input.select(); }
  }, 0);
}

function confirmRenameModal() {
  let input = document.getElementById("rename-modal-input");
  let val = input ? input.value.trim() : "";
  if (!val) return;
  gameState.playerName = val;
  CHARACTERS.主角.name = val;
  closeGenericModal();
  systemToast("改名完成。");
}

// ---------- 設定（左上角選單，任何畫面都能用） ----------

function openSettingsOptionsModal() {
  toggleSettingsMenu();
  renderSettingsOptionsModal();
}

function renderSettingsOptionsModal() {
  openGenericModal("設定", `
    <div class="menu-item" style="cursor:pointer;" onclick="toggleAutoTargetSetting()">
      <strong>${gameState.settings.autoTargetSingleEnemy ? "☑" : "☐"} 敵方只剩1隻時自動選定目標</strong>
      <div class="dim">開啟後，敵方只剩1隻時，普攻/單體技能會直接對它出手，不用再手動點選目標。</div>
    </div>
    <div class="menu-item" style="cursor:pointer;" onclick="toggleTypewriterSetting()">
      <strong>${gameState.settings.typewriter !== false ? "☑" : "☐"} 劇情逐字動畫</strong>
      <div class="dim">開啟後，劇情文字會一個字一個字跑出來；覺得太慢的話關掉就整句直接顯示。（對話框右下角的「自動」按鈕可切換自動下一句的速度。）</div>
    </div>
    <div class="menu-item" style="cursor:default; display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <div>
        <strong>🎨 ${displayName("主角")} 的代表色</strong>
        <div class="dim">用來標示名字/血條卡片左側的顏色，K是棕色、V是藍色、L是綠色，主角可以自己選。</div>
      </div>
      <input type="color" value="${gameState.playerColor}" oninput="setPlayerColor(this.value)" style="width:44px; height:36px; padding:0; border:2px solid #2d333b; border-radius:6px; background:none; cursor:pointer; flex-shrink:0;">
    </div>
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}

function toggleAutoTargetSetting() {
  gameState.settings.autoTargetSingleEnemy = !gameState.settings.autoTargetSingleEnemy;
  renderSettingsOptionsModal();
}

function toggleTypewriterSetting() {
  gameState.settings.typewriter = gameState.settings.typewriter === false;
  renderSettingsOptionsModal();
}

function setPlayerColor(hex) {
  gameState.playerColor = hex;
}

// ---------- 作弊（左上角選單，任何畫面都能用） ----------

function openCheatModal() {
  toggleSettingsMenu();
  let skipTutorialRow = gameState.storyFlags.introDone
    ? `<p class="dim">新手教學已經跳過或走完了。</p>`
    : `<button class="action-btn" onclick="cheatSkipTutorial()">跳過新手教學</button>`;
  let completeLayer1Row = gameState.storyFlags.lRescued
    ? `<p class="dim">第一圈層已經打完了。</p>`
    : `<button class="action-btn" style="margin-top:8px;" onclick="cheatCompleteLayer1()">打完第一層（看結局劇情）</button>`;
  let completeLayer2Row = gameState.storyFlags.layer2Cleared
    ? `<p class="dim">第二圈層已經打完了。</p>`
    : `<button class="action-btn" style="margin-top:8px;" onclick="cheatCompleteLayer2()">打完第二層 Boss（看結局劇情）</button>`;
  let allMaxed = Object.keys(gameState.characters).every((id) => gameState.characters[id].level >= CHARACTERS[id].skillIds.length);
  let maxLevelRow = allMaxed
    ? `<p class="dim">全體角色已經是目前最高等級了。</p>`
    : `<button class="action-btn" style="margin-top:8px;" onclick="cheatMaxLevelAll()">全體角色升到目前最高等級</button>`;
  let unlockCasinoRow = isShelterCasinoUnlocked()
    ? `<p class="dim">避難所賭場已經解鎖了。</p>`
    : `<button class="action-btn" style="margin-top:8px;" onclick="cheatUnlockCasino()">解鎖避難所賭場（H）</button>`;
  openGenericModal("作弊", `
    ${skipTutorialRow}
    ${completeLayer1Row}
    ${completeLayer2Row}
    ${maxLevelRow}
    ${unlockCasinoRow}
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}

// 測試用：直接解鎖避難所賭場（滿足 metH + layer2Cleared 兩條件），並給一點代幣本金。
function cheatUnlockCasino() {
  gameState.storyFlags.metH = true;
  gameState.storyFlags.layer2Cleared = true;
  if (gameState.tokens < 30) gameState.tokens += 50;
  if (gameState.crystal < 30) gameState.crystal += 50;
  closeGenericModal();
  showShelterScreen();
  systemToast("🃏 避難所賭場已解鎖，H 在等你了。");
}

// 每個角色各自升到「自己技能池的最高等級」(目前四人都是4級，但用skillIds.length算，以後技能數不一致也不用改這裡)
function cheatMaxLevelAll() {
  Object.keys(gameState.characters).forEach((id) => {
    let maxLv = CHARACTERS[id].skillIds.length;
    if (gameState.characters[id].level < maxLv) gameState.characters[id].level = maxLv;
  });
  systemToast("🔧 全體角色已升到目前最高等級。");
  closeGenericModal();
}

// ---------- 通知 ----------

function systemToast(msg, important) {
  let container = document.getElementById("system-toast-container");
  let el = document.createElement("div");
  el.className = "system-toast" + (important ? " system-toast-important" : "");
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

// ---------- 對話劇情層（開場劇情／深潛敘事文字共用） ----------

let dialogueQueue = [];
let dialogueOnComplete = null;

// 逐字打字動畫狀態
let typewriterTimer = null;      // setInterval 的 id（正在一個字一個字跑時才有值）
let typewriterFullText = "";     // 本行的完整文字（跳過動畫時直接補上整句）
let typewriterDone = true;       // 本行文字是否已經全部顯示完
let typewriterReveal = null;     // 文字跑完後要做的事（顯示選項/輸入框/繼續鍵、排定Auto）
const TYPEWRITER_SPEED = 22;     // 每個字之間的間隔(ms)，數字越小跑越快

// Auto 自動下一句狀態
let autoAdvanceTimer = null;     // setTimeout 的 id（一行跑完後正在倒數自動下一句時才有值）
const AUTO_MODES = ["off", "slow", "normal", "fast"]; // 按鈕循環順序：關→慢→中→快→關
const AUTO_LABELS = { off: "▶ 自動", slow: "⏸ 自動·慢", normal: "⏸ 自動·中", fast: "⏸ 自動·快" };
const AUTO_DELAYS = { slow: 2400, normal: 1400, fast: 700 }; // 一行文字跑完後，等多久才自動跳下一句(ms)

// logInfo（選填）：{ id, title, order, append } — 有給的話，把這段對話收進「劇情回顧」（見09_劇情記錄.js）。
// 只有主線大段落才傳 logInfo，一般節點事件對話不記錄。
function playDialogue(lines, onComplete, logInfo) {
  if (logInfo && logInfo.id) recordStoryLog(logInfo, lines);
  dialogueQueue = lines.slice();
  dialogueOnComplete = onComplete || null;
  document.getElementById("dialogue-overlay").classList.remove("hidden");
  renderDialogueAutoBtn();
  showNextDialogueLine();
}

// 清掉所有進行中的計時器（逐字動畫、Auto倒數），避免殘留亂觸發或跳字。
function clearDialogueTimers() {
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  typewriterDone = true;
  typewriterReveal = null;
}

// 把一段對話的「有台詞的行」收進劇情回顧（旁白 speaker 為空字串，照樣記，回顧時當旁白顯示）。
// append=true 時接在同一場景後面（用於跨多次 playDialogue 的開場劇情）。
function recordStoryLog(info, lines) {
  if (!gameState.storyLog) gameState.storyLog = {};
  let textLines = (lines || [])
    .filter((l) => l && typeof l.text === "string" && l.text.trim().length > 0)
    .map((l) => ({ speaker: l.speaker || "", text: l.text }));
  if (textLines.length === 0) return;
  let existing = gameState.storyLog[info.id];
  if (existing && info.append) {
    existing.lines = existing.lines.concat(textLines);
    if (info.title) existing.title = info.title;
    if (info.order != null) existing.order = info.order;
  } else {
    gameState.storyLog[info.id] = { title: info.title || info.id, order: info.order || 0, lines: textLines };
  }
}

function showNextDialogueLine() {
  clearDialogueTimers();
  if (dialogueQueue.length === 0) {
    document.getElementById("dialogue-overlay").classList.add("hidden");
    let cb = dialogueOnComplete;
    dialogueOnComplete = null;
    if (cb) cb();
    return;
  }
  let line = dialogueQueue[0];
  document.getElementById("dialogue-speaker").textContent = line.speaker || "";

  let choicesEl = document.getElementById("dialogue-choices");
  let nextBtn = document.getElementById("dialogue-next-btn");
  // 打字進行中：先清空選項、繼續鍵先當「跳過打字」用（點一下把整句秒顯示）。
  choicesEl.innerHTML = "";
  choicesEl.classList.add("hidden");
  nextBtn.classList.remove("hidden");

  // 這一行文字「跑完」之後才顯示選項/輸入框，或排定 Auto 自動下一句。
  typewriterReveal = () => revealDialogueControls(line);
  typeDialogueText(line.text || "");
}

// 逐字顯示一行文字；若在設定關掉逐字動畫，就直接整句顯示。
function typeDialogueText(fullText) {
  let el = document.getElementById("dialogue-text");
  typewriterFullText = fullText;
  // 逐字動畫關閉、或本行沒有文字（例如純輸入名字那行）→ 直接顯示、立刻擺出控制項。
  if (!fullText || (gameState.settings && gameState.settings.typewriter === false)) {
    el.textContent = fullText;
    typewriterDone = true;
    if (typewriterReveal) typewriterReveal();
    return;
  }
  el.textContent = "";
  typewriterDone = false;
  let i = 0;
  typewriterTimer = setInterval(() => {
    i++;
    el.textContent = fullText.slice(0, i);
    if (i >= fullText.length) {
      clearInterval(typewriterTimer);
      typewriterTimer = null;
      typewriterDone = true;
      if (typewriterReveal) typewriterReveal();
    }
  }, TYPEWRITER_SPEED);
}

// 打字中被點一下：立刻把整句補完（跳過動畫），不前進到下一句。
function finishTypewriter() {
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null; }
  if (!typewriterDone) {
    document.getElementById("dialogue-text").textContent = typewriterFullText;
    typewriterDone = true;
    if (typewriterReveal) typewriterReveal();
  }
}

// 一行文字跑完後：擺出輸入框/選項（要玩家操作、不自動前進），或安排 Auto 自動下一句。
function revealDialogueControls(line) {
  let choicesEl = document.getElementById("dialogue-choices");
  let nextBtn = document.getElementById("dialogue-next-btn");
  if (line.textInput) {
    choicesEl.innerHTML = "";
    let input = document.createElement("input");
    input.type = "text";
    input.className = "dialogue-choice-btn";
    input.placeholder = line.textInput.placeholder || "";
    input.autocomplete = "off";
    input.maxLength = 12;
    let btn = document.createElement("button");
    btn.className = "action-btn";
    btn.textContent = line.textInput.buttonLabel || "確定";
    let submit = () => {
      let value = input.value.trim();
      if (!value) return;
      dialogueQueue.shift();
      if (line.textInput.onSubmit) line.textInput.onSubmit(value);
      showNextDialogueLine();
    };
    btn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
    choicesEl.appendChild(input);
    choicesEl.appendChild(btn);
    choicesEl.classList.remove("hidden");
    nextBtn.classList.add("hidden");
    setTimeout(() => input.focus(), 0);
    return; // 等玩家輸入，不自動前進
  }
  if (line.choices && line.choices.length > 0) {
    choicesEl.innerHTML = "";
    line.choices.forEach((c) => {
      let btn = document.createElement("button");
      btn.className = "dialogue-choice-btn";
      btn.textContent = c.label;
      if (c.disabled) {
        btn.disabled = true;
        if (c.disabledReason) btn.title = c.disabledReason;
      } else {
        btn.onclick = () => {
          dialogueQueue.shift();
          if (c.onSelect) c.onSelect();
          showNextDialogueLine();
        };
      }
      choicesEl.appendChild(btn);
    });
    choicesEl.classList.remove("hidden");
    nextBtn.classList.add("hidden");
    return; // 等玩家選，不自動前進
  }
  // 純旁白/台詞：顯示繼續鍵；若開了 Auto，就排定自動下一句。
  choicesEl.classList.add("hidden");
  nextBtn.classList.remove("hidden");
  scheduleAutoAdvance();
}

// 若 Auto 有開，安排「這一行跑完後」自動跳下一句。
function scheduleAutoAdvance() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  let mode = (gameState.settings && gameState.settings.autoMode) || "off";
  if (mode === "off") return;
  let delay = AUTO_DELAYS[mode] || AUTO_DELAYS.normal;
  autoAdvanceTimer = setTimeout(() => {
    autoAdvanceTimer = null;
    advanceDialogue();
  }, delay);
}

function advanceDialogue() {
  if (dialogueQueue.length === 0) return;
  // 打字還沒跑完 → 這一下先把整句補完，不要直接跳下一句。
  if (!typewriterDone) { finishTypewriter(); return; }
  let line = dialogueQueue[0];
  if (line.textInput) return; // 需要輸入文字時不能用「繼續」跳過
  if (line.choices && line.choices.length > 0) return; // 有選項時要點選項，不能用「繼續」跳過
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  dialogueQueue.shift();
  if (line.onShown) line.onShown();
  showNextDialogueLine();
}

// Auto 按鈕：循環「關→慢→中→快→關」，並記住選擇（存進 gameState.settings.autoMode）。
function cycleDialogueAuto() {
  if (!gameState.settings) gameState.settings = {};
  let cur = gameState.settings.autoMode || "off";
  let next = AUTO_MODES[(AUTO_MODES.indexOf(cur) + 1) % AUTO_MODES.length];
  gameState.settings.autoMode = next;
  renderDialogueAutoBtn();
  if (next === "off") {
    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  } else if (typewriterDone) {
    // 剛好停在一句已跑完的旁白上：開 Auto 立刻開始倒數（輸入框/選項的行不算）。
    let line = dialogueQueue[0];
    if (line && !line.textInput && !(line.choices && line.choices.length > 0)) scheduleAutoAdvance();
  }
}

// 依目前 Auto 狀態更新按鈕文字/樣式。
function renderDialogueAutoBtn() {
  let btn = document.getElementById("dialogue-auto-btn");
  if (!btn) return;
  let mode = (gameState.settings && gameState.settings.autoMode) || "off";
  btn.textContent = AUTO_LABELS[mode] || AUTO_LABELS.off;
  btn.classList.toggle("on", mode !== "off");
}

// ---------- 存讀檔 ----------

function collectSaveData() {
  return {
    saveVersion: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    playerName: gameState.playerName,
    playerColor: gameState.playerColor,
    crystal: gameState.crystal,
    tokens: gameState.tokens,
    potions: gameState.potions,
    storyFlags: gameState.storyFlags,
    bestiary: gameState.bestiary,
    discoveredNodeTypes: gameState.discoveredNodeTypes,
    discoveredDishes: gameState.discoveredDishes,
    discoveredPotions: gameState.discoveredPotions,
    workshopSuspended: gameState.workshopSuspended,
    characters: gameState.characters,
    rawFoodInventory: gameState.rawFoodInventory,
    cookedInventory: gameState.cookedInventory,
    rawHerbInventory: gameState.rawHerbInventory,
    craftedPotionInventory: gameState.craftedPotionInventory,
    equippedSkills: gameState.equippedSkills,
    foodAssignment: gameState.foodAssignment,
    potionAssignment: gameState.potionAssignment,
    lastDepartLayer: gameState.lastDepartLayer,
    storyLog: gameState.storyLog,
    settings: gameState.settings,
    achievements: gameState.achievements,
    stats: gameState.stats,
  };
}

function saveGameToFile() {
  try {
    let json = JSON.stringify(collectSaveData(), null, 2);
    let blob = new Blob([json], { type: "application/json" });
    let url = URL.createObjectURL(blob);
    let a = document.createElement("a");
    let dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `潛淵_存檔_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    systemToast("💾 存檔已下載到瀏覽器的下載資料夾，可以自己搬到桌面保管。");
  } catch (e) {
    systemToast("❌ 存檔失敗，發生未預期的錯誤。", true);
  }
  toggleSettingsMenu();
}

function triggerLoadGameFile() {
  document.getElementById("load-game-input").click();
}

function loadGameFromFile(event) {
  let file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;

  let reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      systemToast("❌ 讀檔失敗：這個檔案不是有效的存檔格式。", true);
      return;
    }
    if (!data || typeof data !== "object" || !data.characters) {
      systemToast("❌ 讀檔失敗：這個檔案看起來不是本遊戲的存檔。", true);
      return;
    }
    applySaveData(data);
  };
  reader.onerror = () => {
    systemToast("❌ 讀檔失敗：檔案讀取時發生錯誤。", true);
  };
  reader.readAsText(file);
  toggleSettingsMenu();
}

// 能讀多少讀多少，每個欄位分開 try/catch，讀不到的欄位保留目前預設值繼續
function applySaveData(data) {
  try {
    if (typeof data.playerName === "string") gameState.playerName = data.playerName;
    if (typeof data.playerColor === "string" && /^#[0-9a-fA-F]{6}$/.test(data.playerColor)) gameState.playerColor = data.playerColor;
    if (typeof data.crystal === "number") gameState.crystal = Math.max(0, data.crystal);
    if (typeof data.tokens === "number") gameState.tokens = Math.max(0, Math.round(data.tokens));
    if (typeof data.potions === "number") gameState.potions = clamp(data.potions, 0, POTION_MAX);
  } catch (e) {}

  try {
    if (data.storyFlags && typeof data.storyFlags === "object") {
      Object.keys(gameState.storyFlags).forEach((key) => {
        if (typeof data.storyFlags[key] === "boolean") gameState.storyFlags[key] = data.storyFlags[key];
      });
    }
  } catch (e) {}

  try {
    if (data.bestiary && typeof data.bestiary === "object") {
      Object.keys(data.bestiary).forEach((key) => {
        if (MONSTERS[key]) gameState.bestiary[key] = !!data.bestiary[key];
      });
    }
  } catch (e) {}

  try {
    if (data.discoveredNodeTypes && typeof data.discoveredNodeTypes === "object") {
      Object.keys(data.discoveredNodeTypes).forEach((key) => {
        if (NODE_NAMES[key]) gameState.discoveredNodeTypes[key] = !!data.discoveredNodeTypes[key];
      });
    }
    if (typeof data.workshopSuspended === "boolean") gameState.workshopSuspended = data.workshopSuspended;
  } catch (e) {}

  try {
    if (data.discoveredDishes && typeof data.discoveredDishes === "object") {
      Object.keys(data.discoveredDishes).forEach((key) => {
        let known = Object.values(FOODS).some((f) => f.dishId === key);
        if (known && data.discoveredDishes[key]) gameState.discoveredDishes[key] = true;
      });
    }
    if (data.discoveredPotions && typeof data.discoveredPotions === "object") {
      Object.keys(data.discoveredPotions).forEach((key) => {
        if (POTIONS[key] && data.discoveredPotions[key]) gameState.discoveredPotions[key] = true;
      });
    }
  } catch (e) {}

  try {
    if (data.characters && typeof data.characters === "object") {
      Object.keys(gameState.characters).forEach((id) => {
        let c = data.characters[id];
        if (!c || typeof c !== "object") return;
        if (typeof c.level === "number") gameState.characters[id].level = clamp(Math.round(c.level), 1, LEVEL_CAP);
        if (typeof c.exp === "number") gameState.characters[id].exp = Math.max(0, c.exp);
        if (typeof c.weaponLv === "number") gameState.characters[id].weaponLv = Math.max(0, Math.round(c.weaponLv));
        if (typeof c.armorLv === "number") gameState.characters[id].armorLv = Math.max(0, Math.round(c.armorLv));
        gameState.characters[id].relics = []; // 先清空，下面統一重建（同一件遺物不會同時裝在兩個角色身上）
      });
      // 遺物讀檔：只保留合法 id、去重（跨角色也不重複）、每人上限 RELIC_MAX_PER_CHARACTER。舊存檔沒有 relics 就都空著。
      let usedRelicIds = {};
      Object.keys(gameState.characters).forEach((id) => {
        let c = data.characters[id];
        if (!c || !Array.isArray(c.relics)) return;
        c.relics.forEach((rid) => {
          if (gameState.characters[id].relics.length >= RELIC_MAX_PER_CHARACTER) return;
          if (usedRelicIds[rid]) return;
          if (!RELICS.some((r) => r.id === rid)) return;
          usedRelicIds[rid] = true;
          gameState.characters[id].relics.push(rid);
        });
      });
    }
  } catch (e) {}

  try {
    if (data.rawFoodInventory && typeof data.rawFoodInventory === "object") {
      Object.keys(data.rawFoodInventory).forEach((key) => {
        if (!FOODS[key]) return;
        let entry = data.rawFoodInventory[key];
        gameState.rawFoodInventory[key] = {
          normal: typeof entry.normal === "number" ? Math.max(0, entry.normal) : 0,
          rare: typeof entry.rare === "number" ? Math.max(0, entry.rare) : 0,
        };
      });
    }
  } catch (e) {}

  try {
    if (data.cookedInventory && typeof data.cookedInventory === "object") {
      Object.keys(data.cookedInventory).forEach((key) => {
        let known = Object.values(FOODS).some((f) => f.dishId === key);
        if (!known) return;
        let entry = data.cookedInventory[key];
        gameState.cookedInventory[key] = {
          normal: typeof entry.normal === "number" ? Math.max(0, entry.normal) : 0,
          rare: typeof entry.rare === "number" ? Math.max(0, entry.rare) : 0,
        };
      });
    }
  } catch (e) {}

  try {
    if (data.foodAssignment && typeof data.foodAssignment === "object") {
      Object.keys(gameState.foodAssignment).forEach((id) => {
        let f = data.foodAssignment[id];
        if (!f || typeof f !== "object" || typeof f.dishId !== "string") { gameState.foodAssignment[id] = null; return; }
        let known = Object.values(FOODS).some((food) => food.dishId === f.dishId);
        let entry = gameState.cookedInventory[f.dishId];
        let rare = !!f.rare;
        let have = entry ? (rare ? entry.rare : entry.normal) : 0;
        gameState.foodAssignment[id] = (known && have > 0) ? { dishId: f.dishId, rare } : null;
      });
    }
  } catch (e) {}

  try {
    if (data.rawHerbInventory && typeof data.rawHerbInventory === "object") {
      Object.keys(data.rawHerbInventory).forEach((key) => {
        if (!HERBS[key]) return;
        let entry = data.rawHerbInventory[key];
        gameState.rawHerbInventory[key] = {
          normal: typeof entry.normal === "number" ? Math.max(0, entry.normal) : 0,
          rare: typeof entry.rare === "number" ? Math.max(0, entry.rare) : 0,
        };
      });
    }
  } catch (e) {}

  try {
    if (data.craftedPotionInventory && typeof data.craftedPotionInventory === "object") {
      Object.keys(data.craftedPotionInventory).forEach((key) => {
        if (!POTIONS[key]) return;
        let entry = data.craftedPotionInventory[key];
        gameState.craftedPotionInventory[key] = {
          normal: typeof entry.normal === "number" ? Math.max(0, entry.normal) : 0,
          rare: typeof entry.rare === "number" ? Math.max(0, entry.rare) : 0,
        };
      });
    }
  } catch (e) {}

  try {
    if (data.potionAssignment && typeof data.potionAssignment === "object") {
      Object.keys(gameState.potionAssignment).forEach((id) => {
        let f = data.potionAssignment[id];
        if (!f || typeof f !== "object" || typeof f.potionId !== "string" || !POTIONS[f.potionId]) { gameState.potionAssignment[id] = null; return; }
        let entry = gameState.craftedPotionInventory[f.potionId];
        let rare = !!f.rare;
        let have = entry ? (rare ? entry.rare : entry.normal) : 0;
        gameState.potionAssignment[id] = have > 0 ? { potionId: f.potionId, rare } : null;
      });
    }
  } catch (e) {}

  try {
    if (data.equippedSkills && typeof data.equippedSkills === "object") {
      Object.keys(gameState.equippedSkills).forEach((id) => {
        let list = data.equippedSkills[id];
        if (!Array.isArray(list)) return;
        let validIds = list.filter((skillId) => SKILLS[skillId] && SKILLS[skillId].owner === id);
        if (validIds.length > 0) gameState.equippedSkills[id] = validIds.slice(0, 4);
      });
    }
  } catch (e) {}

  try {
    if (typeof data.lastDepartLayer === "number" && data.lastDepartLayer >= 1) {
      gameState.lastDepartLayer = Math.round(data.lastDepartLayer);
    }
  } catch (e) {}

  try {
    if (data.storyLog && typeof data.storyLog === "object") {
      gameState.storyLog = {};
      Object.keys(data.storyLog).forEach((id) => {
        let s = data.storyLog[id];
        if (s && Array.isArray(s.lines)) {
          gameState.storyLog[id] = {
            title: typeof s.title === "string" ? s.title : id,
            order: typeof s.order === "number" ? s.order : 0,
            lines: s.lines.filter((l) => l && typeof l.text === "string").map((l) => ({ speaker: l.speaker || "", text: l.text })),
          };
        }
      });
    }
  } catch (e) {}

  try {
    if (data.settings && typeof data.settings === "object") {
      if (typeof data.settings.autoTargetSingleEnemy === "boolean") gameState.settings.autoTargetSingleEnemy = data.settings.autoTargetSingleEnemy;
      if (typeof data.settings.typewriter === "boolean") gameState.settings.typewriter = data.settings.typewriter;
      if (AUTO_MODES.indexOf(data.settings.autoMode) >= 0) gameState.settings.autoMode = data.settings.autoMode;
    }
  } catch (e) {}

  try {
    if (data.achievements && typeof data.achievements === "object") {
      Object.keys(data.achievements).forEach((id) => {
        if (data.achievements[id]) gameState.achievements[id] = true;
      });
    }
  } catch (e) {}

  try {
    if (data.stats && typeof data.stats === "object") {
      Object.keys(gameState.stats).forEach((key) => {
        if (typeof data.stats[key] === "number") gameState.stats[key] = Math.max(0, data.stats[key]);
      });
    }
  } catch (e) {}

  syncLRoster();
  systemToast("📂 讀檔完成。");
  activeDive = null;
  if (gameState.storyFlags.introDone) {
    showShelterScreen();
  } else {
    startOpeningStory();
  }
}

// L救出來之後才正式入隊：SHELTER_PARTY_IDS／PARTY_ORDER_LAYER1一開始都是預設3人，
// 讀檔或重新整理頁面時要照gameState.storyFlags.lRescued把L補回去（handleBossVictory()第一次救到L時也會呼叫這個函式）。
function syncLRoster() {
  if (!gameState.storyFlags.lRescued) return;
  if (!SHELTER_PARTY_IDS.includes("L")) SHELTER_PARTY_IDS.push("L");
  if (!PARTY_ORDER_LAYER1.includes("L")) PARTY_ORDER_LAYER1.push("L");
}

// ---------- 遊戲入口 ----------

function initGame() {
  syncLRoster();
  if (gameState.storyFlags.introDone) {
    showShelterScreen();
  } else {
    startOpeningStory();
  }
}

window.addEventListener("DOMContentLoaded", initGame);
