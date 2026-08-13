// ========================================
// 潛淵 - 可重用「戰鬥 AI」（資料驅動，全角色共用一份）
//   暱稱「小艾」（納可取的）：這支 AI 就是我們的 AI 玩家，也是重要測試員——
//   他會用難度工具/全流程模擬自動玩遊戲，不花額度、跑得比誰都勤，幫我們量難度、抓崩潰。
// ========================================
// 這支檔案做什麼：幫一個角色「自己決定這回合要幹嘛」——血低就補、隊友快死就救、
//   挑最划算的攻擊技打最該死的目標、沒技能可用才普攻。一份邏輯，K／主角／V／L 全通用。
//
// 為什麼要它（一石二鳥，納可 2026-08-13 提案）：
//   ① 難度工具（scripts/難度檢查.js）可以用「會用技能的聰明玩家」跑模擬，比「只普攻的裸模型」更接近真人 →
//      量到的難度更準（裸模型＝難度下限、聰明 AI＝真人上限，兩條一起看）。
//   ② 之後第四層「被心靈控制的 K」本來就要一個聰明 AI（會攻擊、會幫王補血、技能次數一樣有限）——
//      同一份決策邏輯就能用，只是把「打敵人」翻成「打我方」（見檔尾的 side 設計說明）。
//
// ★ 資料驅動，不寫死任何角色／技能（納可 2026-08-13 特別要求：以後會改技能、加新角色）：
//   - AI 全程不認得「K」「V」這種名字，它只讀技能自己聲明的 type（attack／heal／hot／…）來分類。
//   - 【加新角色】：新角色的技能照現有格式寫好（有 type/dmgRange/maxUses…），AI 自動就會用，這裡零改動。
//   - 【改技能數值】：AI 讀即時的 dmgRange/healRange，改數字自動跟著變。
//   - 【發明全新的 type】：這是唯一要回來碰這裡的情況。做法＝在下面 SKILL_ROLE 認一下新 type 屬於哪個角色定位
//     （攻擊/治療/增益…）。**認不得的 type 會被安全略過（當作沒這招）**，所以就算忘了加、AI 也只是「暫時不會用那招」，
//     絕不會壞掉或報錯——可以放心之後再補。
//
// 純度：aiDecideAllyAction() 是「純函式」——只讀狀態、回傳一個「要做什麼」的描述，不碰畫面、不改任何資料。
//        真正去按按鈕（改狀態）的是 aiTakeAllyTurn()，它把描述丟給既有的戰鬥函式執行。
// ========================================

// 把技能的 type 歸類成 AI 看得懂的「定位」。加新 type 就在對應陣列補一個字串即可。
// 認不得的 type → 不會出現在任何一類 → 被 AI 略過（安全）。
const AI_SKILL_ROLE = {
  attackSingle: ["attack"],            // 對單體/全體的傷害技（用 targetType 再細分單體 or 全體）
  healAlly: ["heal", "hot"],           // 指定隊友的治療（單體/持續回血）
  selfHeal: ["self-heal-percent"],     // 自我回血
  partyBuff: ["party-dmg-buff"],       // 全隊增益（下次攻擊更痛）
  // ── 以下這些是「有用但不好自動評分」的技能，暫時交給普攻/攻擊技優先，先不主動用（要教 AI 用就往上面歸類）：
  //    guard（格擋）、self-charge（蓄力）、self-dodge（閃避）、damage-reduction（減傷）。
};

// 這回合血量低於這個比例就優先想辦法補血（自我回血技或喝補血藥）。
const AI_HEAL_SELF_THRESHOLD = 0.35;
// 隊友（含自己）血量低於這個比例，且自己有「指定隊友治療技」時就去救最虛的那個。
const AI_HEAL_ALLY_THRESHOLD = 0.40;

// 取某個技能對單一敵人的「期望傷害」與「最大傷害」，已套用該角色的武器倍率與命中的粗估。
// 只用來排序/判斷能不能一擊解決，不影響實際傷害計算（實際仍由 06 的 damageCalc 決定）。
function aiSkillDamageEstimate(actorId, skill) {
  let mult = getCharacterWeaponMultiplier(actorId);
  let lo = Math.max(1, Math.ceil((skill.dmgRange ? skill.dmgRange[0] : 0) * mult));
  let hi = Math.max(1, Math.ceil((skill.dmgRange ? skill.dmgRange[1] : 0) * mult));
  let hits = skill.hits || 1;
  let hitChance = 1 - (skill.missRate || 0); // 有 missRate 的技能期望值打折
  return { avg: ((lo + hi) / 2) * hits * hitChance, max: hi * hits };
}

// 普攻的期望/最大傷害（同樣只用來排序與判斷收頭）。
function aiNormalAttackEstimate(actorId) {
  let c = CHARACTERS[actorId];
  let mult = getCharacterWeaponMultiplier(actorId);
  let lo = Math.max(1, Math.ceil(c.atkRange[0] * mult));
  let hi = Math.max(1, Math.ceil(c.atkRange[1] * mult));
  let hits = c.atkHits || 1;
  return { avg: ((lo + hi) / 2) * hits, max: hi * hits };
}

// 這角色現在「還能用」的技能（已解鎖、還有次數），依 AI 定位分好類。
function aiUsableSkills(actorId) {
  let m = activeDive.party[actorId];
  let out = { attackSingle: [], attackAll: [], healAlly: [], selfHeal: [], partyBuff: [] };
  (gameState.equippedSkills[actorId] || []).forEach((sid) => {
    let sk = SKILLS[sid];
    if (!sk) return;
    if (!isSkillUnlocked(actorId, sid)) return;
    if ((m.skillUses[sid] || 0) <= 0) return;
    if (AI_SKILL_ROLE.attackSingle.includes(sk.type)) {
      (sk.targetType === "all-enemies" ? out.attackAll : out.attackSingle).push(sid);
    } else if (AI_SKILL_ROLE.healAlly.includes(sk.type)) {
      out.healAlly.push(sid);
    } else if (AI_SKILL_ROLE.selfHeal.includes(sk.type)) {
      out.selfHeal.push(sid);
    } else if (AI_SKILL_ROLE.partyBuff.includes(sk.type)) {
      out.partyBuff.push(sid);
    }
    // 其餘 type：AI 目前不主動用，略過（安全）。
  });
  return out;
}

// 場上「可以被打」的敵人（活著、沒逃、沒鑽地）。
function aiLivingEnemies() {
  return activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped && !e.burrowed);
}

// 沒倒下的我方（含自己）。
function aiLivingAllies() {
  return SHELTER_PARTY_IDS.filter((id) => !activeDive.party[id].fallen);
}

// 選「最該打的目標」：優先挑「這一擊能收頭的敵人」（血量最少的那隻），
// 否則集火血量最低的敵人（越快清人數，我方越少挨打）。maxDmg 用來判斷能不能一擊解決。
function aiPickTarget(enemies, maxDmg) {
  let sorted = enemies.slice().sort((a, b) => a.hp - b.hp);
  let finishable = sorted.filter((e) => e.hp <= maxDmg);
  return (finishable.length ? finishable[finishable.length - 1] : sorted[0]); // 能收頭的挑血最多的那隻收掉；否則打血最少的集火
}

// ---------- 核心：純函式決策 ----------
// 回傳這回合要做的事：
//   { kind: "drink-potion" }                      喝補血藥（回血）
//   { kind: "skill", skillId, targetUid }         對單體敵人放攻擊技
//   { kind: "skill", skillId }                    放全體攻擊技／全隊增益（不用選目標）
//   { kind: "skill", skillId, targetAllyId }      對隊友放治療技
//   { kind: "self-skill", skillId }               對自己放自我回血技
//   { kind: "attack", targetUid }                 普攻
//   { kind: "pass" }                              真的沒事可做（理論上不會發生，保底用）
function aiDecideAllyAction(actorId) {
  let m = activeDive.party[actorId];
  let enemies = aiLivingEnemies();
  let skills = aiUsableSkills(actorId);

  // 1) 自己快死了：先救自己（自我回血技 > 喝補血藥）。
  if (m.hp / m.maxHp < AI_HEAL_SELF_THRESHOLD) {
    if (skills.selfHeal.length) return { kind: "self-skill", skillId: skills.selfHeal[0] };
    if (gameState.potions > 0) return { kind: "drink-potion" };
  }

  // 2) 有隊友（含自己）很虛，而自己會治療 → 救最虛的那個。
  if (skills.healAlly.length) {
    let allies = aiLivingAllies().map((id) => ({ id, pct: activeDive.party[id].hp / activeDive.party[id].maxHp }));
    let weakest = allies.sort((a, b) => a.pct - b.pct)[0];
    if (weakest && weakest.pct < AI_HEAL_ALLY_THRESHOLD) {
      return { kind: "skill", skillId: skills.healAlly[0], targetAllyId: weakest.id };
    }
  }

  // 沒有敵人可打（理論上戰鬥早該結束）→ 保底不做事。
  if (enemies.length === 0) return { kind: "pass" };

  // 3) 全隊增益：場上還有兩人以上、且有增益技時，開場先開（buff 的是「大家下次攻擊」，
  //    行動順序在前的人開了，這一輪後面的隊友立刻吃到，純賺）。只在戰鬥第一回合用，避免每回合都在補 buff 不打人。
  if (skills.partyBuff.length && activeBattle.turnCount === 1 && aiLivingAllies().length >= 2) {
    return { kind: "skill", skillId: skills.partyBuff[0] };
  }

  // 4) 攻擊：比較「最好的單體攻擊技 / 全體攻擊技 / 普攻」，挑期望傷害最高的。
  //    全體技只有在敵人 ≥2 時才把「打到每隻」的總傷算進來（單隻時全體技＝浪費一次珍貴次數）。
  let best = { score: -1, action: null };

  // 4a) 單體攻擊技
  skills.attackSingle.forEach((sid) => {
    let est = aiSkillDamageEstimate(actorId, SKILLS[sid]);
    let tgt = aiPickTarget(enemies, est.max);
    // 能一擊收頭的技能加分（提早清人數價值高）；否則就用期望傷害當分數。
    let score = est.avg + (tgt.hp <= est.max ? 100 : 0);
    if (score > best.score) best = { score, action: { kind: "skill", skillId: sid, targetUid: tgt.uid } };
  });

  // 4b) 全體攻擊技（總傷 = 每隻期望傷害 × 敵人數）
  skills.attackAll.forEach((sid) => {
    let est = aiSkillDamageEstimate(actorId, SKILLS[sid]);
    let score = est.avg * enemies.length;
    if (score > best.score) best = { score, action: { kind: "skill", skillId: sid } };
  });

  // 4c) 普攻（保底一定有；沒技能時就是它）
  let na = aiNormalAttackEstimate(actorId);
  let naTgt = aiPickTarget(enemies, na.max);
  let naScore = na.avg + (naTgt.hp <= na.max ? 100 : 0);
  if (naScore > best.score) best = { score: naScore, action: { kind: "attack", targetUid: naTgt.uid } };

  return best.action || { kind: "attack", targetUid: naTgt.uid };
}

// ---------- 執行器：把決策變成真的行動（會改狀態） ----------
// 給難度工具／被控 K 呼叫；它把 aiDecideAllyAction() 的描述丟給 06 既有的戰鬥函式執行。
// 回傳做了什麼（給日誌/除錯用）。前提：現在是 actorId 的回合（isCurrentActorsTurn 為真）。
function aiTakeAllyTurn(actorId) {
  let a = aiDecideAllyAction(actorId);
  switch (a.kind) {
    case "drink-potion":
      battleDrinkPotion(actorId);
      break;
    case "self-skill":
      // 自我回血技 targetType 是 self，battleUseSkill 會直接結算、不需選目標。
      battleUseSkill(actorId, a.skillId);
      break;
    case "skill":
      battleUseSkill(actorId, a.skillId);
      // 需要選目標的（單體攻擊技→選敵人；治療技→選隊友）才會有 pendingAction。
      if (activeBattle && activeBattle.pendingAction) {
        if (a.targetUid) battleSelectTarget(a.targetUid, true);
        else if (a.targetAllyId) battleSelectTarget(a.targetAllyId, false);
      }
      break;
    case "attack":
      battleNormalAttack(actorId);
      if (activeBattle && activeBattle.pendingAction) battleSelectTarget(a.targetUid, true);
      break;
    default:
      // pass：理論上不會走到，保底不做事（避免卡死可在呼叫端處理）。
      break;
  }
  return a;
}

// ========================================
// 【給之後第四層「被控 K」的設計備忘（還沒做，先留說明）】
// ------------------------------------------------------------
// 上面這套是「我方視角」：我＝隊伍、敵＝怪。被控 K 是「敵方視角」——同一套決策，只要把三件事翻面：
//   ① 「隊友」＝敵方陣營（怪 + 被控 K 自己）；「目標」＝玩家的我方隊伍。
//   ② 攻擊/收頭找「玩家角色」；治療（幫王補血）找「血量最低的敵方友軍（例如王）」。
//   ③ 技能次數一樣有限（用怪物實例上的 skillCooldowns / 或給被控 K 一份 skillUses）。
// 屆時建議把「找隊友 / 找目標 / 用哪個行動函式」抽成參數（一個 side 設定物），
// aiDecideAllyAction 的核心評分（救人 > 集火收頭 > 期望傷害）原封不動就能共用。
// 現在先不做，是因為第四層還沒實裝、也還沒有能測的地方——避免做出測不到的半成品。
// ========================================
