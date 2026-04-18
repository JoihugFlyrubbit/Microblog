#!/usr/bin/env bash
# 备份本地 D1 数据库为 .sql 文件
# 输出两份：
#   1. ~/Claude/backups/micronotes/latest.sql（跟 claude-workspace 一起 push，git 历史当归档）
#   2. api/backups/ 下本地保留最近 30 份（带时间戳，快速回滚用）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_DIR/api"
LOCAL_BACKUP_DIR="$API_DIR/backups"
REMOTE_BACKUP_DIR="$HOME/Claude/backups/micronotes"

# 纯表结构的最小大小（字节），低于此视为空库
MIN_DATA_SIZE=4000

mkdir -p "$LOCAL_BACKUP_DIR" "$REMOTE_BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TMP_OUTPUT="$LOCAL_BACKUP_DIR/$TIMESTAMP.sql"

echo "备份本地 D1 ..."
cd "$API_DIR"
npx wrangler d1 export microblog-db-local --local --output="$TMP_OUTPUT"

SIZE=$(wc -c < "$TMP_OUTPUT" | tr -d ' ')

# 验证 dump 非空（不把空库误当正常备份）
if [ "$SIZE" -le "$MIN_DATA_SIZE" ]; then
  echo "⚠️  警告：导出仅 $SIZE 字节（可能是空库），跳过远程备份覆写"
  echo "本地临时文件保留在：$TMP_OUTPUT"
  exit 0
fi

# 覆写远程备份（git 历史保留所有版本）
cp "$TMP_OUTPUT" "$REMOTE_BACKUP_DIR/latest.sql"
echo "✓ 远程备份：$REMOTE_BACKUP_DIR/latest.sql ($SIZE 字节)"

# 本地保留带时间戳的最近 30 份
echo "✓ 本地备份：$TMP_OUTPUT ($SIZE 字节)"
cd "$LOCAL_BACKUP_DIR"
ls -t *.sql 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null || true
