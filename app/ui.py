import tempfile
import os
import gradio as gr
from .logging_utils import UILogHandler, read_logs
from .network import expand_tiktok_url
from .media import yt_dlp_m4a, to_wav_normalized
from .transcription import transcribe_wav


logger = UILogHandler("tttranscribe")


def build_gradio_ui():
    def transcribe_url(url: str, progress=gr.Progress()):
        try:
            if not url or not url.strip():
                return "Provide a TikTok URL", "No URL"
            url = url.strip()
            from .logging_utils import LOGS  # lazy to avoid circulars

            LOGS.clear()
            logger.log("info", "submit", url=url)

            progress(0.05, desc="Expanding URL")
            expanded = expand_tiktok_url(url)

            with tempfile.TemporaryDirectory(dir="/tmp", prefix="tiktok_") as tmpd:
                progress(0.15, desc="Fetching audio")
                m4a = yt_dlp_m4a(expanded, tmpd)
                logger.log("info", "stored locally", object=os.path.basename(m4a), path=m4a)

                progress(0.40, desc="Converting to WAV")
                wav = os.path.join(tmpd, "audio.wav")
                to_wav_normalized(m4a, wav)

                progress(0.70, desc="Transcribing")
                text, _, _ = transcribe_wav(wav)

            progress(1.0, desc="Done")
            logger.log("info", "FINAL_TRANSCRIPT", transcript=text)
            return text, "Done"
        except Exception as e:
            logger.log("error", "exception", error=str(e))
            return f"[Exception] {e}", "Error"

    with gr.Blocks(title="TTTranscribe") as demo:
        gr.Markdown("### TikTok → Transcript, with live server logs")
        url_in = gr.Textbox(label="TikTok URL", placeholder="https://vm.tiktok.com/...")
        with gr.Row():
            go = gr.Button("Transcribe", variant="primary")
            status = gr.Textbox(label="Status", value="Idle", interactive=False)
        transcript = gr.Textbox(label="Transcript", lines=12)
        logs = gr.Textbox(label="Server log (live)", lines=16, interactive=False)
        go.click(fn=transcribe_url, inputs=[url_in], outputs=[transcript, status], concurrency_limit=1)
        try:
            demo.poll(fn=read_logs, outputs=[logs], every=0.5)
        except Exception:
            pass
    return demo


