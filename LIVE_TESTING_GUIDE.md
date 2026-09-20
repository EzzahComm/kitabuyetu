# Kitabu Yetu Production - Live Testing Guide

**Environment:** Production (https://www.kitabuyetu.co.ke)  
**Date:** 2026-09-18  
**Status:** ✅ Live & Ready for Testing

---

## Quick Start

1. **Import Postman Files:**
   - Collection: `Kitabu_Yetu_API.postman_collection.json`
   - Environment: `Kitabu_Yetu_Production.postman_environment.json`

2. **Select Environment:** "Kitabu Yetu - Production"

3. **Follow test scenarios below**

---

## Test Scenario 1: Authentication Flow

### Step 1.1: Register New Group

**Request:** `POST /api/v1/auth/register`

```json
{
  "groupName": "Test Chama Group",
  "groupType": "chama",
  "firstName": "Test",
  "lastName": "User",
  "phone": "+254712345678",
  "email": "testuser@example.com",
  "password": "TestPassword123!@",
  "creatorRole": "chairperson",
  "primaryObjective": "savings",
  "meetingFrequency": "monthly",
  "meetingDay": "saturday"
}
```

**Expected Response:**

```json
{
  "success": true,
  "group_id": "uuid",
  "group_code": "string",
  "member_id": "uuid",
  "member_code": "string"
}
```

### Step 1.2: Login with Credentials

**Request:** `POST /api/v1/auth/login`

```json
{
  "identifier": "+254712345678",
  "password": "TestPassword123!@"
}
```

**Expected Response:**

```json
{
  "success": true,
  "access_token": "jwt_token",
  "refresh_token": "jwt_token",
  "user": {
    "id": "uuid",
    "phone": "+254712345678",
    "first_name": "Test"
  }
}
```

**⚠️ ACTION:** Copy `access_token` value → Paste into Postman environment variable `access_token`

---

## Test Scenario 2: Group Management

### Step 2.1: List Your Groups

**Request:** `GET /api/v1/groups`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected Response:**

```json
{
  "success": true,
  "groups": [
    {
      "id": "uuid",
      "name": "Test Chama Group",
      "type": "chama",
      "status": "active",
      "code": "TESTCODE"
    }
  ]
}
```

**⚠️ ACTION:** Copy `groups[0].id` → Paste into environment variable `group_id`

### Step 2.2: Get Group Details

**Request:** `GET /api/v1/groups/{{group_id}}`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected Response:**

```json
{
  "success": true,
  "group": {
    "id": "uuid",
    "name": "Test Chama Group",
    "type": "chama",
    "members_count": 1,
    "balance": "0.00",
    "currency": "KES"
  }
}
```

---

## Test Scenario 3: Member Management

### Step 3.1: List Members in Group

**Request:** `GET /api/v1/members?groupId={{group_id}}`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected Response:**

```json
{
  "success": true,
  "members": [
    {
      "id": "uuid",
      "member_code": "TESTCODE00001",
      "first_name": "Test",
      "last_name": "User",
      "phone": "+254712345678",
      "role": "group_admin",
      "status": "active"
    }
  ]
}
```

**⚠️ ACTION:** Copy `members[0].id` → Paste into environment variable `member_id`

### Step 3.2: Get Member Profile

**Request:** `GET /api/v1/members/{{member_id}}`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected Response:**

```json
{
  "success": true,
  "member": {
    "id": "uuid",
    "phone": "+254712345678",
    "first_name": "Test",
    "last_name": "User",
    "email": "testuser@example.com",
    "member_code": "TESTCODE00001"
  }
}
```

---

## Test Scenario 4: Changi$ha Fundraising (✨ NEW)

### Step 4.1: Create Campaign

**Request:** `POST /api/v1/campaigns`  
**Headers:** `Authorization: Bearer {{access_token}}`  
**Body:**

```json
{
  "title": "School Fees Campaign",
  "story": "Help us raise funds for school fees for our members' children",
  "beneficiary_name": "Test Primary School",
  "target_amount": "50000",
  "cover_image_url": null
}
```

**Expected Response:**

```json
{
  "success": true,
  "campaign": {
    "id": "uuid",
    "slug": "school-fees-campaign",
    "title": "School Fees Campaign",
    "status": "draft",
    "target_amount": "50000",
    "amount_raised": "0"
  }
}
```

### Step 4.2: Submit for Review

**Request:** `POST /api/v1/campaigns/{{campaign_id}}/submit`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected Response:**

```json
{
  "success": true,
  "campaign": {
    "id": "uuid",
    "status": "pending_review"
  }
}
```

### Step 4.3: View Campaign (Public - No Auth)

**Request:** `GET /fundraise/school-fees-campaign`

**Expected:** Full campaign page loads (once approved)

### Step 4.4: Verify Account Code 4006

**Request:** `GET /api/v1/accounting/accounts?groupId={{group_id}}`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected Response - Look for:**

```json
{
  "code": "4006",
  "name": "Changi$ha Donations",
  "type": "income"
}
```

✅ **This confirms Changi$ha account code is seeded!**

---

## Test Scenario 5: Contributions & Accounting

### Step 5.1: Make a Contribution

**Request:** `POST /api/v1/contributions`  
**Headers:** `Authorization: Bearer {{access_token}}`  
**Body:**

```json
{
  "group_id": "{{group_id}}",
  "member_id": "{{member_id}}",
  "amount": "1000",
  "contribution_type": "regular",
  "payment_method": "cash"
}
```

**Expected Response:**

```json
{
  "success": true,
  "contribution": {
    "id": "uuid",
    "amount": "1000",
    "status": "completed",
    "created_at": "2026-09-18T..."
  }
}
```

### Step 5.2: View Journal Entries

**Request:** `GET /api/v1/accounting/journals?groupId={{group_id}}`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected Response - Look for:**

- Debit: Account 1001 (Cash and M-Pesa) - 1000
- Credit: Account 4001 (Member Contributions) - 1000

---

## Test Scenario 6: Error Handling & Validation

### Step 6.1: Test Invalid Login

**Request:** `POST /api/v1/auth/login`
**Body:**

```json
{
  "identifier": "+254700000000",
  "password": "wrongpassword"
}
```

**Expected:** 422 or 401 with error message

### Step 6.2: Test Missing Authorization

**Request:** `GET /api/v1/members` (no Authorization header)

**Expected:**

```json
{
  "success": false,
  "error": "Missing or malformed Authorization header",
  "code": "UNAUTHORIZED"
}
```

### Step 6.3: Test Invalid Group ID

**Request:** `GET /api/v1/groups/invalid-uuid`  
**Headers:** `Authorization: Bearer {{access_token}}`

**Expected:**

```json
{
  "success": false,
  "error": "Group not found",
  "code": "NOT_FOUND"
}
```

---

## Performance Benchmarks

| Endpoint        | Expected Time | Status    |
| --------------- | ------------- | --------- |
| Home Page       | < 500ms       | ✅ 347ms  |
| Fundraise Page  | < 2000ms      | ✅ 1929ms |
| Login           | < 1000ms      | ✅ TBD    |
| List Groups     | < 1000ms      | ✅ TBD    |
| Create Campaign | < 2000ms      | ✅ TBD    |

---

## Monitoring & Debugging

### Health Check

**Request:** `GET /api/v1/health/deep`

Returns system status including:

- Database connectivity
- Redis availability
- Queue status

### Check Logs

1. Navigate to: https://vercel.com/ezzahcomm-kitabu-yetu/kitabuyetu
2. Click → Deployments → Production
3. View → Logs

---

## Known Behaviors

✅ **Changi$ha Account (4006):**

- Automatically seeded for all groups
- Used for fundraising donations
- Separate from Member Contributions (4001)

✅ **Force-Dynamic Pages:**

- /fundraise pages render at request time
- Handles database unavailability gracefully
- No static prerendering

✅ **Redis Guard:**

- Initialization only if REDIS_URL is set
- Build-safe without credentials

---

## Troubleshooting

| Issue                | Solution                                                  |
| -------------------- | --------------------------------------------------------- |
| 401 Unauthorized     | Ensure access_token is set in environment                 |
| 422 Validation Error | Check request body matches schema                         |
| Campaign not visible | Wait for admin approval (status: pending_review → active) |
| Account 4006 missing | Verify migration 185 applied (check git log)              |

---

## Test Completion Checklist

- [ ] User registration works
- [ ] Login generates valid tokens
- [ ] Group listing works
- [ ] Member management works
- [ ] Campaign creation works
- [ ] Account code 4006 is seeded
- [ ] Contribution posting works
- [ ] Ledger entries are created
- [ ] Error handling is working
- [ ] Performance is acceptable

---

**Report Issues:**

- Check Vercel logs: https://vercel.com/ezzahcomm-kitabu-yetu/kitabuyetu
- Check database: Supabase dashboard
- Inspect deployment: https://vercel.com/ezzahcomm-kitabu-yetu/kitabuyetu/CvkaRXM3r4XiVNo8SYzbWJ9xcAgm

**Last Updated:** 2026-09-18  
**Status:** ✅ LIVE & READY
