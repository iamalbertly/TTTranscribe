# Mobile App - Rich Metadata Integration Guide

**Date**: December 27, 2025
**Audience**: Mobile App Developers
**Status**: TTTranscribe backend ready, mobile UI updates needed

---

## Overview

TTTranscribe now returns **rich metadata** for all TikTok videos, replacing generic placeholders like "TikTok Video" and "TikTok User" with actual video information. This guide shows you how to use this metadata in the mobile app.

---

## What Changed in API Responses

### Before (Generic Metadata)
```json
{
  "jobId": "aa65796c-d2ca-47fb-a614-de5dc85ff6f5",
  "status": "completed",
  "result": {
    "transcription": "Keep this in mind when judging...",
    "duration": 50.48
  },
  "metadata": {
    "title": "TikTok Video",
    "author": "TikTok User",
    "description": "Transcribed TikTok video",
    "url": "https://www.tiktok.com/..."
  }
}
```

### After (Rich Metadata) ✅
```json
{
  "jobId": "aa65796c-d2ca-47fb-a614-de5dc85ff6f5",
  "status": "completed",
  "result": {
    "transcription": "Keep this in mind when judging other Muslims...",
    "duration": 50.48,
    "wordCount": 142,
    "speakerCount": 1,
    "audioQuality": "high"
  },
  "metadata": {
    "title": "There will always be a reason to complain. But for every complaint...",
    "author": "@thesunnahguy",
    "authorDisplayName": "The Sunnah Guy - Life mentor",
    "description": "There will always be a reason to complain...",
    "url": "https://www.tiktok.com/@thesunnahguy/video/7493203244727012630",
    "thumbnail": "https://p16-pu-sign-no.tiktokcdn-eu.com/...",
    "thumbnailBase64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "viewCount": 2962504,
    "likeCount": 309905,
    "commentCount": 7197,
    "uploadDate": "20250414",
    "relativeTime": "3 weeks ago",
    "hashtags": ["islam", "muslim", "dawah"],
    "music": {
      "title": "original sound - The Sunnah Guy",
      "author": "The Sunnah Guy - Life mentor"
    }
  }
}
```

---

## Updated Data Models

### Kotlin (Android)

Update your `TranscriptionStatusResponse` data class:

```kotlin
@Serializable
data class TranscriptionStatusResponse(
    val jobId: String,
    val status: String,
    val progress: Int,
    val result: TranscriptionResult? = null,
    val metadata: TranscriptionMetadata? = null,  // Enhanced
    // ... other fields
)

// NEW: Enhanced metadata with rich fields
@Serializable
data class TranscriptionMetadata(
    val title: String? = null,
    val author: String? = null,
    val authorDisplayName: String? = null,
    val description: String? = null,
    val url: String,

    // NEW: Visual content
    val thumbnail: String? = null,
    val thumbnailBase64: String? = null,

    // NEW: Engagement metrics
    val viewCount: Int? = null,
    val likeCount: Int? = null,
    val commentCount: Int? = null,

    // NEW: Time context
    val uploadDate: String? = null,
    val relativeTime: String? = null,

    // NEW: Content categorization
    val hashtags: List<String>? = null,
    val music: MusicMetadata? = null
)

@Serializable
data class MusicMetadata(
    val title: String? = null,
    val author: String? = null
)
```

### Swift (iOS)

```swift
struct TranscriptionStatusResponse: Codable {
    let jobId: String
    let status: String
    let progress: Int
    let result: TranscriptionResult?
    let metadata: TranscriptionMetadata?
}

struct TranscriptionMetadata: Codable {
    let title: String?
    let author: String?
    let authorDisplayName: String?
    let description: String?
    let url: String

    // Visual content
    let thumbnail: String?
    let thumbnailBase64: String?

    // Engagement metrics
    let viewCount: Int?
    let likeCount: Int?
    let commentCount: Int?

    // Time context
    let uploadDate: String?
    let relativeTime: String?

    // Content categorization
    let hashtags: [String]?
    let music: MusicMetadata?
}

struct MusicMetadata: Codable {
    let title: String?
    let author: String?
}
```

---

## UI Implementation Examples

### 1. Transcription List Item (Before)

```
┌─────────────────────────────────────┐
│ TikTok Video                        │
│ TikTok User                         │
│ 50s • Completed 2 hours ago         │
└─────────────────────────────────────┘
```

**Problem**: User can't tell which video is which!

### 2. Transcription List Item (After) ✅

```
┌─────────────────────────────────────┐
│ ┌──────┐                            │
│ │      │ There will always be...    │
│ │ IMG  │ @thesunnahguy              │
│ │      │ 2.9M views • 309K likes    │
│ └──────┘ 50s • 3 weeks ago          │
└─────────────────────────────────────┘
```

**Solution**: Instant visual recognition!

---

## Kotlin (Android) UI Example

### TranscriptionListAdapter.kt

```kotlin
class TranscriptionViewHolder(view: View) : RecyclerView.ViewHolder(view) {
    private val thumbnailImage: ImageView = view.findViewById(R.id.thumbnail)
    private val titleText: TextView = view.findViewById(R.id.title)
    private val authorText: TextView = view.findViewById(R.id.author)
    private val statsText: TextView = view.findViewById(R.id.stats)
    private val timeText: TextView = view.findViewById(R.id.time)

    fun bind(transcription: TranscriptionStatusResponse) {
        val metadata = transcription.metadata

        // Load thumbnail from base64 or URL
        if (metadata?.thumbnailBase64 != null) {
            loadThumbnailFromBase64(metadata.thumbnailBase64)
        } else if (metadata?.thumbnail != null) {
            loadThumbnailFromUrl(metadata.thumbnail)
        } else {
            thumbnailImage.setImageResource(R.drawable.ic_video_placeholder)
        }

        // Display title (or fallback to generic)
        titleText.text = metadata?.title ?: "TikTok Video"

        // Display author with display name preference
        authorText.text = metadata?.authorDisplayName
            ?: metadata?.author
            ?: "TikTok User"

        // Format engagement stats
        val stats = buildString {
            metadata?.viewCount?.let { append("${formatCount(it)} views") }
            metadata?.likeCount?.let {
                if (isNotEmpty()) append(" • ")
                append("${formatCount(it)} likes")
            }
        }
        statsText.text = stats.ifEmpty { "No stats available" }
        statsText.visibility = if (stats.isEmpty()) View.GONE else View.VISIBLE

        // Display upload time
        val duration = transcription.result?.duration?.toInt() ?: 0
        timeText.text = buildString {
            if (duration > 0) append("${duration}s")
            metadata?.relativeTime?.let {
                if (isNotEmpty()) append(" • ")
                append(it)
            }
        }

        // Add hashtags if available
        metadata?.hashtags?.let { hashtags ->
            if (hashtags.isNotEmpty()) {
                // Display hashtags as chips or text
                val hashtagText = hashtags.joinToString(" ") { "#$it" }
                // Add to UI...
            }
        }
    }

    private fun loadThumbnailFromBase64(base64: String) {
        // Remove "data:image/jpeg;base64," prefix
        val imageData = base64.substringAfter("base64,")
        val decodedBytes = android.util.Base64.decode(imageData, android.util.Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
        thumbnailImage.setImageBitmap(bitmap)
    }

    private fun loadThumbnailFromUrl(url: String) {
        // Use Glide, Coil, or Picasso
        Glide.with(thumbnailImage.context)
            .load(url)
            .placeholder(R.drawable.ic_video_placeholder)
            .error(R.drawable.ic_video_error)
            .into(thumbnailImage)
    }

    private fun formatCount(count: Int): String {
        return when {
            count < 1000 -> count.toString()
            count < 1_000_000 -> "${count / 1000}K"
            else -> "${count / 1_000_000}M"
        }
    }
}
```

### Layout XML

```xml
<!-- res/layout/item_transcription.xml -->
<androidx.constraintlayout.widget.ConstraintLayout
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:padding="16dp">

    <!-- Thumbnail -->
    <ImageView
        android:id="@+id/thumbnail"
        android:layout_width="80dp"
        android:layout_height="80dp"
        android:scaleType="centerCrop"
        android:contentDescription="Video thumbnail"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintTop_toTopOf="parent" />

    <!-- Title -->
    <TextView
        android:id="@+id/title"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginStart="12dp"
        android:maxLines="2"
        android:ellipsize="end"
        android:textSize="16sp"
        android:textColor="@color/text_primary"
        android:textStyle="bold"
        app:layout_constraintStart_toEndOf="@id/thumbnail"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintTop_toTopOf="@id/thumbnail" />

    <!-- Author -->
    <TextView
        android:id="@+id/author"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginTop="4dp"
        android:textSize="14sp"
        android:textColor="@color/text_secondary"
        app:layout_constraintStart_toStartOf="@id/title"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintTop_toBottomOf="@id/title" />

    <!-- Stats -->
    <TextView
        android:id="@+id/stats"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginTop="2dp"
        android:textSize="12sp"
        android:textColor="@color/text_tertiary"
        app:layout_constraintStart_toStartOf="@id/title"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintTop_toBottomOf="@id/author" />

    <!-- Time -->
    <TextView
        android:id="@+id/time"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginTop="2dp"
        android:textSize="12sp"
        android:textColor="@color/text_tertiary"
        app:layout_constraintStart_toStartOf="@id/title"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintTop_toBottomOf="@id/stats" />

</androidx.constraintlayout.widget.ConstraintLayout>
```

---

## Swift (iOS) UI Example

### TranscriptionCell.swift

```swift
class TranscriptionCell: UITableViewCell {
    let thumbnailImageView = UIImageView()
    let titleLabel = UILabel()
    let authorLabel = UILabel()
    let statsLabel = UILabel()
    let timeLabel = UILabel()

    func configure(with transcription: TranscriptionStatusResponse) {
        let metadata = transcription.metadata

        // Load thumbnail
        if let base64 = metadata?.thumbnailBase64 {
            loadThumbnailFromBase64(base64)
        } else if let thumbnailUrl = metadata?.thumbnail, let url = URL(string: thumbnailUrl) {
            loadThumbnailFromUrl(url)
        } else {
            thumbnailImageView.image = UIImage(named: "video_placeholder")
        }

        // Display title
        titleLabel.text = metadata?.title ?? "TikTok Video"

        // Display author
        authorLabel.text = metadata?.authorDisplayName
            ?? metadata?.author
            ?? "TikTok User"

        // Format stats
        var stats: [String] = []
        if let views = metadata?.viewCount {
            stats.append("\(formatCount(views)) views")
        }
        if let likes = metadata?.likeCount {
            stats.append("\(formatCount(likes)) likes")
        }
        statsLabel.text = stats.isEmpty ? "" : stats.joined(separator: " • ")
        statsLabel.isHidden = stats.isEmpty

        // Display time
        var timeComponents: [String] = []
        if let duration = transcription.result?.duration {
            timeComponents.append("\(Int(duration))s")
        }
        if let relativeTime = metadata?.relativeTime {
            timeComponents.append(relativeTime)
        }
        timeLabel.text = timeComponents.joined(separator: " • ")
    }

    private func loadThumbnailFromBase64(_ base64: String) {
        // Remove "data:image/jpeg;base64," prefix
        guard let dataString = base64.components(separatedBy: ",").last,
              let data = Data(base64Encoded: dataString),
              let image = UIImage(data: data) else {
            return
        }
        thumbnailImageView.image = image
    }

    private func loadThumbnailFromUrl(_ url: URL) {
        // Use SDWebImage or Kingfisher
        thumbnailImageView.sd_setImage(
            with: url,
            placeholderImage: UIImage(named: "video_placeholder"),
            options: .refreshCached
        )
    }

    private func formatCount(_ count: Int) -> String {
        switch count {
        case ..<1000:
            return "\(count)"
        case ..<1_000_000:
            return "\(count / 1000)K"
        default:
            return "\(count / 1_000_000)M"
        }
    }
}
```

---

## Feature Enhancements

### 1. Search by Hashtag

```kotlin
// Filter transcriptions by hashtag
fun filterByHashtag(transcriptions: List<TranscriptionStatusResponse>, hashtag: String): List<TranscriptionStatusResponse> {
    return transcriptions.filter { transcription ->
        transcription.metadata?.hashtags?.contains(hashtag) == true
    }
}
```

### 2. Sort by Popularity

```kotlin
// Sort by view count
fun sortByViewCount(transcriptions: List<TranscriptionStatusResponse>): List<TranscriptionStatusResponse> {
    return transcriptions.sortedByDescending { it.metadata?.viewCount ?: 0 }
}
```

### 3. Filter by Author

```kotlin
// Find all transcriptions by specific author
fun filterByAuthor(transcriptions: List<TranscriptionStatusResponse>, author: String): List<TranscriptionStatusResponse> {
    return transcriptions.filter { transcription ->
        transcription.metadata?.author?.equals(author, ignoreCase = true) == true ||
        transcription.metadata?.authorDisplayName?.contains(author, ignoreCase = true) == true
    }
}
```

---

## Migration Strategy

### Step 1: Update Data Models (Required)
- Add new metadata fields to your data classes
- All fields are nullable for backward compatibility

### Step 2: Update UI (Recommended)
- Add thumbnail display to transcription list
- Show real title instead of "TikTok Video"
- Show author display name
- Display view/like counts

### Step 3: Add Features (Optional)
- Search by hashtag
- Sort by popularity
- Filter by author
- Music attribution

---

## Backward Compatibility

✅ **All new fields are optional** (nullable)
- Old transcriptions without rich metadata will still work
- UI should handle missing metadata gracefully
- Fallback to generic values when metadata unavailable

Example:
```kotlin
val title = metadata?.title ?: "TikTok Video"
val author = metadata?.authorDisplayName ?: metadata?.author ?: "TikTok User"
```

---

## Testing Checklist

- [ ] Update data models with new metadata fields
- [ ] Test transcription list displays thumbnails
- [ ] Test title displays instead of "TikTok Video"
- [ ] Test author display name shows correctly
- [ ] Test view/like counts format correctly (2.9M, 309K, etc.)
- [ ] Test relative time displays (e.g., "3 weeks ago")
- [ ] Test base64 thumbnail loading
- [ ] Test URL thumbnail loading as fallback
- [ ] Test graceful degradation when metadata missing
- [ ] Test with old transcriptions (before rich metadata)
- [ ] Test search/filter by hashtag
- [ ] Test sort by popularity

---

## Performance Considerations

### Thumbnail Loading

**Base64 (Embedded)**:
- ✅ No network request needed
- ✅ Instant display
- ❌ ~52KB per thumbnail in response
- **Best for**: Recently completed transcriptions

**URL (External)**:
- ✅ Smaller API response
- ✅ Image caching by OS
- ❌ Requires network request
- **Best for**: Cached transcriptions

**Recommendation**: Use base64 if available, fallback to URL, then placeholder image.

### Memory Management

```kotlin
// Use image loading library with memory caching
Glide.with(context)
    .load(thumbnailUrl)
    .diskCacheStrategy(DiskCacheStrategy.ALL)
    .override(200, 200) // Resize to list item size
    .into(imageView)
```

---

## Example: Full Integration

```kotlin
// MainActivity.kt - Display transcription list with rich metadata
class MainActivity : AppCompatActivity() {

    private fun displayTranscriptions(transcriptions: List<TranscriptionStatusResponse>) {
        recyclerView.adapter = TranscriptionListAdapter(transcriptions) { transcription ->
            // Handle item click - show transcript
            showTranscriptDetail(transcription)
        }
    }

    private fun showTranscriptDetail(transcription: TranscriptionStatusResponse) {
        val metadata = transcription.metadata
        val result = transcription.result

        // Show rich detail view with:
        // - Full thumbnail
        // - Video title
        // - Author info with follower count
        // - Full transcript
        // - Engagement stats (views, likes, comments)
        // - Upload date
        // - Hashtags as clickable chips
        // - Music attribution
    }
}
```

---

## Summary

**What You Get**:
- 📸 **Thumbnails** - Visual recognition at a glance
- 📝 **Real Titles** - Actual video titles instead of "TikTok Video"
- 👤 **Author Info** - Username + display name
- 📊 **Engagement Stats** - Views, likes, comments
- ⏰ **Time Context** - Upload date and relative time
- 🏷️ **Hashtags** - Content categorization
- 🎵 **Music Info** - Track and artist details

**Result**: Users can **instantly recognize** their transcriptions, preserving the "magic moment" that led them to save each video.

---

**Guide Version**: 1.0
**Date**: December 27, 2025
**Status**: TTTranscribe Backend Ready ✅
