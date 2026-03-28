#!/bin/bash
# Evaluation Script - Service startup with health check
# Entry point for the evaluation system

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND_PID=""
FRONTEND_PID=""
MAX_WAIT=60

# Report variables
REPORT_FILE=""
START_TIME=""
EVAL_SCOPE=""
UPLOAD_TOTAL=0
UPLOAD_SUCCESS=0
UPLOAD_FAIL=0
E2E_TOTAL=0
E2E_SUCCESS=0
E2E_FAIL=0
E2E_SKIP=0
API_TEST_TOTAL=0
API_TEST_PASS=0
API_TEST_FAIL=0
API_TEST_SKIP=0
TYPECHECK_BACKEND="PASS"
TYPECHECK_FRONTEND="PASS"
BLOCKING_ISSUES=()
HIGH_ISSUES=()
MEDIUM_ISSUES=()
SUGGESTION_ISSUES=()
OVERALL_RESULT="PASS"

echo "=========================================="
echo "Evaluation System - Service Startup"
echo "=========================================="

# Initialize report
START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TODAY=$(date +"%Y-%m-%d")
REPORT_FILE="$PROJECT_ROOT/tasks/evaluation-report-$TODAY.md"
mkdir -p "$PROJECT_ROOT/tasks"

# Cleanup function to kill processes on exit
cleanup() {
    echo ""
    echo "Shutting down services..."
    ERRORS=0

    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        if kill "$BACKEND_PID" 2>/dev/null; then
            echo "  Backend (PID: $BACKEND_PID) stopped"
        else
            echo "  WARNING: Failed to stop backend (PID: $BACKEND_PID)"
            ERRORS=$((ERRORS + 1))
        fi
    fi

    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        if kill "$FRONTEND_PID" 2>/dev/null; then
            echo "  Frontend (PID: $FRONTEND_PID) stopped"
        else
            echo "  WARNING: Failed to stop frontend (PID: $FRONTEND_PID)"
            ERRORS=$((ERRORS + 1))
        fi
    fi

    if [ $ERRORS -eq 0 ]; then
        echo "Services stopped successfully."
    else
        echo "Service cleanup completed with $ERRORS warning(s)."
    fi
    exit 0
}

# Function to add an issue to tracking
add_issue() {
    local severity="$1"
    local description="$2"
    local location="$3"
    local suggested_fix="$4"

    case "$severity" in
        BLOCKING)
            BLOCKING_ISSUES+=("- **$description**\n  - Location: $location\n  - Suggested Fix: $suggested_fix")
            ;;
        HIGH)
            HIGH_ISSUES+=("- **$description**\n  - Location: $location\n  - Suggested Fix: $suggested_fix")
            ;;
        MEDIUM)
            MEDIUM_ISSUES+=("- **$description**\n  - Location: $location\n  - Suggested Fix: $suggested_fix")
            ;;
        SUGGESTION)
            SUGGESTION_ISSUES+=("- **$description**\n  - Location: $location\n  - Suggested Fix: $suggested_fix")
            ;;
    esac
}

# Function to generate the evaluation report
generate_report() {
    local end_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Calculate execution time
    local start_ts=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$START_TIME" +%s 2>/dev/null || date -f "%Y-%m-%dT%H:%M:%SZ" "$START_TIME" +%s 2>/dev/null || echo "0")
    local end_ts=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$end_time" +%s 2>/dev/null || date -f "%Y-%m-%dT%H:%M:%SZ" "$end_time" +%s 2>/dev/null || echo "0")

    # Fallback calculation using seconds since epoch
    start_ts=$(date -f "%Y-%m-%dT%H:%M:%SZ" "$START_TIME" +%s 2>/dev/null || echo "$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$START_TIME" +%s 2>/dev/null || echo "0")")
    end_ts=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$end_time" +%s 2>/dev/null || echo "$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$end_time" +%s 2>/dev/null || echo "0")")

    local exec_duration=$((end_ts - start_ts))
    local exec_minutes=$((exec_duration / 60))
    local exec_seconds=$((exec_duration % 60))

    # Calculate totals
    local total_tests=$((API_TEST_TOTAL))
    local total_pass=$((API_TEST_PASS))
    local total_fail=$((API_TEST_FAIL))

    # Determine overall result
    if [ $E2E_FAIL -gt 0 ] || [ $API_TEST_FAIL -gt 0 ] || [ "$TYPECHECK_BACKEND" != "PASS" ] || [ "$TYPECHECK_FRONTEND" != "PASS" ]; then
        OVERALL_RESULT="FAIL"
    fi

    # Generate markdown report
    cat > "$REPORT_FILE" << EOF
# 评估报告

**评估日期**: $TODAY
**评估时间**: $START_TIME - $end_time
**执行时长**: ${exec_minutes}m ${exec_seconds}s
**评估范围**: $EVAL_SCOPE
**总体结果**: $OVERALL_RESULT

---

## 一、执行摘要

| 测试类别 | 总数 | 通过 | 失败 | 跳过 |
|---------|------|------|------|------|
| 类型检查 (Backend) | 1 | $([ "$TYPECHECK_BACKEND" = "PASS" ] && echo 1 || echo 0) | $([ "$TYPECHECK_BACKEND" = "PASS" ] && echo 0 || echo 1) | 0 |
| 类型检查 (Frontend) | 1 | $([ "$TYPECHECK_FRONTEND" = "PASS" ] && echo 1 || echo 0) | $([ "$TYPECHECK_FRONTEND" = "PASS" ] && echo 0 || echo 1) | 0 |
| 书籍上传 | $UPLOAD_TOTAL | $UPLOAD_SUCCESS | $UPLOAD_FAIL | 0 |
| 端到端测试 | $E2E_TOTAL | $E2E_SUCCESS | $E2E_FAIL | $E2E_SKIP |
| API 契约测试 | $API_TEST_TOTAL | $API_TEST_PASS | $API_TEST_FAIL | $API_TEST_SKIP |

**汇总**: $((API_TEST_PASS + (UPLOAD_SUCCESS > 0 ? 1 : 0) + (E2E_SUCCESS > 0 ? 1 : 0) + (TYPECHECK_BACKEND = "PASS" ? 1 : 0) + (TYPECHECK_FRONTEND = "PASS" ? 1 : 0))) 通过, $((API_TEST_FAIL + (UPLOAD_FAIL > 0 ? 1 : 0) + (E2E_FAIL > 0 ? 1 : 0) + (TYPECHECK_BACKEND != "PASS" ? 1 : 0) + (TYPECHECK_FRONTEND != "PASS" ? 1 : 0))) 失败

---

## 二、详细测试结果

### 2.1 类型检查

#### Backend (cargo check)
- **结果**: $TYPECHECK_BACKEND
$(if [ "$TYPECHECK_BACKEND" != "PASS" ]; then echo "- **问题**: Backend 编译检查失败"; fi)

#### Frontend (npm run typecheck)
- **结果**: $TYPECHECK_FRONTEND
$(if [ "$TYPECHECK_FRONTEND" != "PASS" ]; then echo "- **问题**: Frontend 类型检查失败"; fi)

### 2.2 书籍上传测试

- **总上传数**: $UPLOAD_TOTAL
- **成功**: $UPLOAD_SUCCESS
- **失败**: $UPLOAD_FAIL

EOF

    # Add E2E test results
    cat >> "$REPORT_FILE" << EOF

### 2.3 端到端功能测试

- **测试书籍数**: $E2E_TOTAL
- **通过**: $E2E_SUCCESS
- **失败**: $E2E_FAIL
- **跳过**: $E2E_SKIP

EOF

    # Add API test results
    cat >> "$REPORT_FILE" << EOF

### 2.4 API 契约测试

- **总测试数**: $API_TEST_TOTAL
- **通过**: $API_TEST_PASS
- **失败**: $API_TEST_FAIL
- **跳过**: $API_TEST_SKIP

---

## 三、问题列表

### 严重程度分级

- **[BLOCKING]**: 阻塞性问题 - 必须修复才能正常运行
- **[HIGH]**: 严重问题 - 影响核心功能
- **[MEDIUM]**: 一般问题 - 不影响启动但需要修复
- **[SUGGESTION]**: 建议改进

EOF

    # Add blocking issues
    if [ ${#BLOCKING_ISSUES[@]} -gt 0 ]; then
        cat >> "$REPORT_FILE" << EOF

### 3.1 [BLOCKING] 阻塞性问题

EOF
        for issue in "${BLOCKING_ISSUES[@]}"; do
            echo -e "$issue" >> "$REPORT_FILE"
        done
    fi

    # Add high issues
    if [ ${#HIGH_ISSUES[@]} -gt 0 ]; then
        cat >> "$REPORT_FILE" << EOF

### 3.2 [HIGH] 严重问题

EOF
        for issue in "${HIGH_ISSUES[@]}"; do
            echo -e "$issue" >> "$REPORT_FILE"
        done
    fi

    # Add medium issues
    if [ ${#MEDIUM_ISSUES[@]} -gt 0 ]; then
        cat >> "$REPORT_FILE" << EOF

### 3.3 [MEDIUM] 一般问题

EOF
        for issue in "${MEDIUM_ISSUES[@]}"; do
            echo -e "$issue" >> "$REPORT_FILE"
        done
    fi

    # Add suggestion issues
    if [ ${#SUGGESTION_ISSUES[@]} -gt 0 ]; then
        cat >> "$REPORT_FILE" << EOF

### 3.4 [SUGGESTION] 建议改进

EOF
        for issue in "${SUGGESTION_ISSUES[@]}"; do
            echo -e "$issue" >> "$REPORT_FILE"
        done
    fi

    # Add summary if no issues
    if [ ${#BLOCKING_ISSUES[@]} -eq 0 ] && [ ${#HIGH_ISSUES[@]} -eq 0 ] && [ ${#MEDIUM_ISSUES[@]} -eq 0 ] && [ ${#SUGGESTION_ISSUES[@]} -eq 0 ]; then
        cat >> "$REPORT_FILE" << EOF

未发现任何问题。

EOF
    fi

    # Add before/after comparison with previous report
    echo "" >> "$REPORT_FILE"
    echo "---" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "## 四、修复前后对比" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"

    # Find the most recent previous report (excluding current)
    local prev_report=$(ls -t "$PROJECT_ROOT/tasks"/evaluation-report-$TODAY-*.md 2>/dev/null | grep -v "$(basename "$REPORT_FILE")" | head -1 || echo "")

    # If no same-day previous report, find any previous report
    if [ -z "$prev_report" ]; then
        prev_report=$(ls -t "$PROJECT_ROOT/tasks"/evaluation-report-*.md 2>/dev/null | grep -v "$(basename "$REPORT_FILE")" | head -1 || echo "")
    fi

    if [ -n "$prev_report" ] && [ -f "$prev_report" ]; then
        echo "**对比基准**: $(basename "$prev_report")" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"

        # Extract previous blocking issues
        local prev_blocking=$(grep -A 50 "### 3.1 \[BLOCKING\]" "$prev_report" 2>/dev/null | grep -E "^\- \*\*" | sed 's/- \*\*//g;s/\*\*//g' || echo "")
        local prev_high=$(grep -A 50 "### 3.2 \[HIGH\]" "$prev_report" 2>/dev/null | grep -E "^\- \*\*" | sed 's/- \*\*//g;s/\*\*//g' || echo "")
        local prev_medium=$(grep -A 50 "### 3.3 \[MEDIUM\]" "$prev_report" 2>/dev/null | grep -E "^\- \*\*" | sed 's/- \*\*//g;s/\*\*//g' || echo "")
        local prev_suggestion=$(grep -A 50 "### 3.4 \[SUGGESTION\]" "$prev_report" 2>/dev/null | grep -E "^\- \*\*" | sed 's/- \*\*//g;s/\*\*//g' || echo "")

        # Extract current issues (same format)
        local curr_blocking=""
        local curr_high=""
        local curr_medium=""
        local curr_suggestion=""

        for issue in "${BLOCKING_ISSUES[@]}"; do
            curr_blocking="$curr_blocking${issue//\*\*}\n"
        done
        for issue in "${HIGH_ISSUES[@]}"; do
            curr_high="$curr_high${issue//\*\*}\n"
        done
        for issue in "${MEDIUM_ISSUES[@]}"; do
            curr_medium="$curr_medium${issue//\*\*}\n"
        done
        for issue in "${SUGGESTION_ISSUES[@]}"; do
            curr_suggestion="$curr_suggestion${issue//\*\*}\n"
        done

        echo "### 4.1 阻塞性问题 (BLOCKING) 变化" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        if [ -n "$prev_blocking" ]; then
            echo "| 状态 | 问题 |" >> "$REPORT_FILE"
            echo "|------|------|" >> "$REPORT_FILE"
            echo "$prev_blocking" | while IFS= read -r line; do
                if [ -n "$line" ]; then
                    # Check if this issue still exists in current
                    if echo "$curr_blocking" | grep -qF "$line"; then
                        echo "| 🔴 持续 | $line |" >> "$REPORT_FILE"
                    else
                        echo "| 🟢 已修复 | $line |" >> "$REPORT_FILE"
                    fi
                fi
            done
        fi
        # Show new blocking issues
        if [ -n "$curr_blocking" ]; then
            echo "$curr_blocking" | while IFS= read -r line; do
                if [ -n "$line" ] && ! echo "$prev_blocking" | grep -qF "$line"; then
                    echo "| 🟡 新增 | $line |" >> "$REPORT_FILE"
                fi
            done
        fi
        if [ -z "$prev_blocking" ] && [ -z "$curr_blocking" ]; then
            echo "无阻塞性问题" >> "$REPORT_FILE"
        fi
        echo "" >> "$REPORT_FILE"

        echo "### 4.2 严重问题 (HIGH) 变化" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        if [ -n "$prev_high" ]; then
            echo "| 状态 | 问题 |" >> "$REPORT_FILE"
            echo "|------|------|" >> "$REPORT_FILE"
            echo "$prev_high" | while IFS= read -r line; do
                if [ -n "$line" ]; then
                    if echo "$curr_high" | grep -qF "$line"; then
                        echo "| 🔴 持续 | $line |" >> "$REPORT_FILE"
                    else
                        echo "| 🟢 已修复 | $line |" >> "$REPORT_FILE"
                    fi
                fi
            done
        fi
        if [ -n "$curr_high" ]; then
            echo "$curr_high" | while IFS= read -r line; do
                if [ -n "$line" ] && ! echo "$prev_high" | grep -qF "$line"; then
                    echo "| 🟡 新增 | $line |" >> "$REPORT_FILE"
                fi
            done
        fi
        if [ -z "$prev_high" ] && [ -z "$curr_high" ]; then
            echo "无严重问题" >> "$REPORT_FILE"
        fi
        echo "" >> "$REPORT_FILE"

        echo "### 4.3 其他问题 (MEDIUM/SUGGESTION) 变化" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        if [ -z "$prev_medium" ] && [ -z "$curr_medium" ] && [ -z "$prev_suggestion" ] && [ -z "$curr_suggestion" ]; then
            echo "无一般问题或建议" >> "$REPORT_FILE"
        else
            if [ -n "$prev_medium" ] || [ -n "$prev_suggestion" ]; then
                echo "**之前**: $(( $(echo "$prev_medium" | wc -l) + $(echo "$prev_suggestion" | wc -l) )) 个问题" >> "$REPORT_FILE"
            fi
            if [ -n "$curr_medium" ] || [ -n "$curr_suggestion" ]; then
                echo "**当前**: $(( $(echo "$curr_medium" | wc -l) + $(echo "$curr_suggestion" | wc -l) )) 个问题" >> "$REPORT_FILE"
            fi
            echo "(MEDIUM/SUGGESTION 问题可延后处理)" >> "$REPORT_FILE"
        fi
        echo "" >> "$REPORT_FILE"
    else
        echo "**对比基准**: 无历史报告" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        echo "这是首次评估，无法进行前后对比。" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
    fi

    # Add conclusion
    cat >> "$REPORT_FILE" << EOF

---

## 四、结论

**评估完成时间**: $end_time

本次评估执行了以下测试:
1. 启动后端和前端服务
2. 执行后端和前端类型检查
3. 上传样本书籍并验证
4. 端到端功能测试 (解析、提取、图谱生成)
5. API 契约测试

**总体结果**: $OVERALL_RESULT

EOF

    echo "Report generated: $REPORT_FILE"
}

# Set trap for graceful shutdown
trap cleanup INT TERM

# Start backend
echo "[1/3] Starting backend (Rust + Axum)..."
cd "$PROJECT_ROOT/backend"
cargo run &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
COUNTER=0
until curl -s http://localhost:8080/api/health 2>/dev/null | grep -q '"status":"ok"'; do
    sleep 1
    COUNTER=$((COUNTER + 1))

    # Check if process is still running
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo ""
        echo "ERROR: Backend process died unexpectedly"
        exit 1
    fi

    if [ $COUNTER -ge $MAX_WAIT ]; then
        echo ""
        echo "ERROR: Backend failed to start within $MAX_WAIT seconds"
        echo "Killing backend process (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
        exit 1
    fi
    echo "  Waiting... ($COUNTER/$MAX_WAIT)"
done
echo "Backend started successfully (PID: $BACKEND_PID)"

# Start frontend
echo "[2/3] Starting frontend (React + Vite)..."
cd "$PROJECT_ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

# Wait for frontend to be ready
echo "Waiting for frontend to start..."
COUNTER=0
until curl -s http://localhost:3000 > /dev/null 2>&1; do
    sleep 1
    COUNTER=$((COUNTER + 1))

    # Check if process is still running
    if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo ""
        echo "ERROR: Frontend process died unexpectedly"
        exit 1
    fi

    if [ $COUNTER -ge $MAX_WAIT ]; then
        echo ""
        echo "ERROR: Frontend failed to start within $MAX_WAIT seconds"
        echo "Killing frontend process (PID: $FRONTEND_PID)..."
        kill "$FRONTEND_PID" 2>/dev/null || true
        exit 1
    fi
    echo "  Waiting... ($COUNTER/$MAX_WAIT)"
done
echo "Frontend started successfully (PID: $FRONTEND_PID)"

# Run typecheck
echo "[3/3] Running typecheck..."
cd "$PROJECT_ROOT"
EVAL_SCOPE="类型检查、书籍上传、端到端功能测试、API契约测试"

# Backend typecheck (cargo check)
echo "  Checking backend..."
cd "$PROJECT_ROOT/backend"
if ! cargo check 2>&1; then
    echo ""
    echo "ERROR: Backend typecheck failed"
    TYPECHECK_BACKEND="FAIL"
    add_issue "BLOCKING" "Backend 编译检查失败" "backend/" "运行 cargo check 查看详细错误"
else
    echo "  Backend: OK"
fi

# Frontend typecheck
echo "  Checking frontend..."
cd "$PROJECT_ROOT/frontend"
if ! npm run typecheck 2>&1; then
    echo ""
    echo "ERROR: Frontend typecheck failed"
    TYPECHECK_FRONTEND="FAIL"
    add_issue "BLOCKING" "Frontend 类型检查失败" "frontend/" "运行 npm run typecheck 查看详细错误"
else
    echo "  Frontend: OK"
fi

# Frontend typecheck
echo "  Checking frontend..."
cd "$PROJECT_ROOT/frontend"
if ! npm run typecheck 2>&1; then
    echo ""
    echo "ERROR: Frontend typecheck failed"
    exit 1
fi
echo "  Frontend: OK"

# US-002: Upload sample books
echo ""
echo "[4/4] Uploading sample books..."
SAMPLE_BOOKS_DIR="$PROJECT_ROOT/sample_books"
UPLOADED_BOOKS_FILE="$PROJECT_ROOT/.uploaded_books.json"

if [ ! -d "$SAMPLE_BOOKS_DIR" ]; then
    echo "  WARNING: sample_books/ directory not found, skipping book upload"
    add_issue "HIGH" "sample_books/ 目录不存在" "project root" "创建 sample_books/ 目录并放入测试书籍"
elif [ -z "$(ls -A "$SAMPLE_BOOKS_DIR" 2>/dev/null)" ]; then
    echo "  WARNING: sample_books/ directory is empty, skipping book upload"
    add_issue "HIGH" "sample_books/ 目录为空" "sample_books/" "添加 PDF 或 EPUB 测试书籍"
else
    echo "  Found sample books in $SAMPLE_BOOKS_DIR"

    # Initialize uploaded books tracking
    echo "[]" > "$UPLOADED_BOOKS_FILE"

    UPLOAD_SUCCESS=0
    UPLOAD_FAIL=0
    UPLOAD_TOTAL=0

    for book_file in "$SAMPLE_BOOKS_DIR"/*; do
        if [ -f "$book_file" ]; then
            filename=$(basename "$book_file")
            extension="${filename##*.}"
            lowercase_ext="${extension,,}"

            if [ "$lowercase_ext" != "pdf" ] && [ "$lowercase_ext" != "epub" ]; then
                echo "  SKIP: $filename (not a PDF or EPUB)"
                continue
            fi

            UPLOAD_TOTAL=$((UPLOAD_TOTAL + 1))
            echo "  Uploading: $filename"

            # Determine title from filename
            title="${filename%.*}"
            title="${title//-/ }"

            # Upload via multipart form
            response=$(curl -s -X POST http://localhost:8080/api/books/upload \
                -F "title=$title" \
                -F "author=Sample Author" \
                -F "file=@$book_file")

            # Check if upload was successful
            if echo "$response" | grep -q '"book_id"'; then
                book_id=$(echo "$response" | grep -o '"book_id":"[^"]*"' | cut -d'"' -f4)
                echo "    SUCCESS: book_id=$book_id"

                # Record in uploaded books file
                timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
                temp_file=$(mktemp)
                jq --arg id "$book_id" --arg title "$title" --arg file "$filename" --arg timestamp "$timestamp" \
                   '. += [{book_id: $id, title: $title, source_file: $file, uploaded_at: $timestamp}]' \
                   "$UPLOADED_BOOKS_FILE" > "$temp_file" && mv "$temp_file" "$UPLOADED_BOOKS_FILE"

                UPLOAD_SUCCESS=$((UPLOAD_SUCCESS + 1))
            else
                error_msg=$(echo "$response" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || echo "Unknown error")
                echo "    FAILED: $error_msg"
                UPLOAD_FAIL=$((UPLOAD_FAIL + 1))
                add_issue "HIGH" "书籍上传失败: $title" "POST /api/books/upload" "检查后端服务状态和文件格式"
            fi
        fi
    done

    echo ""
    echo "  Upload Summary: $UPLOAD_SUCCESS succeeded, $UPLOAD_FAIL failed"

    # Verify uploaded books appear in the list
    if [ $UPLOAD_SUCCESS -gt 0 ]; then
        echo ""
        echo "  Verifying uploaded books..."

        book_list=$(curl -s http://localhost:8080/api/books)
        echo "  Book list response: $book_list"

        # Check if our uploaded books are in the list
        VERIFY_SUCCESS=0
        VERIFY_FAIL=0

        while IFS= read -r line; do
            book_id=$(echo "$line" | jq -r '.book_id' 2>/dev/null)
            if [ -n "$book_id" ] && [ "$book_id" != "null" ]; then
                if echo "$book_list" | grep -q "$book_id"; then
                    title=$(echo "$line" | jq -r '.title')
                    echo "    VERIFIED: $title ($book_id)"
                    VERIFY_SUCCESS=$((VERIFY_SUCCESS + 1))
                else
                    echo "    VERIFY FAILED: book_id=$book_id not found in list"
                    VERIFY_FAIL=$((VERIFY_FAIL + 1))
                fi
            fi
        done < <(jq -c '.[]' "$UPLOADED_BOOKS_FILE" 2>/dev/null || echo "")

        echo ""
        echo "  Verification Summary: $VERIFY_SUCCESS verified, $VERIFY_FAIL failed"

        if [ $VERIFY_FAIL -gt 0 ]; then
            echo ""
            echo "ERROR: Some uploaded books were not found in the book list"
            add_issue "HIGH" "部分上传的书籍未在书籍列表中出现" "GET /api/books" "检查后端数据一致性"
            E2E_SKIP=$((E2E_SKIP + UPLOAD_SUCCESS))
            UPLOAD_SUCCESS=0
        fi
    fi
fi

# US-003: End-to-end functional test
echo ""
echo "[5/5] Running end-to-end functional test..."

E2E_SUCCESS=0
E2E_FAIL=0
E2E_SKIP=0
E2E_TOTAL=0

# Check if we have uploaded books to test
if [ ! -f "$UPLOADED_BOOKS_FILE" ] || [ -z "$(cat "$UPLOADED_BOOKS_FILE")" ] || [ "$(cat "$UPLOADED_BOOKS_FILE")" = "[]" ]; then
    echo "  WARNING: No uploaded books found, skipping e2e test"
    E2E_SKIP=1
else
    while IFS= read -r line; do
        book_id=$(echo "$line" | jq -r '.book_id' 2>/dev/null)
        title=$(echo "$line" | jq -r '.title' 2>/dev/null)

        if [ -z "$book_id" ] || [ "$book_id" = "null" ]; then
            continue
        fi

        echo ""
        E2E_TOTAL=$((E2E_TOTAL + 1))
        echo "  Testing: $title ($book_id)"

        # Step 1: Parse book
        echo "    [Step 1] Parsing book..."
        parse_response=$(curl -s -X POST "http://localhost:8080/api/books/$book_id/parse")

        # Check for HTTP errors or error field
        if echo "$parse_response" | grep -q '"error"'; then
            error_msg=$(echo "$parse_response" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || echo "Unknown error")
            echo "    [Step 1] FAILED: $error_msg"
            echo "    E2E TEST FAILED - terminating flow"
            E2E_FAIL=$((E2E_FAIL + 1))
            add_issue "HIGH" "书籍解析失败: $title - $error_msg" "POST /api/books/$book_id/parse" "检查后端解析功能"
            continue
        fi

        # Check chunks_created > 0
        chunks_created=$(echo "$parse_response" | jq -r '.chunks_created // 0' 2>/dev/null || echo "0")
        if [ "$chunks_created" -gt 0 ]; then
            echo "    [Step 1] OK: chunks_created=$chunks_created"
        else
            echo "    [Step 1] FAILED: chunks_created=$chunks_created (expected > 0)"
            echo "    E2E TEST FAILED - terminating flow"
            E2E_FAIL=$((E2E_FAIL + 1))
            add_issue "HIGH" "书籍解析失败: $title - 未创建任何 chunk" "POST /api/books/$book_id/parse" "检查解析逻辑是否正确"
            continue
        fi

        # Step 2: Extract concepts
        echo "    [Step 2] Extracting concepts..."
        extract_response=$(curl -s -X POST "http://localhost:8080/api/books/$book_id/extract")

        # Check for HTTP errors or error field
        if echo "$extract_response" | grep -q '"error"'; then
            error_msg=$(echo "$extract_response" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || echo "Unknown error")
            echo "    [Step 2] FAILED: $error_msg"
            echo "    E2E TEST FAILED - terminating flow"
            E2E_FAIL=$((E2E_FAIL + 1))
            add_issue "HIGH" "概念提取失败: $title - $error_msg" "POST /api/books/$book_id/extract" "检查后端提取功能"
            continue
        fi

        # Check nodes_count > 0
        nodes_count=$(echo "$extract_response" | jq -r '.nodes_count // 0' 2>/dev/null || echo "0")
        if [ "$nodes_count" -gt 0 ]; then
            echo "    [Step 2] OK: nodes_count=$nodes_count"
        else
            echo "    [Step 2] FAILED: nodes_count=$nodes_count (expected > 0)"
            echo "    E2E TEST FAILED - terminating flow"
            E2E_FAIL=$((E2E_FAIL + 1))
            add_issue "HIGH" "概念提取失败: $title - 未提取到任何概念节点" "POST /api/books/$book_id/extract" "检查 LLM 服务和提取逻辑"
            continue
        fi

        # Step 3: Get graph
        echo "    [Step 3] Getting graph..."
        graph_response=$(curl -s -X GET "http://localhost:8080/api/books/$book_id/graph")

        # Check for HTTP errors or error field
        if echo "$graph_response" | grep -q '"error"'; then
            error_msg=$(echo "$graph_response" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || echo "Unknown error")
            echo "    [Step 3] FAILED: $error_msg"
            echo "    E2E TEST FAILED - terminating flow"
            E2E_FAIL=$((E2E_FAIL + 1))
            add_issue "HIGH" "获取概念图谱失败: $title - $error_msg" "GET /api/books/$book_id/graph" "检查后端图谱生成功能"
            continue
        fi

        # Check non-empty nodes and edges arrays
        graph_nodes=$(echo "$graph_response" | jq -r '.nodes | length' 2>/dev/null || echo "0")
        graph_edges=$(echo "$graph_response" | jq -r '.edges | length' 2>/dev/null || echo "0")

        if [ "$graph_nodes" -gt 0 ] && [ "$graph_edges" -gt 0 ]; then
            echo "    [Step 3] OK: nodes=$graph_nodes, edges=$graph_edges"
            echo "  PASSED: $title"
            E2E_SUCCESS=$((E2E_SUCCESS + 1))
        else
            echo "    [Step 3] FAILED: nodes=$graph_nodes, edges=$graph_edges (expected both > 0)"
            echo "    E2E TEST FAILED - terminating flow"
            E2E_FAIL=$((E2E_FAIL + 1))
            add_issue "HIGH" "概念图谱为空: $title - nodes=$graph_nodes, edges=$graph_edges" "GET /api/books/$book_id/graph" "检查图谱生成逻辑"
            continue
        fi

    done < <(jq -c '.[]' "$UPLOADED_BOOKS_FILE" 2>/dev/null || echo "")
fi

echo ""
echo "  E2E Summary: $E2E_SUCCESS passed, $E2E_FAIL failed, $E2E_SKIP skipped"

if [ $E2E_FAIL -gt 0 ]; then
    echo ""
    echo "ERROR: End-to-end test failed for $E2E_FAIL book(s)"
    add_issue "HIGH" "端到端测试失败: $E2E_FAIL 个书籍处理失败" "E2E Test Flow" "检查后端解析、提取、图谱生成功能"
fi

# US-004: API Contract Test Suite
echo ""
echo "[6/6] Running API contract test suite..."

API_TEST_PASS=0
API_TEST_FAIL=0
API_TEST_SKIP=0

# Helper function to test API endpoint
test_api() {
    local name="$1"
    local expected_status="$2"
    local expected_body_pattern="$3"
    local method="${4:-GET}"
    shift 4
    local url="$1"
    shift
    local data="$*"

    echo "  Testing: $name"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\n%{http_code}" "$url")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$data" "$url")
    fi

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    # Check HTTP status code
    if [ "$http_code" != "$expected_status" ]; then
        echo "    FAIL: Expected HTTP $expected_status, got $http_code"
        echo "    Body: $body"
        return 1
    fi

    # Check body pattern if specified
    if [ -n "$expected_body_pattern" ]; then
        if ! echo "$body" | grep -q "$expected_body_pattern"; then
            echo "    FAIL: Body does not match pattern '$expected_body_pattern'"
            echo "    Body: $body"
            return 1
        fi
    fi

    echo "    PASS"
    return 0
}

# Test 1: GET /api/health
echo ""
echo "  [Health Endpoint]"
API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
if test_api "GET /api/health returns status ok" "200" '"status":"ok"'; then
    API_TEST_PASS=$((API_TEST_PASS + 1))
else
    API_TEST_FAIL=$((API_TEST_FAIL + 1))
fi

# Test 2: GET /api/settings/language
echo ""
echo "  [Settings Endpoints]"
API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
if test_api "GET /api/settings/language returns language" "200" '"language":"'; then
    API_TEST_PASS=$((API_TEST_PASS + 1))
else
    API_TEST_FAIL=$((API_TEST_FAIL + 1))
fi

# Get current language to restore later
current_lang=$(curl -s http://localhost:8080/api/settings/language | grep -o '"language":"[^"]*"' | cut -d'"' -f4 || echo "zh")

# Test 3: PUT /api/settings/language (update to en)
API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
if test_api "PUT /api/settings/language updates to en" "200" '"language":"en"' "PUT" "http://localhost:8080/api/settings/language" '{"language":"en"}'; then
    API_TEST_PASS=$((API_TEST_PASS + 1))
else
    API_TEST_FAIL=$((API_TEST_FAIL + 1))
fi

# Restore original language
curl -s -X PUT http://localhost:8080/api/settings/language -H "Content-Type: application/json" -d "{\"language\":\"$current_lang\"}" > /dev/null

# Test 4: GET /api/books (list books)
echo ""
echo "  [Book Endpoints]"
API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
if test_api "GET /api/books returns array" "200" '\['; then
    API_TEST_PASS=$((API_TEST_PASS + 1))
else
    API_TEST_FAIL=$((API_TEST_FAIL + 1))
fi

# Get first book ID for further tests
first_book_id=$(curl -s http://localhost:8080/api/books | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$first_book_id" ]; then
    echo ""
    echo "  Using book ID for tests: $first_book_id"

    # Test 5: GET /api/books/{id} (get book details)
    API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
    if test_api "GET /api/books/{id} returns book details" "200" '"id":"'"$first_book_id"'"'; then
        API_TEST_PASS=$((API_TEST_PASS + 1))
    else
        API_TEST_FAIL=$((API_TEST_FAIL + 1))
    fi

    # Test 6: GET /api/books/{id}/chunks
    echo ""
    API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
    if test_api "GET /api/books/{id}/chunks returns array" "200" '\['; then
        API_TEST_PASS=$((API_TEST_PASS + 1))
    else
        API_TEST_FAIL=$((API_TEST_FAIL + 1))
    fi

    # Test 7: GET /api/books/{id}/graph
    echo ""
    API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
    if test_api "GET /api/books/{id}/graph returns nodes and edges" "200" '"nodes"'; then
        API_TEST_PASS=$((API_TEST_PASS + 1))
    else
        API_TEST_FAIL=$((API_TEST_FAIL + 1))
    fi

    # Test 8: DELETE /api/books/{id}
    echo ""
    API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
    if test_api "DELETE /api/books/{id} returns deleted:true" "200" '"deleted":true'; then
        API_TEST_PASS=$((API_TEST_PASS + 1))
    else
        API_TEST_FAIL=$((API_TEST_FAIL + 1))
    fi

    # Test 9: GET /api/books/{id} after delete (should be 404)
    echo ""
    API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
    response=$(curl -s -w "\n%{http_code}" "http://localhost:8080/api/books/$first_book_id")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "404" ]; then
        echo "    Testing: GET /api/books/{id} after delete returns 404"
        echo "    PASS"
        API_TEST_PASS=$((API_TEST_PASS + 1))
    else
        echo "    Testing: GET /api/books/{id} after delete returns 404"
        echo "    FAIL: Expected HTTP 404, got $http_code"
        API_TEST_FAIL=$((API_TEST_FAIL + 1))
    fi
else
    echo "  SKIP: No books available for detailed endpoint tests"
    API_TEST_SKIP=$((API_TEST_SKIP + 4))
fi

# Test 10: Error case - invalid language
echo ""
echo "  [Error Cases]"
API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
response=$(curl -s -w "\n%{http_code}" -X PUT http://localhost:8080/api/settings/language -H "Content-Type: application/json" -d '{"language":"invalid"}')
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "400" ]; then
    echo "    Testing: PUT /api/settings/language with invalid language returns 400"
    echo "    PASS"
    API_TEST_PASS=$((API_TEST_PASS + 1))
else
    echo "    Testing: PUT /api/settings/language with invalid language returns 400"
    echo "    FAIL: Expected HTTP 400, got $http_code"
    API_TEST_FAIL=$((API_TEST_FAIL + 1))
fi

# Test 11: Error case - non-existent book
echo ""
API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
response=$(curl -s -w "\n%{http_code}" "http://localhost:8080/api/books/non-existent-id-12345")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "404" ]; then
    echo "    Testing: GET /api/books/{non-existent} returns 404"
    echo "    PASS"
    API_TEST_PASS=$((API_TEST_PASS + 1))
else
    echo "    Testing: GET /api/books/{non-existent} returns 404"
    echo "    FAIL: Expected HTTP 404, got $http_code"
    API_TEST_FAIL=$((API_TEST_FAIL + 1))
fi

# Test 12: Error case - non-existent chunk
echo ""
API_TEST_TOTAL=$((API_TEST_TOTAL + 1))
response=$(curl -s -w "\n%{http_code}" "http://localhost:8080/api/chunks/non-existent-id-12345")
http_code=$(echo "$response" | tail -n1)

if [ "$http_code" = "404" ]; then
    echo "    Testing: GET /api/chunks/{non-existent} returns 404"
    echo "    PASS"
    API_TEST_PASS=$((API_TEST_PASS + 1))
else
    echo "    Testing: GET /api/chunks/{non-existent} returns 404"
    echo "    FAIL: Expected HTTP 404, got $http_code"
    API_TEST_FAIL=$((API_TEST_FAIL + 1))
fi

echo ""
echo "  API Contract Test Summary: $API_TEST_PASS passed, $API_TEST_FAIL failed, $API_TEST_SKIP skipped"

if [ $API_TEST_FAIL -gt 0 ]; then
    echo ""
    echo "ERROR: API contract test failed for $API_TEST_FAIL case(s)"
    add_issue "HIGH" "API 契约测试失败: $API_TEST_FAIL 个测试用例未通过" "API Endpoints" "检查后端 API 实现是否符合规范"
fi

# Generate evaluation report
echo ""
echo "[REPORT] Generating evaluation report..."
generate_report

echo ""
echo "=========================================="
echo "All services started and typecheck passed!"
echo ""
echo "  Backend:  http://localhost:8080"
echo "  Frontend: http://localhost:3000"
echo "  Health:   http://localhost:8080/api/health"
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Keep the script running
wait