#!/bin/bash
#
# k6 Load Test Runner
#
# Usage:
#   ./scripts/load-test/run.sh                           # Run all scenarios
#   ./scripts/load-test/run.sh --scenario health         # Run specific scenario
#   ./scripts/load-test/run.sh --scenario mixed --vus 50 # Custom VUs
#   ./scripts/load-test/run.sh --quick                   # Quick smoke test
#
# Environment variables:
#   API_URL   - API base URL (default: http://localhost:8882)
#   API_KEY   - API key for authenticated endpoints
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6_DIR="$SCRIPT_DIR/k6/scenarios"

# Default values
API_URL="${API_URL:-http://localhost:8882}"
API_KEY="${API_KEY:-}"
SCENARIO=""
VUS=""
DURATION=""
QUICK=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --vus)
      VUS="$2"
      shift 2
      ;;
    --duration)
      DURATION="$2"
      shift 2
      ;;
    --quick)
      QUICK=true
      shift
      ;;
    --api-url)
      API_URL="$2"
      shift 2
      ;;
    --api-key)
      API_KEY="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --scenario <name>  Run specific scenario (health, messages, chats, mixed, soak)"
      echo "  --vus <number>     Override virtual users count"
      echo "  --duration <time>  Override duration (e.g., '1m', '30s')"
      echo "  --quick            Quick smoke test (10s, 5 VUs)"
      echo "  --api-url <url>    API URL (default: http://localhost:8882)"
      echo "  --api-key <key>    API key for authenticated endpoints"
      echo "  --help             Show this help"
      echo ""
      echo "Examples:"
      echo "  $0                          # Run all scenarios"
      echo "  $0 --scenario health        # Run health endpoint test"
      echo "  $0 --quick                  # Quick smoke test"
      echo "  $0 --scenario mixed --vus 50"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
  echo "Error: k6 is not installed."
  echo ""
  echo "Install k6:"
  echo "  macOS: brew install k6"
  echo "  Linux: https://k6.io/docs/get-started/installation/#linux"
  echo "  Docker: docker run -i grafana/k6 run - <script.js"
  exit 1
fi

# Check if API is reachable
echo "Checking API at $API_URL..."
if ! curl -s -f "$API_URL/api/v2/health" > /dev/null 2>&1; then
  echo "Error: API is not reachable at $API_URL"
  echo "Make sure the API is running: pm2 status omni-v2-api"
  exit 1
fi
echo "API is responding."
echo ""

# Build k6 arguments
K6_ARGS=""
if [[ -n "$API_URL" ]]; then
  K6_ARGS="$K6_ARGS --env API_URL=$API_URL"
fi
if [[ -n "$API_KEY" ]]; then
  K6_ARGS="$K6_ARGS --env API_KEY=$API_KEY"
fi
if [[ -n "$VUS" ]]; then
  K6_ARGS="$K6_ARGS --vus $VUS"
fi
if [[ -n "$DURATION" ]]; then
  K6_ARGS="$K6_ARGS --duration $DURATION"
fi

# Quick smoke test overrides
if [[ "$QUICK" == true ]]; then
  K6_ARGS="$K6_ARGS --vus 5 --duration 10s"
  echo "Running quick smoke test (5 VUs, 10s)..."
  echo ""
fi

run_scenario() {
  local scenario=$1
  local file="$K6_DIR/$scenario.js"

  if [[ ! -f "$file" ]]; then
    echo "Error: Scenario file not found: $file"
    return 1
  fi

  echo "========================================"
  echo "Running scenario: $scenario"
  echo "========================================"
  echo ""

  k6 run $K6_ARGS "$file"
  echo ""
}

# Run scenarios
if [[ -n "$SCENARIO" ]]; then
  # Run specific scenario
  run_scenario "$SCENARIO"
else
  # Run all scenarios (except soak - it's too long)
  echo "Running all scenarios (except soak)..."
  echo ""

  for scenario in health chats messages mixed; do
    run_scenario "$scenario"
  done

  echo "========================================"
  echo "All scenarios completed!"
  echo ""
  echo "To run the soak test (30 min):"
  echo "  $0 --scenario soak"
  echo "========================================"
fi
