"""
Simple Fixed Gradio UI for TTTranscibe - avoids argument mismatch issues
"""
import gradio as gr
import httpx
import json
import time

# Use localhost inside the Space container to call the co-mounted FastAPI app
# Relative URLs are not accepted by httpx, so keep explicit scheme/host
BASE_URL = "http://127.0.0.1:7860"

def log_debug(message: str):
    """Log debug message to console"""
    print(f"[DEBUG] {message}")

def transcribe_video(url: str, *args, **kwargs):
    """Transcribe a TikTok video and stream updates so the UI refreshes until done."""
    log_debug(f"Starting transcription for URL: {url}")

    if not url or not url.strip():
        log_debug("No URL provided")
        yield "❌ Please provide a TikTok URL", "", "", ""
        return

    try:
        # Submit the job
        log_debug(f"Submitting job to {BASE_URL}/transcribe")
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{BASE_URL}/transcribe",
                json={"url": url.strip()},
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            job_data = response.json()
            log_debug(f"Job submission response: {json.dumps(job_data, indent=2)}")

        job_id = job_data.get("id") or job_data.get("job_id")
        if not job_id:
            log_debug("Failed to get job ID from response")
            yield "❌ Failed to get job ID", "", "", ""
            return

        log_debug(f"Job ID: {job_id}")

        # Poll for completion with proper status updates
        deadline = time.time() + 300  # 5 minutes timeout
        last_status = ""

        attempt = 0
        while time.time() < deadline:
            attempt += 1
            try:
                log_debug(f"Polling attempt {attempt} for job {job_id}")
                with httpx.Client(timeout=30.0) as poll_client:
                    response = poll_client.get(f"{BASE_URL}/transcribe/{job_id}")
                    response.raise_for_status()
                    status_data = response.json()
                    log_debug(f"Poll response: {json.dumps(status_data, indent=2)}")

                status = status_data.get("status", "UNKNOWN")

                if status != last_status:
                    log_debug(f"Status changed: {last_status} -> {status}")
                    last_status = status

                if status == "COMPLETE":
                    log_debug("✅ TRANSCRIPTION COMPLETED SUCCESSFULLY!")

                    # Get transcript text - check multiple possible locations
                    transcript_text = ""

                    if status_data.get("text"):
                        transcript_text = status_data["text"]
                        log_debug(f"Found transcript in status.text: {len(transcript_text)} characters")
                    elif status_data.get("data") and status_data["data"].get("text"):
                        transcript_text = status_data["data"]["text"]
                        log_debug(f"Found transcript in status.data.text: {len(transcript_text)} characters")
                    elif status_data.get("result") and status_data["result"].get("text"):
                        transcript_text = status_data["result"]["text"]
                        log_debug(f"Found transcript in status.result.text: {len(transcript_text)} characters")
                    elif status_data.get("text_preview"):
                        transcript_text = status_data["text_preview"]
                        log_debug(f"Found transcript in status.text_preview: {len(transcript_text)} characters")

                    if not transcript_text or len(transcript_text) < 50:
                        log_debug("No transcript text found in main response, trying dedicated endpoint")
                        try:
                            with httpx.Client(timeout=30.0) as transcript_client:
                                transcript_response = transcript_client.get(f"{BASE_URL}/transcript/{job_id}")
                                log_debug(f"Transcript endpoint status: {transcript_response.status_code}")
                                if transcript_response.status_code == 200:
                                    transcript_data = transcript_response.json()
                                    transcript_text = transcript_data.get("text", transcript_text)
                                    log_debug(f"Got transcript from dedicated endpoint: {len(transcript_text)} characters")
                                else:
                                    log_debug(f"Transcript endpoint failed: {transcript_response.status_code}")
                        except Exception as e:
                            log_debug(f"Transcript endpoint error: {e}")

                    audio_url = status_data.get("audio_url", "")
                    transcript_url = status_data.get("transcript_url", "")
                    links = ""

                    if audio_url:
                        if audio_url.startswith("/"):
                            audio_url = f"{BASE_URL}{audio_url}"
                        links += f"🎵 **Audio:** [Download]({audio_url})\n"
                        log_debug(f"Audio URL: {audio_url}")

                    if transcript_url:
                        if transcript_url.startswith("/"):
                            transcript_url = f"{BASE_URL}{transcript_url}"
                        links += f"📝 **Transcript:** [Download]({transcript_url})\n"
                        log_debug(f"Transcript URL: {transcript_url}")

                    yield "✅ Transcription completed successfully!", transcript_text, links, f"Job ID: {job_id}\nStatus: COMPLETE"
                    return

                if status == "FAILED":
                    error_msg = status_data.get("message", "Unknown error")
                    log_debug(f"❌ TRANSCRIPTION FAILED: {error_msg}")
                    yield f"❌ Transcription failed: {error_msg}", "", "", f"Job ID: {job_id}\nStatus: FAILED\nError: {error_msg}"
                    return

                # Still processing → stream a progress update and continue polling
                remaining = max(0, int(deadline - time.time()))
                log_debug(f"Status: {status} (Time remaining: {remaining}s)")
                yield f"⏳ Processing... Status: {status}", "", "", f"Job ID: {job_id}\nStatus: {status}\nAttempt: {attempt}"

            except Exception as e:
                log_debug(f"Error checking job status: {str(e)}")
                yield f"❌ Error checking job status: {str(e)}", "", "", f"Job ID: {job_id}\nError: {str(e)}"
                return

            time.sleep(3)

        log_debug("⏰ Timeout: Transcription took too long")
        yield "⏰ Timeout: Transcription took too long", "", "", f"Job ID: {job_id}\nStatus: TIMEOUT"
        return

    except Exception as e:
        log_debug(f"❌ Error submitting job: {str(e)}")
        yield f"❌ Error submitting job: {str(e)}", "", "", f"Error: {str(e)}"
        return

def create_interface():
    # Avoid kwargs that may not exist across gradio versions
    with gr.Blocks(title="TTTranscibe - TikTok Video Transcriber") as interface:
        # Enhance console logs in the browser for better diagnosis without changing app logic
        gr.HTML("""
<script>
(function(){
  const originalWarn = console.warn;
  console.warn = function(){
    try{
      if (arguments && typeof arguments[0] === 'string' && arguments[0].includes('Too many arguments provided for the endpoint')){
        originalWarn('[TTTranscibe] Note: Gradio UI may pass an extra event arg; backend accepts it.');
      }
    }catch(e){}
    return originalWarn.apply(console, arguments);
  };
})();
</script>
""")
        gr.Markdown("# 🎵 TTTranscibe - TikTok Video Transcriber")
        gr.Markdown("Transcribe TikTok videos to text using AI. Supports both short URLs (`vm.tiktok.com`) and full TikTok URLs.")
        
        with gr.Row():
            url_input = gr.Textbox(
                label="TikTok URL",
                placeholder="https://vm.tiktok.com/... or https://www.tiktok.com/@user/video/...",
                lines=1
            )
            submit_btn = gr.Button("🎵 Transcribe", variant="primary")
        
        status_output = gr.Textbox(
            label="Status",
            interactive=False,
            lines=2,
            value="⏳ Ready to transcribe"
        )
        
        transcript_output = gr.Textbox(
            label="📝 Transcription Result",
            interactive=False,
            lines=10,
            max_lines=20,
            placeholder="Transcription will appear here..."
        )
        
        links_output = gr.Markdown(
            value="Files will appear here after transcription completes"
        )
        
        details_output = gr.Textbox(
            label="Job Details",
            interactive=False,
            lines=4
        )
        
        # Connect the button click to the function
        submit_btn.click(
            fn=transcribe_video,
            inputs=[url_input],
            outputs=[status_output, transcript_output, links_output, details_output],
            queue=False
        )
        
        # Add examples
        gr.Examples(
            examples=[
                ["https://vm.tiktok.com/ZMADQVF4e/"],
                ["https://vm.tiktok.com/ZMAPTWV7o/"],
                ["https://www.tiktok.com/@businesssapience/video/7298871837335883050?lang=en"]
            ],
            inputs=[url_input],
            label="📋 Try these example URLs"
        )
        
        gr.Markdown("""
        **💡 Tips:**
        - Supports both short (`vm.tiktok.com`) and full TikTok URLs
        - Processing time varies based on video length (usually 30-60 seconds)
        - Results are cached - repeat URLs return instantly
        """)
    # Disable queue and API panel to avoid frontend arg schema mismatches and warnings
    interface.queue(False)
    try:
        # Available in recent gradio versions
        interface.show_api = False
    except Exception:
        pass
    return interface

# Create the interface
simple_fixed_interface = create_interface()
