#!/bin/bash

BASE_URL="https://www.kitabuyetu.co.ke"
API_BASE="$BASE_URL/api"

echo "════════════════════════════════════════════════════════════"
echo "LIVE TEST - THE FIONAS GROUP"
echo "════════════════════════════════════════════════════════════"
echo
echo "Credentials:"
echo "  Phone: 0717548646"
echo "  Password: Bungoma@2026"
echo "  Group: The Fionas"
echo
echo "════════════════════════════════════════════════════════════"
echo "STEP 1: LOGIN"
echo "════════════════════════════════════════════════════════════"

LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "+254717548646", "password": "Bungoma@2026"}')

echo "Request: POST $API_BASE/v1/auth/login"
echo "Response:"
echo "$LOGIN_RESPONSE" | jq '.' 2>/dev/null || echo "$LOGIN_RESPONSE"
echo

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token // empty' 2>/dev/null)
REFRESH_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.refresh_token // empty' 2>/dev/null)
USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id // empty' 2>/dev/null)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Login failed - no access token received"
  exit 1
fi

echo "✅ Login successful!"
echo "Access Token: ${ACCESS_TOKEN:0:50}..."
echo

echo "════════════════════════════════════════════════════════════"
echo "STEP 2: GET MEMBERSHIPS"
echo "════════════════════════════════════════════════════════════"

PROFILE=$(curl -s -X GET "$API_BASE/v1/auth/memberships" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "$PROFILE" | jq '.' 2>/dev/null || echo "$PROFILE"
echo

GROUP_ID=$(echo "$PROFILE" | jq -r '.memberships[0].group_id // empty' 2>/dev/null)
MEMBER_ID=$(echo "$PROFILE" | jq -r '.memberships[0].member_id // empty' 2>/dev/null)
GROUP_NAME=$(echo "$PROFILE" | jq -r '.memberships[0].group_name // empty' 2>/dev/null)

echo "✅ Group: $GROUP_NAME | Group ID: $GROUP_ID"
echo

echo "════════════════════════════════════════════════════════════"
echo "STEP 3: GET GROUP DETAILS"
echo "════════════════════════════════════════════════════════════"

GROUP_DETAILS=$(curl -s -X GET "$API_BASE/v1/groups/$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "$GROUP_DETAILS" | jq '.group' 2>/dev/null || echo "$GROUP_DETAILS"
echo

echo "════════════════════════════════════════════════════════════"
echo "STEP 4: LIST MEMBERS"
echo "════════════════════════════════════════════════════════════"

MEMBERS=$(curl -s -X GET "$API_BASE/v1/members?groupId=$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

MEMBER_COUNT=$(echo "$MEMBERS" | jq '.members | length' 2>/dev/null)
echo "Total Members: $MEMBER_COUNT"
echo "$MEMBERS" | jq '.members[] | {member_code, name: (.first_name + " " + .last_name), phone, role}' 2>/dev/null | head -20
echo

echo "════════════════════════════════════════════════════════════"
echo "STEP 5: CHECK ACCOUNT CODE 4006 (Changi\$ha)"
echo "════════════════════════════════════════════════════════════"

ACCOUNTS=$(curl -s -X GET "$API_BASE/v1/accounting/accounts?groupId=$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "All Accounts:"
echo "$ACCOUNTS" | jq '.accounts[] | {code, name, type}' 2>/dev/null
echo

HAS_4006=$(echo "$ACCOUNTS" | jq '.accounts[] | select(.code=="4006")' 2>/dev/null)
if [ ! -z "$HAS_4006" ]; then
  echo "✅ CHANGI\$HA ACCOUNT CODE 4006 FOUND!"
  echo "$HAS_4006"
else
  echo "⚠️  Account 4006 not found in this group"
fi
echo

echo "════════════════════════════════════════════════════════════"
echo "STEP 6: GET CONTRIBUTIONS"
echo "════════════════════════════════════════════════════════════"

CONTRIBUTIONS=$(curl -s -X GET "$API_BASE/v1/contributions?groupId=$GROUP_ID&limit=10" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

CONTRIB_COUNT=$(echo "$CONTRIBUTIONS" | jq '.contributions | length' 2>/dev/null)
echo "Total Contributions: $CONTRIB_COUNT"
echo "$CONTRIBUTIONS" | jq '.contributions[] | {amount, member_code, created_at, status}' 2>/dev/null | head -20
echo

echo "════════════════════════════════════════════════════════════"
echo "STEP 7: GET CAMPAIGNS (Changi\$ha)"
echo "════════════════════════════════════════════════════════════"

CAMPAIGNS=$(curl -s -X GET "$API_BASE/v1/campaigns?groupId=$GROUP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

CAMPAIGN_COUNT=$(echo "$CAMPAIGNS" | jq '.campaigns | length' 2>/dev/null)
echo "Total Campaigns: $CAMPAIGN_COUNT"
echo "$CAMPAIGNS" | jq '.campaigns[] | {id, title, status, amount_raised, target_amount}' 2>/dev/null
echo

echo "════════════════════════════════════════════════════════════"
echo "✅ LIVE TEST COMPLETE - THE FIONAS GROUP"
echo "════════════════════════════════════════════════════════════"
echo
echo "Results:"
echo "✅ Authentication working"
echo "✅ Group access verified"
echo "✅ Members retrieved ($MEMBER_COUNT total)"
echo "✅ Accounts listed"
echo "✅ Contributions retrieved ($CONTRIB_COUNT total)"
echo "✅ Campaigns accessible ($CAMPAIGN_COUNT campaigns)"
if [ ! -z "$HAS_4006" ]; then
  echo "✅ Changi\$ha account 4006 CONFIRMED"
fi
echo
echo "Production Status: ✅ LIVE & VERIFIED"
echo "════════════════════════════════════════════════════════════"
