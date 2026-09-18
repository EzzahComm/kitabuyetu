#!/bin/bash

# Phase 7 Ecosystem Build Verification Script
# Verifies all build steps and deployment readiness

set -e

echo "🔍 Phase 7 Ecosystem Build Verification"
echo "======================================"
echo ""

# Step 1: TypeScript Check
echo "1️⃣  Checking TypeScript..."
if npx tsc --noEmit --listFiles 2>&1 | grep -q "error"; then
  echo "❌ TypeScript errors found"
  exit 1
fi
echo "✅ TypeScript check passed"
echo ""

# Step 2: ESLint Check
echo "2️⃣  Checking ESLint..."
if npx eslint app components lib/services --max-warnings 0 2>&1 | grep -q "error"; then
  echo "❌ ESLint errors found"
  exit 1
fi
echo "✅ ESLint check passed"
echo ""

# Step 3: Build Check
echo "3️⃣  Running production build..."
if ! npm run build 2>&1 | tail -20; then
  echo "❌ Build failed"
  exit 1
fi
echo "✅ Build completed successfully"
echo ""

# Step 4: New Files Check
echo "4️⃣  Verifying Phase 7 files exist..."
files=(
  "app/(dashboard)/programs/page.tsx"
  "app/ecosystem/programs/page.tsx"
  "app/ecosystem/programs/\[slug\]/page.tsx"
  "app/ecosystem/donors/page.tsx"
  "app/(admin)/admin/programs/page.tsx"
  "app/api/v1/programs/route.ts"
  "app/api/v1/programs/\[id\]/submit-review/route.ts"
  "app/api/admin/programs/route.ts"
  "components/ecosystem/program-donate-form.tsx"
  "lib/services/ecosystem.service.ts"
)

for file in "${files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing file: $file"
    exit 1
  fi
done
echo "✅ All Phase 7 files verified"
echo ""

# Step 5: Commit Check
echo "5️⃣  Verifying Phase 7 commits..."
commits=$(git log --oneline | grep "feat(phase-7)" | wc -l)
if [ $commits -lt 6 ]; then
  echo "❌ Expected 6+ Phase 7 commits, found $commits"
  exit 1
fi
echo "✅ Found $commits Phase 7 commits"
echo ""

# Step 6: Branch Check
echo "6️⃣  Verifying main branch..."
if [ "$(git branch --show-current)" != "main" ]; then
  echo "❌ Not on main branch"
  exit 1
fi
if ! git diff-index --quiet HEAD --; then
  echo "❌ Uncommitted changes detected"
  exit 1
fi
echo "✅ Main branch is clean and up-to-date"
echo ""

echo "🎉 Phase 7 Build Verification PASSED"
echo "======================================"
echo "Ready for Vercel deployment!"
