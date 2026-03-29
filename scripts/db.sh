#!/bin/bash
#
# Database Management Script
# 数据库管理脚本 - 重置、备份、查看数据库
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Database path (IMPORTANT: Backend uses backend/data/ not root data/)
DB_PATH="/Users/heshi/fcy-learning/reader-v3/backend/data/reader.db"
DATA_DIR="/Users/heshi/fcy-learning/reader-v3/backend/data"
BACKUP_DIR="/Users/heshi/fcy-learning/reader-v3/backend/data/backups"

# Show help
show_help() {
    echo "数据库管理脚本"
    echo ""
    echo "用法: $0 [命令]"
    echo ""
    echo "命令:"
    echo "  reset     重置数据库（删除并重新创建，⚠️ 数据会丢失）"
    echo "  backup    备份当前数据库"
    echo "  restore   从备份恢复数据库"
    echo "  schema    查看数据库表结构"
    echo "  tables    列出所有表"
    echo "  size      查看数据库大小"
    echo "  path      显示数据库文件路径"
    echo ""
    echo "重要提示:"
    echo "  数据库实际路径: backend/data/reader.db"
    echo "  不是: data/reader.db (项目根目录下的是空的！)"
}

# Print colored message
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if sqlite3 is installed
check_sqlite() {
    if ! command -v sqlite3 &> /dev/null; then
        print_error "sqlite3 未安装，请先安装: brew install sqlite"
        exit 1
    fi
}

# Get database path
get_db_path() {
    echo "$DB_PATH"
}

# Reset database
reset_db() {
    print_warning "⚠️  警告: 这将删除所有数据！"
    read -p "确定要继续吗？输入 'yes' 确认: " confirm

    if [ "$confirm" != "yes" ]; then
        print_info "已取消"
        exit 0
    fi

    # Stop backend if running
    print_info "停止后端服务..."
    pkill -f "reader_backend" 2>/dev/null || true
    pkill -f "cargo run" 2>/dev/null || true
    sleep 2

    # Backup before reset if database exists and has content
    if [ -s "$DB_PATH" ]; then
        mkdir -p "$BACKUP_DIR"
        backup_file="$BACKUP_DIR/reader_backup_$(date +%Y%m%d_%H%M%S).db"
        cp "$DB_PATH" "$backup_file"
        print_success "已备份到: $backup_file"
    fi

    # Remove database
    print_info "删除数据库文件..."
    rm -f "$DB_PATH"
    print_success "数据库已删除"

    # Also clean up root data directory if exists (old wrong location)
    if [ -f "/Users/heshi/fcy-learning/reader-v3/data/reader.db" ]; then
        print_info "清理旧位置的数据库文件..."
        rm -f "/Users/heshi/fcy-learning/reader-v3/data/reader.db"
    fi

    # Restart backend
    print_info "重新启动后端服务..."
    cd /Users/heshi/fcy-learning/reader-v3/backend
    cargo run > /tmp/reader_backend.log 2>&1 &

    # Wait for backend to start
    print_info "等待后端启动..."
    for i in {1..30}; do
        if curl -s http://localhost:8080/api/health > /dev/null 2>&1; then
            print_success "后端启动成功！"
            break
        fi
        sleep 1
        echo -n "."
    done

    # Verify database was created
    if [ -f "$DB_PATH" ]; then
        print_success "新数据库已创建: $DB_PATH"
        print_info "数据库大小: $(du -h "$DB_PATH" | cut -f1)"
    else
        print_error "数据库创建失败，请检查后端日志: /tmp/reader_backend.log"
        exit 1
    fi
}

# Backup database
backup_db() {
    check_sqlite

    if [ ! -f "$DB_PATH" ]; then
        print_error "数据库文件不存在: $DB_PATH"
        exit 1
    fi

    mkdir -p "$BACKUP_DIR"
    backup_file="$BACKUP_DIR/reader_backup_$(date +%Y%m%d_%H%M%S).db"

    cp "$DB_PATH" "$backup_file"
    print_success "备份完成: $backup_file"
    print_info "备份大小: $(du -h "$backup_file" | cut -f1)"
}

# Restore database
restore_db() {
    check_sqlite

    # List available backups
    if [ ! -d "$BACKUP_DIR" ] || [ -z "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
        print_error "没有找到备份文件"
        exit 1
    fi

    echo "可用备份:"
    ls -lt "$BACKUP_DIR" | grep "reader_backup_" | head -10 | nl

    read -p "选择要恢复的备份编号 (1-10): " choice

    backup_file=$(ls -t "$BACKUP_DIR"/reader_backup_*.db | sed -n "${choice}p")

    if [ -z "$backup_file" ]; then
        print_error "无效的选择"
        exit 1
    fi

    print_warning "⚠️  警告: 这将覆盖当前数据库！"
    read -p "确定要恢复吗？输入 'yes' 确认: " confirm

    if [ "$confirm" != "yes" ]; then
        print_info "已取消"
        exit 0
    fi

    # Stop backend
    print_info "停止后端服务..."
    pkill -f "reader_backend" 2>/dev/null || true
    sleep 2

    # Restore
    cp "$backup_file" "$DB_PATH"
    print_success "数据库已恢复: $backup_file"

    # Restart backend
    print_info "重新启动后端服务..."
    cd /Users/heshi/fcy-learning/reader-v3/backend
    cargo run > /tmp/reader_backend.log 2>&1 &
    sleep 5

    if curl -s http://localhost:8080/api/health > /dev/null 2>&1; then
        print_success "服务已恢复"
    else
        print_warning "服务可能未正常启动，请检查日志"
    fi
}

# Show schema
show_schema() {
    check_sqlite

    if [ ! -f "$DB_PATH" ]; then
        print_error "数据库文件不存在: $DB_PATH"
        exit 1
    fi

    echo ""
    echo "=== 数据库表结构 ==="
    echo ""

    for table in books chunks nodes edges settings; do
        echo "--- $table 表 ---"
        sqlite3 "$DB_PATH" ".schema $table" 2>/dev/null || echo "表不存在"
        echo ""
    done
}

# List tables
list_tables() {
    check_sqlite

    if [ ! -f "$DB_PATH" ]; then
        print_error "数据库文件不存在: $DB_PATH"
        exit 1
    fi

    echo ""
    echo "=== 数据库表 ==="
    sqlite3 "$DB_PATH" ".tables"
    echo ""

    # Show row counts
    echo "=== 表记录数 ==="
    for table in books chunks nodes edges settings; do
        count=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
        echo "$table: $count 条记录"
    done
}

# Show database size
show_size() {
    if [ ! -f "$DB_PATH" ]; then
        print_error "数据库文件不存在: $DB_PATH"
        exit 1
    fi

    echo ""
    echo "=== 数据库信息 ==="
    echo "路径: $DB_PATH"
    echo "大小: $(du -h "$DB_PATH" | cut -f1)"
    echo "修改时间: $(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$DB_PATH" 2>/dev/null || stat -c "%y" "$DB_PATH" 2>/dev/null)"
    echo ""
}

# Show path
show_path() {
    echo ""
    echo "=== 数据库路径信息 ==="
    echo ""
    echo "✅ 正确的数据库路径:"
    echo "   $DB_PATH"
    echo ""
    echo "❌ 错误的路径（项目根目录，这个文件是空的！）:"
    echo "   /Users/heshi/fcy-learning/reader-v3/data/reader.db"
    echo ""
    echo "说明:"
    echo "   后端服务从 backend/ 目录启动，所以数据目录是 backend/data/"
    echo "   不要混淆这两个位置！"
    echo ""

    if [ -f "$DB_PATH" ]; then
        print_success "数据库文件存在"
        ls -lh "$DB_PATH"
    else
        print_error "数据库文件不存在"
    fi

    if [ -f "/Users/heshi/fcy-learning/reader-v3/data/reader.db" ]; then
        print_warning "注意: 根目录下有一个空的数据库文件，可以安全删除"
        ls -lh "/Users/heshi/fcy-learning/reader-v3/data/reader.db"
    fi
}

# Main
main() {
    case "${1:-}" in
        reset)
            reset_db
            ;;
        backup)
            backup_db
            ;;
        restore)
            restore_db
            ;;
        schema)
            show_schema
            ;;
        tables)
            list_tables
            ;;
        size)
            show_size
            ;;
        path)
            show_path
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            show_path
            echo ""
            show_help
            ;;
    esac
}

main "$@"
