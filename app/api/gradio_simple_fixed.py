"""
Simple Fixed Gradio UI for TTTranscibe - Final Corrected Version
"""
import gradio as gr
import httpx
import os

# Use loopback HTTP to call the co-hosted FastAPI app. This is the most reliable method.
PORT = os.environ.get("PORT", "7860")
BASE_URL = f"http://127.0.0.1:{PORT}"


def submit_transcription_job(url: str):
    """
    Handles the button click, submits the job, and returns state for the UI.
    Always returns a 5-tuple: (status, transcript, links_md, details, job_id)
    """
    if not url or not url.strip():
        return "❌ Please provide a TikTok URL", "", "", "Error: No URL provided", ""

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{BASE_URL}/transcribe",
                json={"url": url.strip()},
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            job_data = response.json()

        job_id = job_data.get("id") or job_data.get("job_id")
        if not job_id:
            return "❌ Failed to get job ID from response", "", "", "Error: No job_id in response", ""

        status_message = "⏳ Processing... Status: PENDING"
        details_message = f"Job ID: {job_id}\nStatus: PENDING"
        return status_message, "", "", details_message, job_id

    except httpx.RequestError as e:
        error_message = f"❌ Network error submitting job: {e}"
        return error_message, "", "", error_message, ""
    except Exception as e:
        error_message = f"❌ An unexpected error occurred: {str(e)}"
        return error_message, "", "", error_message, ""


def poll_job_status(job_id: str | None):
    """Polls the job status by its ID and returns updates for the UI fields."""
    if not job_id:
        return gr.update(), gr.update(), gr.update(), gr.update()

    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.get(f"{BASE_URL}/transcribe/{job_id}")
            r.raise_for_status()
            data = r.json()

        status = data.get("status", "UNKNOWN")
        details_text = f"Job ID: {job_id}\nStatus: {status}"

        if status == "COMPLETE":
            text = data.get("text") or data.get("data", {}).get("text", "")
            audio_url = data.get("audio_url", "")
            transcript_url = data.get("transcript_url", "")
            links = ""
            if audio_url:
                links += f"🎵 **Audio:** [Download]({audio_url})\n"
            if transcript_url:
                links += f"📝 **Transcript:** [Download]({transcript_url})\n"
            return "✅ Transcription successful!", text, links, details_text

        elif status == "FAILED":
            message = data.get("message", "Unknown error")
            details_text += f"\nError: {message}"
            return f"❌ Transcription failed: {message}", "", "", details_text

        else:  # PENDING, FETCHING, etc.
            return f"⏳ Processing... Status: {status}", gr.update(), gr.update(), details_text

    except Exception as e:
        error_text = f"❌ Error polling job: {e}"
        return error_text, "", "", error_text


def create_interface():
    with gr.Blocks(title="TTTranscibe - TikTok Video Transcriber") as interface:
        gr.Markdown("# 🎵 TTTranscibe - TikTok Video Transcriber")
        gr.Markdown("Enter a TikTok URL to transcribe it. Results are cached for speed.")
        
        with gr.Row():
            url_input = gr.Textbox(label="TikTok URL", placeholder="e.g., https://www.tiktok.com/@user/video/...", lines=1)
            submit_btn = gr.Button("🎵 Transcribe", variant="primary")

        # Hidden state to store the current job_id for polling
        job_state = gr.State("")
        
        status_output = gr.Textbox(label="Status", interactive=False, lines=1, value="⏳ Ready")
        transcript_output = gr.Textbox(label="📝 Transcription", interactive=False, lines=10, placeholder="Transcription will appear here...")
        links_output = gr.Markdown("Download links will appear here.")
        details_output = gr.Textbox(label="Job Details", interactive=False, lines=4)

        submit_btn.click(
            fn=submit_transcription_job,
            inputs=[url_input],
            outputs=[status_output, transcript_output, links_output, details_output, job_state],
            queue=False
        )

        # Version-agnostic polling: prefer Poll, fallback to Timer signatures
        try:
            gr.Poll(
                fn=poll_job_status,
                inputs=[job_state],
                outputs=[status_output, transcript_output, links_output, details_output],
                every=2.0
            )
        except Exception:
            try:
                gr.Timer(
                    fn=poll_job_status,
                    inputs=[job_state],
                    outputs=[status_output, transcript_output, links_output, details_output],
                    every=2.0
                )
            except Exception:
                try:
                    gr.Timer(2.0, poll_job_status, [job_state], [status_output, transcript_output, links_output, details_output])
                except Exception:
                    pass

        gr.Examples(
            examples=[["https://www.tiktok.com/@businesssapience/video/7298871837335883050"]],
            inputs=[url_input]
        )
    
    interface.queue(False)
    return interface

# Create the final interface instance
simple_fixed_interface = create_interface()
