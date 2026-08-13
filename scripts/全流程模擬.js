// ============================================================
// 潛淵 — 全流程模擬（讓 AI 玩家「小艾」像真玩家一樣「玩完整個遊戲」）
//   小艾＝AI 玩家的暱稱（納可取的），我們的重要測試員：不花額度、跑得比誰都勤。
// ============================================================
// 做什麼：模擬一個從零開始的玩家，一趟一趟地玩——下潛 → 打完一整層的怪（血量／技能次數／補血藥一路消耗，
//         這就是「一整趟資源戰」）→ 回避難所花潛晶升級（先解鎖技能、再升歷練）→ 再下潛 → 打得動就往下一層。
//         最後報告：「第幾趟升到幾級、每層打幾趟才過 Boss、賺多少潛晶、卡在哪」。
//
// 為什麼要它（納可 2026-08-13 提案）：單場戰鬥模擬（scripts/難度檢查.js）只看「一場」；這支看「整個經濟循環」，
//         直接回答納可想知道的：何時升級、打怪贏還輸、拿多少獎勵去升級、哪一層卡關 → 用來校準難度與成長曲線。
//         全程在瀏覽器裡用遊戲自己的 JS 跑（playwright 無頭），電腦自己算，不花 AI 額度。
//
// 用法：NODE_PATH=./node_modules node scripts/全流程模擬.js
// 需要 playwright（開發用；沒裝先 `npm install playwright`）。
//
// 【跑法 / 讓小艾跑的小眉角】（納可要求記進文件，免得每次重新踩坑）：
//   · 快速看數字＝「跑縮小版」：用環境變數把輪數調小，跑得快。例：
//       SILENT_RUNS=5 NODE_PATH=./node_modules node scripts/全流程模擬.js
//     （VERBOSE_RUNS/SILENT_RUNS/MAX_DIVES 都能這樣覆蓋，預設 1/10/20。從 repo 根目錄跑，路徑才對。）
//   · 為什麼要縮小版：卡關的那一輪會跑滿 MAX_DIVES，很慢；輪數少一點、上限小一點就快很多，先看趨勢用。
//   · 這支會跑上百場戰鬥，常常超過前景 timeout 被移到背景——正常。它是「最後才一次 console.log」，
//     跑到一半去看輸出檔是空的也正常，要等它整個跑完。等背景完成通知、或稍後再看輸出檔。
//   · 完整版（預設 10 輪+詳細）給正式數字；縮小版給邊調邊看。兩個都零 AI 額度（電腦自己算）。
//
// 玩家策略（可調）：
//   · 探索：貪一點——強制戰鬥照打，能選菁英/小怪的節點就打（賺潛晶＋逼出資源消耗）；血量低於門檻的休息點就補血。
//   · 戰鬥：用 js/10_戰鬥AI.js 的聰明 AI（全角色共用那份）。
//   · 避難所花錢：先把買得起的技能一個個解鎖（一次性、強），再把潛晶拿去升「歷練最低的人」。
//   · 潛晶收入：戰鬥掉的 ＋ 寶藏節點（真實公式 3~8 × 層倍率）＋ 事件節點（估：一半機率給寶藏級潛晶）。
//     奇異地形（安全增益）/商店（淨支出）/賭局（風險）保守略過——所以仍偏保守，但比「只算戰鬥」準很多。
// ============================================================
const { chromium } = require('playwright');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// 這三個可用環境變數覆蓋，方便「跑縮小版」快速看數字（見檔頭「跑法/小眉角」）。
const VERBOSE_RUNS = +process.env.VERBOSE_RUNS || 1;   // 詳細印出「一趟趟的旅程」幾次（給人看故事）
const SILENT_RUNS = +process.env.SILENT_RUNS || 10;   // 靜默多跑幾次，統計「每層平均打幾趟過關」（給可靠數字；卡關的輪會跑滿 MAX_DIVES 較慢）
const MAX_DIVES = +process.env.MAX_DIVES || 20;       // 單次遊玩最多下潛幾趟（超過視為卡關）
const REST_HEAL_THRESHOLD = 0.6; // 隊伍平均血量低於此比例，遇到休息點就補血

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE:' + m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.waitForTimeout(500);

  const result = await p.evaluate(async ({ VERBOSE_RUNS, SILENT_RUNS, MAX_DIVES, REST_HEAL_THRESHOLD }) => {
    const _st = window.setTimeout;
    window.setTimeout = (fn) => _st(fn, 0);           // 加速：動畫/敵人回合瞬間推進
    const sleep = () => new Promise(r => _st(r, 0));

    // ---- 把整個 gameState.characters 重設成「全新玩家」（歷練1、只有第1招、沒潛晶） ----
    function resetPlayer() {
      Object.keys(gameState.characters).forEach(id => {
        gameState.characters[id].trainLevel = 1;
        gameState.characters[id].unlockedSkills = [CHARACTERS[id].skillIds[0]];
        gameState.characters[id].relics = [];
      });
      gameState.crystal = 0;
      gameState.storyFlags.introDone = true;
      gameState.storyFlags.firstLayerCleared = false;
      gameState.storyFlags.lRescued = false;
      gameState.storyFlags.layer2Cleared = false;
      // 把可能被上一輪 push 進去的 L 移除，回到 3 人隊（const 陣列在瀏覽器裡不掛在 window 上，直接用變數名）
      [SHELTER_PARTY_IDS, PARTY_ORDER_LAYER1].forEach(arr => {
        let i = arr.indexOf('L');
        if (i >= 0) arr.splice(i, 1);
      });
    }

    // ---- 打一場：不重置血量/技能次數（讓資源跨節點消耗），用聰明 AI 打完，回傳結果 ----
    async function runBattle(group, opts) {
      let done = false, outcome = null, crystalEarned = 0, guard = 0;
      startBattle(group, Object.assign({ allowFlee: false, onResult: r => { done = true; outcome = r.outcome; crystalEarned = r.crystalEarned || 0; } }, opts));
      while (!done && guard < 8000) {
        if (activeBattle && activeBattle.phase === 'ally' && !activeBattle.pendingAction) {
          let id = activeBattle.allyTurnQueue[activeBattle.allyTurnPointer];
          if (id && isCurrentActorsTurn(id)) aiTakeAllyTurn(id);
        }
        await sleep(); guard++;
      }
      if (crystalEarned) gameState.crystal += crystalEarned;
      return { win: outcome === 'win', wiped: outcome === 'wipe', crystalEarned };
    }

    function partyAvgHpPct() {
      let ids = Object.keys(activeDive.party).filter(id => !activeDive.party[id].fallen);
      if (!ids.length) return 0;
      return ids.reduce((s, id) => s + Math.max(0, activeDive.party[id].hp) / activeDive.party[id].maxHp, 0) / ids.length;
    }
    function healPartyFull() {
      Object.keys(activeDive.party).forEach(id => { let m = activeDive.party[id]; if (!m.fallen) m.hp = m.maxHp; });
    }

    // ---- 下潛一趟：走完該層節點，回報「有沒有撐到王、有沒有打贏王、賺多少潛晶」 ----
    async function diveLayer(layer) {
      startNewDive(null, null, layer);          // 全滿血、技能次數重置
      gameState.potions = POTION_MAX;            // 避難所補滿補血藥
      let cfg = LAYER_NODE_CONFIGS[layer];
      let crystalStart = gameState.crystal, battles = 0, wiped = false;

      let findMult = LAYER_FIND_MULT[layer] || 1;
      for (let i = 0; i < cfg.length - 1; i++) { // 最後一格是 Boss，另外處理
        let opts = cfg[i].options;
        if (opts.includes('elite')) { let r = await runBattle(drawRandomMonsters(false), { isElite: true }); battles++; if (r.wiped) { wiped = true; break; } }
        else if (opts.includes('monster')) { let r = await runBattle(drawRandomMonsters(false), {}); battles++; if (r.wiped) { wiped = true; break; } }
        else if (opts.includes('treasure')) { gameState.crystal += Math.round(randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]) * findMult); } // 寶藏：拿潛晶（真實公式：3~8 × 層倍率）
        else if (opts.includes('event')) { if (chance(0.5)) gameState.crystal += Math.round(randInt(TREASURE_CRYSTAL_RANGE[0], TREASURE_CRYSTAL_RANGE[1]) * findMult); } // 事件：混合的，估「一半機率給寶藏級潛晶」
        else if (opts.includes('rest')) { if (partyAvgHpPct() < REST_HEAL_THRESHOLD) healPartyFull(); }
        // 其餘（oddity=安全增益不給潛晶／shop=淨支出／gamble=風險）：保守略過
      }

      if (wiped) return { reachedBoss: false, bossWin: false, battles, crystalEarned: gameState.crystal - crystalStart };
      let br = await runBattle([getLayerBoss(layer)], { isBoss: true });
      battles++;
      return { reachedBoss: true, bossWin: br.win, wiped: br.wiped, battles, crystalEarned: gameState.crystal - crystalStart };
    }

    // ---- 避難所花潛晶：先解鎖買得起的技能（便宜的先），再把錢拿去升「歷練最低的人」 ----
    function shelterSpend() {
      let ids = SHELTER_PARTY_IDS.slice();
      // 1) 解鎖技能：把全隊「還沒解鎖的技能」照價錢由低到高排，買得起就買，直到買不動
      while (true) {
        let candidates = [];
        ids.forEach(id => CHARACTERS[id].skillIds.forEach(sid => {
          if (!isSkillUnlocked(id, sid)) candidates.push({ id, sid, cost: getSkillUnlockCost(id, sid) });
        }));
        candidates.sort((a, b) => a.cost - b.cost);
        let next = candidates.find(c => c.cost <= gameState.crystal);
        if (!next) break;
        gameState.crystal -= next.cost;
        gameState.characters[next.id].unlockedSkills.push(next.sid);
      }
      // 2) 升歷練：反覆挑「歷練最低、還沒到上限」的人升，直到潛晶不夠
      while (true) {
        let target = null;
        ids.forEach(id => {
          if (gameState.characters[id].trainLevel >= TRAIN_LEVEL_CAP) return;
          if (!target || gameState.characters[id].trainLevel < gameState.characters[target].trainLevel) target = id;
        });
        if (!target) break;
        let cost = getTrainUpgradeCost(gameState.characters[target].trainLevel);
        if (gameState.crystal < cost) break;
        gameState.crystal -= cost;
        gameState.characters[target].trainLevel++;
      }
    }

    function trainSnapshot() {
      return SHELTER_PARTY_IDS.map(id => gameState.characters[id].trainLevel).join(',');
    }

    // ---- 玩一整輪：從零開始，一層層推，回報每層打幾趟過關 ----
    async function playthrough(verbose, log) {
      resetPlayer();
      let clearedLayers = 0, targetLayer = 1, dives = 0;
      let divesPerLayer = {};
      while (targetLayer <= 3 && dives < MAX_DIVES) {
        if (dives > 0) { syncLRoster(); shelterSpend(); } // 第一趟前不花錢（沒潛晶）；之後每趟回避難所花錢
        dives++;
        divesPerLayer[targetLayer] = (divesPerLayer[targetLayer] || 0) + 1;
        let before = gameState.crystal, snap = trainSnapshot();
        let r = await diveLayer(targetLayer);
        if (verbose) {
          log.push(`  趟${String(dives).padStart(2)} 第${targetLayer}層 歷練[${snap}] 潛晶${before}(+${r.crystalEarned}) ` +
            `戰${r.battles}場 到王:${r.reachedBoss ? '是' : '否(全滅)'} 王:${r.reachedBoss ? (r.bossWin ? '✓' : '✗') : '—'}` +
            (r.bossWin ? `　🎉通關第${targetLayer}層` : ''));
        }
        if (r.bossWin) {
          clearedLayers = targetLayer;
          if (targetLayer === 1) { gameState.storyFlags.firstLayerCleared = true; gameState.storyFlags.lRescued = true; syncLRoster(); }
          if (targetLayer === 2) gameState.storyFlags.layer2Cleared = true;
          targetLayer++;
        }
      }
      return { clearedLayers, dives, divesPerLayer, stuck: clearedLayers < 3 };
    }

    let out = { verbose: [], stats: { clears: [0, 0, 0], divesToClear: [[], [], []], stuckCount: 0, fullClearDives: [] } };

    for (let v = 0; v < VERBOSE_RUNS; v++) {
      let log = [];
      let r = await playthrough(true, log);
      out.verbose.push(log);
    }
    // 靜默多跑，統計每層「累積到通關第 N 層時、總共下潛幾趟」
    for (let s = 0; s < SILENT_RUNS; s++) {
      let r = await playthrough(false, null);
      let cum = 0;
      for (let L = 1; L <= 3; L++) {
        cum += (r.divesPerLayer[L] || 0);
        if (r.clearedLayers >= L) { out.stats.clears[L - 1]++; out.stats.divesToClear[L - 1].push(cum); }
      }
      if (r.stuck) out.stats.stuckCount++;
      else out.stats.fullClearDives.push(r.dives);
    }
    return out;
  }, { VERBOSE_RUNS, SILENT_RUNS, MAX_DIVES, REST_HEAL_THRESHOLD });

  const avg = a => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : '—';
  console.log('=== 潛淵 全流程模擬（聰明 AI 玩家，從零開始一層層推）===');
  console.log('（保守估計：只算戰鬥掉的潛晶；真實玩家還有寶藏/事件/食物/魔藥/遺物會更快）\n');
  result.verbose.forEach((log, i) => {
    console.log(`【範例旅程 ${i + 1}（一趟趟的過程）】`);
    log.forEach(l => console.log(l));
    console.log('');
  });
  console.log(`【統計（跑 ${SILENT_RUNS} 輪平均）】`);
  ['第1層', '第2層', '第3層'].forEach((name, i) => {
    console.log(`  通關${name}：成功率 ${Math.round(result.stats.clears[i] / SILENT_RUNS * 100)}%　平均累計下潛 ${avg(result.stats.divesToClear[i])} 趟`);
  });
  console.log(`  三層全通：${result.stats.fullClearDives.length}/${SILENT_RUNS} 輪　平均 ${avg(result.stats.fullClearDives)} 趟；卡關 ${result.stats.stuckCount} 輪`);
  console.log('\n錯誤:', errs.length ? errs.join(' | ') : '（無）');
  await b.close();
})();
