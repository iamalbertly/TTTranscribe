from app.api import create_app

# export FastAPI app for Hugging Face
app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
