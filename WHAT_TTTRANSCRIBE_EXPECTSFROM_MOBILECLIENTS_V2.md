# What TTTranscribe Expects from Mobile Clients (v2.0)

## 📋 Overview

This document explains how **Mobile Clients** (iOS/Android apps) should interact with **TTTranscribe** through the **Business Engine** proxy layer. This version includes **API versioning**, **credit hold logic**, and **failed job refund policies**.

---

## 🎯 Key Principles (Customer-Centered, Simple, Trustworthy)

### 1. **Credit Hold Before Processing**
- Business Engine places a **credit hold** (estimated cost) BEFORE forwarding request to TTTranscribe
- Hold is released ONLY when:
  - ✅ Transcription completes → Convert hold to charge
  - ❌ Transcription fails → Release hold (full refund)
  - ⏱️ Timeout (5 minutes) → Release hold (full refund)

### 2. **Automatic Refunds on Failure**
- If TTTranscribe returns an error at ANY stage:
  - Download fails (video private/deleted)
  - Transcription fails (API error)
  - Processing timeout
- → **Full automatic refund** (credit hold released)
- → User sees clear error message
- → No manual refund requests needed

### 3. **Transparent Pricing**
- Mobile app shows **estimated cost** before submission
- User confirms before charge
- Actual cost based on **real audio duration**, not estimate
- If actual cost < estimate → User only pays actual cost

---

## 🏗️ Architecture Overview

```
┌─────────────────┐
│  Mobile Client  │  (iOS/Android - Multiple versions in the wild)
│  Version 1.0.0+ │
└────────┬────────┘
         │
         │ Headers:
         │ - Authorization: Bearer <user_jwt>
         │ - X-Client-Version: 1.0.0
         │ - X-Client-Platform: ios|android
         │
         ▼
┌─────────────────┐
│ Business Engine │  (Credit orchestrator + Version router)
│  Cloudflare     │
│  Workers/API    │
└────────┬────────┘
         │
         │ A. Check credit balance
         │ B. Place credit hold (estimated cost)
         │ C. Forward to TTTranscribe with auth
         │ D. Receive webhook when complete
         │ E. Convert hold→charge OR release hold
         │
         ▼
┌─────────────────┐
│  TTTranscribe   │  (Transcription service)
│ Hugging Face    │  API Version: 1.0.0
│    Spaces       │
└─────────────────┘
```

---

## 🔄 API Versioning Strategy

### Why Versioning Matters

Mobile apps are installed on user devices and **cannot be instantly updated**. Different users will have different app versions simultaneously. Business Engine must handle all supported versions gracefully.

### Version Header (REQUIRED)

All requests from mobile clients **MUST** include:

```http
X-Client-Version: 1.0.0
X-Client-Platform: ios
```

**Supported Platforms:**
- `ios` - iOS app
- `android` - Android app
- `web` - Web app

### Version Support Policy

| Client Version | Status | TTTranscribe API | Support Until |
|---------------|--------|------------------|---------------|
| 1.0.0 | ✅ Current | 1.0.0 | Indefinite |
| 1.1.0 | 🔜 Future | 1.0.0 | TBD |

### Version Compatibility Check

**Business Engine should check client version on every request:**

```typescript
function checkClientVersion(clientVersion: string): VersionCheckResult {
  const minimum = '1.0.0';
  const recommended = '1.0.0';
  const latest = '1.0.0';

  if (compareVersions(clientVersion, minimum) < 0) {
    return {
      allowed: false,
      message: 'Your app version is no longer supported. Please update to continue.',
      updateRequired: true,
      updateUrl: 'https://apps.apple.com/app/your-app'
    };
  }

  if (compareVersions(clientVersion, recommended) < 0) {
    return {
      allowed: true,
      message: 'A new version is available with improved features.',
      updateRequired: false,
      updateUrl: 'https://apps.apple.com/app/your-app'
    };
  }

  return {
    allowed: true,
    message: 'You are using the latest version.',
    updateRequired: false
  };
}
```

**Response when version too old:**
```json
{
  "error": "version_unsupported",
  "message": "Your app version is no longer supported. Please update to continue.",
  "details": {
    "yourVersion": "0.9.0",
    "minimumVersion": "1.0.0",
    "latestVersion": "1.0.0",
    "updateUrl": "https://apps.apple.com/app/your-app"
  }
}
```

---

## 💰 Credit Hold & Refund Logic

### Flow Diagram

```
User taps "Transcribe" → Mobile app checks balance
                              ↓
                     Balance sufficient?
                       ↙          ↘
                     NO           YES
                      ↓             ↓
            Show "Buy Credits"   Call /estimate
                                    ↓
                             Show cost confirmation
                              "This will cost ~1 credit"
                                    ↓
                              User confirms?
                                ↙        ↘
                              NO         YES
                               ↓          ↓
                            Cancel    Business Engine:
                                       1. Place hold (1 credit)
                                       2. Forward to TTTranscribe
                                       3. Wait for webhook
                                          ↓
                                    Webhook received?
                                 ↙                    ↘
                            SUCCESS                 FAILED
                               ↓                      ↓
                    1. Convert hold→charge     1. Release hold
                    2. Update balance          2. Update balance
                    3. Return transcript       3. Return error
                               ↓                      ↓
                    User sees transcript      User sees error
                    "Used 1 credit"           "Refunded 1 credit"
```

### Credit Hold Implementation (Business Engine)

```typescript
async function handleTranscribeRequest(userId: string, url: string, requestId: string) {
  // 1. Get estimate from TTTranscribe
  const estimate = await fetch(`${TTT_URL}/estimate`, {
    method: 'POST',
    headers: { 'X-Engine-Auth': TTT_SHARED_SECRET },
    body: JSON.stringify({ url })
  }).then(r => r.json());

  // 2. Check user balance
  const userBalance = await getUserBalance(userId);
  if (userBalance.availableCredits < estimate.estimatedCredits) {
    return {
      error: 'insufficient_credits',
      required: estimate.estimatedCredits,
      available: userBalance.availableCredits
    };
  }

  // 3. Place credit hold (BEFORE forwarding to TTTranscribe)
  await placeHold(userId, estimate.estimatedCredits, requestId);
  console.log(`[hold] Placed ${estimate.estimatedCredits} credit hold for user ${userId}, request ${requestId}`);

  // 4. Forward to TTTranscribe
  try {
    const response = await fetch(`${TTT_URL}/transcribe`, {
      method: 'POST',
      headers: {
        'X-Engine-Auth': TTT_SHARED_SECRET,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, requestId })
    });

    if (!response.ok) {
      // TTTranscribe rejected request - release hold
      await releaseHold(userId, requestId);
      console.log(`[hold] Released hold for ${requestId} - TTTranscribe rejected`);
      throw new Error(`TTTranscribe returned ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    // Network error or TTTranscribe unreachable - release hold
    await releaseHold(userId, requestId);
    console.log(`[hold] Released hold for ${requestId} - error: ${error.message}`);
    throw error;
  }
}
```

### Webhook Processing (Business Engine)

```typescript
async function handleTTTranscribeWebhook(payload: WebhookPayload) {
  // 1. Verify signature (security)
  if (!verifySignature(payload)) {
    return { error: 'invalid_signature', status: 401 };
  }

  // 2. Check idempotency (prevent duplicate charges)
  if (await wasProcessed(payload.idempotencyKey)) {
    return { message: 'already_processed', status: 409 };
  }

  // 3. Get original request details
  const hold = await getHold(payload.requestId);
  if (!hold) {
    console.error(`[webhook] No hold found for requestId ${payload.requestId}`);
    return { error: 'hold_not_found', status: 404 };
  }

  // 4. Process based on status
  if (payload.status === 'completed') {
    // Calculate actual cost from usage
    const actualCost = calculateCost(payload.usage);

    // Convert hold to charge
    await convertHoldToCharge(hold.userId, payload.requestId, actualCost);
    console.log(`[webhook] Charged ${actualCost} credits to user ${hold.userId} for job ${payload.jobId}`);

    // Store transcript
    await storeTranscript(payload.requestId, payload.result);

  } else if (payload.status === 'failed') {
    // Release hold (full refund)
    await releaseHold(hold.userId, payload.requestId);
    console.log(`[webhook] Released hold for user ${hold.userId} - job ${payload.jobId} failed: ${payload.error}`);

    // Store error for user to see
    await storeError(payload.requestId, payload.error);
  }

  // 5. Mark as processed
  await markProcessed(payload.idempotencyKey);

  return { message: 'ok', status: 200 };
}
```

### Cost Calculation (Business Engine)

```typescript
function calculateCost(usage: WebhookPayload['usage']): number {
  const { audioDurationSeconds, modelUsed } = usage;

  // Pricing tiers based on model
  const rates = {
    'openai-whisper-tiny': 0.5,    // 0.5 credits per minute
    'openai-whisper-base': 1.0,    // 1.0 credits per minute
    'openai-whisper-small': 1.5,   // 1.5 credits per minute
    'openai-whisper-medium': 2.0,  // 2.0 credits per minute
    'openai-whisper-large': 3.0    // 3.0 credits per minute
  };

  const ratePerMinute = rates[modelUsed] || 1.0;
  const minutes = audioDurationSeconds / 60;
  const cost = Math.ceil(minutes * ratePerMinute);

  // Minimum 1 credit per transcription
  return Math.max(1, cost);
}
```

---

## 📱 Mobile Client Integration

### 1. Version Header (CRITICAL)

**ALWAYS send version headers:**

```swift
// iOS Example
let request = URLRequest(url: url)
request.setValue("1.0.0", forHTTPHeaderField: "X-Client-Version")
request.setValue("ios", forHTTPHeaderField: "X-Client-Platform")
```

```kotlin
// Android Example
val request = Request.Builder()
    .url(url)
    .header("X-Client-Version", "1.0.0")
    .header("X-Client-Platform", "android")
    .build()
```

### 2. Check for Updates

**On app launch, check version compatibility:**

```http
GET https://pluct-business-engine.romeo-lya2.workers.dev/version
X-Client-Version: 1.0.0
X-Client-Platform: ios
```

**Response:**
```json
{
  "yourVersion": "1.0.0",
  "minimumVersion": "1.0.0",
  "latestVersion": "1.0.0",
  "updateAvailable": false,
  "updateRequired": false,
  "updateUrl": null
}
```

**If update required:**
```json
{
  "yourVersion": "0.9.0",
  "minimumVersion": "1.0.0",
  "latestVersion": "1.0.0",
  "updateAvailable": true,
  "updateRequired": true,
  "updateUrl": "https://apps.apple.com/app/your-app",
  "message": "Your app version is no longer supported. Please update to continue."
}
```

**Mobile app should:**
- Show update prompt if `updateAvailable: true`
- Block app usage if `updateRequired: true`
- Open App Store if user taps "Update"

### 3. Transcription Flow with Credit Holds

```typescript
async function transcribeVideo(url: string) {
  // 1. Check version compatibility
  const versionCheck = await checkVersion();
  if (versionCheck.updateRequired) {
    showUpdateRequiredDialog(versionCheck);
    return;
  }

  // 2. Check balance
  const balance = await getBalance();
  if (balance.availableCredits < 1) {
    showInsufficientCreditsDialog();
    return;
  }

  // 3. Get cost estimate
  const estimate = await getEstimate(url);
  const confirmed = await showCostConfirmation(
    `This video will cost approximately ${estimate.estimatedCredits} credits. Continue?`
  );
  if (!confirmed) return;

  // 4. Submit transcription
  const response = await submitTranscription(url);
  const { requestId } = response;

  // 5. Show pending UI
  showProcessingUI(`Credit hold placed: ${estimate.estimatedCredits} credits`);

  // 6. Poll for status
  const result = await pollStatus(requestId);

  // 7. Show result
  if (result.status === 'completed') {
    showTranscript(result.transcription);
    const newBalance = await getBalance();
    showToast(`Transcription complete! Used ${result.creditsCharged} credits. ${newBalance.balance} remaining.`);
  } else {
    showError(result.error);
    const newBalance = await getBalance();
    showToast(`Transcription failed. ${estimate.estimatedCredits} credits refunded. ${newBalance.balance} available.`);
  }
}
```

### 4. Display Credit Holds in UI

**Balance Display:**
```
💰 Balance: 45 credits
   - Available: 42 credits
   - Pending: 3 credits (2 jobs in progress)
```

**Mobile UI should show:**
- **Total Balance**: All credits owned
- **Available Credits**: Credits not held
- **Held Credits**: Credits reserved for in-progress jobs

**Implementation:**
```swift
struct BalanceView: View {
    @State var balance: Balance

    var body: some View {
        VStack {
            Text("Balance: \\(balance.balance) credits")
                .font(.headline)
            Text("Available: \\(balance.availableCredits) credits")
                .font(.subheadline)
            if balance.heldCredits > 0 {
                Text("Pending: \\(balance.heldCredits) credits")
                    .font(.caption)
                    .foregroundColor(.orange)
            }
        }
    }
}
```

---

## 🔔 Error Handling & User Communication

### Error Types

| Error Code | Description | User Message | Refund? |
|-----------|-------------|--------------|---------|
| `insufficient_credits` | Not enough credits | "You need {X} credits. Buy more?" | N/A (no charge) |
| `version_unsupported` | App too old | "Please update your app" | N/A |
| `download_failed` | Video unavailable | "Video is private or deleted" | ✅ Full refund |
| `transcription_failed` | ASR error | "Transcription service error" | ✅ Full refund |
| `timeout` | Took too long | "Processing timed out" | ✅ Full refund |
| `service_unavailable` | TTTranscribe down | "Service temporarily unavailable" | ✅ Full refund |

### User-Friendly Error Messages

```swift
func getErrorMessage(error: ApiError) -> String {
    switch error.code {
    case "insufficient_credits":
        return "You need \\(error.required) credits to transcribe this video. You have \\(error.available) credits available."
    case "download_failed":
        return "This video is private or has been deleted. Your credits have been refunded."
    case "transcription_failed":
        return "We couldn't transcribe this video. Your credits have been refunded."
    case "timeout":
        return "This video took too long to process. Your credits have been refunded."
    case "version_unsupported":
        return "Your app version is no longer supported. Please update to the latest version."
    default:
        return "An unexpected error occurred. Your credits have been refunded if any were charged."
    }
}
```

---

## 🧪 Testing Your Mobile App

### Test Scenarios

#### 1. **Successful Transcription**
- Submit valid TikTok URL
- Verify credit hold placed
- Poll until complete
- Verify hold converted to charge
- Verify transcript displayed

#### 2. **Insufficient Credits**
- Ensure balance < 1 credit
- Attempt transcription
- Verify error message
- Verify "Buy Credits" button shown

#### 3. **Failed Transcription (Auto Refund)**
- Submit invalid/private TikTok URL
- Verify credit hold placed
- Verify job fails
- Verify hold released (refund)
- Verify error message shown

#### 4. **Version Check**
- Set `X-Client-Version` to `0.1.0`
- Make any request
- Verify `version_unsupported` error
- Verify update prompt shown

#### 5. **Network Error During Submission**
- Disconnect network after estimate
- Submit transcription
- Verify no credit charge
- Verify error message

---

## 📊 Analytics & Monitoring

### Events to Track

```typescript
// Mobile app should track these events:

analytics.track('transcription_started', {
  userId,
  estimatedCost,
  balanceBefore,
  videoUrl
});

analytics.track('transcription_completed', {
  userId,
  actualCost,
  balanceAfter,
  duration,
  processingTime
});

analytics.track('transcription_failed', {
  userId,
  errorCode,
  errorMessage,
  refundedAmount
});

analytics.track('credit_hold_placed', {
  userId,
  amount,
  requestId
});

analytics.track('credit_hold_released', {
  userId,
  amount,
  requestId,
  reason
});
```

---

## 🔒 Security Checklist

- ✅ Always send `X-Client-Version` header
- ✅ Always send `Authorization: Bearer <jwt>` header
- ✅ Never cache JWT tokens beyond session
- ✅ Never store user credentials on device
- ✅ Use certificate pinning for Business Engine
- ✅ Validate all API responses
- ✅ Handle expired tokens gracefully
- ✅ Implement request timeout (30 seconds)

---

## 📚 Summary for App Developers

### **You MUST:**
1. Send `X-Client-Version` and `X-Client-Platform` headers on every request
2. Check version compatibility on app launch
3. Show credit holds in balance UI
4. Display clear refund messages on failures
5. Handle all error codes gracefully
6. Implement update prompts

### **Business Engine WILL:**
1. Place credit hold BEFORE processing
2. Automatically refund on any failure
3. Route requests based on client version
4. Block unsupported client versions
5. Return clear error messages

### **Users GET:**
1. Transparent pricing (see cost before charge)
2. Automatic refunds (no manual requests)
3. Clear error messages
4. Fair billing (only pay for successful transcriptions)

---

**Questions?** Contact the backend team or refer to:
- [DEPLOYMENT_GUIDE_HUGGINGFACE.md](./DEPLOYMENT_GUIDE_HUGGINGFACE.md) for TTTranscribe deployment
- Business Engine API documentation
