// ============================================================
// 潛淵 — 冒煙測試（Smoke Test）：一鍵驗證「遊戲沒有被改壞」
// ============================================================
// 做什麼：開遊戲 → 檢查資料完整性 → 作弊通關第一/二/三層（劇情） → 每層各打一場小怪戰＋Boss戰，
//         全程監看有沒有 console/page 錯誤。有任何錯誤或流程崩掉就 exit 1（CI 會標紅）。
//
// 為什麼：這遊戲改動很頻繁，手動每次點一遍太慢。這支腳本讓「有沒有改壞」變成一個指令、幾十秒的事，
//         而且完全在本地/CI 機器上跑，不花 AI 額度。GitHub Actions 每次 push 會自動跑它（見 .github/workflows）。
//
// 用法：NODE_PATH=./node_modules node scripts/冒煙測試.js
// 需要 playwright（開發用；沒裝先 `npm install playwright && npx playwright install chromium`）。
// ============================================================
const { chromium } = require('playwright');
const path = require('path');

// 本地環境的 chromium 在 /opt/pw-browsers；CI 用 playwright 自己裝的（預設路徑）。兩邊都試。
async function launch() {
  const candidates = [undefined, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];
  for (const executablePath of candidates) {
    try { return await chromium.launch(executablePath ? { executablePath } : {}); }
    catch (e) { /* 試下一個 */ }
  }
  throw new Error('找不到可用的 Chromium');
}

(async () => {
  const b = await launch();
  const p = await b.newPage();
  const errors = [];
  p.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await p.waitForTimeout(500);

  const report = await p.evaluate(async () => {
    const problems = [];
    const ok = [];
    window.setTimeout = ((orig) => (fn) => orig(fn, 0))(window.setTimeout); // 加速戰鬥
    const sleep = () => new Promise(r => setTimeout(r, 0));

    // 1) 資料完整性
    if (typeof MAX_LAYER !== 'number' || MAX_LAYER < 1) problems.push('MAX_LAYER 異常');
    for (let ly = 1; ly <= MAX_LAYER; ly++) {
      if (!LAYERS_META[ly]) problems.push('LAYERS_META 缺第' + ly + '層');
      if (!LAYER_BOSS[ly]) problems.push('LAYER_BOSS 缺第' + ly + '層');
      if (!LAYER_MONSTER_POOLS[ly]) problems.push('LAYER_MONSTER_POOLS 缺第' + ly + '層');
      if (!LAYER_NODE_CONFIGS[ly]) problems.push('LAYER_NODE_CONFIGS 缺第' + ly + '層');
    }
    Object.keys(MONSTERS).forEach(mid => {
      (MONSTERS[mid].skillIds || []).forEach(sid => { if (!MONSTER_SKILLS[sid]) problems.push(`${mid} 技能 ${sid} 不存在`); });
    });
    Object.values(MONSTER_SKILLS).forEach(sk => { if (sk.summonId && !MONSTERS[sk.summonId]) problems.push(`技能 ${sk.id} summonId ${sk.summonId} 不存在`); });
    ACHIEVEMENTS.forEach(a => { if (a.relic && !RELICS.find(r => r.id === a.relic)) problems.push(`成就 ${a.id} 對應遺物 ${a.relic} 不存在`); });
    if (problems.length === 0) ok.push('資料完整性');

    // 2) 作弊通關三層（劇情播放不崩）
    gameState.settings.typewriter = false;
    const cheatFns = [['cheatCompleteLayer1', 'lRescued'], ['cheatCompleteLayer2', 'layer2Cleared'], ['cheatCompleteLayer3', 'layer3Cleared']];
    for (const [fn, flag] of cheatFns) {
      try {
        // 重置到乾淨，逐層測
        window[fn]();
        if (!gameState.storyFlags[flag]) problems.push(`${fn} 沒有設定 ${flag}`);
      } catch (e) { problems.push(`${fn} 崩了：${e.message}`); }
    }
    if (!problems.some(x => x.includes('cheatComplete'))) ok.push('作弊通關三層劇情');

    // 3) 各層各打一場小怪戰＋Boss戰（滿血滿級，重點是流程不崩、零錯誤）
    gameState.storyFlags.firstLayerCleared = true; gameState.storyFlags.lRescued = true; gameState.storyFlags.layer2Cleared = true;
    syncLRoster();
    // 成長系統精簡版：解鎖全技能＋拉高歷練（取代舊的「升到 4 級」）
    Object.keys(gameState.characters).forEach(id => {
      gameState.characters[id].unlockedSkills = CHARACTERS[id].skillIds.slice();
      gameState.characters[id].trainLevel = 8;
    });

    async function playBattle(group, opts) {
      Object.keys(activeDive.party).forEach(id => { let m = activeDive.party[id]; m.maxHp = 9999; m.hp = 9999; m.fallen = false; Object.keys(m.skillUses).forEach(s => m.skillUses[s] = 99); });
      let done = false, outcome = null, guard = 0;
      startBattle(group, Object.assign({ allowFlee: false, onResult: r => { done = true; outcome = r.outcome; } }, opts));
      while (!done && guard < 6000) {
        if (activeBattle && activeBattle.phase === 'ally' && !activeBattle.pendingAction) {
          let id = activeBattle.allyTurnQueue[activeBattle.allyTurnPointer];
          if (id && isCurrentActorsTurn(id)) {
            let tgt = activeBattle.enemies.find(e => e.hp > 0 && !e.escaped && !e.burrowed);
            if (tgt) { battleNormalAttack(id); if (activeBattle && activeBattle.pendingAction) battleSelectTarget(tgt.uid, true); }
          }
        }
        Object.keys(activeDive.party).forEach(id => { let m = activeDive.party[id]; if (!m.fallen && m.hp < 3000) m.hp = 9999; });
        await sleep(); guard++;
      }
      return done && outcome === 'win';
    }

    for (let ly = 1; ly <= MAX_LAYER; ly++) {
      startNewDive(null, null, ly);
      let w1 = await playBattle(drawRandomMonsters(false), { isElite: false });
      let w2 = await playBattle([getLayerBoss(ly)], { isBoss: true });
      if (!w1) problems.push('第' + ly + '層小怪戰沒有正常打完');
      if (!w2) problems.push('第' + ly + '層Boss戰沒有正常打完');
    }
    if (!problems.some(x => x.includes('戰'))) ok.push('各層小怪戰＋Boss戰');

    return { problems, ok };
  });

  console.log('=== 潛淵 冒煙測試 ===');
  report.ok.forEach(o => console.log('  ✓ ' + o));
  if (report.problems.length) { console.log('  問題：'); report.problems.forEach(x => console.log('    ✗ ' + x)); }
  if (errors.length) { console.log('  console/page 錯誤：'); errors.forEach(e => console.log('    ✗ ' + e)); }

  const fail = report.problems.length > 0 || errors.length > 0;
  console.log(fail ? '\n結果：❌ FAIL' : '\n結果：✅ PASS');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
