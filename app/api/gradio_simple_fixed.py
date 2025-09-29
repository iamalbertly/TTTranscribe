"""
Simple Fixed Gradio UI for TTTranscibe - avoids argument mismatch issues
"""
import gradio as gr
from collections import deque
import httpx
import json
import time

# Use localhost inside the Space container to call the co-mounted FastAPI app
# Relative URLs are not accepted by httpx, so keep explicit scheme/host
BASE_URL = "http://127.0.0.1:7860"

UI_LOGS: deque[str] = deque(maxlen=1000)

def log_debug(message: str):
    """Log debug message to console"""
    print(f"[DEBUG] {message}")
    try:
        UI_LOGS.append(message)
    except Exception:
        pass

def read_ui_logs() -> str:
    """Return recent UI logs as a single string."""
    try:
        return "\n".join(list(UI_LOGS)[-400:])
    except Exception:
        return ""

def transcribe_video(url: str, *args, **kwargs):
    """Legacy streaming path (kept for compatibility). Returns immediate status and lets timer update."""
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
            return "❌ Failed to get job ID", "", "", ""

        log_debug(f"Job ID: {job_id}")

        # Return immediately; a background timer will poll and update the UI.
        return "⏳ Processing... Status: PENDING", "", "", f"Job ID: {job_id}\nStatus: PENDING"

    except Exception as e:
        log_debug(f"❌ Error submitting job: {str(e)}")
        return f"❌ Error submitting job: {str(e)}", "", "", f"Error: {str(e)}"


def poll_job(job_id: str | None):
    """Poll job status by id and return UI fields. Safe if job_id is empty."""
    try:
        if not job_id:
            return gr.update(), gr.update(), gr.update(), gr.update()

        with httpx.Client(timeout=30.0) as client:
            r = client.get(f"{BASE_URL}/transcribe/{job_id}")
            if r.status_code >= 400:
                return f"❌ Error checking job: HTTP {r.status_code}", "", "", f"Job ID: {job_id}\nHTTP: {r.status_code}"
            data = r.json()

        status = data.get("status", "UNKNOWN")
        if status == "COMPLETE":
            text = data.get("text") or data.get("data", {}).get("text") or data.get("result", {}).get("text") or data.get("text_preview", "")
            audio_url = data.get("audio_url", "")
            transcript_url = data.get("transcript_url", "")
            links = ""
            if audio_url:
                if audio_url.startswith("/"):
                    audio_url = f"{BASE_URL}{audio_url}"
                links += f"🎵 **Audio:** [Download]({audio_url})\n"
            if transcript_url:
                if transcript_url.startswith("/"):
                    transcript_url = f"{BASE_URL}{transcript_url}"
                links += f"📝 **Transcript:** [Download]({transcript_url})\n"
            return "✅ Transcription completed successfully!", text or "", links, f"Job ID: {job_id}\nStatus: COMPLETE"

        if status == "FAILED":
            message = data.get("message", "unknown error")
            return f"❌ Transcription failed: {message}", "", "", f"Job ID: {job_id}\nStatus: FAILED\nError: {message}"

        return f"⏳ Processing... Status: {status}", gr.update(), gr.update(), f"Job ID: {job_id}\nStatus: {status}"
    except Exception as e:
        return f"❌ Poll error: {e}", "", "", f"Error: {e}"

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
            refresh_btn = gr.Button("Refresh Status")

        # Hidden state for job id to drive the polling timer
        job_state = gr.State("")
        
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

        logs_output = gr.Textbox(
            label="Server Log (live)",
            interactive=False,
            lines=12
        )
        
        # Connect the button click to the function (immediate response)
        def start_and_store(url: str):
            s, t, l, d = transcribe_video(url)
            # Extract job id from details string if present
            job_id = ""
            try:
                if d and "Job ID:" in d:
                    job_id = d.split("Job ID:")[1].split("\n")[0].strip()
            except Exception:
                pass
            return s, t, l, d, job_id

        submit_btn.click(
            fn=start_and_store,
            inputs=[url_input],
            outputs=[status_output, transcript_output, links_output, details_output, job_state],
            queue=False
        )

        # Poller: every 2s update outputs while job_state has a value
        gr.Timer(interval=2.0, fn=poll_job, inputs=[job_state], outputs=[status_output, transcript_output, links_output, details_output])

        # Manual refresh fallback
        refresh_btn.click(
            fn=poll_job,
            inputs=[job_state],
            outputs=[status_output, transcript_output, links_output, details_output],
            queue=False
        )

        # Live logs every 0.5s
        try:
            gr.Poll(fn=read_ui_logs, outputs=[logs_output], every=0.5)
        except Exception:
            pass
        
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
