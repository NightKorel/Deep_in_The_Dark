// ========================================
// 潛淵 - 劇情回顧
// 從 gameState.storyLog 讀出玩家「已經看過」的主線劇情段落（防暴雷：沒看過的不會出現），
// 由左上角 ☰ 選單開啟，可選段落回顧，內容以可滾動的文字對話紀錄呈現（旁白顯示為旁白）。
// 記錄的寫入在 02_介面共用與存讀檔.js（recordStoryLog／playDialogue 的 logInfo）。
// ========================================

// 取出所有已記錄的劇情場景，依 order 由前到後排序
function getStoryLogScenes() {
  let log = gameState.storyLog || {};
  return Object.keys(log)
    .map((id) => Object.assign({ id }, log[id]))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

// 基本 HTML escape，避免劇情/玩家名字裡的特殊字元破壞版面
function escapeHtmlBasic(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function openStoryLogModal() {
  toggleSettingsMenu();
  let scenes = getStoryLogScenes();
  if (scenes.length === 0) {
    openGenericModal("劇情回顧", `
      <p class="dim">還沒有可以回顧的劇情。隨著遊戲進行，看過的主線段落會自動收錄到這裡。</p>
      <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
    `);
    return;
  }
  let rows = scenes.map((s) =>
    `<div class="menu-item" onclick="showStoryLogScene('${encodeURIComponent(s.id)}')">📜 ${escapeHtmlBasic(s.title)}</div>`
  ).join("");
  openGenericModal("劇情回顧", `
    <p class="dim">選一段回顧（只會列出你已經看過的劇情）：</p>
    ${rows}
    <button class="action-btn secondary" style="margin-top:8px;" onclick="closeGenericModal()">關閉</button>
  `);
}

function showStoryLogScene(encId) {
  let id = decodeURIComponent(encId);
  let scene = (gameState.storyLog || {})[id];
  if (!scene) return;
  let body = scene.lines.map((l) => {
    if (!l.speaker) {
      return `<p class="storylog-narration">${escapeHtmlBasic(l.text)}</p>`;
    }
    return `<p class="storylog-line"><b class="storylog-speaker">${escapeHtmlBasic(l.speaker)}</b>：${escapeHtmlBasic(l.text)}</p>`;
  }).join("");
  openGenericModal(scene.title, `
    <div class="storylog-scroll">${body}</div>
    <div style="margin-top:12px;">
      <button class="action-btn secondary" onclick="openStoryLogModal()">← 回劇情列表</button>
      <button class="action-btn secondary" onclick="closeGenericModal()">關閉</button>
    </div>
  `);
}
