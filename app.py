"""
Hugging Face Spaces entry point for TikTok Transcriber.
This file serves as the main entry point for the Hugging Face Space.
"""

from app.api.main import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
