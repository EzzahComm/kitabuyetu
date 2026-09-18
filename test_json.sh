#!/bin/bash

BASE_URL="https://www.kitabuyetu.co.ke"
API_BASE="$BASE_URL/api"

TOKEN_RESPONSE=$(curl -s -X POST "$API_BASE/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"identifier": "+254717548646", "password": "Bungoma@2026", "groupCode": "KY0000004"}')

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
GROUP_ID="4fcd5d11-f554-4812-8090-daccca232d27"

echo "✅ THE FIONAS LIVE TEST"
echo

echo "1. GROUP DETAILS:"
curl -s -X GET "$API_BASE/v1/groups/$GROUP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | head -c 500

echo -e "\n\n2. ACCOUNT CODES:"
curl -s -X GET "$API_BASE/v1/accounting/accounts?groupId=$GROUP_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | head -c 800

echo -e "\n\n3. CONTRIBUTIONS:"
curl -s -X GET "$API_BASE/v1/contributions?groupId=$GROUP_ID&limit=3" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | head -c 500

echo -e "\n"
