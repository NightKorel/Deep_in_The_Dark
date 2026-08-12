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
    { speaker: "", text: "黑暗中，你手腳動彈不得，被綁在冰涼的東西上，視線模糊，眼前人頭攢動。" },
    { speaker: "？？？", text: "抱歉……我們沒有選擇。" },
    { speaker: "", text: "你感覺自己正在傾斜，接著是無盡的下墜。" },
    { speaker: "", text: "不知過了多久，你在幽暗潮濕的裂谷中獨自醒來，四周是陌生的岩壁與微光。" },
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
    { speaker: "", text: "有人猛然出手，引開了怪物的注意力，並狠狠造成一擊傷害。" },
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
    { speaker: "K", text: "雖然有很多想問……但此地不宜久留，你也受了傷，先跟我來吧。" },
    { speaker: "", text: "你跟著K走進一處簡陋的避難所——兩個棚子搭在裂谷的一處平台上，一個堆滿了各種材料和工具，另一個有灶台和鍋具，旁邊鋪著幾張睡覺用的墊子。" },
    { speaker: "", text: "一人正沉默地磨著刀，聽見動靜抬起頭，盯著K和他帶回來的人看了一眼，隨即低下頭繼續磨刀。" },
    { speaker: "K", text: "醒了？太好了。我叫 K，那邊磨刀的是 V。" },
    { speaker: "", text: "V只嗯了一聲，沒有抬頭。" },
    { speaker: "K", text: "我們原本是三人小隊，第三個人叫 L，前陣子落入一個深坑後失蹤了，到現在都沒找到。我這幾天都在找，還是沒有結果。" },
    { speaker: "K", text: "話說回來……你怎麼稱呼？" },
    { speaker: "", text: "你張了張嘴，卻什麼都想不起來。連自己的名字都是一片空白。" },
    { speaker: "K", text: "……算了，看你這樣，不記得也正常。那就自己想一個名字吧，之後想改也可以。" },
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
    { speaker: "K", text: "我們仨都是被潛淵吞下來、落在這個被世界拋棄的地方的倖存者。避難所裡的事各自有分工：V 做武器、我煮飯，L 在的話是製藥的，現在只能先擱著。" },
    { speaker: "V", text: `……你還沒給 ${name} 吃的。` },
    { speaker: "K", text: "啊，對喔。等等，先讓 V 幫你弄件像樣的武器。" },
    { speaker: "", text: "V 拿起 K 帶回來的一小塊潛晶，閉上眼。晶體發出微光，像融化般緩緩改變形狀，最後化成一把劍，遞到你面前。" },
    { speaker: "K", text: "那是潛晶——這個世界會吞人的裂谷裡，唯一能挖到的好東西。魔法能『改變性質』：造風、凝冰、加溫燃燒；潛晶不一樣，它的力量是『消耗自身進行創造』，從無到有。灌注『想像』進去，就能改變現實、創造出東西。" },
    { speaker: "K", text: "構造簡單、強度普通的東西只要幾顆潛晶。但要讓它更硬、更鋒利，消耗會直線上升——而且一部分潛晶得拿去維修避難所，所以我們手上一直存不了太多。" },
    { speaker: "K", text: "之前有幾次不夠，工坊那邊就暫時動不了，不過避難所本身不會塌就是了。前期會緊一點，之後應該會越來越寬裕。" },
    { speaker: "K", text: "對了——你也餓了吧？食材是打怪的時候會撿到的，每種食材都能對應做出一道菜，偶爾會撿到高級版，效果會加倍。平常有塊莖類的食物，靠一點潛晶造肥料跟種子種出來的，管飽但……不太好吃。吃到好料理的話，身體會更有力氣。" },
    { speaker: "K", text: "因為 L 不在，沒辦法製藥，我的『想像』也不夠強，只能用潛晶造最基本的補血藥。先拿去用吧。" },
    { speaker: "K", text: "這些補血藥給你，戰鬥內外都能喝，不過戰鬥中喝會耽誤出手時機。補血藥快用完的時候，拿潛晶來，我可以用「想像」幫你多做幾瓶。" },
    { speaker: "K", text: "好了，該讓你自己看看四周了。" },
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
  dialogueQueue = [];
  dialogueOnComplete = null;
  document.getElementById("dialogue-overlay").classList.add("hidden");

  gameState.bestiary.凝膠 = true; // 正常教學戰鬥打的就是凝膠
  gameState.storyFlags.introDone = true;
  gameState.potions = 3;
  showShelterScreen();
  systemToast("已跳過新手教學。想改名的話可以從左上角☰選單改。");
}
