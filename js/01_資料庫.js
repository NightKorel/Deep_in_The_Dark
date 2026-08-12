// ========================================
// 潛淵 - 資料庫
// 只放純資料（角色/技能/怪物/節點/道具），邏輯放在其他檔案。
// ========================================

// ---------- 經濟與成長常數 ----------

const SHELTER_MAINTENANCE_FEE = 3; // 每次回避難所扣的維護費
const POTION_MAX = 12;
const POTION_REFILL_COST = 1; // 潛晶/瓶
const POTION_HEAL_PERCENT = 0.30; // 補血藥回復比例（藥效強化增益可提升到0.45）
// 補血藥「外敷」用法（第二層Boss戰後L研發出來、由 storyFlags.potionApplyUnlocked 解鎖）：
// 不是當場回血，而是接下來數回合的持續回血（HoT）。從「下一回合開始」才回第一次，跟中毒/流血/持續回血技能同步結算。
const POTION_HOT_PERCENT = 0.15; // 外敷：每回合回復最大血量比例（藥效強化時 ×1.5）
const POTION_HOT_DURATION = 3;   // 外敷：持續回合數（15%×3＝總量45%，比直飲30%多、但延遲又怕被打斷，兩種用法各有取捨）

// 升級費用：Lv1=10，之後每級 x1.5 無條件進位
const UPGRADE_COST_BY_LEVEL = [0, 10, 15, 23, 35, 53];
function getUpgradeCost(currentLevel) {
  // currentLevel 是目前等級，升到 currentLevel+1 要付 UPGRADE_COST_BY_LEVEL[currentLevel+1]
  let targetLevel = currentLevel + 1;
  if (targetLevel < UPGRADE_COST_BY_LEVEL.length) return UPGRADE_COST_BY_LEVEL[targetLevel];
  // 超出表格範圍的話，沿用同樣 x1.5 無條件進位的規律往下推算
  let cost = UPGRADE_COST_BY_LEVEL[UPGRADE_COST_BY_LEVEL.length - 1];
  for (let lv = UPGRADE_COST_BY_LEVEL.length; lv <= targetLevel; lv++) {
    cost = Math.ceil(cost * 1.5);
  }
  return cost;
}
const UPGRADE_GROWTH_RATE = 1.10; // 武器/裝備每級成長倍率

// 經驗值曲線：index = 目前等級，值 = 從這一級升到下一級所需的經驗
const EXP_CURVE = [0, 30, 100, 300];
function getExpNeeded(level) {
  if (level < EXP_CURVE.length) return EXP_CURVE[level];
  let last = EXP_CURVE[EXP_CURVE.length - 1];
  for (let lv = EXP_CURVE.length; lv <= level; lv++) {
    last = Math.round(last * 2.75); // 5級以後：每級約上一級的2.5~3倍，取中間值2.75
  }
  return last;
}
const LEVEL_CAP = 20; // 目前內容還沒設計到這麼高，先放一個寬鬆上限避免無限升級

// ---------- 角色 ----------

const CHARACTERS = {
  主角: {
    id: "主角",
    name: "", // 由玩家輸入，開場劇情結束後填入
    icon: "🗡️",
    weaponName: "劍",
    baseHp: 20,
    baseAtk: 4, atkRange: [3, 5], // 普攻
    skillIds: ["主角_劈斬", "主角_格擋", "主角_重斬", "主角_振作"],
  },
  K: {
    id: "K",
    name: "K",
    icon: "🍳",
    weaponName: "雙刀",
    baseHp: 18,
    baseAtk: 2, atkRange: [1, 3], atkHits: 2, // 普攻砍兩下，各1~3
    skillIds: ["K_治癒", "K_風刃", "K_雙擊", "K_輕靈"],
    color: "#a97142", // 代表色：棕色
  },
  V: {
    id: "V",
    name: "V",
    icon: "🔪",
    weaponName: "匕首",
    baseHp: 14,
    baseAtk: 5, atkRange: [4, 6],
    skillIds: ["V_流血技", "V_爆擊技", "V_蓄力", "V_隱步"],
    color: "#3d8fd6", // 代表色：藍色
  },
  L: {
    id: "L",
    name: "L",
    icon: "🧪",
    weaponName: "法杖",
    baseHp: 16,
    baseAtk: 3, atkRange: [2, 4],
    skillIds: ["L_冰錐", "L_應急繃帶", "L_冰盾", "L_霜爆"], // 打贏Boss救出來後正式入隊，見06_戰鬥.js的handleBossVictory
    color: "#4caf6e", // 代表色：綠色
  },
};

const DEFAULT_PLAYER_COLOR = "#d9a441"; // 主角預設代表色（金色），可在設定選單自訂

// 出征小隊固定順序（速度由高到低）：K → 主角 → V，L救出來後加在最後
// 注意：這兩個陣列在遊戲執行中會被動態push("L")（見05_深潛.js的handleBossVictory、02_介面共用與存讀檔.js的syncLRoster），
// 不是單純的常數，L救出來前後長度會不一樣。
const PARTY_ORDER_LAYER1 = ["K", "主角", "V"];

// ---------- 技能 ----------
// type: "attack"(造成傷害) / "heal"(治療) / "hot"(持續回血) / "guard"(格擋，主角專屬)
//   / "self-heal-percent"(立即回復自身%血量) / "party-dmg-buff"(全隊下次攻擊傷害+%)
//   / "self-charge"(下次任意攻擊傷害×倍率) / "self-dodge"(當回合自身閃避+%)
//   / "damage-reduction"(單體隊友減傷%，持續N回合)
// targetType: "single-enemy" / "all-enemies" / "single-ally" / "self" / "none"

const SKILLS = {
  // ===== 主角（Lv1~4）=====
  主角_劈斬: {
    id: "主角_劈斬", name: "劈斬", owner: "主角", type: "attack",
    targetType: "single-enemy", dmgRange: [5, 7], missRate: 0.15, maxUses: 10,
  },
  主角_格擋: {
    id: "主角_格擋", name: "格擋", owner: "主角", type: "guard",
    targetType: "none", maxUses: 5,
    taunt: true, // 100%成為敵方單體攻擊的目標，已經靠pickAllyTarget()的既有邏輯實現，這裡只是標記
  },
  主角_重斬: {
    id: "主角_重斬", name: "重斬", owner: "主角", type: "attack",
    targetType: "single-enemy", dmgRange: [4, 6], maxUses: 5, stunChance: 0.30,
  },
  主角_振作: {
    id: "主角_振作", name: "振作", owner: "主角", type: "self-heal-percent",
    targetType: "self", healPercent: 0.50, maxUses: 3,
  },

  // ===== K（Lv1~4）=====
  K_治癒: {
    id: "K_治癒", name: "治癒", owner: "K", type: "heal",
    targetType: "single-ally", healRange: [5, 7], maxUses: 5,
  },
  K_風刃: {
    id: "K_風刃", name: "風刃", owner: "K", type: "attack",
    targetType: "all-enemies", dmgRange: [1, 3], maxUses: 20,
  },
  K_雙擊: {
    id: "K_雙擊", name: "雙擊", owner: "K", type: "attack",
    targetType: "single-enemy", dmgRange: [1, 4], maxUses: 10, hits: 2,
  },
  K_輕靈: {
    id: "K_輕靈", name: "輕靈", owner: "K", type: "party-dmg-buff",
    targetType: "all-allies", dmgBuffPercent: 0.20, maxUses: 3, duration: 1,
  },

  // ===== V（Lv1~4）=====
  V_流血技: {
    id: "V_流血技", name: "流血技", owner: "V", type: "attack",
    targetType: "single-enemy", dmgRange: [2, 4], maxUses: 10, applyBleed: 1,
  },
  V_爆擊技: {
    id: "V_爆擊技", name: "爆擊技", owner: "V", type: "attack",
    targetType: "single-enemy", dmgRange: [3, 5], maxUses: 10, critRateOverride: 0.30,
  },
  V_蓄力: {
    id: "V_蓄力", name: "蓄力", owner: "V", type: "self-charge",
    targetType: "self", chargeMultiplier: 2, maxUses: 3,
  },
  V_隱步: {
    id: "V_隱步", name: "隱步", owner: "V", type: "self-dodge",
    targetType: "self", dodgeChance: 0.50, maxUses: 3,
  },

  // ===== L（Lv1~4）=====
  L_冰錐: {
    id: "L_冰錐", name: "冰錐", owner: "L", type: "attack",
    targetType: "single-enemy", dmgRange: [4, 6], maxUses: 20,
  },
  L_應急繃帶: {
    id: "L_應急繃帶", name: "應急繃帶", owner: "L", type: "hot",
    targetType: "single-ally", hotHealPerTurn: 3, hotDuration: 3, maxUses: 3,
  },
  L_冰盾: {
    id: "L_冰盾", name: "冰盾", owner: "L", type: "damage-reduction",
    targetType: "single-ally", damageReduction: 0.30, maxUses: 5, duration: 1,
  },
  L_霜爆: {
    id: "L_霜爆", name: "霜爆", owner: "L", type: "attack",
    targetType: "all-enemies", dmgRange: [4, 6], maxUses: 3,
  },
};

// ---------- 狀態效果常數 ----------

const BLEED_DAMAGE_PER_STACK = 1;
const BLEED_MAX_STACKS = 3;
const BLEED_DURATION = 3;
const GUARD_DAMAGE_REDUCTION = 0.30;
const BASE_CRIT_RATE = 0.05;
const BASE_CRIT_MULT = 2;
const DAMAGE_VARIANCE = 0.15; // ±15%
const CHARGE_BONUS = 0.20; // 蓄勢 +20%（「岩蚺之牙」等 charge-bonus-override 遺物可提升到30%）
const FLEE_SUCCESS_RATE = 0.60;

// 中毒（第二層新狀態）：持續3回合，期間受到的治療效果減半（不直接扣血）；
// 不可疊加，重複中毒只刷新持續時間，不疊層。用來跟「流血」（直接扣血）做出區隔。
const POISON_DURATION = 3;
const POISON_HEAL_MULTIPLIER = 0.5;

// ---------- 怪物 ----------
// intents 對照 skillId -> "⚔️"/"☠️"/"❓"

const MONSTERS = {
  凝膠: {
    id: "凝膠", name: "凝膠", icon: "🟢",
    hpRange: [6, 10],
    skillIds: ["凝膠_猛擊", "凝膠_彈跳", "凝膠_壓縮"],
    codex: "到處都有，走路不看地的話踩上去會滑一跤，別問我怎麼知道的。打起來不難，就是有點煩，跟甩不掉的鼻涕一樣。",
    idleLine: "凝膠在地面微微顫動著，像是在呼吸。",
    foodId: "凝膠凍",
  },
  藍顎獸: {
    id: "藍顎獸", name: "藍顎獸", icon: "🐊",
    hpRange: [18, 25],
    skillIds: ["藍顎獸_撕咬", "藍顎獸_蓄力", "藍顎獸_重擊"],
    codex: "看到那張大嘴你就懂了，能在石頭上留齒痕的傢伙。平常趴在水邊跟石頭一樣，我第一次遇到的時候差點坐上去。……對，V 笑了很久。",
    idleLine: "藍顎獸的豎瞳緊盯著你，尾巴緩緩掃過地面。",
    foodId: "顎獸肉塊",
  },
  翅鱗: {
    id: "翅鱗", name: "翅鱗", icon: "🐟",
    hpRange: [8, 12],
    skillIds: ["翅鱗_斬擊", "翅鱗_俯衝", "翅鱗_水花"],
    codex: "會飛的魚，你相信嗎？我看到的時候還以為自己剛剛摔跤摔出幻覺了。速度真的很快，不太容易打到，好在皮很薄。",
    idleLine: "翅鱗在半空中來回穿梭，鰭片反射著微光。",
    foodId: "翅鱗魚片",
  },
  眼藻: {
    id: "眼藻", name: "眼藻", icon: "👁️",
    hpRange: [10, 15],
    skillIds: ["眼藻_鞭擊", "眼藻_纏繞", "眼藻_凝視"],
    codex: "遠看就是一團水藻，走近才發現上面全是——嗯，被一堆眼珠子盯著的感覺我到現在還不太習慣。長在潮濕的角落，最好別讓它們結群。",
    idleLine: "眼藻滴溜溜地轉動著，載浮載沉。",
    foodId: "水藻脆球",
  },
  島鯨: {
    id: "島鯨", name: "島鯨", icon: "🐋", isBoss: true,
    hpRange: [75, 75],
    skillIds: ["島鯨_巨浪", "島鯨_噴射", "島鯨_反芻", "島鯨_聲納"],
    codex: "……說實話我也不太確定那是什麼，太大了，我們看到的應該只是一部分吧。牠到底吞了多少東西啊……",
    idleLine: "水面下的巨影緩緩移動著，發出低沉的共鳴。",
    foodId: null,
  },
  寶箱怪: {
    id: "寶箱怪", name: "寶箱怪", icon: "🎁",
    hpRange: [18, 18],
    skillIds: ["寶箱怪_攻擊"],
    innateDodge: 0.50, // 天生常駐50%閃避（不會被消耗，每次被攻擊都重新判定）
    fleesAfterRound: 2, // 補丁v1修改5事件6：第1回合只會攻擊一次，第2回合開始時自動逃走消失(沒有獎勵)
    codex: "圖鑑待補。",
    idleLine: "箱子安靜地待在原地，彷彿只是個普通的箱子。",
    foodId: null,
  },

  // ===== 第二層：乾燥岩洞地帶 =====
  // 區域基調：外表不起眼／看起來可愛，實際兇猛危險。
  // 血量對標「玩家等級4、武器與裝備都約3級（帶著幾個遺物）」的狀態——比初版調高，避免被秒殺、太弱。
  刺螯: {
    id: "刺螯", name: "刺螯", icon: "🦂",
    hpRange: [16, 20],
    skillIds: ["刺螯_夾擊", "刺螯_毒刺", "刺螯_鑽沙"],
    codex: "比拳頭大一點，踩都能踩死。但要是被螫到，喝什麼藥都像在喝白開水，連V煮的酸味湯都沒味道了，超詭異的。（V：？）",
    idleLine: "刺螯的尾刺微微顫動，發出乾澀的摩擦聲。",
    foodId: null, herbId: "刺螯毒腺",
  },
  膜翼: {
    id: "膜翼", name: "膜翼", icon: "🦇",
    hpRange: [26, 32],
    skillIds: ["膜翼_利爪", "膜翼_超聲波", "膜翼_吸血"],
    codex: "掛在洞頂一坨一坨的，我本來以為是某種石筍，直到聽見牠尖叫……哭啊，都快聾了:(",
    idleLine: "膜翼倒掛在陰影中，發出細碎的高頻鳴叫。",
    foodId: null, herbId: "膜翼血囊",
  },
  垂垂耳: {
    id: "垂垂耳", name: "垂垂耳", icon: "🐰",
    hpRange: [30, 38],
    skillIds: ["垂垂耳_踢擊", "垂垂耳_連踢", "垂垂耳_猛撞"],
    codex: "毛茸茸的，大耳朵垂著，好可愛……然後牠踢裂了地上那塊石頭。欸L你什麼意思，我才沒有想摸！",
    idleLine: "垂垂耳的後腿微微下壓，肌肉繃得很緊。",
    foodId: "垂垂耳腿肉",
  },
  尖嘴鼠: {
    id: "尖嘴鼠", name: "尖嘴鼠", icon: "🐹",
    hpRange: [26, 32],
    skillIds: ["尖嘴鼠_爪擊", "尖嘴鼠_地震", "尖嘴鼠_掘地"],
    codex: "走路搖搖晃晃的，看起來真的很呆，到底怎麼那麼會鑽啊？？？",
    idleLine: "尖嘴鼠的爪子刨動著地面，碎石不斷滾落。",
    foodId: "尖嘴鼠肉",
  },

  // ===== 第二層 Boss：巨岩蚺 =====
  巨岩蚺: {
    id: "巨岩蚺", name: "巨岩蚺", icon: "🐍", isBoss: true,
    hpRange: [120, 120],
    skillIds: ["巨岩蚺_喚岩", "巨岩蚺_碎地連擊", "巨岩蚺_地陷"],
    codex: "岩洞最深處的石堆其實是牠。跟岩壁同一個顏色。被壓進地裡超級可怕，我不想再體驗第二次了……",
    idleLine: "巨岩蚺的鱗片與岩壁融為一體，只有吐信時才看得出牠在哪。",
    foodId: null, herbId: null,
  },
};

// 怪物技能：type同角色技能；cooldown為冷卻回合數(0=無冷卻，每回合都能用)；intent對應顯示圖示
const MONSTER_SKILLS = {
  凝膠_猛擊: { id: "凝膠_猛擊", name: "猛擊", type: "attack", targetType: "single-enemy", dmgRange: [1, 3], cooldown: 0, intent: "⚔️", isBasic: true },
  凝膠_彈跳: { id: "凝膠_彈跳", name: "彈跳", type: "self-heal", healRange: [2, 4], cooldown: 2, intent: "❓" },
  凝膠_壓縮: { id: "凝膠_壓縮", name: "壓縮", type: "self-shield", shieldAmount: 3, cooldown: 2, intent: "❓" },

  藍顎獸_撕咬: { id: "藍顎獸_撕咬", name: "撕咬", type: "attack", targetType: "single-enemy", dmgRange: [4, 6], cooldown: 0, intent: "⚔️", isBasic: true },
  藍顎獸_蓄力: { id: "藍顎獸_蓄力", name: "蓄力", type: "charge-up", cooldown: 0, intent: "🌀" },
  藍顎獸_重擊: { id: "藍顎獸_重擊", name: "重擊", type: "attack", targetType: "single-enemy", dmgRange: [10, 14], cooldown: 0, intent: "⚔️", forcesNextBite: true },

  翅鱗_斬擊: { id: "翅鱗_斬擊", name: "斬擊", type: "attack", targetType: "single-enemy", dmgRange: [1, 3], hits: 2, cooldown: 0, intent: "⚔️", isBasic: true },
  翅鱗_俯衝: { id: "翅鱗_俯衝", name: "俯衝", type: "self-buff-dodge", dodgeChance: 0.50, cooldown: 2, intent: "❓" },
  翅鱗_水花: { id: "翅鱗_水花", name: "水花", type: "attack", targetType: "all-enemies", dmgRange: [1, 3], cooldown: 2, intent: "⚔️" },

  眼藻_鞭擊: { id: "眼藻_鞭擊", name: "鞭擊", type: "attack", targetType: "single-enemy", dmgRange: [2, 4], cooldown: 0, intent: "⚔️", isBasic: true },
  眼藻_纏繞: { id: "眼藻_纏繞", name: "纏繞", type: "apply-bleed-all", bleedStacks: 1, cooldown: 2, intent: "☠️" },
  眼藻_凝視: { id: "眼藻_凝視", name: "凝視", type: "attack", targetType: "single-enemy", dmgRange: [4, 6], cooldown: 1, intent: "⚔️" },

  島鯨_巨浪: { id: "島鯨_巨浪", name: "巨浪", type: "attack", targetType: "all-enemies", dmgRange: [1, 3], cooldown: 0, intent: "⚔️" },
  島鯨_噴射: { id: "島鯨_噴射", name: "噴射", type: "attack", targetType: "single-enemy", dmgRange: [7, 9], cooldown: 1, intent: "⚔️" },
  島鯨_反芻: { id: "島鯨_反芻", name: "反芻", type: "summon", summonPool: "layer1", cooldown: 3, intent: "❓" },
  島鯨_聲納: { id: "島鯨_聲納", name: "聲納", type: "stun-chance-all", stunChance: 0.30, cooldown: 3, intent: "☠️" },

  寶箱怪_攻擊: { id: "寶箱怪_攻擊", name: "攻擊", type: "attack", targetType: "single-enemy", dmgRange: [1, 3], cooldown: 0, intent: "⚔️", isBasic: true },

  // ===== 第二層小怪技能 =====
  // isBasic 的技能在意圖列一律顯示「攻擊」；其餘顯示技能本名。
  刺螯_夾擊: { id: "刺螯_夾擊", name: "夾擊", type: "attack", targetType: "single-enemy", dmgRange: [2, 4], cooldown: 0, intent: "⚔️", isBasic: true },
  刺螯_毒刺: { id: "刺螯_毒刺", name: "毒刺", type: "attack-random-allies", targetCount: 2, dmgRange: [2, 4], applyPoison: true, cooldown: 3, intent: "☠️" },
  刺螯_鑽沙: { id: "刺螯_鑽沙", name: "鑽沙", type: "self-buff-dodge", dodgeChance: 0.50, cooldown: 2, intent: "❓" },

  膜翼_利爪: { id: "膜翼_利爪", name: "利爪", type: "attack", targetType: "single-enemy", dmgRange: [3, 5], cooldown: 0, intent: "⚔️", isBasic: true },
  膜翼_超聲波: { id: "膜翼_超聲波", name: "超聲波", type: "stun-chance-all", stunChance: 0.30, cooldown: 3, intent: "☠️" },
  膜翼_吸血: { id: "膜翼_吸血", name: "吸血", type: "attack", targetType: "single-enemy", dmgRange: [3, 5], lifesteal: true, cooldown: 2, intent: "⚔️" },

  垂垂耳_踢擊: { id: "垂垂耳_踢擊", name: "踢擊", type: "attack", targetType: "single-enemy", dmgRange: [4, 6], cooldown: 0, intent: "⚔️", isBasic: true },
  垂垂耳_連踢: { id: "垂垂耳_連踢", name: "連踢", type: "attack", targetType: "single-enemy", dmgRange: [2, 4], hits: 2, cooldown: 1, intent: "⚔️" },
  垂垂耳_猛撞: { id: "垂垂耳_猛撞", name: "猛撞", type: "attack", targetType: "single-enemy", dmgRange: [8, 12], cooldown: 2, intent: "⚔️" },

  尖嘴鼠_爪擊: { id: "尖嘴鼠_爪擊", name: "爪擊", type: "attack", targetType: "single-enemy", dmgRange: [3, 5], cooldown: 0, intent: "⚔️", isBasic: true },
  尖嘴鼠_地震: { id: "尖嘴鼠_地震", name: "地震", type: "attack", targetType: "all-enemies", dmgRange: [3, 5], cooldown: 2, intent: "⚔️" },
  尖嘴鼠_掘地: { id: "尖嘴鼠_掘地", name: "掘地", type: "burrow", emergeSkillId: "尖嘴鼠_破土", cooldown: 3, intent: "🌀" },
  尖嘴鼠_破土: { id: "尖嘴鼠_破土", name: "破土", type: "attack", targetType: "single-enemy", dmgRange: [6, 9], cooldown: 0, intent: "⚔️" },

  // ===== 第二層 Boss「巨岩蚺」技能 =====
  // 三招式，冷卻都 ≥2（沒有一回合冷卻的招）：
  //  1) 喚岩：叫出小怪，並「預約」下一回合吞掉其中一隻回血（吞噬為連動招、非隨機挑選）。
  //     小怪若在被吞前被玩家打死，這次吞噬就撲空、補不到血——這是玩家的反制點。
  //  2) 碎地連擊：隨機打 3 下，同一個人最多挨 2 下。
  //  3) 地陷：把一名角色壓進地面，受一次傷害後被震懾 2 回合。
  巨岩蚺_喚岩: { id: "巨岩蚺_喚岩", name: "喚岩", type: "summon-then-devour", summonPool: "layer2", summonCount: 2, chainSkillId: "巨岩蚺_吞噬", cooldown: 4, intent: "❓" },
  巨岩蚺_吞噬: { id: "巨岩蚺_吞噬", name: "吞噬", type: "devour-heal", healAmount: 22, cooldown: 0, intent: "❓" }, // forcedNextSkillId 連動觸發，不進隨機池
  巨岩蚺_碎地連擊: { id: "巨岩蚺_碎地連擊", name: "碎地連擊", type: "multi-random-hits", hits: 3, maxPerTarget: 2, dmgRange: [4, 7], cooldown: 2, intent: "⚔️" },
  巨岩蚺_地陷: { id: "巨岩蚺_地陷", name: "地陷", type: "press-stun", dmgRange: [6, 9], stunTurns: 2, cooldown: 3, intent: "☠️" },
};

const ELITE_HP_MULT = 1.5; // 無條件進位
const ELITE_DMG_MULT = 1.3; // 無條件進位
const MAX_ENEMIES_ON_FIELD = 4;

// 敵人組合
// 小怪節點：每次隨機決定2或3隻、從當層怪物池不重複抽選（見05_深潛.js的generateRandomMonsterGroup）。
// 菁英節點（2026-08-12 納可拍板改成隨機）：一樣隨機抽2~3隻、整組菁英化，不再用固定配方（舊的 ENEMY_GROUPS_* 已移除）。
const LAYER1_MONSTER_POOL = ["凝膠", "藍顎獸", "翅鱗", "眼藻"];
const LAYER2_MONSTER_POOL = ["刺螯", "膜翼", "垂垂耳", "尖嘴鼠"];

// 圈層對應的 Boss 與各圈層的怪物池，讓深潛系統依 activeDive.layer 取用（見 05_深潛.js 的 getLayerXxx）。
const LAYER_BOSS = { 1: "島鯨", 2: "巨岩蚺" };
const LAYER_MONSTER_POOLS = { 1: LAYER1_MONSTER_POOL, 2: LAYER2_MONSTER_POOL };
// 圈層基本資料：目前兩層，深潛系統與圈層選擇畫面共用。
const LAYERS_META = {
  1: { layer: 1, name: "海洋", subtitle: "第一圈層" },
  2: { layer: 2, name: "乾燥岩洞地帶", subtitle: "第二圈層" },
};
const MAX_LAYER = 2;
// （2026-08-12）納可拍板：選深層跳關「不再自動補償任何增益或遺物」，就單純跳關。舊的 SKIP_LAYER_*_COMP 已移除。
const MIMIC_AMBUSH_CHANCE = 0.05; // 一般小怪戰鬥額外混入寶箱怪的機率（不佔原本2~3隻的名額，是多加的）

// 每隻小怪的經驗值與潛晶掉落（第一圈層小怪戰鬥）
const EXP_PER_MONSTER_LAYER1 = [3, 5]; // 隨機範圍
const BOSS_EXP_REWARD = 20; // 文件沒寫Boss經驗值，先抓一個合理數字，之後可調
const CRYSTAL_DROP = {
  普通: [3, 6],  // 小幅上調：打怪有風險（掉血/耗技能/可能全滅），潛晶要比被動事件多一點才值得
  菁英: [7, 11],
  Boss: [12, 18],
};
// 圈層獎勵倍率：越深的圈層敵人越難，潛晶與經驗小幅上調，讓後期好賺一點；刻意只加一點點，別讓賭場以外的經濟膨脹太快。
const LAYER_REWARD_MULT = { 1: 1, 2: 1.25 };
// 探索類（隨機事件／奇異地形／寶藏）撿到的潛晶，越深的圈層給越多。刻意比戰鬥倍率(1.25)更明顯一點，
// 讓「往更深處探索」本身就有回報；但一樣壓在合理範圍，別把玩家養太肥。
const LAYER_FIND_MULT = { 1: 1, 2: 1.5 };
// 混戰中打死寶箱怪的額外獎勵（疊加在原本的戰鬥獎勵之上）：50%機率潛晶大獎，50%機率潛晶小獎+1個隨機遺物
const MIMIC_BONUS_CRYSTAL_BIG = [8, 12];
const MIMIC_BONUS_CRYSTAL_SMALL = [4, 6];

// ---------- 深潛節點 ----------

const NODE_ICONS = {
  monster: "👾",
  elite: "👿",
  boss: "🏴‍☠️",
  rest: "⛺",
  oddity: "🔮",
  cost_exchange: "♻️",
  gamble: "🎲",
  shop: "💰",
  event: "❔",
  treasure: "📦",
};
const NODE_NAMES = {
  monster: "小怪",
  elite: "菁英怪",
  boss: "Boss",
  rest: "休息點",
  oddity: "奇異地形",
  cost_exchange: "代價交換",
  gamble: "賭博",
  shop: "商人",
  event: "隨機事件",
  treasure: "寶藏",
};

// 第一圈層節點配置：每格是可選的節點類型列表
// 補丁v1修改1+3：第1/5格改單選(強制戰鬥，不用選了等於沒得選)；第6格改商店，原本第6格的❔搬到第8格
const LAYER1_NODE_CONFIG = [
  { options: ["monster"] },                 // 第1格：單選，強制戰鬥
  { options: ["event", "oddity"] },         // 第2格
  { options: ["monster", "treasure"] },     // 第3格
  { options: ["rest", "cost_exchange"] },   // 第4格
  { options: ["monster"] },                 // 第5格：單選，強制戰鬥
  { options: ["shop", "oddity"] },          // 第6格
  { options: ["rest", "monster", "elite"] }, // 第7格：三選一
  { options: ["gamble", "event"] },         // 第8格：把原本的代價交換換成「神秘賭局🎲」——刻意放後段，玩家這時通常已經攢了點潛晶（見納可要求）
  { options: ["treasure", "cost_exchange"] }, // 第9格
  { options: ["boss"] },                    // 第10格：固定
];
const LAYER1_DEPTH = LAYER1_NODE_CONFIG.length;

// 第二圈層節點配置（10 格，結構比照第一層；賭場節點🎲放在中後段）。
const LAYER2_NODE_CONFIG = [
  { options: ["monster"] },                 // 第1格：單選，強制戰鬥
  { options: ["event", "oddity"] },         // 第2格
  { options: ["monster", "treasure"] },     // 第3格
  { options: ["rest", "cost_exchange"] },   // 第4格
  { options: ["monster"] },                 // 第5格：單選，強制戰鬥
  { options: ["shop", "gamble"] },          // 第6格：商人 or 神秘賭局
  { options: ["rest", "monster", "elite"] }, // 第7格：三選一
  { options: ["cost_exchange", "event"] },  // 第8格
  { options: ["treasure", "gamble"] },      // 第9格：寶藏 or 神秘賭局
  { options: ["boss"] },                    // 第10格：固定（巨岩蚺）
];
const LAYER2_DEPTH = LAYER2_NODE_CONFIG.length;
const LAYER_NODE_CONFIGS = { 1: LAYER1_NODE_CONFIG, 2: LAYER2_NODE_CONFIG };

// ---------- 休息點 ----------
const REST_HEAL_PERCENT = 0.30;

// ---------- 奇異地形 🔮（隨機抽一個） ----------
// ===== 節點定位規則（🔮 奇異地形 vs ❔ 隨機事件，兩者在第2格等處二選一，別讓玩家只想選一種）=====
// 🔮 奇異地形＝安全的「強化/補給站」：只給 buff／回血／爆擊等「當場變強或回血」的好處，
//    幾乎零風險、且【不給潛晶/藥水/遺物】。玩家想補血或變強、又不想冒險時選它。
// ❔ 隨機事件（見下方 RANDOM_EVENTS）＝有賺頭但有風險的「際遇」：給潛晶/藥水/遺物等戰利品，
//    但可能受傷、被迫戰鬥、甚至空手。想要資源、敢賭一把時選它。
// → 之後新增內容都照這個分工放，才能維持「求強度 vs 求資源」的取捨平衡。
const ODDITY_EVENTS = [
  { id: "發光水池", name: "發光水池", desc: "一窪散發微光的水。看起來可以喝。", options: [
    { label: "喝下去", outcomes: [
      { chance: 0.7, text: "水很清甜。一股暖流散開，傷口舒緩了不少。", effect: { type: "heal-all-percent", value: 0.20 } },
      { chance: 0.3, text: "水帶著淡淡的礦味，喝下去也覺得舒服了些。", effect: { type: "heal-all-percent", value: 0.12 } },
    ] },
    { label: "不喝", effect: { type: "noop" } },
  ] },
  { id: "嗡鳴晶簇", name: "嗡鳴晶簇", desc: "一簇發出低鳴的晶體從牆壁上長出來。靠近時你的手指在發麻。", options: [
    { label: "觸碰", text: "晶體的共鳴在你腦中激起了三道不同的回響。", effect: { type: "choose-one-of-three-buffs" } },
  ] },
  { id: "溫暖氣流", name: "溫暖氣流", desc: "一陣溫暖的風從地底吹上來。很舒服。", options: [
    { label: "感受氣流", text: "暖意滲進身體，緊繃的肌肉鬆了下來。", effect: { type: "heal-all-percent", value: 0.12 } },
  ] },
  { id: "不穩定地面", name: "不穩定地面", desc: "腳下的地面傳來規律的微震，像是底下有什麼正順著你的呼吸回應。", options: [
    { label: "穩住重心，感受它", text: "你順著震動調勻呼吸，一股力量沉進體內。", effect: { type: "random-buff" } },
    { label: "小心繞開", effect: { type: "noop" } },
  ] },
  { id: "潛淵低語", name: "潛淵低語", desc: "空氣中有低沉的嗡鳴聲。不是語言，但你的身體在回應。", options: [
    { label: "聆聽", effect: { type: "random-member-crit-buff", value: 0.10 } },
  ] },
  { id: "靜滯結晶", name: "靜滯結晶", desc: "一塊半透明的結晶懸在半空，裡面的光流動得很慢，靠近時連時間都彷彿黏稠了起來。", options: [
    { label: "汲取暖光 — 全隊回血", text: "溫熱的光注入身體，傷勢緩和了下來。", effect: { type: "heal-all-percent", value: 0.18 } },
    { label: "引導鋒芒 — 一名隊員爆擊率上升", text: "光順著手臂爬上來，凝成一股銳氣。", effect: { type: "random-member-crit-buff", value: 0.10 } },
  ] },
];

// ---------- 代價交換 ♻️（隨機出現兩個選項） ----------
// 補丁v1修改8：從4種擴充到7種後又移除「潛晶換情報」，目前6種，每次仍隨機出2個
const COST_EXCHANGE_FOCUS_DMG_BONUS = 0.15; // 「補血藥換激昂」的下場戰鬥傷害加成
const COST_EXCHANGE_CRIT_BONUS = 0.15; // 「犧牲換爆擊率」的加成
const COST_EXCHANGE_CRIT_BATTLES = 2; // 「犧牲換爆擊率」持續場數
const COST_EXCHANGE_OPTIONS = [
  { id: "犧牲換增益", label: "犧牲一名角色10%當前血量 → 獲得隨機增益", effect: { type: "sacrifice-hp-for-buff", value: 0.10 } },
  { id: "潛晶換回血", label: "支付5潛晶 → 全隊回復30%血量", effect: { type: "pay-crystal-for-heal", cost: 5, healPercent: 0.30 } },
  { id: "料理換潛晶", label: "交出一份攜帶中的料理 → 獲得5~8潛晶", effect: { type: "trade-food-for-crystal", range: [5, 8] } },
  { id: "補血藥換激昂", label: `獻上2瓶補血藥 → 全隊獲得「激昂」，下場戰鬥傷害+${Math.round(COST_EXCHANGE_FOCUS_DMG_BONUS * 100)}%`, effect: { type: "trade-potions-for-dmg-buff", potionCost: 2, value: COST_EXCHANGE_FOCUS_DMG_BONUS } },
  { id: "潛晶換選增益", label: "支付8潛晶 → 從3個增益中選1個", effect: { type: "pay-crystal-for-buff-choice", cost: 8 } },
  { id: "犧牲換爆擊率", label: `獻出一名角色20%當前血量 → 該角色下${COST_EXCHANGE_CRIT_BATTLES}場戰鬥爆擊率+${Math.round(COST_EXCHANGE_CRIT_BONUS * 100)}%`, effect: { type: "sacrifice-hp-for-multi-battle-crit", value: 0.20, critBonus: COST_EXCHANGE_CRIT_BONUS, battles: COST_EXCHANGE_CRIT_BATTLES } },
];

// ---------- 隨機事件 ❔（隨機抽一個，自動觸發） ----------
// 補丁v1修改5：全面重做成10種，6個有選擇+4個無選擇。盲選類事件結果傾向好的多於壞的。
const RANDOM_EVENTS = [
  // ---- 有選擇 (6) ----
  { id: "好奇的生物", name: "好奇的生物", desc: "一隻從沒見過的小生物蹲在路邊，歪著頭看你們。不像有敵意。", options: [
    { label: "給它食物", requiresCarriedFood: true, text: "它吃完之後從角落叼了一個東西過來。", effect: { type: "trade-food-for-crystal", range: [3, 6] } },
    { label: "趕走它", text: "它跑走了，留下了一個小東西。", effect: { type: "find-crystal", range: [2, 4] } },
    { label: "不理它", effect: { type: "noop" } },
  ] },
  { id: "密封的容器", name: "密封的容器", desc: "地上有個密封的石製容器。不知道放了多久。上面的紋路還隱約在動。", options: [
    { label: "打開", outcomes: [
      { chance: 0.7, text: "裡面裝著一些有用的東西。", effect: { type: "compound", effects: [{ type: "find-crystal", range: [2, 4] }, { type: "find-potion", range: [1, 1] }] } },
      { chance: 0.3, text: "打開的瞬間有什麼東西噴了出來——！", effect: { type: "damage-all-flat", value: 3 } },
    ] },
    { label: "不碰", effect: { type: "noop" } },
  ] },
  { id: "受困的旅人遺骸", name: "受困的旅人遺骸", desc: "牆邊有一具靠坐著的骸骨，懷裡還抱著一個包。手邊刻著幾個歪歪扭扭的字，但看不清了。", options: [
    { label: "搜索包裹", effect: { type: "random-one-of", options: [{ type: "random-buff" }, { type: "find-crystal", range: [3, 5] }, { type: "find-potion", range: [1, 2] }] } },
    { label: "留下它", text: "你們默默走過。", effect: { type: "noop" } },
  ] },
  { id: "發光的裂縫", name: "發光的裂縫", desc: "牆面上有一道狹窄的裂縫，裡面透出微弱的光。手伸得進去，但看不到裡面有什麼。", options: [
    { label: "伸手進去", outcomes: [
      { chance: 0.60, text: "你的手碰到了什麼冰涼的東西——是潛晶。", effect: { type: "find-crystal", range: [4, 8] } },
      { chance: 0.25, text: "有什麼刺了你一下！", effect: { type: "damage-random-member-percent", value: 0.15 } },
      { chance: 0.15, text: "你的手碰到了什麼滑滑的東西——它動了！", effect: { type: "forced-battle", group: ["凝膠"], suppressRewards: true } },
    ] },
    { label: "不碰", effect: { type: "noop" } },
  ] },
  { id: "潛晶賭注", name: "潛晶賭注", desc: "地面上有一圈用潛晶粉末畫成的奇怪圖案。中間放著一顆潛晶，好像在等待什麼。", options: [
    { label: "放入3顆潛晶（賭一把）", requiresCrystal: 3, upfrontCost: { crystal: 3 }, outcomes: [
      { chance: 0.5, text: "圖案猛地亮起，中央湧出一小堆潛晶，連你放入的那些一起彈了出來！", effect: { type: "find-crystal", range: [8, 12] } },
      { chance: 0.5, text: "圖案暗了下去。你放入的潛晶連同原本那顆，一起消失了。", effect: { type: "noop" } },
    ] },
    { label: "拿走中間那顆", text: "你伸手拿起了那顆潛晶。什麼也沒發生。", effect: { type: "find-crystal", range: [1, 2] } },
    { label: "離開", effect: { type: "noop" } },
  ] },
  { id: "寶箱怪事件", name: "寶箱怪", desc: "前方有個箱子。看起來裝著不少好東西——等等，它在動。", isMimic: true },

  // ---- 無選擇 (4) ----
  { id: "小型儲藏", name: "發現小型儲藏", desc: "角落裡有一個被遺棄的小包。裡面還剩一些潛晶。", effect: { type: "find-crystal", range: [2, 4] } },
  { id: "漂流者的遺物", name: "漂流者的遺物", desc: "牆邊靠著一個空了的背包。裡面還有幾瓶沒打開的補血藥，夾層裡也藏著幾顆潛晶。", effect: { type: "compound", effects: [{ type: "find-potion", range: [1, 2] }, { type: "find-crystal", range: [1, 3] }] } },
  { id: "寧靜角落", name: "寧靜角落", desc: "這片區域異常安靜，腳步聲都變得柔和了。在這裡待了一會，呼吸順暢了些；角落的碎石堆裡還嵌著幾顆潛晶。", effect: { type: "compound", effects: [{ type: "heal-all-percent", value: 0.15 }, { type: "find-crystal", range: [2, 4] }] } },
  { id: "地面塌陷", name: "地面塌陷", desc: "腳下一鬆——地面塌了一小塊。碎石刮傷了大家。不過裂縫裡有東西在發光。", effect: { type: "compound", effects: [{ type: "damage-all-flat", value: 2 }, { type: "random-buff" }] } },

  // ---- 新增事件（有選擇）----
  { id: "迴音壁", name: "迴音壁", desc: "一面凹陷的岩壁把你的呼吸聲放大回傳。要不要對它喊點什麼？", options: [
    { label: "放聲大喊", outcomes: [
      { chance: 0.55, text: "層層回音在洞裡盪開，震落了岩壁上幾顆潛晶，也讓你精神為之一振。", effect: { type: "compound", effects: [{ type: "find-crystal", range: [3, 6] }, { type: "random-member-crit-buff", value: 0.10 }] } },
      { chance: 0.45, text: "回音招來了躲在暗處的東西……", effect: { type: "forced-battle", group: ["凝膠", "眼藻"], suppressRewards: true } },
    ] },
    { label: "安靜走開", effect: { type: "noop" } },
  ] },
  { id: "廢棄的營地", name: "廢棄的營地", desc: "一處匆忙棄置的營地，灰燼裡還有一點餘溫。主人似乎走得很急。", options: [
    { label: "快速拿了就走", text: "你抓了幾樣看得見的東西就離開。", effect: { type: "find-crystal", range: [2, 3] } },
    { label: "仔細搜刮一遍", outcomes: [
      { chance: 0.6, text: "翻遍每個角落，收穫不錯。", effect: { type: "compound", effects: [{ type: "find-crystal", range: [4, 7] }, { type: "find-potion", range: [1, 1] }] } },
      { chance: 0.4, text: "你翻倒了一疊東西，某個尖銳的物件劃傷了大家。", effect: { type: "damage-all-flat", value: 3 } },
    ] },
  ] },
  { id: "潛淵鏡面", name: "潛淵鏡面", desc: "一池靜止如鏡的水。水裡倒映出的你，表情卻和你不太一樣。", options: [
    { label: "凝視倒影", outcomes: [
      { chance: 0.5, text: "你在倒影深處看見了某種領悟。", effect: { type: "random-buff" } },
      { chance: 0.5, text: "倒影忽然咧嘴一笑——你猛地回神，背後全是冷汗。", effect: { type: "damage-all-flat", value: 2 } },
    ] },
    { label: "攪散水面", text: "你伸手攪碎了倒影，水面回復平靜。什麼也沒發生……大概吧。", effect: { type: "noop" } },
  ] },

  // ---- 增益互動事件（讓玩家會去在意自己身上有什麼 buff）----
  // 註（2026-08-12）：遺物改成成就永久獎勵後，原本操作遺物的「遺物熔爐／遺物賭盤」已改成純增益版本，
  // 不再有任何深潛中撿遺物或賭遺物的機制。
  { id: "共鳴殘響", name: "共鳴殘響", desc: "空氣裡有一種熟悉的震動——是你身上某個增益的迴響。它躁動著，似乎想換一種樣子。", options: [
    { label: "順著它變化（換一個增益）", text: "你放任那股震動流過全身。", effect: { type: "swap-random-buff" } },
    { label: "壓下這股躁動", effect: { type: "noop" } },
  ] },
  { id: "增益熔爐", name: "增益熔爐", desc: "岩壁上有一處還在悶燒的凹槽，熱氣蒸騰。湊近時，你腦中浮現出三種不同的可能。", options: [
    { label: "湊近火光淬鍊（3選1增益）", text: "你把手探近凹槽，熱氣裡的回響漸漸清晰。", effect: { type: "choose-one-of-three-buffs" } },
    { label: "不碰", effect: { type: "noop" } },
  ] },
  { id: "共鳴賭盤", name: "共鳴賭盤", desc: "地面上刻著一個古怪的圖騰，中央的凹陷嗡嗡作響，像在慫恿你賭一把運氣。", options: [
    { label: "把手按上圖騰賭一把", outcomes: [
      { chance: 0.5, text: "圖騰震動起來，兩道回響湧進你體內！", effect: { type: "compound", effects: [{ type: "random-buff" }, { type: "random-buff" }] } },
      { chance: 0.5, text: "圖騰猛地反噬，一股尖銳的震波掃過全隊。", effect: { type: "damage-all-flat", value: 3 } },
    ] },
    { label: "不理它", effect: { type: "noop" } },
  ] },
];

// ---------- 寶藏 🪎 ----------
const TREASURE_CRYSTAL_RANGE = [3, 8];

// ---------- 商人 💰（遺留物資，第一圈層第6格就有） ----------
// 遺物改成成就獎勵後，商店不再賣遺物；改成賣「食材」與「增益」（增益是本趟深潛限定、睡覺後消失）。
const SHOP_PRICES = { food: 3, buff: 8 };

// ---------- 食材與料理 ----------
const FOODS = {
  凝膠凍: {
    id: "凝膠凍", name: "凝膠凍", rareName: "稀有凝膠凍",
    dishId: "彈牙凍飲", dishName: "彈牙凍飲",
    flavorText: "QQ的，咬起來會彈，還算好玩。",
    buff: { type: "maxhp-percent", value: 0.10, rareValue: 0.20 },
  },
  顎獸肉塊: {
    id: "顎獸肉塊", name: "顎獸肉塊", rareName: "稀有顎獸肉塊",
    dishId: "厚切顎排", dishName: "厚切顎排",
    flavorText: "肉質很緊實，嚼起來很有勁。難怪咬合力那麼強。",
    buff: { type: "damage-percent", value: 0.10, rareValue: 0.20 },
  },
  翅鱗魚片: {
    id: "翅鱗魚片", name: "翅鱗魚片", rareName: "稀有翅鱗魚片",
    dishId: "酥炸鱗翅", dishName: "酥炸鱗翅",
    flavorText: "外酥內嫩，不說的話還以為是雞翅。",
    buff: { type: "dodge-percent", value: 0.10, rareValue: 0.20 },
  },
  水藻脆球: {
    id: "水藻脆球", name: "水藻脆球", rareName: "稀有水藻脆球",
    dishId: "脆脆藻湯", dishName: "脆脆藻湯",
    flavorText: "有股天然的鹽味，很爽口呢。",
    buff: { type: "damage-reduction-percent", value: 0.10, rareValue: 0.20 },
  },

  // ===== 第二層食材（垂垂耳／尖嘴鼠掉落，K 在「家」煮成料理）=====
  // 刻意用第一層沒有的 buff 類型：爆擊率、首回合傷害。
  垂垂耳腿肉: {
    id: "垂垂耳腿肉", name: "垂垂耳腿肉", rareName: "稀有垂垂耳腿肉",
    dishId: "炙烤兔腿", dishName: "炙烤兔腿",
    flavorText: "看起來人畜無害，肉質倒是意外緊實彈牙。K 煮完還嘀咕了句「明明那麼會踢」。",
    buff: { type: "crit-percent", value: 0.10, rareValue: 0.20 },
  },
  尖嘴鼠肉: {
    id: "尖嘴鼠肉", name: "尖嘴鼠肉", rareName: "稀有尖嘴鼠肉",
    dishId: "鹽烤鼠肉串", dishName: "鹽烤鼠肉串",
    flavorText: "串起來炭烤，油脂滋滋作響。吃一口，開場那一下特別有勁。",
    buff: { type: "first-turn-dmg-percent", value: 0.15, rareValue: 0.30 },
  },
};
const FOOD_DROP_RATE_NORMAL = 0.50;
const FOOD_DROP_RATE_RARE = 0.05;

// ---------- 藥材與魔藥（第二層）----------
// 藥材：刺螯／膜翼掉落，拿到工坊的「魔藥間」由 L 製成魔藥。掉落率沿用食材那組。
// 魔藥：戰鬥中主動使用的「非治療」消耗品，出發前每人可帶 1 瓶（跟料理各自獨立一格）。
//   使用不消耗回合、只能在自己回合用。一種藥材對應一種魔藥（1:1）。稀有版效果加強。
const HERBS = {
  刺螯毒腺: { id: "刺螯毒腺", name: "刺螯毒腺", rareName: "稀有刺螯毒腺", potionId: "腐蝕彈" },
  膜翼血囊: { id: "膜翼血囊", name: "膜翼血囊", rareName: "稀有膜翼血囊", potionId: "血膜護盾" },
};
const POTIONS = {
  腐蝕彈: {
    id: "腐蝕彈", name: "腐蝕彈", icon: "💥", herbId: "刺螯毒腺",
    target: "all-enemies", // 投擲，不需選目標
    desc: "投擲，對全體敵人造成傷害並使其中毒（吸血/自癒減半）。",
    effect: { type: "throw-damage", dmgRange: [4, 6], rareDmgRange: [6, 9], poison: true },
  },
  血膜護盾: {
    id: "血膜護盾", name: "血膜護盾", icon: "🛡️", herbId: "膜翼血囊",
    target: "self",
    desc: "給自己一層護盾，吸收傷害。",
    effect: { type: "self-shield", shield: 8, rareShield: 14 },
  },
};

// ---------- 遺物（個人永久裝備；只能靠「達成成就」取得，一個成就對一個遺物） ----------
// 新版遺物系統（2026-08-12 大改）：
//   · 遺物是「永久的」——裝在角色身上就一直在，除非到「技能遺物」頁面拆下來；不再是單趟深潛用完就重置。
//   · 來源只有一個：達成成就。ACHIEVEMENTS 裡每個成就都對應一個遺物（見 07_成就.js 的 relic 欄位）。
//   · 每個角色最多裝 3 個。未出戰的角色也能裝，但只有實際出戰才會生效（遺物本來就是作用在該角色身上）。
//   · 戰鬥效果採「資料驅動」：戰鬥碼用 relicSum()/relicMax() 掃角色身上的遺物即時計算，
//     所以之後要加新遺物「只改這裡的資料」就好，不用再去動戰鬥碼（除非是全新的 effect.type）。
//   · cat 決定分類與框色（見下方 RELIC_CATEGORIES）；desc 是給玩家看的效果說明。
// 數值刻意壓得比舊版溫和一點：舊版遺物是單趟用完就沒，新版是永久 always-on、又可四人共 12 件，
// 所以個別效果收斂一些，避免疊起來太誇張（納可授權自行抓平衡）。
const RELIC_CATEGORIES = {
  attack:  { label: "攻擊", color: "#d8564f", icon: "⚔️" },
  defense: { label: "防禦", color: "#4fa8d8", icon: "🛡️" },
  recover: { label: "回復", color: "#5bbf6a", icon: "💚" },
  support: { label: "輔助", color: "#b07fd8", icon: "✴️" },
};
const RELICS = [
  { id: "初潛之勇", name: "初潛之勇", cat: "attack",  desc: "普攻傷害 +10%", effect: { type: "normal-atk-percent", value: 0.10 } },
  { id: "重逢餘溫", name: "重逢餘溫", cat: "recover", desc: "每場戰鬥結束時回復12%最大血量", effect: { type: "post-battle-heal-percent", value: 0.12 } },
  { id: "洋流羅盤", name: "洋流羅盤", cat: "support", desc: "行動順序提前一位", effect: { type: "turn-order-shift", value: 1 } },
  { id: "疾手之爪", name: "疾手之爪", cat: "attack",  desc: "普攻時15%機率攻擊兩次", effect: { type: "normal-atk-double-chance", value: 0.15 } },
  { id: "無瑕之盾", name: "無瑕之盾", cat: "defense", desc: "受到傷害 -8%", effect: { type: "damage-taken-percent", value: -0.08 } },
  { id: "不熄餘燼", name: "不熄餘燼", cat: "defense", desc: "倒地後站起時回復25%血量而非1血", effect: { type: "revive-heal-percent", value: 0.25 } },
  { id: "飽足護身", name: "飽足護身", cat: "recover", desc: "最大血量 +10%", effect: { type: "maxhp-percent", value: 0.10 } },
  { id: "拾荒者之眼", name: "拾荒者之眼", cat: "support", desc: "使用技能時10%機率不消耗次數", effect: { type: "skill-no-cost-chance", value: 0.10 } },
  { id: "潛晶碎鑽", name: "潛晶碎鑽", cat: "attack",  desc: "爆擊率 +5%", effect: { type: "crit-rate-add", value: 0.05 } },
  { id: "熟練刻印", name: "熟練刻印", cat: "attack",  desc: "技能傷害 +12%", effect: { type: "skill-dmg-percent", value: 0.12 } },
  { id: "精鍛核心", name: "精鍛核心", cat: "attack",  desc: "普攻傷害 +8%", effect: { type: "normal-atk-percent", value: 0.08 } },
  { id: "岩蚺之牙", name: "岩蚺之牙", cat: "attack",  desc: "蓄勢加成從20%提升到30%", effect: { type: "charge-bonus-override", value: 0.30 } },
  { id: "岩鱗甲片", name: "岩鱗甲片", cat: "defense", desc: "受到傷害 -6%", effect: { type: "damage-taken-percent", value: -0.06 } },
  { id: "藥師之瓶", name: "藥師之瓶", cat: "recover", desc: "每場戰鬥結束時回復10%最大血量", effect: { type: "post-battle-heal-percent", value: 0.10 } },
  { id: "饗宴之力", name: "饗宴之力", cat: "recover", desc: "最大血量 +8%", effect: { type: "maxhp-percent", value: 0.08 } },
  { id: "老手護符", name: "老手護符", cat: "support", desc: "使用技能時8%機率不消耗次數", effect: { type: "skill-no-cost-chance", value: 0.08 } },
  { id: "萬物歸一", name: "萬物歸一", cat: "attack",  desc: "技能傷害 +10%", effect: { type: "skill-dmg-percent", value: 0.10 } },
];
const RELIC_MAX_PER_CHARACTER = 3;
// 依 effect.type 掃一個角色身上所有遺物、把同型效果的 value 加總（給戰鬥碼即時計算用）。
// combatant 沒有 relics（例如敵人）或沒裝任何該型遺物時回傳 0，呼叫端可安心相加。
function relicSum(combatant, type) {
  if (!combatant || !combatant.relics) return 0;
  let s = 0;
  combatant.relics.forEach((rid) => {
    let r = RELICS.find((x) => x.id === rid);
    if (r && r.effect.type === type) s += r.effect.value;
  });
  return s;
}
// 「覆蓋型」效果（例如蓄勢加成、倒地回血）取身上該型遺物的最大值，跟 base 比較後取大的。
function relicMax(combatant, type, base) {
  let v = base;
  if (combatant && combatant.relics) combatant.relics.forEach((rid) => {
    let r = RELICS.find((x) => x.id === rid);
    if (r && r.effect.type === type && r.effect.value > v) v = r.effect.value;
  });
  return v;
}

// ---------- 增益效果（全局，睡覺後消失） ----------
const GLOBAL_BUFFS = [
  { id: "潛淵之息", name: "潛淵之息", desc: "每場戰鬥開始時全隊回復10%最大血量", effect: { type: "battle-start-heal-percent", value: 0.10 } },
  { id: "潛晶磁感", name: "潛晶磁感", desc: "潛晶掉落量 +25%", effect: { type: "crystal-drop-percent", value: 0.25 } },
  { id: "同步感應", name: "同步感應", desc: "全隊爆擊率 +5%", effect: { type: "crit-rate-add-all", value: 0.05 } },
  { id: "迴聲護盾", name: "迴聲護盾", desc: "每場戰鬥第一回合全隊減傷30%", effect: { type: "first-turn-dmg-reduction", value: 0.30 } },
  { id: "潛流加速", name: "潛流加速", desc: "第一回合全隊閃避率 +30%", effect: { type: "first-turn-dodge", value: 0.30 } },
  { id: "採集本能", name: "採集本能", desc: "潛晶掉落量 +50%", effect: { type: "crystal-drop-percent", value: 0.50 } },
  { id: "藥效強化", name: "藥效強化", desc: "補血藥回復量從30%提升到45%", effect: { type: "potion-heal-override", value: 0.45 } },
  { id: "強韌體質", name: "強韌體質", desc: "全隊最大血量 +15%", effect: { type: "maxhp-percent-all", value: 0.15 } },
  { id: "脆弱迴響", name: "脆弱迴響", desc: "第三回合起所有敵人受到傷害 +15%", effect: { type: "enemy-dmg-taken-from-turn3", value: 0.15 } },
  { id: "險境奮起", name: "險境奮起", desc: "有人倒地時其餘角色傷害 +20%", effect: { type: "dmg-boost-when-ally-fallen", value: 0.20 } },
];

// ---------- 全滅/撤退收穫規則 ----------
const WIPE_CRYSTAL_KEEP_PERCENT = 0.5; // 全滅：本趟潛晶掉一半
const RETREAT_CRYSTAL_KEEP_PERCENT = 1.0; // 主動撤退：保留全部本趟收穫
