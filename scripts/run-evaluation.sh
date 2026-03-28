#!/bin/bash
# Evaluation Script - Service startup with health check
# Entry point for the evaluation system

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BACKEND_PID=""
FRONTEND_PID=""
MAX_WAIT=60

echo "=========================================="
echo "Evaluation System - Service Startup"
echo "=========================================="

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

# Backend typecheck (cargo check)
echo "  Checking backend..."
cd "$PROJECT_ROOT/backend"
if ! cargo check 2>&1; then
    echo ""
    echo "ERROR: Backend typecheck failed"
    exit 1
fi
echo "  Backend: OK"

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
elif [ -z "$(ls -A "$SAMPLE_BOOKS_DIR" 2>/dev/null)" ]; then
    echo "  WARNING: sample_books/ directory is empty, skipping book upload"
else
    echo "  Found sample books in $SAMPLE_BOOKS_DIR"

    # Initialize uploaded books tracking
    echo "[]" > "$UPLOADED_BOOKS_FILE"

    UPLOAD_SUCCESS=0
    UPLOAD_FAIL=0

    for book_file in "$SAMPLE_BOOKS_DIR"/*; do
        if [ -f "$book_file" ]; then
            filename=$(basename "$book_file")
            extension="${filename##*.}"
            lowercase_ext="${extension,,}"

            if [ "$lowercase_ext" != "pdf" ] && [ "$lowercase_ext" != "epub" ]; then
                echo "  SKIP: $filename (not a PDF or EPUB)"
                continue
            fi

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
            exit 1
        fi
    fi
fi

# US-003: End-to-end functional test
echo ""
echo "[5/5] Running end-to-end functional test..."

E2E_SUCCESS=0
E2E_FAIL=0
E2E_SKIP=0

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
            continue
        fi

    done < <(jq -c '.[]' "$UPLOADED_BOOKS_FILE" 2>/dev/null || echo "")
fi

echo ""
echo "  E2E Summary: $E2E_SUCCESS passed, $E2E_FAIL failed, $E2E_SKIP skipped"

if [ $E2E_FAIL -gt 0 ]; then
    echo ""
    echo "ERROR: End-to-end test failed for $E2E_FAIL book(s)"
    exit 1
fi

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