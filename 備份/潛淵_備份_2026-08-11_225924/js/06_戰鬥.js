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
    m.guardActive = false; m.chargeReady = false; m.stunnedNextTurn = false;
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
    stunnedNextTurn: false,
    burrowed: false, // 尖嘴鼠掘地：潛入地底時為 true，期間無法被選為目標、也不受全體技能波及
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

// 基礎順序固定是 PARTY_ORDER_LAYER1(K→主角→V)，持有「急速鰭」遺物的角色會往前提一位
// （跟前一位交換），依基礎順序由前到後依序套用，同時有多人持有時會連鎖往前擠。
function buildAllyTurnQueue() {
  let queue = PARTY_ORDER_LAYER1.filter((id) => !activeDive.party[id].fallen);
  queue.forEach((_, i) => {
    if (i === 0) return;
    let m = activeDive.party[queue[i]];
    if (m.relics.includes("急速鰭")) [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]];
  });
  return queue;
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
  if (m.stunnedNextTurn) {
    m.stunnedNextTurn = false;
    logBattle(`${displayName(id)} 被震懾，無法行動。`);
    activeBattle.allyTurnPointer++;
    renderBattleScreen();
    setTimeout(advanceAllyTurn, 500);
    return;
  }
  renderBattleScreen(id);
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

  if (enemy.stunnedNextTurn) {
    enemy.stunnedNextTurn = false;
    logBattle(`${enemy.name} 被震懾，無法行動。`);
    renderBattleScreen();
    setTimeout(processNextEnemyTurn, 500);
    return;
  }

  executeEnemySkill(enemy);
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
    if (sid === "島鯨_反芻") return activeBattle.enemies.filter((e) => e.hp > 0).length < MAX_ENEMIES_ON_FIELD;
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
    let results = [];
    if (skill.targetType === "all-enemies") {
      SHELTER_PARTY_IDS.forEach((id) => {
        if (activeDive.party[id].fallen) return;
        for (let h = 0; h < hits; h++) results.push(Object.assign({ name: displayName(id) }, dealDamageToAlly(enemy, id, skill.dmgRange)));
      });
    } else {
      let targetId = pickAllyTarget();
      if (targetId) for (let h = 0; h < hits; h++) results.push(Object.assign({ name: displayName(targetId) }, dealDamageToAlly(enemy, targetId, skill.dmgRange)));
    }
    logBattle(`${enemy.icon} ${enemy.name} 使用「${skill.name}」，對 ${summarizeHits(results)}。`);
    if (skill.forcesNextBite) enemy.forcedNextSkillId = "藍顎獸_撕咬";
    if (skill.lifesteal) {
      let drained = results.reduce((sum, r) => sum + (r.miss ? 0 : r.dmg), 0);
      if (drained > 0) {
        let healed = applyEnemyHeal(enemy, drained); // 中毒時吸血減半
        logBattle(`${enemy.icon} ${enemy.name} 吸取了 ${healed} 點血量${enemy.poisonDuration > 0 ? "（中毒，減半）" : ""}。`);
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
      if (chance(skill.stunChance)) { m.stunnedNextTurn = true; stunned.push(displayName(id)); flashUnit(id, "target"); }
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
    let bonus = opts.attacker.relics && opts.attacker.relics.includes("蓄能核") ? 0.30 : CHARGE_BONUS;
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
    return { dmg: 0, miss: true, crit: false };
  }
  if (m.dodgeBuffThisTurn && chance(m.dodgeBuffThisTurn)) {
    flashUnit(allyId, "target");
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
  if (wasGuarding) m.guardActive = false; // 被單體攻擊命中後格擋消失
  if (m.hp <= 0) fallAlly(allyId);
  return result;
}

function getAllyDamageTakenReduction(m) {
  let reduction = 0;
  if (m.relics.includes("厚殼甲")) reduction += 0.10;
  if (m.foodBuffActive && m.foodBuffActive.type === "damage-reduction-percent") reduction += m.foodBuffActive.value;
  if (m.damageReductionDuration > 0) reduction += m.damageReduction; // L_冰盾
  return reduction;
}

// 只負責算傷害／扣血／閃光，不在這裡寫log——同一次行動打中的每個目標會在呼叫端合併成一行
function dealDamageToEnemy(casterId, enemy, dmgRange, opts) {
  opts = opts || {};
  let m = activeDive.party[casterId];
  let critBonus = (m.relics.includes("裂瞳珠") ? 0.05 : 0) + (m.critBuffNextBattle || 0) + (m.multiBattleCritRemaining > 0 ? m.multiBattleCritBonus : 0)
    + (m.foodBuffActive && m.foodBuffActive.type === "crit-percent" ? m.foodBuffActive.value : 0); // 第二層料理「炙烤兔腿」：爆擊率
  let dmgPercent = 0;
  if (opts.isNormalAttack && m.relics.includes("尖銳碎片")) dmgPercent += 0.15;
  if (opts.isSkill && m.relics.includes("銳石")) dmgPercent += 0.15;
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

  let doubleHit = m.relics.includes("雙擊環") && chance(0.20);
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
  let noCost = m.relics.includes("回響石") && chance(0.10);
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
          if (skill.stunChance && !result.miss && !enemy.stunnedNextTurn && chance(skill.stunChance)) {
            enemy.stunnedNextTurn = true;
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
  applyAllyHeal(m, Math.ceil(m.maxHp * healPercent)); // 中毒時補血藥回復同樣減半
  logBattle(`🧪 ${displayName(casterId)} 喝下補血藥回復血量。`);
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
    m.hp = m.relics.includes("韌皮帶") ? Math.ceil(m.maxHp * 0.30) : 1;
    logBattle(`${displayName(id)} 搖搖晃晃地站了起來。`);
  });
}

function handleBattleWin() {
  let defeatedMonsterIds = activeBattle.enemies.filter((e) => !e.escaped).map((e) => e.monsterId);
  let mimicDefeated = !activeBattle.suppressRewards && defeatedMonsterIds.includes("寶箱怪");

  let crystalEarned = 0, expEarned = 0, foodDrops = [], foodDropsText = "", herbDrops = [], herbDropsText = "";
  if (!activeBattle.suppressRewards) {
    let category = activeBattle.isBoss ? "Boss" : activeBattle.isElite ? "菁英" : "普通";
    let baseCrystal = category === "Boss" ? randInt(CRYSTAL_DROP.Boss[0], CRYSTAL_DROP.Boss[1])
      : category === "菁英" ? randInt(CRYSTAL_DROP.菁英[0], CRYSTAL_DROP.菁英[1])
      : randInt(CRYSTAL_DROP.普通[0], CRYSTAL_DROP.普通[1]);
    let crystalMult = 1;
    if (activeDive.globalBuffs.includes("潛晶磁感")) crystalMult += 0.25;
    if (activeDive.globalBuffs.includes("採集本能")) crystalMult += 0.50;
    crystalEarned = Math.round(baseCrystal * crystalMult * activeBattle.rewardMult);

    let eliteExpMult = activeBattle.isElite ? 2 : 1; // 菁英怪獎勵兩倍：潛晶已經有自己的更高掉落區間，經驗值原本沒跟著翻倍，這裡補上
    expEarned = activeBattle.isBoss
      ? BOSS_EXP_REWARD
      : Math.round(defeatedMonsterIds.reduce((sum) => sum + randInt(EXP_PER_MONSTER_LAYER1[0], EXP_PER_MONSTER_LAYER1[1]), 0) * eliteExpMult * activeBattle.rewardMult);

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
    if (m.relics.includes("生命苔")) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.15));
  });

  clearBattleTransientBuffs();
  renderBattleScreen();
  if (mimicDefeated) {
    setTimeout(() => resolveMimicBonus(crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds), 900);
    return;
  }
  setTimeout(() => endBattle("win", { crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds }), 900);
}

// 混戰中打死寶箱怪的額外獎勵，疊加在原本的戰鬥獎勵之上：50%潛晶大獎、50%潛晶小獎+1個隨機遺物
function resolveMimicBonus(crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds) {
  if (chance(0.5)) {
    let bonus = randInt(MIMIC_BONUS_CRYSTAL_BIG[0], MIMIC_BONUS_CRYSTAL_BIG[1]);
    crystalEarned += bonus;
    systemToast(`💎 寶箱怪噴出一大筆潛晶！+${bonus}`);
    endBattle("win", { crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds });
  } else {
    let bonus = randInt(MIMIC_BONUS_CRYSTAL_SMALL[0], MIMIC_BONUS_CRYSTAL_SMALL[1]);
    crystalEarned += bonus;
    systemToast(`💎 寶箱怪噴出了 ${bonus} 顆潛晶，還有一個遺物！`);
    grantRandomRelic(() => {
      endBattle("win", { crystalEarned, expEarned, foodDrops, foodDropsText, herbDrops, herbDropsText, fallenIds });
    });
  }
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
    if (m.guardActive) {
      statusHtml += statusIconHtml("🛡️格擋", `格擋中：受到的傷害-${Math.round(GUARD_DAMAGE_REDUCTION * 100)}%，被攻擊命中一次後解除`);
    }
    if (m.chargeReady) {
      let bonus = m.relics.includes("蓄能核") ? 0.30 : CHARGE_BONUS;
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
      <button class="battle-btn" title="回復最大血量的${Math.round(potionHealPercent * 100)}%" ${gameState.potions <= 0 ? "disabled" : ""} onclick="battleDrinkPotion('${casterId}')">
        補血藥<span class="btn-sub">剩 ${gameState.potions} 瓶</span>
      </button>
      ${magicPotionBtn}
      <button class="battle-btn" title="嘗試逃離戰鬥，成功率${Math.round(FLEE_SUCCESS_RATE * 100)}%，失敗會讓敵方立刻多行動一輪" ${(!activeBattle.allowFlee || aliveCount < 2) ? "disabled" : ""} onclick="battleFlee('${casterId}')">逃跑</button>
    </div>
  `;
}
