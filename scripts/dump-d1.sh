#!/usr/bin/env bash
# 备份本地 D1 数据库为 .sql 文件。
# 默认输出到 api/backups/；也可以通过 BACKUP_DIR 指定本机目录。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_DIR/api"
LOCAL_BACKUP_DIR="$API_DIR/backups"
BACKUP_DIR="${BACKUP_DIR:-$LOCAL_BACKUP_DIR}"

# 纯表结构的最小大小（字节），低于此视为空库
MIN_DATA_SIZE=4000

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TMP_OUTPUT="$BACKUP_DIR/$TIMESTAMP.sql"

echo "备份本地 D1 ..."
cd "$API_DIR"
npx wrangler d1 export microblog-db-local --local --output="$TMP_OUTPUT"

SIZE=$(wc -c < "$TMP_OUTPUT" | tr -d ' ')

# 验证 dump 非空（不把空库误当正常备份）
if [ "$SIZE" -le "$MIN_DATA_SIZE" ]; then
  echo "⚠️  警告：导出仅 $SIZE 字节（可能是空库），跳过远程备份覆写"
  echo "备份文件保留在：$TMP_OUTPUT"
  exit 0
fi

echo "✓ 本地备份：$TMP_OUTPUT ($SIZE 字节)"
