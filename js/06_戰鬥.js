// ========================================
// 潛淵 - 戰鬥引擎
// 回合制小隊 vs 敵群。activeBattle 是這場戰鬥的暫存狀態，戰鬥結束就丟棄。
// ========================================

let activeBattle = null;

// ---------- 建立戰鬥 ----------

function startBattle(monsterIds, options) {
  // 安全網：萬一還有沒關掉的對話框覆蓋層卡在畫面上（例如上一個節點的巢狀選人對話框
  // 沒有正常結束），這裡強制關掉，避免那層透明覆蓋層擋住戰鬥畫面所有點擊。
  dialogueQueue = [];
  dialogueOnComplete = null;
  document.getElementById("dialogue-overlay").classList.add("hidden");

  let enemies = monsterIds.map((mid, idx) => buildEnemyInstance(mid, options.isElite, idx));

  // 重置我方本場戰鬥限定的暫存狀態（血量/等級強化沿用 activeDive.party，只重置狀態效果）
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    m.bleedStacks = 0; m.bleedDuration = 0;
    m.poisonDuration = 0; // 中毒：戰鬥開始清空，避免跨戰鬥殘留
    m.hotHealPerTurn = 0; m.hotDuration = 0; // 順手修：這兩個原本沒在這裡重置，理論上會跨戰鬥殘留
    m.guardActive = false; m.chargeReady = false; m.stunTurns = 0;
    m.confuseTurns = 0; // 混亂：戰鬥開始清空
    m.shield = 0;
    m.dmgBuffNextAttack = 0; m.chargeMultiplier = 1; m.dodgeBuffThisTurn = 0;
    m.damageReduction = 0; m.damageReductionDuration = 0;
    if (activeDive.globalBuffs.includes("潛淵之息")) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.10));
  });

  activeBattle = {
    enemies,
    isBoss: !!options.isBoss,
    isElite: !!options.isElite,
    allowFlee: options.allowFlee !== false && !options.isBoss,
    rewardMult: options.rewardMult || 1,
    suppressRewards: !!options.suppressRewards,
    onResult: options.onResult,
    turnCount: 1,
    log: [],
    quip: "",
    knownSpeciesAtStart: Object.keys(gameState.bestiary).filter((k) => gameState.bestiary[k]),
    pendingAction: null, // {casterId, kind, skillId} 等待玩家選目標時使用
  };

  monsterIds.forEach((mid) => { gameState.bestiary[mid] = true; });

  document.getElementById("battle-overlay").classList.remove("hidden");
  beginRound();
}

function buildEnemyInstance(monsterId, isElite, idx) {
  let monster = MONSTERS[monsterId];
  let baseHp = randInt(monster.hpRange[0], monster.hpRange[1]);
  let hp = isElite ? Math.ceil(baseHp * ELITE_HP_MULT) : baseHp;
  return {
    uid: monsterId + "_" + idx + "_" + Math.random().toString(36).slice(2, 7),
    monsterId, name: (isElite ? "⚠️菁英 " : "") + monster.name, icon: monster.icon,
    hp, maxHp: hp,
    isElite: !!isElite,
    skillCooldowns: {},
    forcedNextSkillId: null,
    intentSkillId: null,
    dodgeActive: monster.innateDodge ? { chance: monster.innateDodge, permanent: true } : false,
    shield: 0,
    bleedStacks: 0, bleedDuration: 0,
    poisonDuration: 0, // 敵方中毒：中毒期間自身的吸血/自癒回復減半（同我方中毒的邏輯）
    stunTurns: 0, // 震懾剩餘回合數（>0 表示接下來這麼多次自己的行動會被跳過）
    burrowed: false, // 尖嘴鼠掘地：潛入地底時為 true，期間無法被選為目標、也不受全體技能波及
    isBossSummon: false, // 巨岩蚺喚岩叫出來的小怪：可被 Boss「吞噬」吃掉回血
    chargeReady: false, // 敵方蓄勢（第三層青羽「鼓翼」給友軍上）：下次攻擊傷害提升
    vanishAfterAction: false, // 第三層花尾「呼喚」召來的青羽：自己行動一次後就消失
  };
}

// ---------- 回合流程 ----------

function beginRound() {
  // 特殊怪物（例如寶箱怪）撐過指定回合數就會自動逃走消失，不算被打死、沒有獎勵
  activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped).forEach((e) => {
    let monster = MONSTERS[e.monsterId];
    if (monster.fleesAfterRound && activeBattle.turnCount >= monster.fleesAfterRound) {
      e.escaped = true;
      logBattle(`${e.icon} ${e.name} 趁機逃跑了！`);
    }
  });

  // 每回合開始先讓所有怪物的技能冷卻遞減，不然有冷卻的技能只能用一次就永久鎖住
  activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped).forEach((e) => {
    Object.keys(e.skillCooldowns).forEach((sid) => { if (e.skillCooldowns[sid] > 0) e.skillCooldowns[sid]--; });
  });

  activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped).forEach((e) => { e.intentSkillId = chooseEnemyIntent(e); });
  let alive = activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped);
  activeBattle.quip = alive.length > 0 ? MONSTERS[pickRandom(alive).monsterId].idleLine : "";

  tickStatusEffectsAll();
  if (checkBattleEnd()) return;

  activeBattle.phase = "ally";
  activeBattle.allyTurnQueue = buildAllyTurnQueue();
  activeBattle.allyTurnPointer = 0;
  advanceAllyTurn();
}

// 基礎順序固定是 PARTY_ORDER_LAYER1(K→主角→V)，帶有「行動順序提前」類遺物的角色會往前提。
// 提前的格數 = 該角色身上這類遺物的加總（turn-order-shift）。用「基礎位置 − 提前格數」當排序權重、
// 穩定排序：權重小的排前面，平手時維持原本順序。這樣多人持有、或單人提前多格都能正確處理。
function buildAllyTurnQueue() {
  let base = PARTY_ORDER_LAYER1.filter((id) => !activeDive.party[id].fallen);
  return base
    .map((id, idx) => ({ id, idx, pri: idx - relicSum(activeDive.party[id], "turn-order-shift") }))
    .sort((a, b) => (a.pri - b.pri) || (a.idx - b.idx))
    .map((x) => x.id);
}

// 對我方角色套用治療，並處理「中毒→治療減半」。回傳實際回復的血量（給log顯示用）。
// 戰鬥中所有對我方的治療都要走這裡，中毒才能一致地把治療打對折。
function applyAllyHeal(m, rawHeal) {
  let heal = m.poisonDuration > 0 ? Math.ceil(rawHeal * POISON_HEAL_MULTIPLIER) : rawHeal;
  m.hp = Math.min(m.maxHp, m.hp + heal);
  return heal;
}

// 敵方回復（吸血/自癒）統一走這裡，中毒時同樣打對折。回傳實際回復量。
function applyEnemyHeal(enemy, rawHeal) {
  let heal = enemy.poisonDuration > 0 ? Math.ceil(rawHeal * POISON_HEAL_MULTIPLIER) : rawHeal;
  enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
  return heal;
}

function tickStatusEffectsAll() {
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    if (m.fallen) return;
    m.dodgeBuffThisTurn = 0; // V_隱步只在施放的那個回合有效，新回合開始就重置
    if (m.damageReductionDuration > 0) {
      m.damageReductionDuration--;
      if (m.damageReductionDuration <= 0) m.damageReduction = 0;
    }
    if (m.hotDuration > 0) {
      let healed = applyAllyHeal(m, m.hotHealPerTurn);
      logBattle(`💚 ${displayName(id)} 持續回血 +${healed}。`);
      spawnFloatingNumber(id, "+" + healed, "heal");
      m.hotDuration--;
      if (m.hotDuration <= 0) m.hotHealPerTurn = 0;
    }
    if (m.bleedStacks > 0) {
      let dmg = m.bleedStacks * BLEED_DAMAGE_PER_STACK;
      m.hp = Math.max(0, m.hp - dmg);
      logBattle(`🩸 ${displayName(id)} 受到流血傷害 ${dmg}。`);
      if (m.hp <= 0) fallAlly(id);
      m.bleedDuration--;
      if (m.bleedDuration <= 0) m.bleedStacks = 0;
    }
  });
  activeBattle.enemies.filter((e) => e.hp > 0 && e.bleedStacks > 0).forEach((e) => {
    let dmg = e.bleedStacks * BLEED_DAMAGE_PER_STACK;
    e.hp = Math.max(0, e.hp - dmg);
    logBattle(`🩸 ${e.name} 受到流血傷害 ${dmg}。`);
    e.bleedDuration--;
    if (e.bleedDuration <= 0) e.bleedStacks = 0;
  });
}

function fallAlly(id) {
  let m = activeDive.party[id];
  if (m.fallen) return;
  m.fallen = true;
  m.hp = 0;
  logBattle(`💥 ${displayName(id)} 倒下了。`);
}

function advanceAllyTurn() {
  if (checkBattleEnd()) return;
  if (activeBattle.allyTurnPointer >= activeBattle.allyTurnQueue.length) {
    startEnemyPhase();
    return;
  }
  let id = activeBattle.allyTurnQueue[activeBattle.allyTurnPointer];
  let m = activeDive.party[id];
  if (m.fallen) { activeBattle.allyTurnPointer++; advanceAllyTurn(); return; }
  if (m.stunTurns > 0) {
    m.stunTurns--;
    logBattle(`${displayName(id)} 被震懾，無法行動。`);
    activeBattle.allyTurnPointer++;
    renderBattleScreen();
    setTimeout(advanceAllyTurn, 500);
    return;
  }
  if (m.confuseTurns > 0) {
    // 混亂：這回合玩家不能操作，角色自動亂行動（可能打到隊友/自己、補到敵人、或發呆）。
    m.confuseTurns--;
    renderBattleScreen();
    setTimeout(() => executeConfusedTurn(id), 500);
    return;
  }
  renderBattleScreen(id);
}

// 混亂中的自動行動：從該角色「真的能用的行動」（攻擊＋還有次數的技能）隨機挑一個，
// 目標從全場任意對象（敵方＋沒倒下的我方，含自己）隨機挑；攻擊/治療類會依落在敵或友做正確導向。
// finishAllyAction() 由各分支負責呼叫，推進到下一個我方行動。
function executeConfusedTurn(casterId) {
  if (checkBattleEnd()) return;
  let m = activeDive.party[casterId];
  let c = CHARACTERS[casterId];
  // 全場可當目標的對象
  let enemyTargets = activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped && !e.burrowed);
  let allyTargets = SHELTER_PARTY_IDS.filter((id) => !activeDive.party[id].fallen);
  // 可用行動：攻擊 + 還有次數且已解鎖的技能
  let actions = ["attack"];
  gameState.equippedSkills[casterId].forEach((sid) => {
    if (isSkillUnlocked(casterId, sid) && (m.skillUses[sid] || 0) > 0) actions.push(sid);
  });
  let action = pickRandom(actions);

  // 隨機挑一個目標（敵或友），回傳 {kind:'enemy'|'ally', enemy?, allyId?}
  let pickAnyTarget = () => {
    let pool = [];
    enemyTargets.forEach((e) => pool.push({ kind: "enemy", enemy: e }));
    allyTargets.forEach((id) => pool.push({ kind: "ally", allyId: id }));
    return pool.length ? pickRandom(pool) : null;
  };

  flashUnit(casterId, "actor");

  if (action === "attack") {
    let mult = getCharacterWeaponMultiplier(casterId);
    let range = [Math.max(1, Math.ceil(c.atkRange[0] * mult)), Math.max(1, Math.ceil(c.atkRange[1] * mult))];
    let t = pickAnyTarget();
    if (!t) { finishAllyAction(); return; }
    if (t.kind === "enemy") {
      logBattle(`😵‍💫 ${displayName(casterId)} 混亂中，胡亂攻擊了 ${t.enemy.name}。`);
      let r = Object.assign({ name: t.enemy.name }, dealDamageToEnemy(casterId, t.enemy, range, { isNormalAttack: true }));
      void r;
    } else {
      logBattle(`😵‍💫 ${displayName(casterId)} 混亂中，一巴掌打向了自己人 ${displayName(t.allyId)}！`);
      dealDamageToAlly({ isElite: false }, t.allyId, range); // 友傷：用一個沒有菁英加成的假攻擊者
    }
    finishAllyAction();
    return;
  }

  // 技能（混亂）：扣一次次數，再依技能類型導向隨機目標
  let skill = SKILLS[action];
  m.skillUses[action]--;
  let mult = getCharacterWeaponMultiplier(casterId);

  if (skill.type === "attack") {
    let range = [Math.max(1, Math.ceil(skill.dmgRange[0] * mult)), Math.max(1, Math.ceil(skill.dmgRange[1] * mult))];
    let t = pickAnyTarget();
    if (!t) { finishAllyAction(); return; }
    if (t.kind === "enemy") {
      logBattle(`😵‍💫 ${displayName(casterId)} 混亂中，對 ${t.enemy.name} 亂放了「${skill.name}」。`);
      let hits = skill.hits || 1;
      for (let h = 0; h < hits; h++) { if (t.enemy.hp <= 0) break; dealDamageToEnemy(casterId, t.enemy, range, { isSkill: true }); }
    } else {
      logBattle(`😵‍💫 ${displayName(casterId)} 混亂中，把「${skill.name}」砸到了自己人 ${displayName(t.allyId)}！`);
      let hits = skill.hits || 1;
      for (let h = 0; h < hits; h++) dealDamageToAlly({ isElite: false }, t.allyId, range);
    }
    finishAllyAction();
    return;
  }

  if (skill.type === "heal" || skill.type === "hot") {
    let t = pickAnyTarget();
    if (!t) { finishAllyAction(); return; }
    if (t.kind === "ally") {
      // 剛好補到自己人：正常治療
      let healMult = getCharacterHealMultiplier(casterId);
      let tm = activeDive.party[t.allyId];
      if (skill.type === "heal") {
        let heal = Math.ceil(randInt(skill.healRange[0], skill.healRange[1]) * healMult);
        tm.hp = Math.min(tm.maxHp, tm.hp + heal);
        spawnFloatingNumber(t.allyId, "+" + heal, "heal");
        logBattle(`😵‍💫 ${displayName(casterId)} 混亂中亂放「${skill.name}」，剛好治療了 ${displayName(t.allyId)}（+${heal}）。`);
      } else {
        tm.hotHealPerTurn = Math.ceil(skill.hotHealPerTurn * healMult);
        tm.hotDuration = skill.hotDuration;
        logBattle(`😵‍💫 ${displayName(casterId)} 混亂中亂放「${skill.name}」，剛好幫 ${displayName(t.allyId)} 上了持續回血。`);
      }
    } else {
      // 補到敵人身上：白白幫敵人回血
      let healMult = getCharacterHealMultiplier(casterId);
      let raw = skill.type === "heal" ? Math.ceil(randInt(skill.healRange[0], skill.healRange[1]) * healMult) : Math.ceil(skill.hotHealPerTurn * healMult);
      t.enemy.hp = Math.min(t.enemy.maxHp, t.enemy.hp + raw);
      spawnFloatingNumber(t.enemy.uid, "+" + raw, "heal");
      logBattle(`😵‍💫 ${displayName(casterId)} 混亂中認錯了人，把「${skill.name}」的治療給了敵方 ${t.enemy.name}（+${raw}）！`);
    }
    finishAllyAction();
    return;
  }

  // 其餘（自身/全隊增益、格擋、蓄力、閃避、減傷等）：就當作「剛好正常施放在自己/隊伍」，走原本流程。
  logBattle(`😵‍💫 ${displayName(casterId)} 混亂中，糊裡糊塗地對自己人用了「${skill.name}」。`);
  m.skillUses[action]++; // 還回去，讓 resolveSkillNoTarget 自己扣（它內部會處理次數與效果）
  let targetId = (skill.targetType === "single-ally") ? pickRandom(allyTargets) : null;
  resolveSkillNoTarget(casterId, action, targetId); // 內部會呼叫 finishAllyAction
}

function startEnemyPhase() {
  if (checkBattleEnd()) return;
  activeBattle.phase = "enemy";
  activeBattle.enemyTurnPointer = 0;
  renderBattleScreen();
  setTimeout(processNextEnemyTurn, 400);
}

function processNextEnemyTurn() {
  if (checkBattleEnd()) return;
  if (activeBattle.enemyTurnPointer >= activeBattle.enemies.length) {
    endRound();
    return;
  }
  let enemy = activeBattle.enemies[activeBattle.enemyTurnPointer];
  activeBattle.enemyTurnPointer++;
  if (enemy.hp <= 0 || enemy.escaped) { processNextEnemyTurn(); return; }

  if (enemy.justSummoned) {
    enemy.justSummoned = false; // 下回合才開始行動
    processNextEnemyTurn();
    return;
  }

  if (enemy.stunTurns > 0) {
    enemy.stunTurns--;
    logBattle(`${enemy.name} 被震懾，無法行動。`);
    renderBattleScreen();
    setTimeout(processNextEnemyTurn, 500);
    return;
  }

  executeEnemySkill(enemy);
  // 花尾「呼喚」召來的青羽：行動一次後就離場消失（不算被打死、沒有戰利品）。
  if (enemy.vanishAfterAction) {
    enemy.hp = 0;
    enemy.escaped = true;
    logBattle(`${enemy.icon} ${enemy.name} 拍拍翅膀，消失在風裡。`);
  }
  renderBattleScreen();
  if (checkBattleEnd()) return;
  setTimeout(processNextEnemyTurn, 650);
}

function endRound() {
  if (checkBattleEnd()) return;
  // 中毒持續回合在每回合結束時遞減，讓「中毒當回合起算3個治療回合」都吃得到減半效果
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    if (m.poisonDuration > 0) m.poisonDuration--;
  });
  activeBattle.enemies.forEach((e) => { if (e.poisonDuration > 0) e.poisonDuration--; });
  activeBattle.turnCount++;
  beginRound();
}

function checkBattleEnd() {
  if (!activeBattle) return true;
  if (activeBattle.enemies.every((e) => e.hp <= 0 || e.escaped)) {
    let anyDefeated = activeBattle.enemies.some((e) => e.hp <= 0 && !e.escaped);
    if (!anyDefeated) { handleAllEscaped(); return true; }
    handleBattleWin();
    return true;
  }
  if (SHELTER_PARTY_IDS.every((id) => activeDive.party[id].fallen)) { handleBattleWipe(); return true; }
  return false;
}

// ---------- 敵人 AI ----------

function chooseEnemyIntent(enemy) {
  if (enemy.forcedNextSkillId) {
    let id = enemy.forcedNextSkillId;
    enemy.forcedNextSkillId = null;
    // 掘地→破土：這一回合冒出地面，恢復成可被攻擊的目標（玩家有機會在牠出手前打斷）
    if (MONSTER_SKILLS[id] && MONSTER_SKILLS[id].id === "尖嘴鼠_破土") enemy.burrowed = false;
    return id;
  }
  let monster = MONSTERS[enemy.monsterId];
  let available = monster.skillIds.filter((sid) => (enemy.skillCooldowns[sid] || 0) <= 0);
  available = available.filter((sid) => {
    let sk = MONSTER_SKILLS[sid];
    // 召喚類技能（島鯨反芻／巨岩蚺喚岩）在場上已滿時不能用
    if (sid === "島鯨_反芻" || (sk && sk.type === "summon-then-devour")) {
      return activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped).length < MAX_ENEMIES_ON_FIELD;
    }
    return true;
  });
  if (available.length === 0) available = monster.skillIds;
  return pickRandom(available);
}

function executeEnemySkill(enemy) {
  let skill = MONSTER_SKILLS[enemy.intentSkillId];
  enemy.skillCooldowns[skill.id] = skill.cooldown;
  flashUnit(enemy.uid, "actor");

  if (skill.type === "attack") {
    let hits = skill.hits || 1;
    // 敵方蓄勢（青羽「鼓翼」給的）：這次攻擊傷害提升，用完消耗。
    let atkRange = enemy.chargeReady
      ? [Math.ceil(skill.dmgRange[0] * (1 + CHARGE_BONUS)), Math.ceil(skill.dmgRange[1] * (1 + CHARGE_BONUS))]
      : skill.dmgRange;
    let results = [];
    if (skill.targetType === "all-enemies") {
      SHELTER_PARTY_IDS.forEach((id) => {
        if (activeDive.party[id].fallen) return;
        for (let h = 0; h < hits; h++) results.push(Object.assign({ name: displayName(id) }, dealDamageToAlly(enemy, id, atkRange)));
      });
    } else {
      let targetId = pickAllyTarget();
      if (targetId) for (let h = 0; h < hits; h++) results.push(Object.assign({ name: displayName(targetId) }, dealDamageToAlly(enemy, targetId, atkRange)));
    }
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，對 ${summarizeHits(results)}${enemy.chargeReady ? "（蓄勢釋放）" : ""}。`);
    if (enemy.chargeReady) enemy.chargeReady = false;
    if (skill.forcesNextBite) enemy.forcedNextSkillId = "藍顎獸_撕咬";
    if (skill.lifesteal) {
      let drained = results.reduce((sum, r) => sum + (r.miss ? 0 : r.dmg), 0);
      if (drained > 0) {
        let healed = applyEnemyHeal(enemy, drained); // 中毒時吸血減半
        logBattle(`${enemy.icon} ${enemy.name} 吸取了 ${healed} 點血量${enemy.poisonDuration > 0 ? "（中毒，減半）" : ""}。`);
        spawnFloatingNumber(enemy.uid, "+" + healed, "heal");
      }
    }
  } else if (skill.type === "attack-random-allies") {
    // 隨機挑 targetCount 名還沒倒下的我方，各別造成傷害；命中的可附加中毒
    let alive = SHELTER_PARTY_IDS.filter((id) => !activeDive.party[id].fallen);
    let count = Math.min(skill.targetCount || 1, alive.length);
    let pool = alive.slice();
    let picked = [];
    for (let i = 0; i < count && pool.length > 0; i++) picked.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
    let results = [];
    let poisonedNames = [];
    picked.forEach((id) => {
      let r = Object.assign({ name: displayName(id) }, dealDamageToAlly(enemy, id, skill.dmgRange));
      results.push(r);
      let m = activeDive.party[id];
      if (skill.applyPoison && !r.miss && !m.fallen) {
        m.poisonDuration = POISON_DURATION; // 不可疊加，重複中毒只刷新持續時間
        poisonedNames.push(displayName(id));
      }
    });
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，對 ${summarizeHits(results)}${poisonedNames.length ? `，${poisonedNames.join("、")}中毒了` : ""}。`);
  } else if (skill.type === "burrow") {
    // 掘地：這回合潛入地底（無法被選為目標、不受全體技能波及），並預約下回合冒出重擊
    enemy.burrowed = true;
    enemy.forcedNextSkillId = skill.emergeSkillId;
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，鑽進地底，暫時無法被攻擊。`);
  } else if (skill.type === "self-heal") {
    let raw = randInt(skill.healRange[0], skill.healRange[1]);
    let heal = applyEnemyHeal(enemy, raw); // 中毒時自癒減半
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，回復了 ${heal} 點血量${enemy.poisonDuration > 0 ? "（中毒，減半）" : ""}。`);
  } else if (skill.type === "self-shield") {
    enemy.shield += skill.shieldAmount;
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，獲得了 ${skill.shieldAmount} 點護盾。`);
  } else if (skill.type === "charge-up") {
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，正在蓄力……`);
  } else if (skill.type === "self-buff-dodge") {
    enemy.dodgeActive = { chance: skill.dodgeChance };
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，準備閃避下一次攻擊。`);
  } else if (skill.type === "apply-bleed-all") {
    SHELTER_PARTY_IDS.forEach((id) => {
      let m = activeDive.party[id];
      if (m.fallen) return;
      m.bleedStacks = Math.min(BLEED_MAX_STACKS, m.bleedStacks + skill.bleedStacks);
      m.bleedDuration = BLEED_DURATION;
      flashUnit(id, "target");
    });
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，全體我方附加流血。`);
  } else if (skill.type === "stun-chance-all") {
    let stunned = [];
    SHELTER_PARTY_IDS.forEach((id) => {
      let m = activeDive.party[id];
      if (m.fallen) return;
      if (chance(skill.stunChance)) { m.stunTurns = Math.max(m.stunTurns, 1); stunned.push(displayName(id)); flashUnit(id, "target"); }
    });
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」${stunned.length ? `，${stunned.join("、")}被震懾了！` : "，但沒有人被震懾。"}`);
  } else if (skill.type === "summon") {
    if (activeBattle.enemies.filter((e) => e.hp > 0).length < MAX_ENEMIES_ON_FIELD) {
      let summonId = pickRandom(["凝膠", "藍顎獸", "翅鱗", "眼藻"]);
      let inst = buildEnemyInstance(summonId, false, activeBattle.enemies.length);
      inst.justSummoned = true; // 下回合才開始行動
      activeBattle.enemies.push(inst);
      gameState.bestiary[summonId] = true;
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，吐出了一隻 ${MONSTERS[summonId].name}！`);
    } else {
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，但場上已經滿了。`);
    }
  } else if (skill.type === "summon-then-devour") {
    // 巨岩蚺「喚岩」：叫出小怪，並預約下回合「吞噬」其中一隻回血。
    let pool = LAYER_MONSTER_POOLS[2] || LAYER2_MONSTER_POOL;
    let room = MAX_ENEMIES_ON_FIELD - activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped).length;
    let count = Math.min(skill.summonCount || 1, room);
    let summonedNames = [];
    for (let i = 0; i < count; i++) {
      let summonId = pickRandom(pool);
      let inst = buildEnemyInstance(summonId, false, activeBattle.enemies.length);
      inst.justSummoned = true; // 下回合才開始行動
      inst.isBossSummon = true; // 標記成 Boss 的召喚物，之後可被「吞噬」吃掉
      activeBattle.enemies.push(inst);
      gameState.bestiary[summonId] = true;
      summonedNames.push(MONSTERS[summonId].name);
    }
    if (summonedNames.length > 0) {
      enemy.forcedNextSkillId = skill.chainSkillId; // 預約下回合吞噬
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，從岩壁裡喚出了 ${summonedNames.join("、")}！（下回合會吞掉一隻回血——趁早打掉牠們！）`);
    } else {
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，但四周已經沒有空間喚出小怪了。`);
    }
  } else if (skill.type === "devour-heal") {
    // 巨岩蚺「吞噬」：吃掉一隻還活著的召喚物回血；若召喚物已被玩家打死，就撲空、補不到血。
    let prey = activeBattle.enemies.find((e) => e.isBossSummon && e.hp > 0 && !e.escaped);
    if (prey) {
      prey.hp = 0;
      prey.escaped = true; // 標記成離場，不列入戰利品結算
      let healed = applyEnemyHeal(enemy, skill.healAmount); // 中毒時吞噬回血同樣減半
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，一口吞掉了 ${prey.name}，回復了 ${healed} 點血量${enemy.poisonDuration > 0 ? "（中毒，減半）" : ""}。`);
    } else {
      logBattle(`${enemy.icon} ${enemy.name} 張口想吞掉小怪回血——卻撲了個空，小怪早被解決了！`);
    }
  } else if (skill.type === "multi-random-hits") {
    // 兩種用法：
    //  · 巨岩蚺「碎地連擊」：固定 hits 下，同一個人最多挨 maxPerTarget 下（不重複太多）。
    //  · 擬巢怪「彈射」：hitsRange 隨機次數、allowRepeat 目標可重複（同一人可能連中好幾下）。
    let alive = SHELTER_PARTY_IDS.filter((id) => !activeDive.party[id].fallen);
    let hits = skill.hitsRange ? randInt(skill.hitsRange[0], skill.hitsRange[1]) : skill.hits;
    let bag = [];
    if (skill.allowRepeat) {
      for (let k = 0; k < hits && alive.length > 0; k++) bag.push(pickRandom(alive)); // 每下獨立隨機、可重複
    } else {
      let maxPer = skill.maxPerTarget || hits;
      alive.forEach((id) => { for (let k = 0; k < maxPer; k++) bag.push(id); });
      bag = bag.sort(() => Math.random() - 0.5).slice(0, hits); // 洗牌後取前 hits 個，天生把每人上限壓在 maxPer
    }
    let results = [];
    bag.forEach((id) => {
      if (activeDive.party[id].fallen) return;
      results.push(Object.assign({ name: displayName(id) }, dealDamageToAlly(enemy, id, skill.dmgRange)));
    });
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，${results.length ? `對 ${summarizeHits(results)}` : "但沒打中任何人"}。`);
  } else if (skill.type === "heal-all-enemies") {
    // 青羽「群護」：把自己這邊（敵方）所有還活著的怪都補一點血。
    let raw = randInt(skill.healRange[0], skill.healRange[1]);
    let healedNames = [];
    activeBattle.enemies.forEach((e) => {
      if (e.hp <= 0 || e.escaped) return;
      let before = e.hp;
      e.hp = Math.min(e.maxHp, e.hp + raw);
      if (e.hp > before) { spawnFloatingNumber(e.uid, "+" + (e.hp - before), "heal"); healedNames.push(e.name); }
    });
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，${healedNames.length ? `治療了 ${healedNames.join("、")}` : "但沒有誰需要治療"}。`);
  } else if (skill.type === "buff-ally-charge") {
    // 青羽「鼓翼」：幫「其他」還活著的敵方友軍隨機一個上蓄勢；場上只剩自己時落空。
    let others = activeBattle.enemies.filter((e) => e !== enemy && e.hp > 0 && !e.escaped);
    if (others.length > 0) {
      let ally = pickRandom(others);
      ally.chargeReady = true;
      spawnFloatingNumber(ally.uid, "蓄勢", "heal");
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，讓 ${ally.name} 蓄勢待發（下次攻擊更痛）！`);
    } else {
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，但身邊沒有同伴可以鼓舞，落空了。`);
    }
  } else if (skill.type === "summon-copy") {
    // 枝角翎「兀兀」：召來一隻一樣的自己；一場戰鬥最多發生 maxSummonsPerBattle 次（用 activeBattle 計數，含被召來的那隻，避免無限循環）。
    activeBattle.summonCopyCounts = activeBattle.summonCopyCounts || {};
    let key = skill.summonId;
    let used = activeBattle.summonCopyCounts[key] || 0;
    let room = MAX_ENEMIES_ON_FIELD - activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped).length;
    if (used >= skill.maxSummonsPerBattle) {
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，但這片林子裡再也叫不出同伴了。`);
    } else if (room <= 0) {
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，但場上已經沒有空間了。`);
    } else {
      let inst = buildEnemyInstance(skill.summonId, enemy.isElite, activeBattle.enemies.length);
      inst.justSummoned = true;
      activeBattle.enemies.push(inst);
      gameState.bestiary[skill.summonId] = true;
      activeBattle.summonCopyCounts[key] = used + 1;
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，「兀——」暗處站起了另一隻 ${MONSTERS[skill.summonId].name}！`);
    }
  } else if (skill.type === "summon-temporary") {
    // 花尾「呼喚」：召來 summonCount 隻小怪，牠們自己行動一次後就消失（vanishAfterAction）；行動前被打掉就不會放技能。
    let room = MAX_ENEMIES_ON_FIELD - activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped).length;
    let count = Math.min(skill.summonCount || 1, room);
    let names = [];
    for (let i = 0; i < count; i++) {
      let inst = buildEnemyInstance(skill.summonId, false, activeBattle.enemies.length);
      inst.justSummoned = true;
      inst.vanishAfterAction = true;
      activeBattle.enemies.push(inst);
      gameState.bestiary[skill.summonId] = true;
      names.push(MONSTERS[skill.summonId].name);
    }
    if (names.length > 0) logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，喚來了 ${names.join("、")}！（牠們行動一次就會離開——趕在那之前打掉牠們！）`);
    else logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，但四周已經沒有空間了。`);
  } else if (skill.type === "confuse-chance-all") {
    // 花尾「漩渦紋」：全體我方，無傷害，每人各自 confuseChance 機率陷入「混亂」1 回合。
    let confused = [];
    SHELTER_PARTY_IDS.forEach((id) => {
      let m = activeDive.party[id];
      if (m.fallen) return;
      if (chance(skill.confuseChance)) { m.confuseTurns = Math.max(m.confuseTurns, 1); confused.push(displayName(id)); flashUnit(id, "target"); }
    });
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，尾羽的紋路旋轉起來${confused.length ? `——${confused.join("、")}陷入了混亂！` : "，但大家都撐住了。"}`);
  } else if (skill.type === "press-stun") {
    // 巨岩蚺「地陷」：把一名角色壓進地面，受一次傷害後被震懾 stunTurns 回合。
    let targetId = pickAllyTarget();
    if (targetId) {
      let r = Object.assign({ name: displayName(targetId) }, dealDamageToAlly(enemy, targetId, skill.dmgRange));
      let m = activeDive.party[targetId];
      let stunned = false;
      if (!m.fallen) { m.stunTurns = Math.max(m.stunTurns, skill.stunTurns); stunned = true; }
      logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，把 ${summarizeHits([r])}${stunned ? `，${displayName(targetId)} 被壓進地面，震懾 ${skill.stunTurns} 回合！` : "。"}`);
    }
  }
}

// 把同一次行動打中的多個目標／多次命中，合併成一行日誌，並標明是哪個技能造成的
function summarizeHits(hits) {
  let order = [];
  let byTarget = {};
  hits.forEach((h) => {
    if (!byTarget[h.name]) { byTarget[h.name] = { total: 0, hitCount: 0, critCount: 0, missCount: 0 }; order.push(h.name); }
    let t = byTarget[h.name];
    if (h.miss) t.missCount++;
    else { t.total += h.dmg; t.hitCount++; if (h.crit) t.critCount++; }
  });
  return order.map((name) => {
    let t = byTarget[name];
    let parts = [];
    if (t.hitCount > 0) {
      let critNote = t.critCount > 0 ? `${t.hitCount > 1 ? `，${t.critCount}次爆擊` : "（爆擊）"}` : "";
      let hitNote = t.hitCount > 1 ? `（${t.hitCount}次命中${critNote}）` : critNote;
      parts.push(`${name} 造成 ${t.total} 點傷害${hitNote}`);
    }
    if (t.missCount > 0) parts.push(`${name} MISS${t.missCount > 1 ? ` x${t.missCount}` : ""}`);
    return parts.join("、");
  }).join("、");
}

function pickAllyTarget() {
  let alive = SHELTER_PARTY_IDS.filter((id) => !activeDive.party[id].fallen);
  if (alive.length === 0) return null;
  let guarding = alive.find((id) => activeDive.party[id].guardActive);
  return guarding || pickRandom(alive);
}

// ---------- 傷害計算 ----------

function rollCritRate(baseExtra) {
  let rate = BASE_CRIT_RATE + (baseExtra || 0);
  if (activeDive.globalBuffs.includes("同步感應")) rate += 0.05;
  return rate;
}

// attackerSide/targetSide: 'ally' | 'enemy'
function damageCalc(dmgRange, opts) {
  opts = opts || {};
  let dmg = randInt(dmgRange[0], dmgRange[1]);

  if (opts.attacker && opts.attacker.chargeReady) {
    let bonus = relicMax(opts.attacker, "charge-bonus-override", CHARGE_BONUS);
    dmg = Math.ceil(dmg * (1 + bonus));
    opts.attacker.chargeReady = false;
  }
  if (opts.attacker && opts.attacker.dmgBuffNextAttack) {
    dmg = Math.ceil(dmg * (1 + opts.attacker.dmgBuffNextAttack));
    opts.attacker.dmgBuffNextAttack = 0; // K_輕靈：消耗在該角色下一次造成傷害的行動上
  }
  if (opts.attacker && opts.attacker.chargeMultiplier && opts.attacker.chargeMultiplier !== 1) {
    dmg = Math.ceil(dmg * opts.attacker.chargeMultiplier);
    opts.attacker.chargeMultiplier = 1; // V_蓄力：同樣消耗在下一次造成傷害的行動上
  }
  if (opts.attackerRelicDmgPercent) dmg = Math.ceil(dmg * (1 + opts.attackerRelicDmgPercent));
  if (opts.attackerFoodDmgPercent) dmg = Math.ceil(dmg * (1 + opts.attackerFoodDmgPercent));
  if (opts.attackerIsElite) dmg = Math.ceil(dmg * ELITE_DMG_MULT);
  if (activeDive.nextBattleDmgDebuff && opts.attackerSide === "ally") dmg = Math.ceil(dmg * (1 + activeDive.nextBattleDmgDebuff));
  if (activeDive.nextBattleDmgBonus && opts.attackerSide === "ally") dmg = Math.ceil(dmg * (1 + activeDive.nextBattleDmgBonus));
  // 第二層料理「鹽烤鼠肉串」：首回合造成傷害提升（只在該場戰鬥第一回合生效）
  if (opts.attacker && opts.attacker.foodBuffActive && opts.attacker.foodBuffActive.type === "first-turn-dmg-percent" && opts.attackerSide === "ally" && activeBattle.turnCount === 1) {
    dmg = Math.ceil(dmg * (1 + opts.attacker.foodBuffActive.value));
  }
  if (opts.attackerSide === "ally" && activeBattle.turnCount >= 3 && opts.targetSide === "enemy" && activeDive.globalBuffs.includes("脆弱迴響")) {
    dmg = Math.ceil(dmg * 1.15);
  }
  if (opts.attackerSide === "ally" && SHELTER_PARTY_IDS.some((id) => activeDive.party[id].fallen) && activeDive.globalBuffs.includes("險境奮起")) {
    dmg = Math.ceil(dmg * 1.20);
  }

  let isCrit = false;
  if (chance(opts.critRate != null ? opts.critRate : rollCritRate(opts.attackerCritBonus))) {
    dmg = Math.round(dmg * BASE_CRIT_MULT);
    isCrit = true;
  }

  if (opts.missRate && chance(opts.missRate)) return { dmg: 0, miss: true, crit: false };

  // 全局增益「潛流加速」：第一回合我方全體閃避率+30%
  if (opts.attackerSide === "enemy" && opts.targetSide === "ally" && activeBattle.turnCount === 1 && activeDive.globalBuffs.includes("潛流加速")) {
    if (chance(0.30)) return { dmg: 0, miss: true, crit: false, dodge: true };
  }

  if (opts.target && opts.target.dodgeActive) {
    let dodgeChance = opts.target.dodgeActive.chance;
    if (!opts.target.dodgeActive.permanent) opts.target.dodgeActive = false; // 常駐閃避不會用一次就消失
    if (chance(dodgeChance)) return { dmg: 0, miss: true, crit: false, dodge: true };
  }

  if (opts.targetGuard) dmg = Math.ceil(dmg * (1 - GUARD_DAMAGE_REDUCTION));
  if (opts.targetDmgReductionPercent) dmg = Math.ceil(dmg * (1 - opts.targetDmgReductionPercent));
  if (opts.targetSide === "ally" && activeBattle.turnCount === 1 && activeDive.globalBuffs.includes("迴聲護盾")) {
    dmg = Math.ceil(dmg * (1 - 0.30));
  }

  dmg = Math.max(1, dmg);
  return { dmg, miss: false, crit: isCrit };
}

// 只負責算傷害／扣血／閃光，不在這裡寫log——同一次行動打中的每個目標會在呼叫端合併成一行
function dealDamageToAlly(enemy, allyId, dmgRange) {
  let m = activeDive.party[allyId];
  if (m.foodBuffActive && m.foodBuffActive.type === "dodge-percent" && chance(m.foodBuffActive.value)) {
    flashUnit(allyId, "target");
    spawnFloatingNumber(allyId, "閃避", "miss");
    return { dmg: 0, miss: true, crit: false };
  }
  if (m.dodgeBuffThisTurn && chance(m.dodgeBuffThisTurn)) {
    flashUnit(allyId, "target");
    spawnFloatingNumber(allyId, "閃避", "miss");
    return { dmg: 0, miss: true, crit: false };
  }
  let result = damageCalc(dmgRange, {
    target: m,
    targetGuard: m.guardActive,
    targetDmgReductionPercent: getAllyDamageTakenReduction(m),
    attackerSide: "enemy", targetSide: "ally",
    attackerIsElite: enemy.isElite,
  });
  if (result.miss) {
    flashUnit(allyId, "target");
    floatDamageResult(allyId, result);
    return result;
  }
  let wasGuarding = m.guardActive;
  let dmg = result.dmg;
  if (m.shield > 0) { // 魔藥「血膜護盾」等提供的護盾先吸收傷害
    let absorbed = Math.min(m.shield, dmg);
    m.shield -= absorbed;
    dmg -= absorbed;
  }
  m.hp = Math.max(0, m.hp - dmg);
  flashUnit(allyId, "target");
  spawnFloatingNumber(allyId, dmg > 0 ? "-" + dmg : "擋下", dmg > 0 ? (result.crit ? "crit" : "dmg") : "miss");
  if (wasGuarding) m.guardActive = false; // 被單體攻擊命中後格擋消失
  if (m.hp <= 0) fallAlly(allyId);
  return result;
}

function getAllyDamageTakenReduction(m) {
  let reduction = 0;
  reduction += -relicSum(m, "damage-taken-percent"); // 遺物的減傷值存成負數（-0.08），取負號變成正的減傷比例
  if (m.foodBuffActive && m.foodBuffActive.type === "damage-reduction-percent") reduction += m.foodBuffActive.value;
  if (m.damageReductionDuration > 0) reduction += m.damageReduction; // L_冰盾
  return reduction;
}

// 只負責算傷害／扣血／閃光，不在這裡寫log——同一次行動打中的每個目標會在呼叫端合併成一行
function dealDamageToEnemy(casterId, enemy, dmgRange, opts) {
  opts = opts || {};
  let m = activeDive.party[casterId];
  let critBonus = relicSum(m, "crit-rate-add") + (m.critBuffNextBattle || 0) + (m.multiBattleCritRemaining > 0 ? m.multiBattleCritBonus : 0)
    + (m.foodBuffActive && m.foodBuffActive.type === "crit-percent" ? m.foodBuffActive.value : 0); // 第二層料理「炙烤兔腿」：爆擊率
  let dmgPercent = 0;
  if (opts.isNormalAttack) dmgPercent += relicSum(m, "normal-atk-percent");
  if (opts.isSkill) dmgPercent += relicSum(m, "skill-dmg-percent");
  let foodPercent = m.foodBuffActive && m.foodBuffActive.type === "damage-percent" ? m.foodBuffActive.value : 0;

  let result = damageCalc(dmgRange, {
    attacker: m, target: enemy,
    attackerCritBonus: critBonus,
    critRate: opts.critRateOverride != null ? opts.critRateOverride + critBonus + (activeDive.globalBuffs.includes("同步感應") ? 0.05 : 0) : null,
    missRate: opts.missRate,
    attackerRelicDmgPercent: dmgPercent,
    attackerFoodDmgPercent: foodPercent,
    attackerSide: "ally", targetSide: "enemy",
  });

  if (result.miss) {
    flashUnit(enemy.uid, "target");
    floatDamageResult(enemy.uid, result);
    return result;
  }
  let dmg = result.dmg;
  if (enemy.shield > 0) {
    let absorbed = Math.min(enemy.shield, dmg);
    enemy.shield -= absorbed;
    dmg -= absorbed;
  }
  enemy.hp = Math.max(0, enemy.hp - dmg);
  flashUnit(enemy.uid, "target");
  spawnFloatingNumber(enemy.uid, dmg > 0 ? "-" + dmg : "擋下", dmg > 0 ? (result.crit ? "crit" : "dmg") : "miss");
  return Object.assign({}, result, { dmg });
}

// ---------- 玩家行動 ----------

// 防止畫面還沒切到下一個動作前的殘留按鈕被連點兩下觸發兩次（例如玩家手滑連點），
// 或是點到已經換人/換階段之後失效的舊畫面按鈕。
function isCurrentActorsTurn(casterId) {
  if (!activeBattle || activeBattle.phase !== "ally") return false;
  if (activeBattle.pendingAction) return false;
  let currentId = activeBattle.allyTurnQueue[activeBattle.allyTurnPointer];
  return currentId === casterId;
}

// 敵方只剩1隻活著沒逃走的敵人、且設定裡開著自動選目標時，回傳那隻敵人；否則回傳null(需要玩家手動點選)
function getAutoTargetEnemyIfSingle() {
  if (!gameState.settings.autoTargetSingleEnemy) return null;
  let alive = activeBattle.enemies.filter((e) => e.hp > 0 && !e.escaped && !e.burrowed);
  return alive.length === 1 ? alive[0] : null;
}

function battleNormalAttack(casterId) {
  if (!isCurrentActorsTurn(casterId)) return;
  let autoTarget = getAutoTargetEnemyIfSingle();
  if (autoTarget) { resolveNormalAttack(casterId, autoTarget.uid); return; }
  activeBattle.pendingAction = { casterId, kind: "normal" };
  renderBattleScreen(casterId);
}

function battleUseSkill(casterId, skillId) {
  if (!isCurrentActorsTurn(casterId)) return;
  if (!isSkillUnlocked(casterId, skillId)) return;
  let m = activeDive.party[casterId];
  if ((m.skillUses[skillId] || 0) <= 0) return;
  let skill = SKILLS[skillId];
  if (skill.targetType === "single-enemy") {
    let autoTarget = getAutoTargetEnemyIfSingle();
    if (autoTarget) { resolveSkillNoTarget(casterId, skillId, autoTarget.uid); return; }
    activeBattle.pendingAction = { casterId, kind: "skill", skillId };
    renderBattleScreen(casterId);
  } else if (skill.targetType === "single-ally") {
    activeBattle.pendingAction = { casterId, kind: "skill", skillId };
    renderBattleScreen(casterId);
  } else {
    resolveSkillNoTarget(casterId, skillId, null);
  }
}

function battleCancelTargeting() {
  if (!activeBattle.pendingAction) return;
  let casterId = activeBattle.pendingAction.casterId;
  activeBattle.pendingAction = null;
  renderBattleScreen(casterId);
}

function battleSelectTarget(targetId, isEnemy) {
  let pending = activeBattle.pendingAction;
  if (!pending) return;
  if (isEnemy) {
    let enemy = activeBattle.enemies.find((e) => e.uid === targetId);
    if (!enemy || enemy.hp <= 0 || enemy.escaped || enemy.burrowed) return;
  } else {
    let m = activeDive.party[targetId];
    if (!m || m.fallen) return;
  }
  activeBattle.pendingAction = null;
  if (pending.kind === "normal") {
    if (!isEnemy) return;
    resolveNormalAttack(pending.casterId, targetId);
  } else if (pending.kind === "skill") {
    resolveSkillNoTarget(pending.casterId, pending.skillId, targetId);
  }
}

function resolveNormalAttack(casterId, targetUid) {
  let enemy = activeBattle.enemies.find((e) => e.uid === targetUid);
  if (!enemy || enemy.hp <= 0) return;
  let c = CHARACTERS[casterId];
  let m = activeDive.party[casterId];
  let hits = c.atkHits || 1;
  let mult = getCharacterWeaponMultiplier(casterId);
  let range = [Math.max(1, Math.ceil(c.atkRange[0] * mult)), Math.max(1, Math.ceil(c.atkRange[1] * mult))];

  let doubleHit = chance(relicSum(m, "normal-atk-double-chance"));
  let totalHits = hits + (doubleHit ? hits : 0);
  flashUnit(casterId, "actor");
  let results = [];
  for (let h = 0; h < totalHits; h++) {
    if (enemy.hp <= 0) break;
    results.push(Object.assign({ name: enemy.name }, dealDamageToEnemy(casterId, enemy, range, { isNormalAttack: true })));
  }
  logBattle(`${displayName(casterId)} 使用「攻擊」，對 ${summarizeHits(results)}。`);
  logBattle(`⚡ ${displayName(casterId)} 獲得蓄勢。`);
  m.chargeReady = true; // 普攻後獲得蓄勢（不可疊加，這裡直接覆蓋）
  finishAllyAction();
}

function resolveSkillNoTarget(casterId, skillId, targetId) {
  let m = activeDive.party[casterId];
  let skill = SKILLS[skillId];
  let noCost = chance(relicSum(m, "skill-no-cost-chance"));
  if (!noCost) m.skillUses[skillId]--;

  if (skill.type === "attack") {
    let mult = getCharacterWeaponMultiplier(casterId);
    let range = [Math.max(1, Math.ceil(skill.dmgRange[0] * mult)), Math.max(1, Math.ceil(skill.dmgRange[1] * mult))];
    flashUnit(casterId, "actor");
    let results = [];
    let stunnedEnemyName = null;
    if (skill.targetType === "all-enemies") {
      activeBattle.enemies.filter((e) => e.hp > 0 && !e.burrowed).forEach((e) => {
        results.push(Object.assign({ name: e.name }, dealDamageToEnemy(casterId, e, range, { isSkill: true, missRate: skill.missRate, critRateOverride: skill.critRateOverride })));
      });
    } else {
      let enemy = activeBattle.enemies.find((e) => e.uid === targetId);
      if (enemy && enemy.hp > 0) {
        let hits = skill.hits || 1;
        for (let h = 0; h < hits; h++) {
          if (enemy.hp <= 0) break;
          let result = dealDamageToEnemy(casterId, enemy, range, { isSkill: true, missRate: skill.missRate, critRateOverride: skill.critRateOverride });
          results.push(Object.assign({ name: enemy.name }, result));
          if (skill.applyBleed && !result.miss) {
            enemy.bleedStacks = Math.min(BLEED_MAX_STACKS, enemy.bleedStacks + skill.applyBleed);
            enemy.bleedDuration = BLEED_DURATION;
          }
          if (skill.stunChance && !result.miss && enemy.stunTurns <= 0 && chance(skill.stunChance)) {
            enemy.stunTurns = Math.max(enemy.stunTurns, 1);
            stunnedEnemyName = enemy.name;
          }
        }
      }
    }
    logBattle(`${displayName(casterId)} 使用「${skill.name}」，對 ${summarizeHits(results)}${stunnedEnemyName ? `，${stunnedEnemyName}被震懾了！` : ""}。`);
  } else if (skill.type === "heal") {
    let allyId = targetId || casterId;
    let target = activeDive.party[allyId];
    let healMult = getCharacterHealMultiplier(casterId);
    let raw = randInt(Math.ceil(skill.healRange[0] * healMult), Math.ceil(skill.healRange[1] * healMult));
    let heal = applyAllyHeal(target, raw);
    logBattle(`💚 ${displayName(casterId)} 使用「${skill.name}」，治療 ${displayName(allyId)} 回復 ${heal} 點血量。`);
    flashUnit(casterId, "actor");
    flashUnit(allyId, "heal");
    spawnFloatingNumber(allyId, "+" + heal, "heal");
  } else if (skill.type === "hot") {
    let allyId = targetId || casterId;
    let target = activeDive.party[allyId];
    let healMult = getCharacterHealMultiplier(casterId);
    target.hotHealPerTurn = Math.ceil(skill.hotHealPerTurn * healMult);
    target.hotDuration = skill.hotDuration;
    logBattle(`💚 ${displayName(casterId)} 使用「${skill.name}」，${displayName(allyId)} 進入持續回血狀態。`);
    flashUnit(casterId, "actor");
    flashUnit(allyId, "heal");
  } else if (skill.type === "guard") {
    m.guardActive = true;
    logBattle(`🛡️ ${displayName(casterId)} 使用「${skill.name}」，進入格擋姿態。`);
    flashUnit(casterId, "actor");
  } else if (skill.type === "self-heal-percent") {
    let heal = applyAllyHeal(m, Math.ceil(m.maxHp * skill.healPercent));
    logBattle(`💚 ${displayName(casterId)} 使用「${skill.name}」，回復了 ${heal} 點血量。`);
    flashUnit(casterId, "heal");
    spawnFloatingNumber(casterId, "+" + heal, "heal");
  } else if (skill.type === "party-dmg-buff") {
    SHELTER_PARTY_IDS.forEach((id) => {
      let ally = activeDive.party[id];
      if (!ally.fallen) ally.dmgBuffNextAttack = skill.dmgBuffPercent;
    });
    logBattle(`✨ ${displayName(casterId)} 使用「${skill.name}」，全隊下次攻擊傷害提升。`);
    flashUnit(casterId, "actor");
  } else if (skill.type === "self-charge") {
    m.chargeMultiplier = skill.chargeMultiplier;
    logBattle(`🔥 ${displayName(casterId)} 使用「${skill.name}」，蓄力完畢，下次攻擊傷害大幅提升。`);
    flashUnit(casterId, "actor");
  } else if (skill.type === "self-dodge") {
    m.dodgeBuffThisTurn = skill.dodgeChance;
    logBattle(`💨 ${displayName(casterId)} 使用「${skill.name}」，這回合閃避率大幅提升。`);
    flashUnit(casterId, "actor");
  } else if (skill.type === "damage-reduction") {
    let allyId = targetId || casterId;
    let target = activeDive.party[allyId];
    target.damageReduction = skill.damageReduction;
    target.damageReductionDuration = skill.duration;
    logBattle(`❄️ ${displayName(casterId)} 使用「${skill.name}」，${displayName(allyId)} 獲得減傷效果。`);
    flashUnit(casterId, "actor");
    flashUnit(allyId, "heal");
  }
  finishAllyAction();
}

function battleDrinkPotion(casterId) {
  if (!isCurrentActorsTurn(casterId)) return;
  if (gameState.potions <= 0) return;
  gameState.potions--;
  let m = activeDive.party[casterId];
  let healPercent = activeDive.globalBuffs.includes("藥效強化") ? 0.45 : POTION_HEAL_PERCENT;
  let healedByPotion = applyAllyHeal(m, Math.ceil(m.maxHp * healPercent)); // 中毒時補血藥回復同樣減半
  logBattle(`🧪 ${displayName(casterId)} 喝下補血藥回復血量。`);
  flashUnit(casterId, "heal");
  spawnFloatingNumber(casterId, "+" + healedByPotion, "heal");
  finishAllyAction();
}

// 補血藥「外敷」：不當場回血，改成接下來幾回合的持續回血（HoT），從「下一回合開始」才回第一次
// （這回合的持續效果結算已經過了）。第二層Boss戰後由 storyFlags.potionApplyUnlocked 解鎖。
function battleApplyPotion(casterId) {
  if (!isCurrentActorsTurn(casterId)) return;
  if (gameState.potions <= 0) return;
  gameState.potions--;
  let m = activeDive.party[casterId];
  let hotPercent = activeDive.globalBuffs.includes("藥效強化") ? POTION_HOT_PERCENT * 1.5 : POTION_HOT_PERCENT;
  let perTurn = Math.ceil(m.maxHp * hotPercent);
  // 外敷是「刷新式」不是「疊加式」：重複外敷或身上已有持續回血時，取較高的每回合量並把回合數重置到滿
  m.hotHealPerTurn = Math.max(m.hotHealPerTurn || 0, perTurn);
  m.hotDuration = POTION_HOT_DURATION;
  logBattle(`🩹 ${displayName(casterId)} 把補血藥敷上傷口，接下來 ${POTION_HOT_DURATION} 回合會持續回血（每回合約 +${perTurn}，下回合開始生效）。`);
  flashUnit(casterId, "heal");
  finishAllyAction();
}

// 使用攜帶的魔藥：不消耗回合（免費動作）、只能在自己回合用。用完該格變「沒有魔藥」。
function battleUsePotion(casterId) {
  if (!isCurrentActorsTurn(casterId)) return;
  let m = activeDive.party[casterId];
  let cp = m.carriedPotion;
  if (!cp || !POTIONS[cp.potionId]) return;
  let pd = POTIONS[cp.potionId];
  let eff = pd.effect;

  if (eff.type === "throw-damage") {
    let range = cp.rare ? eff.rareDmgRange : eff.dmgRange;
    flashUnit(casterId, "actor");
    let parts = [];
    let poisonedNames = [];
    activeBattle.enemies.forEach((e) => {
      if (e.hp <= 0 || e.escaped || e.burrowed) return;
      let dmg = randInt(range[0], range[1]);
      if (e.shield > 0) { let ab = Math.min(e.shield, dmg); e.shield -= ab; dmg -= ab; }
      e.hp = Math.max(0, e.hp - dmg);
      flashUnit(e.uid, "target");
      parts.push(`${e.name} ${dmg} 點`);
      if (eff.poison && e.hp > 0) { e.poisonDuration = POISON_DURATION; poisonedNames.push(e.name); } // 附中毒（不可疊加，只刷新回合）
    });
    logBattle(`💥 ${displayName(casterId)} 扔出「${pd.name}」，對 ${parts.length ? parts.join("、") : "空氣"} 造成傷害${poisonedNames.length ? `，並使 ${poisonedNames.join("、")} 中毒` : ""}。`);
  } else if (eff.type === "self-shield") {
    let amt = cp.rare ? eff.rareShield : eff.shield;
    m.shield += amt;
    logBattle(`🛡️ ${displayName(casterId)} 使用「${pd.name}」，獲得 ${amt} 點護盾。`);
  } else if (eff.type === "cleanse-self") {
    // 靜羽劑：解除自身所有負面狀態（中毒/流血/震懾/混亂）；稀有版另外回一點血。
    m.poisonDuration = 0; m.bleedStacks = 0; m.bleedDuration = 0; m.stunTurns = 0; m.confuseTurns = 0;
    let healPart = "";
    if (cp.rare && eff.rareHeal) { let h = Math.min(eff.rareHeal, m.maxHp - m.hp); m.hp += h; if (h > 0) { spawnFloatingNumber(casterId, "+" + h, "heal"); healPart = `，並回復 ${h} 點血量`; } }
    flashUnit(casterId, "actor");
    logBattle(`🍃 ${displayName(casterId)} 使用「${pd.name}」，抖落了一身的壞東西（清除負面狀態）${healPart}。`);
  } else if (eff.type === "self-charge") {
    // 碧翎液：自身獲得蓄勢（下次攻擊傷害提升）；稀有版另外本回合閃避提升。
    m.chargeReady = true;
    let dodgePart = "";
    if (cp.rare && eff.rareDodge) { m.dodgeBuffThisTurn = Math.max(m.dodgeBuffThisTurn, eff.rareDodge); dodgePart = `，並在這回合更難被打中`; }
    flashUnit(casterId, "actor");
    logBattle(`🌀 ${displayName(casterId)} 使用「${pd.name}」，氣勢一凝，蓄勢待發${dodgePart}。`);
  }

  m.carriedPotion = null; // 用掉了，魔藥格顯示「沒有魔藥」
  if (checkBattleEnd()) return; // 投擲可能打死所有敵人→直接結束
  renderBattleScreen(casterId); // 免費動作：不 finishAllyAction，仍是這角色的回合
}

function battleFlee(casterId) {
  if (!isCurrentActorsTurn(casterId)) return;
  if (!activeBattle.allowFlee) return;
  let aliveCount = SHELTER_PARTY_IDS.filter((id) => !activeDive.party[id].fallen).length;
  if (aliveCount < 2) return;

  if (chance(FLEE_SUCCESS_RATE)) {
    logBattle("🏃 逃跑成功！");
    renderBattleScreen();
    setTimeout(() => endBattle("flee"), 500);
  } else {
    logBattle("🏃 逃跑失敗，敵方立刻行動一輪！");
    activeBattle.allyTurnPointer = activeBattle.allyTurnQueue.length; // 跳過本回合剩下的我方行動
    renderBattleScreen();
    setTimeout(startEnemyPhase, 500);
  }
}

function finishAllyAction() {
  activeBattle.allyTurnPointer++;
  renderBattleScreen();
  setTimeout(advanceAllyTurn, 400);
}

// ---------- 戰鬥結束 ----------

function clearBattleTransientBuffs() {
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    m.critBuffNextBattle = 0;
    if (m.multiBattleCritRemaining > 0) {
      m.multiBattleCritRemaining--;
      if (m.multiBattleCritRemaining <= 0) m.multiBattleCritBonus = 0;
    }
    if (m.foodBuffActive && m.foodBuffActive.appliedMaxHpBonus) {
      m.maxHp -= m.foodBuffActive.appliedMaxHpBonus;
      m.hp = Math.min(m.hp, m.maxHp);
    }
    m.foodBuffActive = null;
  });
  activeDive.nextBattleDmgDebuff = 0;
  activeDive.nextBattleDmgBonus = 0;
}

function reviveFallenAllies() {
  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    if (!m.fallen) return;
    m.fallen = false;
    let reviveHeal = relicMax(m, "revive-heal-percent", 0);
    m.hp = reviveHeal > 0 ? Math.ceil(m.maxHp * reviveHeal) : 1;
    logBattle(`${displayName(id)} 搖搖晃晃地站了起來。`);
  });
}

function handleBattleWin() {
  let defeatedMonsterIds = activeBattle.enemies.filter((e) => !e.escaped).map((e) => e.monsterId);
  let mimicDefeated = !activeBattle.suppressRewards && defeatedMonsterIds.includes("寶箱怪");

  let crystalEarned = 0, expEarned = 0, foodDrops = [], foodDropsText = "", herbDrops = [], herbDropsText = "";
  if (!activeBattle.suppressRewards) {
    let layerMult = (activeDive && LAYER_REWARD_MULT[activeDive.layer]) || 1; // 越深的圈層獎勵小幅上調
    let category = activeBattle.isBoss ? "Boss" : activeBattle.isElite ? "菁英" : "普通";
    let baseCrystal = category === "Boss" ? randInt(CRYSTAL_DROP.Boss[0], CRYSTAL_DROP.Boss[1])
      : category === "菁英" ? randInt(CRYSTAL_DROP.菁英[0], CRYSTAL_DROP.菁英[1])
      : randInt(CRYSTAL_DROP.普通[0], CRYSTAL_DROP.普通[1]);
    let crystalMult = 1;
    if (activeDive.globalBuffs.includes("潛晶磁感")) crystalMult += 0.25;
    if (activeDive.globalBuffs.includes("採集本能")) crystalMult += 0.50;
    crystalEarned = Math.round(baseCrystal * crystalMult * activeBattle.rewardMult * layerMult);

    let eliteExpMult = activeBattle.isElite ? 2 : 1; // 菁英怪獎勵兩倍：潛晶已經有自己的更高掉落區間，經驗值原本沒跟著翻倍，這裡補上
    expEarned = activeBattle.isBoss
      ? Math.round(BOSS_EXP_REWARD * layerMult)
      : Math.round(defeatedMonsterIds.reduce((sum) => sum + randInt(EXP_PER_MONSTER_LAYER1[0], EXP_PER_MONSTER_LAYER1[1]), 0) * eliteExpMult * activeBattle.rewardMult * layerMult);

    defeatedMonsterIds.forEach((mid) => {
      let foodId = MONSTERS[mid].foodId;
      if (!foodId) return;
      if (chance(FOOD_DROP_RATE_RARE)) foodDrops.push({ foodId, rare: true });
      else if (chance(FOOD_DROP_RATE_NORMAL)) foodDrops.push({ foodId, rare: false });
    });

    // 把每個食材drop轉成「食材名 x數量」，同名的合併計數，用頓號連接
    let foodCounts = {};
    let foodOrder = [];
    foodDrops.forEach((d) => {
      let label = d.rare ? FOODS[d.foodId].rareName : FOODS[d.foodId].name;
      if (!foodCounts[label]) { foodCounts[label] = 0; foodOrder.push(label); }
      foodCounts[label]++;
    });
    foodDropsText = foodOrder.map((label) => `${label} x${foodCounts[label]}`).join("、");

    // 藥材掉落（第二層刺螯/膜翼掉，供工坊魔藥間製藥），做法同食材
    defeatedMonsterIds.forEach((mid) => {
      let herbId = MONSTERS[mid].herbId;
      if (!herbId) return;
      if (chance(FOOD_DROP_RATE_RARE)) herbDrops.push({ herbId, rare: true });
      else if (chance(FOOD_DROP_RATE_NORMAL)) herbDrops.push({ herbId, rare: false });
    });
    let herbCounts = {}, herbOrder = [];
    herbDrops.forEach((d) => {
      let label = d.rare ? HERBS[d.herbId].rareName : HERBS[d.herbId].name;
      if (!herbCounts[label]) { herbCounts[label] = 0; herbOrder.push(label); }
      herbCounts[label]++;
    });
    herbDropsText = herbOrder.map((label) => `${label} x${herbCounts[label]}`).join("、");
  }

  // 這場戰鬥中途倒地過的人，經驗值只拿一半——要在reviveFallenAllies()清掉fallen狀態之前先記下來
  let fallenIds = SHELTER_PARTY_IDS.filter((id) => activeDive.party[id].fallen);
  if (fallenIds.length === 0) gameState.stats.flawlessWins++;
  if (defeatedMonsterIds.includes("寶箱怪")) gameState.stats.mimicKills++;
  checkAchievements();
  reviveFallenAllies();

  SHELTER_PARTY_IDS.forEach((id) => {
    let m = activeDive.party[id];
    let postHeal = relicSum(m, "post-battle-heal-percent");
    if (postHeal > 0) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * postHeal));
  });

  clearBattleTransientBuffs();
  renderBattleScreen();
  if (mimicDefeated) {
    setTimeout(() => resolveMimicBonus(crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds), 900);
    return;
  }
  setTimeout(() => endBattle("win", { crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds }), 900);
}

// 混戰中打死寶箱怪的額外獎勵，疊加在原本的戰鬥獎勵之上：
// 50% 噴一大筆潛晶；50% 噴小筆潛晶 + 一個隨機增益（遺物改成成就獎勵後，這裡不再噴遺物）。
function resolveMimicBonus(crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds) {
  if (chance(0.5)) {
    let bonus = randInt(MIMIC_BONUS_CRYSTAL_BIG[0], MIMIC_BONUS_CRYSTAL_BIG[1]);
    crystalEarned += bonus;
    systemToast(`💎 寶箱怪噴出一大筆潛晶！+${bonus}`);
  } else {
    let bonus = randInt(MIMIC_BONUS_CRYSTAL_SMALL[0], MIMIC_BONUS_CRYSTAL_SMALL[1]);
    crystalEarned += bonus;
    systemToast(`💎 寶箱怪噴出了 ${bonus} 顆潛晶，還有一絲能量！`);
    let available = GLOBAL_BUFFS.filter((b) => !activeDive.globalBuffs.includes(b.id));
    if (available.length > 0) grantGlobalBuff(pickRandom(available));
  }
  endBattle("win", { crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds });
}

function handleAllEscaped() {
  renderBattleScreen();
  setTimeout(() => endBattle("escaped"), 900);
}

function handleBattleWipe() {
  renderBattleScreen();
  setTimeout(() => endBattle("wipe"), 900);
}

function endBattle(outcome, rewards) {
  document.getElementById("battle-overlay").classList.add("hidden");
  let onResult = activeBattle ? activeBattle.onResult : null;
  if (outcome === "flee" || outcome === "escaped") reviveFallenAllies();
  if (outcome !== "wipe") clearBattleTransientBuffs();
  activeBattle = null;
  if (onResult) onResult(Object.assign({ outcome }, rewards || {}));
}

// ---------- 畫面渲染 ----------

function logBattle(msg) {
  activeBattle.log.push(msg);
  if (activeBattle.log.length > 40) activeBattle.log.shift();
}

// 依戰鬥記錄文字內容判斷要套用哪種顏色的class，讓重要訊息（傷害/爆擊/死亡/MISS）更好辨識
function battleLogLineClass(msg) {
  if (msg.includes("倒下")) return "log-death";
  if (msg.includes("爆擊")) return "log-crit";
  if (msg.includes("MISS") || msg.includes("閃開") || msg.includes("被震懾")) return "log-miss";
  if (msg.includes("回復") || msg.includes("治療")) return "log-heal";
  if (msg.includes("傷害")) return "log-dmg";
  return "";
}

// 狀態圖示（流血/護盾/格擋/蓄勢）的hover提示，流血/格擋/蓄勢會附上剩餘回合或百分比等具體數值
function statusIconHtml(icon, title) {
  return `<span class="status-icon" title="${title}">${icon}</span>`;
}

// 單位受擊/行動時的閃光＋抖動效果。因為renderBattleScreen()每次都整段innerHTML重建，
// 這裡用setTimeout(0)把尋找DOM節點的時機延後到「這一輪同步流程裡最後一次render()執行完畢之後」，
// 這樣抓到的才會是重繪後的新節點，動畫才看得到（如果在render()之前就抓，節點馬上就被換掉了）。
function flashUnit(unitId, kind) {
  if (!unitId) return;
  setTimeout(() => {
    let el = document.querySelector(`#battle-root [data-unit-id="${unitId}"]`);
    if (!el) return;
    let flashClass = kind === "actor" ? "unit-flash-actor" : kind === "heal" ? "unit-flash-heal" : "unit-flash-target";
    el.classList.remove("unit-flash-actor", "unit-flash-target", "unit-flash-heal", "unit-shake");
    void el.offsetWidth; // 強制reflow，確保移除class後重新加入時動畫能重新播放
    el.classList.add(flashClass);
    if (kind === "target") el.classList.add("unit-shake");
    setTimeout(() => { el.classList.remove(flashClass, "unit-shake"); }, 320);
  }, 0);
}

// 傷害/治療的飄字：在單位頭上冒出數字並快速上飄消失（CSS .floating-number 已定義動畫）。
// 跟 flashUnit 一樣用 setTimeout(0) 延到本輪 render 完成後才抓節點，抓到的才是重繪後的新節點。
// kind: "dmg"(紅) / "crit"(金、較大) / "heal"(綠) / "miss"(灰)
function spawnFloatingNumber(unitId, text, kind) {
  if (!unitId) return;
  setTimeout(() => {
    let el = document.querySelector(`#battle-root [data-unit-id="${unitId}"]`);
    if (!el) return;
    let node = document.createElement("div");
    node.className = "floating-number " + (kind || "dmg");
    node.textContent = text;
    node.style.left = (50 + (Math.random() * 28 - 14)) + "%"; // 隨機水平微偏移，多段命中不完全重疊
    el.appendChild(node);
    setTimeout(() => node.remove(), 750); // 動畫 0.7s 播完就移除，避免殘留
  }, 0);
}

// 依傷害結果冒出對應飄字（命中冒傷害、爆擊金色放大、MISS/閃避冒灰字）
function floatDamageResult(unitId, result) {
  if (result.miss) {
    spawnFloatingNumber(unitId, result.dodge ? "閃避" : "MISS", "miss");
  } else {
    spawnFloatingNumber(unitId, "-" + result.dmg, result.crit ? "crit" : "dmg");
  }
}

function renderBattleScreen(actingAllyId) {
  if (!activeBattle) return;
  let pending = activeBattle.pendingAction;

  let enemyHtml = activeBattle.enemies.map((e) => {
    if (e.hp <= 0 || e.escaped) return "";
    let burrowed = !!e.burrowed;
    let targetable = !burrowed && pending && ((pending.kind === "normal") || (pending.kind === "skill" && SKILLS[pending.skillId].targetType === "single-enemy"));
    let speciesKnown = activeBattle.knownSpeciesAtStart.includes(e.monsterId);
    // 意圖列：見過的怪顯示「emoji＋技能名」（基本攻擊一律顯示「攻擊」）；沒見過的仍藏成 ❔。不顯示技能效果詳情。
    let intentHtml;
    if (speciesKnown && e.intentSkillId) {
      let sk = MONSTER_SKILLS[e.intentSkillId];
      intentHtml = `${sk.intent} ${sk.isBasic ? "攻擊" : sk.name}`;
    } else {
      intentHtml = "❔";
    }
    let statusHtml = "";
    if (e.bleedStacks > 0) {
      let dmgPerTick = e.bleedStacks * BLEED_DAMAGE_PER_STACK;
      statusHtml += statusIconHtml(`🩸x${e.bleedStacks}`, `流血：每回合造成${dmgPerTick}點傷害，剩${e.bleedDuration}回合`);
    }
    if (e.poisonDuration > 0) statusHtml += statusIconHtml(`🟣`, `中毒：自身回復（吸血/自癒）減半，剩${e.poisonDuration}回合`);
    if (e.stunTurns > 0) statusHtml += statusIconHtml(`🫨`, `震懾：無法行動，剩${e.stunTurns}回合`);
    if (e.confuseTurns > 0) statusHtml += statusIconHtml(`😵‍💫`, `混亂：這隻怪下次行動會胡亂出手（可能打到自己人），剩${e.confuseTurns}回合`);
    if (e.chargeReady) statusHtml += statusIconHtml(`⚡蓄勢`, `蓄勢：下次攻擊傷害提升`);
    if (e.shield > 0) statusHtml += statusIconHtml(`🛡️${e.shield}`, `護盾：可吸收${e.shield}點傷害`);
    if (e.dodgeActive) {
      let label = e.dodgeActive.permanent ? "∞" : "×1";
      statusHtml += statusIconHtml(`✨${label}`, `閃避率${Math.round(e.dodgeActive.chance * 100)}%（${e.dodgeActive.permanent ? "常駐" : "剩1次"}）`);
    }
    let monsterDef = MONSTERS[e.monsterId];
    let enemyRankClass = monsterDef.isBoss ? " battle-unit-boss" : e.isElite ? " battle-unit-elite" : "";
    return `<div class="battle-unit${enemyRankClass}${burrowed ? " battle-unit-burrowed" : ""}${targetable ? " targetable" : ""}" data-unit-id="${e.uid}" ${targetable ? `onclick="battleSelectTarget('${e.uid}', true)"` : ""}>
      <div class="battle-unit-avatar">${e.icon}</div>
      <div class="battle-unit-name">${e.name}${burrowed ? "（潛地中）" : ""}</div>
      <div class="bar-track"><div class="bar-fill enemy-hp-fill" style="width:${(e.hp / e.maxHp) * 100}%;"></div></div>
      <div class="battle-unit-hp-text">${e.hp}/${e.maxHp}</div>
      <div class="battle-unit-intent">${intentHtml}</div>
      <div class="battle-unit-statuses">${statusHtml}</div>
    </div>`;
  }).join("");

  let allyHtml = PARTY_ORDER_LAYER1.map((id) => {
    let m = activeDive.party[id];
    let c = CHARACTERS[id];
    let targetable = pending && pending.kind === "skill" && SKILLS[pending.skillId].targetType === "single-ally" && !m.fallen;
    let isActive = actingAllyId === id;
    let statusHtml = "";
    if (m.bleedStacks > 0) {
      let dmgPerTick = m.bleedStacks * BLEED_DAMAGE_PER_STACK;
      statusHtml += statusIconHtml(`🩸x${m.bleedStacks}`, `流血：每回合受到${dmgPerTick}點傷害，剩${m.bleedDuration}回合`);
    }
    if (m.poisonDuration > 0) {
      statusHtml += statusIconHtml(`🟣`, `中毒：受到的治療效果減半，剩${m.poisonDuration}回合`);
    }
    if (m.stunTurns > 0) {
      statusHtml += statusIconHtml(`🫨`, `震懾：無法行動，剩${m.stunTurns}回合`);
    }
    if (m.confuseTurns > 0) {
      statusHtml += statusIconHtml(`😵‍💫`, `混亂：這回合會自動胡亂行動（可能打到隊友或自己），剩${m.confuseTurns}回合`);
    }
    if (m.guardActive) {
      statusHtml += statusIconHtml("🛡️格擋", `格擋中：受到的傷害-${Math.round(GUARD_DAMAGE_REDUCTION * 100)}%，被攻擊命中一次後解除`);
    }
    if (m.chargeReady) {
      let bonus = relicMax(m, "charge-bonus-override", CHARGE_BONUS);
      statusHtml += statusIconHtml("⚡蓄勢", `蓄勢：下次攻擊傷害+${Math.round(bonus * 100)}%`);
    }
    if (m.hotDuration > 0) {
      statusHtml += statusIconHtml(`💚x${m.hotDuration}`, `持續回血：每回合+${m.hotHealPerTurn}，剩${m.hotDuration}回合`);
    }
    if (m.dmgBuffNextAttack) {
      statusHtml += statusIconHtml("✨傷害", `下次攻擊傷害 +${Math.round(m.dmgBuffNextAttack * 100)}%`);
    }
    if (m.chargeMultiplier && m.chargeMultiplier !== 1) {
      statusHtml += statusIconHtml("🔥蓄力", `下次攻擊傷害 ×${m.chargeMultiplier}`);
    }
    if (m.dodgeBuffThisTurn) {
      statusHtml += statusIconHtml("💨閃避", `本回合閃避率 +${Math.round(m.dodgeBuffThisTurn * 100)}%`);
    }
    if (m.damageReductionDuration > 0) {
      statusHtml += statusIconHtml("❄️減傷", `受到傷害 -${Math.round(m.damageReduction * 100)}%，剩${m.damageReductionDuration}回合`);
    }
    return `<div class="battle-unit battle-unit-ally${m.fallen ? " fallen" : ""}${isActive ? " active-turn" : ""}${targetable ? " targetable" : ""}"
        style="--char-color:${getCharacterColor(id)};"
        data-unit-id="${id}" ${targetable ? `onclick="battleSelectTarget('${id}', false)"` : ""}>
      <div class="battle-unit-avatar">${c.icon}</div>
      <div class="battle-unit-name">${displayName(id)}</div>
      <div class="bar-track"><div class="bar-fill hp-fill${m.hp <= m.maxHp / 2 ? " hp-low" : ""}" style="width:${(m.hp / m.maxHp) * 100}%;"></div></div>
      <div class="battle-unit-hp-text">${m.hp}/${m.maxHp}</div>
      <div class="battle-unit-statuses">${statusHtml}</div>
    </div>`;
  }).join("");

  let actionPanel = "";
  if (actingAllyId && !pending) {
    actionPanel = renderActionPanel(actingAllyId);
  } else if (pending) {
    actionPanel = `<div class="battle-action-header">選擇目標……</div>
      <div class="battle-action-buttons"><button class="battle-btn" onclick="battleCancelTargeting()">取消</button></div>`;
  }

  document.getElementById("battle-root").innerHTML = `
    <div class="battle-quip">${activeBattle.quip}</div>
    <div class="battle-enemy-row">${enemyHtml}</div>
    <div class="battle-ally-row">${allyHtml}</div>
    <div class="battle-action-panel">${actionPanel}</div>
    <div class="battle-log">${activeBattle.log.map((l) => `<p class="${battleLogLineClass(l)}">${l}</p>`).join("")}</div>
  `;
  let logEl = document.querySelector("#battle-root .battle-log");
  if (logEl) logEl.scrollTop = logEl.scrollHeight;
}

function renderActionPanel(casterId) {
  let c = CHARACTERS[casterId];
  let m = activeDive.party[casterId];
  let aliveCount = SHELTER_PARTY_IDS.filter((id) => !activeDive.party[id].fallen).length;

  let skillButtons = gameState.equippedSkills[casterId].filter((skillId) => isSkillUnlocked(casterId, skillId)).map((skillId) => {
    let skill = SKILLS[skillId];
    let uses = m.skillUses[skillId] || 0;
    let disabled = uses <= 0;
    let desc = skillDescForDisplay(skill, casterId);
    return `<button class="battle-btn" title="${desc}" ${disabled ? "disabled" : ""} onclick="battleUseSkill('${casterId}', '${skillId}')">
      ${skill.name}<span class="btn-sub">剩 ${uses} 次</span>
    </button>`;
  }).join("");

  let potionHealPercent = activeDive.globalBuffs.includes("藥效強化") ? 0.45 : POTION_HEAL_PERCENT;

  // 補血藥按鈕：第二層Boss後解鎖「外敷」，就拆成「直飲／外敷」兩顆（共用同一份庫存）；還沒解鎖就只有一顆。
  let potionDisabled = gameState.potions <= 0 ? "disabled" : "";
  let potionButtons;
  if (gameState.storyFlags.potionApplyUnlocked) {
    let hotPercent = activeDive.globalBuffs.includes("藥效強化") ? POTION_HOT_PERCENT * 1.5 : POTION_HOT_PERCENT;
    // 解鎖外敷後，把「直飲／外敷」收成一個緊湊群組（共用同一份庫存），佔的寬度約等於一顆普通按鈕，避免擠版。
    potionButtons = `
      <div class="battle-potion-group">
        <div class="potion-group-label">🧪 補血藥 · 剩 ${gameState.potions} 瓶</div>
        <div class="potion-group-btns">
          <button class="battle-btn potion-mini" title="直飲：立刻回復最大血量的 ${Math.round(potionHealPercent * 100)}%" ${potionDisabled} onclick="battleDrinkPotion('${casterId}')">
            直飲<span class="btn-sub">即回 ${Math.round(potionHealPercent * 100)}%</span>
          </button>
          <button class="battle-btn potion-mini" title="外敷：接下來 ${POTION_HOT_DURATION} 回合，每回合回復最大血量的 ${Math.round(hotPercent * 100)}%（下回合開始生效）" ${potionDisabled} onclick="battleApplyPotion('${casterId}')">
            外敷<span class="btn-sub">${POTION_HOT_DURATION}回合共${Math.round(hotPercent * POTION_HOT_DURATION * 100)}%</span>
          </button>
        </div>
      </div>`;
  } else {
    potionButtons = `
      <button class="battle-btn" title="回復最大血量的 ${Math.round(potionHealPercent * 100)}%" ${potionDisabled} onclick="battleDrinkPotion('${casterId}')">
        補血藥<span class="btn-sub">剩 ${gameState.potions} 瓶</span>
      </button>`;
  }

  // 魔藥格：帶了就顯示魔藥名（可點，使用不消耗回合、只能自己回合），用過或沒帶就顯示「沒有魔藥」
  let cp = m.carriedPotion;
  let magicPotionBtn;
  if (cp && POTIONS[cp.potionId]) {
    let pd = POTIONS[cp.potionId];
    magicPotionBtn = `<button class="battle-btn potion-magic" title="${pd.desc}（使用不消耗回合、只能自己回合用）" onclick="battleUsePotion('${casterId}')">
      ${pd.icon} ${pd.name}${cp.rare ? "（稀有）" : ""}<span class="btn-sub">魔藥 · 不耗回合</span>
    </button>`;
  } else {
    magicPotionBtn = `<button class="battle-btn potion-magic" disabled>沒有魔藥<span class="btn-sub">魔藥格</span></button>`;
  }

  return `
    <div class="battle-action-header">${c.icon} ${displayName(casterId)} 的回合</div>
    <div class="battle-action-buttons">
      <button class="battle-btn" title="對單一敵人造成普通攻擊傷害" onclick="battleNormalAttack('${casterId}')">攻擊</button>
      ${skillButtons}
      ${potionButtons}
      ${magicPotionBtn}
      <button class="battle-btn" title="嘗試逃離戰鬥，成功率${Math.round(FLEE_SUCCESS_RATE * 100)}%，失敗會讓敵方立刻多行動一輪" ${(!activeBattle.allowFlee || aliveCount < 2) ? "disabled" : ""} onclick="battleFlee('${casterId}')">逃跑</button>
    </div>
  `;
}
