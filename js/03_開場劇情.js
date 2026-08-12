// ========================================
// 潛淵 - 開場劇情
// 21段開場劇情逐句播放：黑暗墜落 → 教學岔路 → 教學戰鬥(赤手空拳,固定劇本) → K/V介紹 → 命名 → 世界觀科普 → 轉入避難所
// 教學戰鬥用固定數值(非隨機)，確保「被打兩下剩半血」的劇本一定成立，跟正式戰鬥系統(06_戰鬥.js)是分開的獨立小場景。
// ========================================

function startOpeningStory() {
  showScreen(`<div class="card" style="text-align:center; padding: 60px 20px;">
    <p class="dim">…</p>
  </div>`, { withTopbar: false });

  playDialogue([
    { speaker: "", text: "昏暗中，你被綁在某種冰冷的東西上。" },
    { speaker: "", text: "手腳動彈不得，視線一片模糊，眼前隱約有人頭攢動。" },
    { speaker: "？？？", text: "抱歉……我們沒有選擇。" },
    { speaker: "", text: "你感覺自己正在傾斜，接著是無盡的下墜。" },
    { speaker: "", text: "……" },
    { speaker: "", text: "…………" },
    { speaker: "", text: "不知過了多久，你在幽暗潮濕的裂谷中獨自醒來，四周只有微光點。" },
    { speaker: "", text: "你的背後是石壁，僅有的道路在你眼前分作兩邊。" },
  ], showTutorialFork, { id: "序章", title: "序章・墜入潛淵", order: 0 });
}

function showTutorialFork() {
  showScreen(`
    <h2 class="screen-title">潛淵深處</h2>
    <p>前方岔路分成兩邊，黑暗中看不出兩邊通往哪裡。</p>
    <div class="node-path">
      <button class="node-btn" onclick="chooseTutorialFork()">
        <span class="node-icon">❓</span>
        <span class="node-label">？？？</span>
      </button>
      <button class="node-btn" onclick="chooseTutorialFork()">
        <span class="node-icon">❓</span>
        <span class="node-label">？？？</span>
      </button>
    </div>
  `, { withTopbar: false });
}

function chooseTutorialFork() {
  playDialogue([
    { speaker: "", text: "你選了一邊，往深處走去。" },
  ], startTutorialFight);
}

let tutorialFight = null;

function startTutorialFight() {
  tutorialFight = {
    playerHp: 10, playerMaxHp: 10,
    enemyHp: 14, enemyMaxHp: 14,
    hitsTaken: 0,
    rescued: false,
    over: false,
  };
  renderTutorialFight();
}

function renderTutorialFight() {
  let t = tutorialFight;
  let allies = `<div class="battle-unit"><div class="battle-unit-avatar">🗡️</div><div class="battle-unit-name">你</div>
      <div class="bar-track"><div class="bar-fill hp-fill${t.playerHp <= t.playerMaxHp / 2 ? " hp-low" : ""}" style="width:${(t.playerHp / t.playerMaxHp) * 100}%;"></div></div>
      <div class="battle-unit-hp-text">${t.playerHp}/${t.playerMaxHp}</div></div>`;
  if (t.rescued) {
    allies += `<div class="battle-unit"><div class="battle-unit-avatar">🍳</div><div class="battle-unit-name">？？？</div>
      <div class="battle-unit-hp-text">正在幫你</div></div>`;
  }

  showScreen(`
    <h2 class="screen-title">戰鬥</h2>
    <div class="battle-enemy-row">
      <div class="battle-unit">
        <div class="battle-unit-avatar">🟢</div>
        <div class="battle-unit-name">？？？</div>
        <div class="bar-track"><div class="bar-fill enemy-hp-fill" style="width:${(t.enemyHp / t.enemyMaxHp) * 100}%;"></div></div>
        <div class="battle-unit-hp-text">${t.enemyHp}/${t.enemyMaxHp}</div>
      </div>
    </div>
    <div class="battle-ally-row">${allies}</div>
    <div class="battle-action-buttons">
      <button class="battle-btn" ${t.over ? "disabled" : ""} onclick="tutorialAttack()">⚔️ 攻擊</button>
      <button class="battle-btn" disabled title="逃不掉">🏃 逃跑</button>
    </div>
    <div id="tutorial-fight-log" class="battle-log"></div>
  `, { withTopbar: false });
}

function tutorialLog(msg) {
  let el = document.getElementById("tutorial-fight-log");
  if (!el) return;
  let p = document.createElement("p");
  p.textContent = msg;
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
}

function tutorialAttack() {
  let t = tutorialFight;
  if (t.over) return;

  t.enemyHp = Math.max(0, t.enemyHp - 3);
  tutorialLog("你赤手空拳打了過去，造成 3 點傷害。");

  if (t.enemyHp <= 0) {
    finishTutorialFight();
    return;
  }

  if (!t.rescued) {
    let dmg = t.hitsTaken === 0 ? 3 : 2;
    t.playerHp = Math.max(0, t.playerHp - dmg);
    t.hitsTaken++;
    tutorialLog(`不知名的怪物反擊，你受到 ${dmg} 點傷害。`);
    renderTutorialFight();

    if (t.hitsTaken >= 2) {
      t.over = true;
      renderTutorialFight();
      setTimeout(triggerTutorialRescue, 400);
    }
  } else {
    renderTutorialFight();
  }
}

function triggerTutorialRescue() {
  playDialogue([
    { speaker: "？？？", text: "喂！給我看這邊！" },
    { speaker: "", text: "一聲暴喝引走了怪物的注意力，一個人影驀地跳出。" },
  ], () => {
    let t = tutorialFight;
    t.rescued = true;
    t.over = false;
    t.enemyHp = Math.max(0, t.enemyHp - 6);
    renderTutorialFight();
    playDialogue([
      { speaker: "？？？", text: "我來幫你！" },
    ], () => {});
  });
}

function finishTutorialFight() {
  let t = tutorialFight;
  t.over = true;
  renderTutorialFight();
  let lines = t.rescued
    ? [{ speaker: "", text: "兩人合力，怪物終於倒下不動了。" }]
    : [{ speaker: "", text: "怪物倒下不動了。" }];
  playDialogue(lines, continueOpeningAfterFight);
}

function continueOpeningAfterFight() {
  gameState.bestiary.凝膠 = true;

  playDialogue([
    { speaker: "？？？", text: "雖然有很多想問……但此地不宜久留，你也受了傷，先跟我來吧。" },
    { speaker: "", text: "那人對你微笑，棕色的眸子彎了彎，轉身朝某個方向走去。" },
    { speaker: "", text: "你跟上他的腳步。" },
    { speaker: "", text: "走了幾段路，眼前出現一處簡陋的住所——兩個棚子搭在岩石平台上，一個堆滿了各種材料和工具，另一個有灶台和鍋具，旁邊鋪著幾張似乎是睡覺用的墊子。" },
    { speaker: "", text: "一個人正沉默地磨著刀，聽見動靜抬頭看向你。" },
    { speaker: "K", text: "自我介紹一下，我叫 K，那邊磨刀的是 V。" },
    { speaker: "K", text: "V，這是我在路上遇到的人……真沒想到，這裡還能看見其他倖存者。" },
    { speaker: "", text: "V嗯了一聲。K再次看向你。" },
    { speaker: "K", text: "我們原本是三人小隊，第三個人叫 L。都是在這鬼地方認識的，互相扶持，努力活著。" },
    { speaker: "K", text: "但是幾天前，L落入一個深坑後失蹤了。" },
    { speaker: "K", text: "我……這幾天都在找他，一直沒有找到。潛淵裡太多危險了，地形像是活的一樣，不斷挪動、改變……只靠我和V走不了太遠。" },
    { speaker: "", text: "他苦笑。" },
    { speaker: "K", text: "還是換個話題吧。啊，話說回來，你怎麼稱呼？" },
    { speaker: "", text: "你張了張嘴，卻什麼都想不起來，腦中連名字都是一片空白。" },
    { speaker: "K", text: "沒事，遇到了這樣的事情，想不起來也正常。" },
    { speaker: "K", text: "那就自己想個名字吧，之後隨時想改也可以，和我們說一聲就好。" },
    { speaker: "", text: "", textInput: {
      placeholder: "輸入名字",
      buttonLabel: "就這麼定了",
      onSubmit: (name) => { gameState.playerName = name; CHARACTERS.主角.name = name; },
    } },
  ], continueOpeningAfterNaming, { id: "序章", title: "序章・墜入潛淵", order: 0, append: true });
}

function continueOpeningAfterNaming() {
  let name = gameState.playerName;
  playDialogue([
    { speaker: "K", text: `${name}，嗎。好名字。` },
    { speaker: "K", text: "本來想問你是怎麼掉下來的……算了，不管怎樣都不讓人愉快，不問了。" },
    { speaker: "K", text: "我們都是落在這個被世界拋棄的地方的倖存者。避難所裡的事有分工：V 擅長做武器、我做飯、L會煮藥。" },
    { speaker: "", text: "K從口袋翻出了一些黑色、半透明的……石頭？" },
    { speaker: "K", text: "V，能麻煩你幫忙做一把武器嗎？" },
    { speaker: "", text: "V點頭，拿起 K 手上的幾塊碎石，閉上眼。" },
    { speaker: "", text: "V的手中發出微光，碎塊像融化般緩緩改變形狀，最後化成一把劍。V將劍遞到你面前。" },
    { speaker: "K", text: "這是潛晶。算是……在這詭異的地方，唯一能挖到的好東西。" },
    { speaker: "K", text: "我們過往所知的魔法，能做的是「改變性質」和「製造現象」。依靠著自己的知識和思考，轉移能量或影響世界上本就存在的事物，像是造風、凝冰、燃燒等。" },
    { speaker: "K", text: "但潛晶不一樣，它的力量是「消耗自身進行創造」，從無到有。手握潛晶，灌注自己的「想像」，就能改變現實、創造出原本不存在的東西。" },
    { speaker: "", text: "K指了指你剛拿到的劍。" },
    { speaker: "K", text: "構造較為簡單、強度一般的東西只需要幾顆潛晶。但要讓它更硬、更鋒利或者更複雜，消耗會直線上升。" },
    { speaker: "K", text: "……我們拿到的一部分潛晶得拿來維修避難所，所以一直存不了太多。" },
    { speaker: "K", text: "有時候維修用的潛晶不夠，工坊那邊就得暫時停擺，不過避難所不至於馬上垮掉就是了。" },
    { speaker: "", text: "K正要繼續說明，一旁黑髮藍眼的人冷不防開了口。" },
    { speaker: "V", text: `……你還沒給 ${name} 吃的。` },
    { speaker: "K", text: "啊，對喔！你一定餓了吧，先吃這個墊墊肚子吧。" },
    { speaker: "", text: "K在一堆雜物裡翻了翻，拿出一塊用葉子包著的……餅？" },
    { speaker: "", text: "你試著咬了一口，有點硬，口感乾又粉，有股淡淡的草味。不怎麼好吃。" },
    { speaker: "K", text: "抱歉，暫時只有這個，忍耐一下。" },
    { speaker: "", text: "K歉意地眨了眨眼。" },
    { speaker: "K", text: "去外面探索時偶爾能……從那些「生物」上，嗯……取得一些食材，不過要看運氣。" },
    { speaker: "K", text: "平常我們都吃這裡能生長的塊莖類食物，靠一點點潛晶創造肥料種出來的，能吃飽但不太好吃。就是我剛剛給你的那個。" },
    { speaker: "K", text: "說到材料，因為 L 不在沒辦法製藥，我的「想像」也不夠強，只能用潛晶做出最基本的藥。先拿去用吧。" },
    { speaker: "", text: "你接過三瓶藥水。" },
    { speaker: "K", text: "這些補血藥給你，戰鬥內外都能喝，不過戰鬥中喝會耽誤出手時機。快用完的時候拿潛晶來，我可以用「想像」再幫你做。" },
    { speaker: "K", text: "好，該讓你自己看看四周了。" },
    { speaker: "K", text: `……歡迎你，${name}。` },
  ], finishOpeningStory, { id: "序章", title: "序章・墜入潛淵", order: 0, append: true });
}

function finishOpeningStory() {
  gameState.storyFlags.introDone = true;
  gameState.potions = 3; // 開場K給的起始補血藥數量，回避難所後可以再花潛晶補到上限
  showShelterScreen();
  systemToast(`歡迎來到潛淵，${gameState.playerName}。`);
}

// ---------- 作弊：跳過新手教學 ----------
// 直接套用正常走完開場劇情會有的結果（不強制輸入名字，維持空白，displayName()會顯示「你」，之後可以從☰選單改名）
function cheatSkipTutorial() {
  closeGenericModal();
  // 安全網：萬一是在對話框播放中觸發的，強制關掉殘留的對話框覆蓋層，避免卡住後續畫面點擊
  clearDialogueTimers(); // 一併清掉逐字動畫/Auto倒數的計時器，免得殘留亂觸發
  dialogueQueue = [];
  dialogueOnComplete = null;
  document.getElementById("dialogue-overlay").classList.add("hidden");

  gameState.bestiary.凝膠 = true; // 正常教學戰鬥打的就是凝膠
  gameState.storyFlags.introDone = true;
  gameState.potions = 3;
  showShelterScreen();
  systemToast("已跳過新手教學。想改名的話可以從左上角☰選單改。");
}
