#!/usr/bin/env bash
# 备份本地 D1 数据库为 .sql 文件
# 用法：./scripts/dump-d1.sh
# 输出：api/backups/YYYYMMDD-HHMMSS.sql

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
API_DIR="$PROJECT_DIR/api"
BACKUP_DIR="$API_DIR/backups"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$BACKUP_DIR/$TIMESTAMP.sql"

echo "备份本地 D1 → $OUTPUT ..."
cd "$API_DIR"
npx wrangler d1 export microblog-db-local --local --output="$OUTPUT"

SIZE=$(wc -c < "$OUTPUT" | tr -d ' ')
echo "完成：$OUTPUT ($SIZE 字节)"

# 保留最近 10 个备份，自动清理旧的
cd "$BACKUP_DIR"
ls -t *.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true

echo "当前备份："
ls -lh "$BACKUP_DIR"/*.sql 2>/dev/null
