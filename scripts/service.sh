#!/bin/bash
#
# Service Management Script
# 服务管理脚本 - 启动、停止、重启、检查服务状态
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PROJECT_DIR="/Users/heshi/fcy-learning/reader-v3"
BACKEND_PORT=8080
FRONTEND_PORT=3000
BACKEND_LOG="/tmp/reader_backend.log"
FRONTEND_LOG="/tmp/reader_frontend.log"

# Print functions
print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
    echo "服务管理脚本"
    echo ""
    echo "用法: $0 [命令]"
    echo ""
    echo "命令:"
    echo "  start       启动所有服务（后端 + 前端）"
    echo "  stop        停止所有服务"
    echo "  restart     重启所有服务"
    echo "  status      检查服务状态"
    echo "  logs        查看服务日志"
    echo "  backend     仅启动/停止/重启后端"
    echo "  frontend    仅启动/停止/重启前端"
    echo ""
    echo "示例:"
    echo "  $0 start     # 启动所有服务"
    echo "  $0 restart   # 重启所有服务"
    echo "  $0 status    # 查看运行状态"
}

# Check if service is running
check_backend() {
    curl -s http://localhost:$BACKEND_PORT/api/health > /dev/null 2>&1
}

check_frontend() {
    curl -s -o /dev/null -w "%{http_code}" http://localhost:$FRONTEND_PORT | grep -q "200"
}

# Get process info
get_backend_pid() {
    pgrep -f "reader_backend" | head -1
}

get_frontend_pid() {
    pgrep -f "vite" | head -1
}

# Stop services
stop_services() {
    print_info "停止服务..."

    # Stop backend
    local backend_pid=$(get_backend_pid)
    if [ -n "$backend_pid" ]; then
        print_info "停止后端服务 (PID: $backend_pid)..."
        kill $backend_pid 2>/dev/null || kill -9 $backend_pid 2>/dev/null || true
    fi

    # Stop frontend
    local frontend_pid=$(get_frontend_pid)
    if [ -n "$frontend_pid" ]; then
        print_info "停止前端服务 (PID: $frontend_pid)..."
        kill $frontend_pid 2>/dev/null || kill -9 $frontend_pid 2>/dev/null || true
    fi

    # Kill any remaining cargo processes
    pkill -f "cargo run" 2>/dev/null || true

    sleep 2
    print_success "服务已停止"
}

# Start backend
start_backend() {
    if check_backend; then
        print_warning "后端服务已在运行"
        return 0
    fi

    print_info "启动后端服务..."
    cd "$PROJECT_DIR/backend"

    # Clean up old log
    > "$BACKEND_LOG" 2>/dev/null || true

    # Build and start
    cargo run >> "$BACKEND_LOG" 2>&1 &

    # Wait for startup
    print_info "等待后端启动..."
    local count=0
    while [ $count -lt 30 ]; do
        if check_backend; then
            print_success "后端启动成功 (http://localhost:$BACKEND_PORT)"
            return 0
        fi
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    echo ""

    print_error "后端启动失败，查看日志: $BACKEND_LOG"
    tail -20 "$BACKEND_LOG"
    return 1
}

# Start frontend
start_frontend() {
    if check_frontend; then
        print_warning "前端服务已在运行"
        return 0
    fi

    print_info "启动前端服务..."
    cd "$PROJECT_DIR/frontend"

    # Clean up old log
    > "$FRONTEND_LOG" 2>/dev/null || true

    # Start
    npm run dev >> "$FRONTEND_LOG" 2>&1 &

    # Wait for startup
    print_info "等待前端启动..."
    local count=0
    while [ $count -lt 30 ]; do
        if check_frontend; then
            print_success "前端启动成功 (http://localhost:$FRONTEND_PORT)"
            return 0
        fi
        sleep 1
        count=$((count + 1))
        echo -n "."
    done
    echo ""

    print_error "前端启动失败，查看日志: $FRONTEND_LOG"
    tail -20 "$FRONTEND_LOG"
    return 1
}

# Show status
show_status() {
    echo ""
    echo "=== 服务状态 ==="
    echo ""

    # Backend
    local backend_pid=$(get_backend_pid)
    if check_backend; then
        print_success "后端: 运行中 (PID: $backend_pid)"
        echo "       地址: http://localhost:$BACKEND_PORT"
        echo "       API: http://localhost:$BACKEND_PORT/api/health"
    else
        print_error "后端: 未运行"
    fi

    echo ""

    # Frontend
    local frontend_pid=$(get_frontend_pid)
    if check_frontend; then
        print_success "前端: 运行中 (PID: $frontend_pid)"
        echo "       地址: http://localhost:$FRONTEND_PORT"
    else
        print_error "前端: 未运行"
    fi

    echo ""

    # Database
    local db_path="$PROJECT_DIR/backend/data/reader.db"
    if [ -f "$db_path" ]; then
        local db_size=$(du -h "$db_path" | cut -f1)
        print_success "数据库: 存在 ($db_size)"
        echo "       路径: $db_path"
    else
        print_error "数据库: 不存在"
    fi

    echo ""
}

# Show logs
show_logs() {
    echo "按 Ctrl+C 退出日志查看"
    echo ""

    if [ "$1" == "backend" ] && [ -f "$BACKEND_LOG" ]; then
        tail -f "$BACKEND_LOG"
    elif [ "$1" == "frontend" ] && [ -f "$FRONTEND_LOG" ]; then
        tail -f "$FRONTEND_LOG"
    else
        if [ -f "$BACKEND_LOG" ]; then
            echo "=== 后端日志 (最后 50 行) ==="
            tail -50 "$BACKEND_LOG"
        fi
        echo ""
        if [ -f "$FRONTEND_LOG" ]; then
            echo "=== 前端日志 (最后 50 行) ==="
            tail -50 "$FRONTEND_LOG"
        fi
    fi
}

# Main command handler
main() {
    case "${1:-}" in
        start)
            start_backend
            start_frontend
            show_status
            ;;
        stop)
            stop_services
            ;;
        restart)
            stop_services
            sleep 2
            start_backend
            start_frontend
            show_status
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs "$2"
            ;;
        backend)
            case "${2:-}" in
                start) start_backend ;;
                stop) pkill -f "reader_backend" 2>/dev/null || true ;;
                restart) pkill -f "reader_backend" 2>/dev/null || true; sleep 2; start_backend ;;
                *) echo "用法: $0 backend [start|stop|restart]" ;;
            esac
            ;;
        frontend)
            case "${2:-}" in
                start) start_frontend ;;
                stop) pkill -f "vite" 2>/dev/null || true ;;
                restart) pkill -f "vite" 2>/dev/null || true; sleep 2; start_frontend ;;
                *) echo "用法: $0 frontend [start|stop|restart]" ;;
            esac
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            show_status
            echo ""
            show_help
            ;;
    esac
}

main "$@"
