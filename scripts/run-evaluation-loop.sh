#!/bin/bash
# Evaluation Iteration Loop
# Runs evaluation repeatedly until no BLOCKING issues remain or max iterations reached
# Implements US-007: 迭代循环直到稳定

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVAL_SCRIPT="$SCRIPT_DIR/run-evaluation.sh"

MAX_ITERATIONS=10
MAX_WAIT_PER_ITERATION=300

ITERATION_LOG="$PROJECT_ROOT/tasks/evaluation-iterations.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Evaluation Iteration Loop"
echo "=========================================="
echo ""
echo "Project Root: $PROJECT_ROOT"
echo "Max Iterations: $MAX_ITERATIONS"
echo "Log File: $ITERATION_LOG"
echo ""

# Initialize iteration log
mkdir -p "$PROJECT_ROOT/tasks"
echo "# Evaluation Iteration Log" > "$ITERATION_LOG"
echo "# Started: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$ITERATION_LOG"
echo "" >> "$ITERATION_LOG"

# Function to check for BLOCKING issues in report
check_blocking_issues() {
    local report_file="$1"

    if [ ! -f "$report_file" ]; then
        echo "Report file not found: $report_file"
        return 1
    fi

    # Check for BLOCKING issues section
    if grep -q "### 3.1 \[BLOCKING\]" "$report_file" 2>/dev/null; then
        return 0  # BLOCKING issues found
    fi

    # Also check if overall result is FAIL with blocking mention
    if grep -q "BLOCKING" "$report_file" 2>/dev/null; then
        return 0  # BLOCKING issues found
    fi

    return 1  # No BLOCKING issues
}

# Function to extract iteration summary from report
extract_summary() {
    local report_file="$1"

    if [ ! -f "$report_file" ]; then
        echo "No report"
        return
    fi

    # Extract key info
    local date=$(grep "^\*\*评估日期\*\*:" "$report_file" | head -1 | sed 's/.*: //' || echo "Unknown")
    local duration=$(grep "^\*\*执行时长\*\*:" "$report_file" | head -1 | sed 's/.*: //' || echo "Unknown")
    local overall=$(grep "^\*\*总体结果\*\*:" "$report_file" | head -1 | sed 's/.*: //' || echo "Unknown")

    echo "Date: $date | Duration: $duration | Result: $overall"
}

# Main iteration loop
iteration=1
total_start_time=$(date +%s)

while [ $iteration -le $MAX_ITERATIONS ]; do
    echo ""
    echo "=========================================="
    echo "Iteration $iteration of $MAX_ITERATIONS"
    echo "=========================================="

    iter_start_time=$(date +%s)
    iter_start_human=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Run the evaluation script
    echo "[$iteration] Starting evaluation..."
    cd "$PROJECT_ROOT"

    # Run evaluation (this will start services, run tests, generate report)
    if bash "$EVAL_SCRIPT"; then
        echo "[$iteration] Evaluation script completed"
    else
        echo "[$iteration] Evaluation script failed or was interrupted"
    fi

    # Find the most recent report
    latest_report=$(ls -t "$PROJECT_ROOT/tasks"/evaluation-report-*.md 2>/dev/null | head -1)

    if [ -z "$latest_report" ]; then
        echo "[$iteration] ERROR: No evaluation report generated"
        echo "|$iter_start_human|ERROR|no report|N/A" >> "$ITERATION_LOG"
        iteration=$((iteration + 1))
        continue
    fi

    iter_end_time=$(date +%s)
    iter_duration=$((iter_end_time - iter_start_time))
    iter_duration_min=$((iter_duration / 60))
    iter_duration_sec=$((iter_duration % 60))

    echo ""
    echo "[$iteration] Report: $latest_report"
    echo "[$iteration] Duration: ${iter_duration_min}m ${iter_duration_sec}s"

    # Log this iteration
    blocking_count=$(grep -c "BLOCKING" "$latest_report" 2>/dev/null || echo "0")
    echo "|$iter_start_human|$latest_report|${iter_duration_min}m ${iter_duration_sec}s|blocking=$blocking_count" >> "$ITERATION_LOG"

    # Check for BLOCKING issues
    if check_blocking_issues "$latest_report"; then
        echo ""
        echo -e "${YELLOW}[$iteration] BLOCKING issues found${NC}"
        echo ""
        echo "Blocking issues from this report:"
        grep -A 20 "### 3.1 \[BLOCKING\]" "$latest_report" 2>/dev/null || grep -A 5 "BLOCKING" "$latest_report" 2>/dev/null | head -30
        echo ""

        if [ $iteration -lt $MAX_ITERATIONS ]; then
            echo -e "${YELLOW}BLOCKING issues must be fixed before continuing.${NC}"
            echo "Please fix the issues and run the evaluation again."
            echo ""
            echo "To continue the loop manually, run:"
            echo "  bash $0"
            echo ""
            break
        else
            echo -e "${RED}Max iterations reached. BLOCKING issues remain.${NC}"
            break
        fi
    else
        echo ""
        echo -e "${GREEN}[$iteration] No BLOCKING issues found!${NC}"

        # Extract and display summary
        echo ""
        echo "Evaluation Summary:"
        extract_summary "$latest_report"
        echo ""

        total_end_time=$(date +%s)
        total_duration=$((total_end_time - total_start_time))
        total_duration_min=$((total_duration / 60))
        total_duration_sec=$((total_duration % 60))

        echo ""
        echo "=========================================="
        echo -e "${GREEN}All BLOCKING issues resolved!${NC}"
        echo "=========================================="
        echo "Total Iterations: $iteration"
        echo "Total Duration: ${total_duration_min}m ${total_duration_sec}s"
        echo ""
        echo "Final Report: $latest_report"

        # Log final status
        echo "" >> "$ITERATION_LOG"
        echo "# Final Status: SUCCESS" >> "$ITERATION_LOG"
        echo "# Total Iterations: $iteration" >> "$ITERATION_LOG"
        echo "# Total Duration: ${total_duration_min}m ${total_duration_sec}s" >> "$ITERATION_LOG"
        echo "# Final Report: $latest_report" >> "$ITERATION_LOG"

        exit 0
    fi

    iteration=$((iteration + 1))
done

# If we exit the loop due to max iterations
if [ $iteration -gt $MAX_ITERATIONS ]; then
    echo ""
    echo -e "${RED}Max iterations ($MAX_ITERATIONS) reached.${NC}"
    echo "BLOCKING issues remain. Manual intervention required."
    echo ""
    echo "Final Report: $latest_report"
    echo ""

    # Log final status
    total_end_time=$(date +%s)
    total_duration=$((total_end_time - total_start_time))
    total_duration_min=$((total_duration / 60))
    total_duration_sec=$((total_duration % 60))

    echo "" >> "$ITERATION_LOG"
    echo "# Final Status: MAX_ITERATIONS_REACHED" >> "$ITERATION_LOG"
    echo "# Total Iterations: $MAX_ITERATIONS" >> "$ITERATION_LOG"
    echo "# Total Duration: ${total_duration_min}m ${total_duration_sec}s" >> "$ITERATION_LOG"
    echo "# Final Report: $latest_report" >> "$ITERATION_LOG"

    exit 1
fi

exit 0