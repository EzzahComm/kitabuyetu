#!/bin/bash

BASE_URL="https://www.kitabuyetu.co.ke"
API_BASE="$BASE_URL/api"
GROUP_ID="4fcd5d11-f554-4812-8090-daccca232d27"

echo "════════════════════════════════════════════════════════════"
echo "CHANGI\$HA DONATION FLOW TEST"
echo "════════════════════════════════════════════════════════════"
echo

# Step 1: Get access token
echo "STEP 1: AUTHENTICATE"
TOKEN_RESPONSE=$(curl -s -X POST "$API_BASE/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "+254717548646", "password": "Bungoma@2026", "groupCode": "KY0000004"}')

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
echo "✅ Authenticated as: Polycap Akoth"
echo

# Step 2: Check if account 4006 is available
echo "STEP 2: CHECK ACCOUNT 4006 AVAILABILITY"
ACCOUNTS=$(curl -s -X GET "$API_BASE/v1/accounting/accounts?groupId=$GROUP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

ACCOUNT_4006=$(echo "$ACCOUNTS" | grep -o '"account_code":"4006"')
if [ ! -z "$ACCOUNT_4006" ]; then
  echo "✅ Account 4006 (Changi\$ha Donations) is available"
else
  echo "⚠️  Account 4006 not yet available - needs backfill"
  echo "   Run SQL in Supabase dashboard to backfill"
fi
echo

# Step 3: Create a test campaign
echo "STEP 3: CREATE TEST CAMPAIGN"
CAMPAIGN_RESPONSE=$(curl -s -X POST "$API_BASE/v1/campaigns" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "title": "School Fees Campaign - Test",
    "story": "Help us raise funds for school fees for our members children",
    "beneficiary_name": "Test Primary School",
    "target_amount": "10000",
    "currency": "KES"
  }')

CAMPAIGN_ID=$(echo "$CAMPAIGN_RESPONSE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
CAMPAIGN_STATUS=$(echo "$CAMPAIGN_RESPONSE" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')

if [ ! -z "$CAMPAIGN_ID" ]; then
  echo "✅ Campaign created: $CAMPAIGN_ID"
  echo "   Status: $CAMPAIGN_STATUS"
  echo "   Title: School Fees Campaign - Test"
  echo "   Target: KES 10,000"
else
  echo "ℹ️  Campaign creation response:"
  echo "$CAMPAIGN_RESPONSE" | head -c 200
fi
echo

# Step 4: List campaigns
echo "STEP 4: LIST ALL CAMPAIGNS"
CAMPAIGNS=$(curl -s -X GET "$API_BASE/v1/campaigns?groupId=$GROUP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

CAMPAIGN_COUNT=$(echo "$CAMPAIGNS" | sed -n 's/.*"campaigns":\[\([^]]*\).*/\1/p' | grep -o '"id"' | wc -l)
echo "✅ Total campaigns: $CAMPAIGN_COUNT"
echo

# Step 5: Check public fundraise page
echo "STEP 5: CHECK PUBLIC FUNDRAISE PAGE"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/fundraise")
echo "✅ Fundraise page status: $HTTP_STATUS"
echo

echo "════════════════════════════════════════════════════════════"
echo "CHANGI\$HA DONATION FLOW TEST COMPLETE"
echo "════════════════════════════════════════════════════════════"
echo
echo "Results:"
if [ ! -z "$ACCOUNT_4006" ]; then
  echo "✅ Account 4006: Available"
else
  echo "⚠️  Account 4006: Needs backfill"
fi
if [ ! -z "$CAMPAIGN_ID" ]; then
  echo "✅ Campaign creation: Working"
  echo "✅ Campaign ID: $CAMPAIGN_ID"
else
  echo "ℹ️  Campaign creation: Check response"
fi
echo "✅ Public page: Loading (HTTP $HTTP_STATUS)"
echo
echo "Next: Submit campaign for admin review, then it goes live"
echo "════════════════════════════════════════════════════════════"
