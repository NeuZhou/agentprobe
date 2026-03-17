#!/bin/bash
# AgentProbe Pre-Commit Hook
# Runs agent tests before each commit to catch regressions early.
#
# Installation:
#   cp examples/ci/pre-commit-hook.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Or with husky:
#   npx husky add .husky/pre-commit "bash examples/ci/pre-commit-hook.sh"

set -e

echo "🔬 AgentProbe: Running pre-commit checks..."

# Only run if agent test files were modified
CHANGED_YAML=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(test\.yaml|probe\.yaml)$' || true)
CHANGED_SRC=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|js)$' || true)

if [ -z "$CHANGED_YAML" ] && [ -z "$CHANGED_SRC" ]; then
  echo "✅ No agent test or source files changed, skipping."
  exit 0
fi

# Run quick tests (mock adapter only — no API calls, fast)
echo "📋 Running quick mock tests..."
if npx agentprobe run examples/quickstart/test-mock.yaml --timeout 10000 2>/dev/null; then
  echo "✅ Mock tests passed"
else
  echo "❌ Mock tests failed! Fix before committing."
  exit 1
fi

# Run security tests (critical — always check)
echo "🔒 Running security tests..."
if npx agentprobe run examples/security/ --adapter mock --timeout 30000 2>/dev/null; then
  echo "✅ Security tests passed"
else
  echo "❌ Security tests failed! Fix before committing."
  exit 1
fi

# If specific test files changed, validate their YAML
if [ -n "$CHANGED_YAML" ]; then
  echo "📝 Validating changed test files..."
  for file in $CHANGED_YAML; do
    if npx agentprobe validate "$file" 2>/dev/null; then
      echo "  ✅ $file"
    else
      echo "  ❌ $file — invalid YAML or schema"
      exit 1
    fi
  done
fi

echo ""
echo "🔬 AgentProbe pre-commit checks passed! ✅"
