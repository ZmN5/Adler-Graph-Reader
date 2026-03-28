#!/bin/bash
set -e

echo "=========================================="
echo "Intelligent Reading Concept Graph"
echo "Starting services..."
echo "=========================================="

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down services..."
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    echo "Services stopped."
    exit 0
}

trap cleanup INT TERM

# Start backend
echo "[1/2] Starting backend (Rust + Axum)..."
cd "$SCRIPT_DIR"
cargo run -p backend &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
MAX_WAIT=30
COUNTER=0
until curl -s http://localhost:8080/api/health > /dev/null 2>&1; do
    sleep 1
    COUNTER=$((COUNTER + 1))
    if [ $COUNTER -ge $MAX_WAIT ]; then
        echo "ERROR: Backend failed to start within $MAX_WAIT seconds"
        exit 1
    fi
    echo "  Waiting... ($COUNTER/$MAX_WAIT)"
done
echo "Backend started successfully (PID: $BACKEND_PID)"

# Start frontend
echo "[2/2] Starting frontend (React + Vite)..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

# Wait for frontend to be ready
echo "Waiting for frontend to start..."
COUNTER=0
until curl -s http://localhost:3000 > /dev/null 2>&1; do
    sleep 1
    COUNTER=$((COUNTER + 1))
    if [ $COUNTER -ge $MAX_WAIT ]; then
        echo "ERROR: Frontend failed to start within $MAX_WAIT seconds"
        exit 1
    fi
    echo "  Waiting... ($COUNTER/$MAX_WAIT)"
done
echo "Frontend started successfully (PID: $FRONTEND_PID)"

echo ""
echo "=========================================="
echo "All services started successfully!"
echo ""
echo "  Backend:  http://localhost:8080"
echo "  Frontend: http://localhost:3000"
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Keep the script running
wait
