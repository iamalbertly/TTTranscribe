# What TTTranscribe Expects from Mobile Clients

## 📋 Overview

This document explains how **Mobile Clients** (iOS/Android apps) should interact with **TTTranscribe** through the **Business Engine** proxy layer. Mobile clients should **NEVER** communicate directly with TTTranscribe for security and architectural reasons.

---

## 🏗️ Architecture Overview

```
┌─────────────────┐
│  Mobile Client  │  (iOS/Android)
│  (Your App)     │
└────────┬────────┘
         │
         │ 1. POST /transcribe (url, userId)
         │ 2. GET /status (requestId)
         │ 3. GET /balance
         │ 4. POST /credits/purchase
         │
         ▼
┌─────────────────┐
│ Business Engine │  (Credit orchestrator)
│  Cloudflare     │
│  Workers/API    │
└────────┬────────┘
         │
         │ A. Forward to TTTranscribe (with auth)
         │ B. Check balance, place holds
         │ C. Process webhooks, charge credits
         │
         ▼
┌─────────────────┐
│  TTTranscribe   │  (Transcription service)
│ Hugging Face    │
│    Spaces       │
└─────────────────┘
```

**Key Principle**: Mobile clients interact with Business Engine, NOT TTTranscribe directly.

---

## ❌ Why Mobile Clients Should NOT Access TTTranscribe Directly

### Security Risks:
1. **Secret Exposure**: `X-Engine-Auth` header would be embedded in app code (easily reverse-engineered)
2. **Abuse Prevention**: Without Business Engine, nothing prevents unlimited free transcriptions
3. **No Credit System**: TTTranscribe doesn't track user balances or payments
4. **Rate Limiting**: Business Engine provides per-user rate limiting

### Architectural Reasons:
1. **User Mapping**: TTTranscribe doesn't know which job belongs to which user
2. **Billing Integration**: Stripe/Apple/Google IAP integration happens at Business Engine
3. **Future Flexibility**: Switching transcription providers doesn't require app update

**Bottom Line**: Always go through Business Engine proxy.

---

## 📱 1. Mobile Client Flow

### 1.1 Complete User Journey

```
User Action: Paste TikTok URL and tap "Transcribe"

Mobile App Flow:
  1. Check user balance (GET /balance)
  2. If balance < estimated cost → Show "Buy Credits" modal
  3. Submit transcription (POST /transcribe)
  4. Poll for status (GET /status every 2 seconds)
  5. Display progress bar (0% → 15% → 35% → 75% → 100%)
  6. Show transcript when complete
  7. Update balance display (poll GET /balance)
```

---

### 1.2 Step-by-Step API Calls

#### **Step 1: Check Balance**

```http
GET https://pluct-business-engine.com/users/{userId}/balance
Authorization: Bearer <user_jwt_token>
```

**Response:**

```json
{
  "userId": "user-123",
  "balance": 47,
  "heldCredits": 5,
  "availableCredits": 42,
  "transactions": {
    "pending": 1,
    "lastPurchase": "2025-11-29T10:00:00Z"
  }
}
```

**UI Display:**
```
💰 42 credits available (5 pending)
```

---

#### **Step 2: Estimate Cost (Optional but Recommended)**

```http
POST https://pluct-business-engine.com/transcribe/estimate
Authorization: Bearer <user_jwt_token>
Content-Type: application/json

{
  "url": "https://www.tiktok.com/@garyvee/video/7308801293029248299"
}
```

**Response:**

```json
{
  "estimatedCredits": 1,
  "estimatedDurationSeconds": 45,
  "modelUsed": "openai-whisper-base",
  "note": "Actual cost based on real audio duration"
}
```

**UI Display:**
```
This video will cost approximately 1 credit.
You have 42 credits available.

[Cancel] [Transcribe Now]
```

---

#### **Step 3: Submit Transcription**

```http
POST https://pluct-business-engine.com/transcribe
Authorization: Bearer <user_jwt_token>
Content-Type: application/json

{
  "url": "https://www.tiktok.com/@garyvee/video/7308801293029248299"
}
```

**Success Response (202 Accepted):**

```json
{
  "requestId": "business-engine-uuid",
  "status": "queued",
  "submittedAt": "2025-11-29T21:44:30.000Z",
  "estimatedProcessingTime": 300,
  "estimatedCredits": 1,
  "url": "https://www.tiktok.com/@garyvee/video/7308801293029248299"
}
```

**Error Response (402 Payment Required):**

```json
{
  "error": "insufficient_credits",
  "message": "Insufficient credits to process this request",
  "details": {
    "required": 1,
    "available": 0,
    "heldCredits": 0
  },
  "purchaseUrl": "/credits/purchase"
}
```

**UI on 402:**
```
❌ Insufficient Credits

You need 1 credit to transcribe this video.
You currently have 0 credits available.

[Buy Credits] [Cancel]
```

---

#### **Step 4: Poll for Status**

**Start polling immediately after submitting:**

```http
GET https://pluct-business-engine.com/status/{requestId}
Authorization: Bearer <user_jwt_token>
```

**Response (Queued):**

```json
{
  "requestId": "business-engine-uuid",
  "status": "queued",
  "progress": 0,
  "currentStep": "queued",
  "submittedAt": "2025-11-29T21:44:30.000Z",
  "estimatedCompletion": "2025-11-29T21:49:30.000Z"
}
```

**Response (Processing - Downloading):**

```json
{
  "requestId": "business-engine-uuid",
  "status": "processing",
  "progress": 15,
  "currentStep": "audio_extraction",
  "submittedAt": "2025-11-29T21:44:30.000Z",
  "estimatedCompletion": "2025-11-29T21:48:00.000Z"
}
```

**Response (Processing - Transcribing):**

```json
{
  "requestId": "business-engine-uuid",
  "status": "processing",
  "progress": 35,
  "currentStep": "transcription",
  "submittedAt": "2025-11-29T21:44:30.000Z",
  "estimatedCompletion": "2025-11-29T21:47:15.000Z"
}
```

**Response (Completed):**

```json
{
  "requestId": "business-engine-uuid",
  "status": "completed",
  "progress": 100,
  "currentStep": "completed",
  "submittedAt": "2025-11-29T21:44:30.000Z",
  "completedAt": "2025-11-29T21:45:15.000Z",
  "result": {
    "transcription": "According to MIT, what is the first market that you go after...",
    "confidence": 0.95,
    "language": "en",
    "duration": 45.23,
    "wordCount": 362,
    "speakerCount": 1,
    "audioQuality": "high",
    "processingTime": 12
  },
  "metadata": {
    "title": "MIT Market Selection",
    "author": "@garyvee",
    "url": "https://www.tiktok.com/@garyvee/video/7308801293029248299"
  },
  "creditsCharged": 1
}
```

**Response (Failed):**

```json
{
  "requestId": "business-engine-uuid",
  "status": "failed",
  "progress": 0,
  "currentStep": "failed",
  "error": "Download failed: Video is private or unavailable",
  "submittedAt": "2025-11-29T21:44:30.000Z",
  "completedAt": "2025-11-29T21:44:35.000Z",
  "creditsRefunded": 1
}
```

---

#### **Step 5: Update Balance**

After job completion, poll balance again:

```http
GET https://pluct-business-engine.com/users/{userId}/balance
Authorization: Bearer <user_jwt_token>
```

**Response:**

```json
{
  "userId": "user-123",
  "balance": 46,  // Was 47, now 46 (charged 1 credit)
  "heldCredits": 0,
  "availableCredits": 46,
  "lastTransaction": {
    "type": "charge",
    "amount": -1,
    "description": "Transcription of @garyvee video",
    "timestamp": "2025-11-29T21:45:15.000Z"
  }
}
```

**UI Display:**
```
✅ Transcription complete!
Charged 1 credit. You now have 46 credits.
```

---

## 🎨 2. UI/UX Best Practices

### 2.1 Progress Indication

**Map `progress` values to user-friendly messages:**

| Progress | currentStep | UI Message |
|----------|-------------|------------|
| 0% | queued | "Waiting in queue..." |
| 15% | audio_extraction | "Downloading video... 🎬" |
| 35% | transcription | "Transcribing audio... 🎤" |
| 75% | summarization | "Generating summary... ✨" |
| 100% | completed | "Done! 🎉" |

**Progress Bar:**
```swift
// iOS SwiftUI Example
ProgressView(value: status.progress, total: 100)
  .progressViewStyle(.linear)

Text(status.currentStep.userFriendlyMessage)
  .font(.caption)
  .foregroundColor(.secondary)
```

---

### 2.2 Error Handling

**402 Insufficient Credits:**
```
┌─────────────────────────────┐
│ ❌ Insufficient Credits     │
│                             │
│ You need 1 credit to        │
│ transcribe this video.      │
│                             │
│ You have: 0 credits         │
│                             │
│  [Buy 10 Credits - $0.99]   │
│  [Buy 100 Credits - $7.99]  │
│  [Cancel]                   │
└─────────────────────────────┘
```

**Failed Transcription:**
```
┌─────────────────────────────┐
│ ⚠️ Transcription Failed      │
│                             │
│ Video is private or         │
│ unavailable.                │
│                             │
│ Your credit has been        │
│ refunded.                   │
│                             │
│  [Try Another Video] [OK]   │
└─────────────────────────────┘
```

---

### 2.3 Balance Display

**Header Balance Badge:**
```
┌─────────────────────────────┐
│  My App       💰 42 credits │
│                             │
│  [Paste TikTok URL]         │
│                             │
└─────────────────────────────┘
```

**Low Balance Warning:**
```
🔔 You're running low on credits!
   You have 2 credits remaining.

   [Buy More Credits]
```

---

## 💳 3. In-App Purchase Integration

### 3.1 Purchase Flow

**iOS (StoreKit) Example:**

```swift
// 1. User taps "Buy 100 Credits"
func purchaseCredits(productId: String) async {
    let product = try await Product.products(for: [productId]).first
    let result = try await product.purchase()

    if case .success(let verification) = result {
        let transaction = try verification.payloadValue

        // 2. Send receipt to Business Engine
        await submitReceipt(transaction.id)
    }
}

// 3. Business Engine verifies with Apple and adds credits
func submitReceipt(transactionId: String) async {
    let response = await apiClient.post("/credits/purchase", body: [
        "platform": "ios",
        "transactionId": transactionId
    ])

    if response.success {
        // 4. Poll balance until credits appear
        await pollBalanceUntilUpdated()
    }
}
```

**Android (Google Play Billing) Example:**

```kotlin
// 1. User taps "Buy 100 Credits"
fun purchaseCredits(productId: String) {
    val productDetails = billingClient.queryProductDetails(productId)
    val purchaseParams = BillingFlowParams.newBuilder()
        .setProductDetailsParamsList(listOf(productDetails))
        .build()

    billingClient.launchBillingFlow(activity, purchaseParams)
}

// 2. Handle purchase result
override fun onPurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
    if (result.responseCode == BillingResponseCode.OK && purchases != null) {
        for (purchase in purchases) {
            // 3. Send purchase token to Business Engine
            submitPurchase(purchase.purchaseToken)
        }
    }
}

// 4. Business Engine verifies with Google and adds credits
suspend fun submitPurchase(purchaseToken: String) {
    val response = apiClient.post("/credits/purchase") {
        body = json {
            "platform" to "android"
            "purchaseToken" to purchaseToken
        }
    }

    if (response.success) {
        // 5. Poll balance until credits appear
        pollBalanceUntilUpdated()
    }
}
```

---

### 3.2 Credit Packages

**Recommended Pricing Tiers:**

| Package | Credits | Price | Bonus | Value |
|---------|---------|-------|-------|-------|
| Starter | 10 | $0.99 | 0 | $0.099/credit |
| Popular | 100 | $7.99 | +20 | $0.067/credit |
| Pro | 500 | $29.99 | +100 | $0.050/credit |
| Unlimited (monthly) | 200/month | $9.99/month | Auto-renew | $0.050/credit |

**UI Display:**
```
┌─────────────────────────────┐
│  Choose Your Plan           │
│                             │
│  ⭐ POPULAR                  │
│  100 Credits + 20 Bonus     │
│  $7.99                      │
│  [Select]                   │
│                             │
│  Pro                        │
│  500 Credits + 100 Bonus    │
│  $29.99 (Save 50%)          │
│  [Select]                   │
└─────────────────────────────┘
```

---

## 🔄 4. Polling Strategy

### 4.1 Recommended Polling Logic

```typescript
class TranscriptionStatusPoller {
  private interval = 2000; // 2 seconds
  private maxDuration = 300000; // 5 minutes
  private maxRetries = 150; // 5 minutes / 2 seconds

  async pollStatus(requestId: string): Promise<Status> {
    let attempts = 0;
    const startTime = Date.now();

    while (attempts < this.maxRetries) {
      // Check timeout
      if (Date.now() - startTime > this.maxDuration) {
        throw new Error('Transcription timed out after 5 minutes');
      }

      // Poll status
      const status = await this.apiClient.getStatus(requestId);

      // Check if complete
      if (status.status === 'completed') {
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Transcription failed');
      }

      // Update UI progress
      this.updateProgress(status.progress, status.currentStep);

      // Wait before next poll
      await this.sleep(this.interval);
      attempts++;
    }

    throw new Error('Max polling retries exceeded');
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

### 4.2 Adaptive Polling (Advanced)

**Slow down polling as job progresses:**

```typescript
function getPollingInterval(progress: number): number {
  if (progress < 15) return 1000;  // 1s during queue/download
  if (progress < 35) return 2000;  // 2s during early transcription
  if (progress < 75) return 3000;  // 3s during transcription
  return 2000;  // 2s during summarization
}
```

**Rationale:**
- Reduce server load
- Battery optimization on mobile
- Faster feedback during active phases

---

## 📊 5. Transaction History

### 5.1 Viewing Past Transactions

```http
GET https://pluct-business-engine.com/users/{userId}/transactions
Authorization: Bearer <user_jwt_token>
```

**Response:**

```json
{
  "transactions": [
    {
      "id": "txn-123",
      "type": "charge",
      "amount": -1,
      "balanceBefore": 47,
      "balanceAfter": 46,
      "description": "Transcription of @garyvee video",
      "metadata": {
        "videoUrl": "https://www.tiktok.com/@garyvee/video/...",
        "duration": 45.23
      },
      "timestamp": "2025-11-29T21:45:15.000Z"
    },
    {
      "id": "txn-122",
      "type": "purchase",
      "amount": 100,
      "balanceBefore": 47,
      "balanceAfter": 147,
      "description": "Purchased 100 credits",
      "metadata": {
        "platform": "ios",
        "transactionId": "apple-txn-456"
      },
      "timestamp": "2025-11-29T10:00:00.000Z"
    }
  ],
  "summary": {
    "totalCreditsUsed": 54,
    "totalCreditsPurchased": 100,
    "averageCostPerTranscription": 1.2
  }
}
```

**UI Display:**
```
┌─────────────────────────────┐
│  Transaction History        │
│                             │
│  Nov 29, 9:45 PM            │
│  Transcription              │
│  -1 credit                  │
│  Balance: 46                │
│                             │
│  Nov 29, 10:00 AM           │
│  Purchased 100 credits      │
│  +100 credits               │
│  Balance: 47                │
└─────────────────────────────┘
```

---

## ⚡ 6. Performance Optimization

### 6.1 Caching

**Cache balance locally:**

```typescript
class BalanceCache {
  private cache: { balance: number; timestamp: number } | null = null;
  private TTL = 60000; // 1 minute

  async getBalance(userId: string): Promise<number> {
    // Check cache
    if (this.cache && Date.now() - this.cache.timestamp < this.TTL) {
      return this.cache.balance;
    }

    // Fetch fresh balance
    const response = await apiClient.getBalance(userId);
    this.cache = {
      balance: response.balance,
      timestamp: Date.now()
    };

    return response.balance;
  }

  invalidate() {
    this.cache = null;
  }
}

// Invalidate cache after charge
await pollStatus(requestId);
balanceCache.invalidate();
const newBalance = await balanceCache.getBalance(userId);
```

---

### 6.2 Prefetching

**Pre-fetch balance on app launch:**

```swift
class AppDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Pre-fetch user balance in background
        Task {
            await apiClient.getBalance(userId)
        }
        return true
    }
}
```

---

## 🔒 7. Security Best Practices

### 7.1 Authentication

**NEVER store user credentials in code:**

```swift
// ❌ BAD
let apiKey = "super-secret-api-key-12345"

// ✅ GOOD
let token = Keychain.get("user_jwt_token")
```

**Use JWT tokens with short expiry:**

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

### 7.2 Network Security

**Use certificate pinning for production:**

```swift
// iOS Example
let serverTrustPolicy = ServerTrustPolicy.pinCertificates(
    certificates: ServerTrustPolicy.certificates(),
    validateCertificateChain: true,
    validateHost: true
)

let serverTrustPolicies: [String: ServerTrustPolicy] = [
    "pluct-business-engine.com": serverTrustPolicy
]
```

---

## 📱 8. Platform-Specific Considerations

### 8.1 iOS

**Background Processing:**
```swift
// Continue polling when app enters background (limited to 30 seconds)
class BackgroundTaskManager {
    func startBackgroundTask() -> UIBackgroundTaskIdentifier {
        return UIApplication.shared.beginBackgroundTask {
            // Task expired, clean up
        }
    }
}
```

**Push Notifications (Alternative to Polling):**
```swift
// Business Engine sends push when job completes
func application(_ application: UIApplication,
                 didReceiveRemoteNotification userInfo: [AnyHashable : Any]) {
    if let requestId = userInfo["requestId"] as? String {
        // Fetch final status
        Task {
            let status = await apiClient.getStatus(requestId)
            updateUI(status)
        }
    }
}
```

---

### 8.2 Android

**Foreground Service (for long-running polls):**
```kotlin
class TranscriptionService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestId = intent?.getStringExtra("requestId")

        // Show persistent notification
        showNotification("Transcribing video...")

        // Poll in background
        lifecycleScope.launch {
            val status = poller.pollStatus(requestId)
            showCompletionNotification(status)
        }

        return START_STICKY
    }
}
```

---

## 🎯 9. Complete Example Flow

```typescript
// React Native Example: Complete transcription flow
async function transcribeVideo(url: string) {
  try {
    // 1. Check balance
    const balance = await api.getBalance(userId);
    if (balance.availableCredits < 1) {
      showInsufficientCreditsModal();
      return;
    }

    // 2. Show cost estimate
    const estimate = await api.estimateCost(url);
    const confirmed = await showConfirmationDialog(
      `This will cost approximately ${estimate.estimatedCredits} credits. Continue?`
    );
    if (!confirmed) return;

    // 3. Submit transcription
    setLoading(true);
    const response = await api.submitTranscription(url);
    const { requestId } = response;

    // 4. Poll for status
    const status = await pollWithProgress(requestId, (progress) => {
      setProgress(progress.progress);
      setCurrentStep(progress.currentStep);
    });

    // 5. Display result
    if (status.status === 'completed') {
      showTranscript(status.result.transcription);

      // 6. Update balance
      const newBalance = await api.getBalance(userId);
      updateBalanceDisplay(newBalance);

      toast.success(`Used ${status.creditsCharged} credits. ${newBalance.balance} remaining.`);
    } else {
      toast.error(`Transcription failed: ${status.error}`);
    }

  } catch (error) {
    toast.error(`Error: ${error.message}`);
  } finally {
    setLoading(false);
  }
}
```

---

## 📚 10. Summary Checklist

**Mobile App MUST:**
- ✅ Always route through Business Engine (never direct to TTTranscribe)
- ✅ Check balance before submitting transcription
- ✅ Poll `/status` endpoint every 2 seconds
- ✅ Handle 402 Insufficient Credits error gracefully
- ✅ Display progress bar with user-friendly messages
- ✅ Update balance after job completion
- ✅ Implement in-app purchase flow with receipt verification
- ✅ Cache balance with 60-second TTL
- ✅ Use secure token-based authentication

**Mobile App SHOULD:**
- ⭐ Show cost estimate before submission
- ⭐ Implement adaptive polling (slow down when appropriate)
- ⭐ Pre-fetch balance on app launch
- ⭐ Show transaction history screen
- ⭐ Use push notifications instead of polling (if Business Engine supports it)
- ⭐ Implement certificate pinning for production
- ⭐ Cache completed transcripts locally

---

**Questions or Issues?**
- Business Engine API documentation: Contact your backend team
- Mobile client examples: See example apps repository
- Support: integration-support@your-domain.com
