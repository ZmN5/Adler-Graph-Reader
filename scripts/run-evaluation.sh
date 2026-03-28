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