#!/usr/bin/env bash
# ========================================
# 潛淵 自動備份腳本
# 把目前遊戲內容整包複製成一個資料夾，放進「備份/」。
# 「備份/」只保留最新 3 個備份，更舊的自動移進「備份/更舊的/」。
# 用法：在專案根目錄執行  bash scripts/備份.sh
# ========================================
set -e

# 切換到專案根目錄（本腳本在 scripts/ 底下）
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
BACKUP_DIR="$ROOT/備份"
OLD_DIR="$BACKUP_DIR/更舊的"
mkdir -p "$OLD_DIR"

# 這次備份的資料夾名稱：潛淵_備份_年-月-日_時分秒
STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$BACKUP_DIR/潛淵_備份_$STAMP"
mkdir -p "$DEST"

# 要備份的項目（穩定版遊戲＋開發中版＋文件），排除「備份/」自己與 .git
for item in index.html style.css js 開發中 設計文件 README.md CLAUDE.md 更新日誌.txt 納可要求清單.txt scripts; do
  if [ -e "$ROOT/$item" ]; then
    cp -r "$ROOT/$item" "$DEST/"
  fi
done

# 只保留最新 3 個備份，第 4 個以後（較舊）移進「更舊的/」
cd "$BACKUP_DIR"
ls -1dt 潛淵_備份_*/ 2>/dev/null | tail -n +4 | while read -r old; do
  mv "$old" "$OLD_DIR/"
done

echo "✅ 已建立備份：備份/潛淵_備份_$STAMP"
echo "   目前「備份/」保留最新 $(ls -1dt "$BACKUP_DIR"/潛淵_備份_*/ 2>/dev/null | wc -l | tr -d ' ') 個備份。"
