// ============================================================
// 潛淵 — 難度檢查工具（自動戰鬥模擬）
// ============================================================
// 用途：用「指定成長階段的四人隊」自動打各圈層的小怪／菁英／Boss 各 N 場，
//       算出勝率與打完平均剩餘血量，用來量化每一層的難度、對齊「刷 2~3 趟就能通關 Boss」的目標。
//
// 為什麼要這個：手動試玩太慢又不準；這支腳本讓「難度」變成可重複量測的數字，改完怪的數值馬上驗證。
//
// 用法：
//   1. 需要 playwright（開發用，未進 git；沒裝就先 `npm install playwright`）。
//   2. 執行：NODE_PATH=./node_modules node scripts/難度檢查.js
//   3. 看輸出的「勝率%／剩血%」表：勝率越低＋剩血越少＝越難。
//
// 自動玩家策略（納可 2026-08-12 拍板：改成「只普攻、完全不用技能」的最裸模型）：
//   血<40%且有補血藥就喝；否則一律【普攻】（不碰任何技能）；目標挑第一個活著的敵人。
//   → 這是「最弱的玩家」，真實玩家還有技能＋食物＋魔藥＋遺物＋成就會強很多，
//   所以怪要調到「連這個只會普攻的裸模型都偏難」，真實玩家才會剛好。
//   難度目標：拿「裝備等級＝層數」的隊伍打「同層小怪」，勝率要很低（5~25%）。
//
// 成長階段（TEAM_STAGES）是對「刷第幾趟」的粗略假設，之後可依實際經濟（經驗/潛晶收入）再校準。
// ============================================================
const { chromium } = require('playwright');
const path = require('path');

const N = 16;                    // 每組跑幾場（16：目標落在 10% 邊界附近，多跑幾場降低雜訊）
const LAYERS = [1, 2, 3];        // 要測哪些層
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// 成長階段（納可校準）：角色等級（技能）升級很容易、很快就滿 4 級，所以【固定 level 4、技能全解鎖】，
// 真正代表「刷了幾趟／投入多少資源」的變數是【武器／防具強化等級】。所以這裡固定四級、只變裝備等級。
// relicCount 先設 0（最保守的裸遺物模型）：真實玩家還有遺物／食物／魔藥會更強，所以怪要調到「連這個裸模型都偏難」。
const TEAM_STAGES = [
  { name: '四級·裝備0', level: 4, weaponLv: 0, armorLv: 0, relicCount: 0 },
  { name: '四級·裝備1', level: 4, weaponLv: 1, armorLv: 1, relicCount: 0 },
  { name: '四級·裝備2', level: 4, weaponLv: 2, armorLv: 2, relicCount: 0 },
  { name: '四級·裝備3', level: 4, weaponLv: 3, armorLv: 3, relicCount: 0 },
  { name: '四級·裝備4', level: 4, weaponLv: 4, armorLv: 4, relicCount: 0 },
];

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.waitForTimeout(500);

  const result = await p.evaluate(async ({ N, LAYERS, TEAM_STAGES }) => {
    const _st = window.setTimeout;
    window.setTimeout = (fn) => _st(fn, 0); // 加速：動畫/敵人回合瞬間推進
    const sleep = () => new Promise(r => _st(r, 0));

    gameState.storyFlags.introDone = true;
    gameState.storyFlags.firstLayerCleared = true;
    gameState.storyFlags.lRescued = true;
    gameState.storyFlags.layer2Cleared = true;
    syncLRoster();

    function applyStage(stage) {
      let ids = SHELTER_PARTY_IDS.slice();
      ids.forEach(id => {
        gameState.characters[id].level = stage.level;
        gameState.characters[id].weaponLv = stage.weaponLv;
        gameState.characters[id].armorLv = stage.armorLv;
        gameState.characters[id].relics = [];
      });
      // 依 relicCount 從 RELICS 前面取幾個，輪流分給四人（每人最多 RELIC_MAX_PER_CHARACTER）
      for (let i = 0; i < stage.relicCount && i < RELICS.length; i++) {
        let owner = ids[i % ids.length];
        if (gameState.characters[owner].relics.length < RELIC_MAX_PER_CHARACTER) {
          gameState.characters[owner].relics.push(RELICS[i].id);
        }
      }
    }

    function bestAttackSkill(id, m) {
      return (gameState.equippedSkills[id] || [])
        .filter(s => isSkillUnlocked(id, s) && (m.skillUses[s] || 0) > 0 && SKILLS[s] && SKILLS[s].targetType === 'single-enemy' && SKILLS[s].type === 'attack')
        .sort((a, b) => ((SKILLS[b].dmgRange ? SKILLS[b].dmgRange[1] : 0) - (SKILLS[a].dmgRange ? SKILLS[a].dmgRange[1] : 0)))[0];
    }

    async function runOne(group, opts) {
      Object.keys(activeDive.party).forEach(id => {
        let m = activeDive.party[id];
        m.hp = m.maxHp; m.fallen = false;
        Object.keys(m.skillUses).forEach(s => m.skillUses[s] = SKILLS[s].maxUses);
        m.bleedStacks = m.poisonDuration = m.stunTurns = m.confuseTurns = 0;
      });
      gameState.potions = 3;
      let done = false, outcome = null;
      startBattle(group, Object.assign({ allowFlee: false, onResult: r => { done = true; outcome = r.outcome; } }, opts));
      let guard = 0;
      while (!done && guard < 8000) {
        if (activeBattle && activeBattle.phase === 'ally' && !activeBattle.pendingAction) {
          let id = activeBattle.allyTurnQueue[activeBattle.allyTurnPointer];
          if (id && isCurrentActorsTurn(id)) {
            let m = activeDive.party[id];
            let tgt = activeBattle.enemies.find(e => e.hp > 0 && !e.escaped && !e.burrowed);
            if (m.hp / m.maxHp < 0.4 && gameState.potions > 0) battleDrinkPotion(id);
            else if (tgt) {
              // 納可拍板：裸模型只用普攻、完全不用技能
              battleNormalAttack(id);
              if (activeBattle && activeBattle.pendingAction) battleSelectTarget(tgt.uid, true);
            }
          }
        }
        await sleep(); guard++;
      }
      let hpPct = 0, cnt = 0;
      Object.keys(activeDive.party).forEach(id => { let m = activeDive.party[id]; hpPct += Math.max(0, m.hp) / m.maxHp; cnt++; });
      return { win: outcome === 'win', hpLeft: hpPct / cnt };
    }

    async function measure(layer, kind) {
      startNewDive(null, null, layer);
      let wins = 0, hpSum = 0;
      for (let i = 0; i < N; i++) {
        let group, opts;
        if (kind === 'boss') { group = [getLayerBoss(layer)]; opts = { isBoss: true }; }
        else { group = drawRandomMonsters(false); opts = { isElite: kind === 'elite' }; } // 小怪＝從該層固定組合隨機挑一組（組合內容固定）
        let r = await runOne(group, opts);
        if (r.win) wins++;
        hpSum += r.hpLeft;
      }
      return { winRate: Math.round(wins / N * 100), avgHpLeft: Math.round(hpSum / N * 100) };
    }

    let out = {};
    for (let stage of TEAM_STAGES) {
      applyStage(stage);
      out[stage.name] = {};
      for (let layer of LAYERS) {
        out[stage.name]['第' + layer + '層'] = {
          小怪: await measure(layer, 'normal'),
          菁英: await measure(layer, 'elite'),
          Boss: await measure(layer, 'boss'),
        };
      }
    }
    return out;
  }, { N, LAYERS, TEAM_STAGES });

  console.log('=== 潛淵 難度檢查（每組 ' + N + ' 場；勝率%／打完剩血%）===');
  console.log('（自動玩家＝只普攻+血低喝藥的「最裸模型」，不用任何技能；真實玩家有技能/食物/魔藥/遺物會強很多→怪要調到這裡都偏難）');
  console.log('（難度目標：裝備等級＝層數 時，該層「小怪」勝率壓在 10% 以下、但不為 0）\n');
  for (let stage of Object.keys(result)) {
    console.log('【' + stage + '】');
    for (let layer of Object.keys(result[stage])) {
      let row = result[stage][layer];
      console.log(`  ${layer}： 小怪 ${row.小怪.winRate}%/${row.小怪.avgHpLeft}%　菁英 ${row.菁英.winRate}%/${row.菁英.avgHpLeft}%　Boss ${row.Boss.winRate}%/${row.Boss.avgHpLeft}%`);
    }
  }
  console.log('\n錯誤:', errs.length ? errs.join(' | ') : '（無）');
  await b.close();
})();
