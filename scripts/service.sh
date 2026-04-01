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

# Required models for the application
REQUIRED_EMBEDDING_MODEL="mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ"
REQUIRED_RERANKER_MODEL="qwen3.5-9b"

show_help() {
    echo "服务管理脚本"
    echo ""
    echo "用法: $0 [命令]"
    echo ""
    echo "命令:"
    echo "  start         启动所有服务（后端 + 前端）"
    echo "  stop          停止所有服务"
    echo "  restart       重启所有服务"
    echo "  status        检查服务状态"
    echo "  logs          查看服务日志"
    echo "  backend       仅启动/停止/重启后端"
    echo "  frontend      仅启动/停止/重启前端"
    echo "  check-models  检查LM Studio模型是否已下载"
    echo "  start-models  加载所需的LM Studio模型"
    echo ""
    echo "示例:"
    echo "  $0 start       # 启动所有服务"
    echo "  $0 restart     # 重启所有服务"
    echo "  $0 status      # 查看运行状态"
    echo "  $0 check-models # 检查模型状态"
    echo "  $0 start-models # 加载所需模型"
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

# Check if lms CLI is available
check_lms_cli() {
    if ! command -v lms &> /dev/null; then
        print_error "lms CLI 未找到"
        echo ""
        echo "请安装 LM Studio CLI:"
        echo "  1. 打开 LM Studio 应用"
        echo "  2. 点击左下角设置 (Settings)"
        echo "  3. 选择 'CLI' 标签页"
        echo "  4. 点击 'Install CLI' 按钮"
        echo ""
        echo "或者手动安装:"
        echo "  ln -s '~/.cache/lm-studio/bin/lms' /usr/local/bin/lms"
        return 1
    fi
    return 0
}

# Check if required models are downloaded
check_models() {
    print_info "检查LM Studio模型..."
    echo ""

    if ! check_lms_cli; then
        return 1
    fi

    # Check if LM Studio server is running
    if ! lms server status &> /dev/null; then
        print_error "LM Studio 服务器未运行"
        echo ""
        echo "请启动 LM Studio 并确保服务器已启动:"
        echo "  1. 打开 LM Studio 应用"
        echo "  2. 确保左下角显示 '🟢 运行中'"
        echo "  或运行: lms server start"
        return 1
    fi

    print_success "LM Studio 服务器运行中"
    echo ""

    # Get list of downloaded models
    local models_json
    models_json=$(lms models list --json 2>/dev/null) || {
        print_error "无法获取模型列表"
        return 1
    }

    # Check for embedding model
    echo "检查Embedding模型:"
    echo "  需要: $REQUIRED_EMBEDDING_MODEL"
    if echo "$models_json" | grep -q "$REQUIRED_EMBEDDING_MODEL"; then
        print_success "  状态: 已下载"
    else
        print_error "  状态: 未下载"
        echo ""
        echo "  下载命令:"
        echo "    lms models pull $REQUIRED_EMBEDDING_MODEL"
    fi
    echo ""

    # Check for reranker model (optional but recommended)
    echo "检查Reranker模型 (推荐):"
    echo "  推荐: $REQUIRED_RERANKER_MODEL"
    if echo "$models_json" | grep -q "$REQUIRED_RERANKER_MODEL"; then
        print_success "  状态: 已下载"
    else
        print_warning "  状态: 未下载 (可选，但推荐)"
        echo ""
        echo "  下载命令:"
        echo "    lms models pull mlx-community/Qwen3.5-9B-Instruct-4bit-DWQ"
    fi
    echo ""

    # Show loaded models
    echo "当前加载的模型:"
    local loaded_models
    loaded_models=$(lms models loaded --json 2>/dev/null | grep '"id"' || echo "  无")
    echo "$loaded_models" | sed 's/^/  /'
}

# Load required models
start_models() {
    print_info "加载LM Studio模型..."
    echo ""

    if ! check_lms_cli; then
        return 1
    fi

    # Check if LM Studio server is running
    if ! lms server status &> /dev/null; then
        print_info "启动LM Studio服务器..."
        lms server start &> /dev/null || {
            print_error "无法启动LM Studio服务器"
            echo "请手动启动LM Studio应用"
            return 1
        }
        sleep 2
    fi

    print_success "LM Studio 服务器运行中"
    echo ""

    # Load embedding model
    print_info "加载Embedding模型: $REQUIRED_EMBEDDING_MODEL"
    if lms models load "$REQUIRED_EMBEDDING_MODEL" &> /dev/null; then
        print_success "Embedding模型加载成功"
    else
        print_error "Embedding模型加载失败"
        echo "请确保模型已下载:"
        echo "  lms models pull $REQUIRED_EMBEDDING_MODEL"
    fi
    echo ""

    # Load reranker model (optional)
    print_info "尝试加载Reranker模型..."
    if lms models load "mlx-community/Qwen3.5-9B-Instruct-4bit-DWQ" &> /dev/null; then
        print_success "Reranker模型加载成功"
    else
        print_warning "Reranker模型加载失败 (可选)"
        echo "如需使用，请下载:"
        echo "  lms models pull mlx-community/Qwen3.5-9B-Instruct-4bit-DWQ"
    fi
    echo ""

    # Show loaded models
    print_info "当前加载的模型:"
    lms models loaded 2>/dev/null || echo "  无"
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
        check-models)
            check_models
            ;;
        start-models)
            start_models
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
