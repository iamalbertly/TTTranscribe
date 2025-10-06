from app.api import create_app

<<<<<<< HEAD

app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
 
=======
# export FastAPI app for Hugging Face
app = create_app()


>>>>>>> b5b28564 (CI deploy - 2025-10-02 21:20:45)
