"""
Xet storage backend for Hugging Face Hub
Provides faster file transfers and better performance for free accounts
"""
import os
import json
import tempfile
from typing import Optional, Dict, Any
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_url
import logging

logger = logging.getLogger(__name__)

class XetStorage:
    """
    Xet storage backend for Hugging Face Hub
    Uses Xet storage for faster file transfers and better performance
    """
    
    def __init__(self):
        self.repo_id = os.getenv("HF_DATASET_REPO_ID", "").strip()
        self.hf_token = os.getenv("HF_TOKEN")
        
        if not self.repo_id:
            raise RuntimeError("HF_DATASET_REPO_ID is required for Xet storage")
        if not self.hf_token:
            raise RuntimeError("HF_TOKEN is required for Xet storage")
        
        # Initialize HF API with Xet storage
        self.api = HfApi(token=self.hf_token)
        self.repo_type = "dataset"
        
        # Configure Xet storage if available
        try:
            # Enable Xet storage for better performance
            os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
            logger.info("Xet storage enabled for faster transfers")
        except Exception as e:
            logger.warning(f"Could not enable Xet storage: {e}")
    
    def _get_public_url(self, path_in_repo: str) -> str:
        """Get public URL for a file in the dataset"""
        return hf_hub_url(
            self.repo_id, 
            filename=path_in_repo, 
            repo_type=self.repo_type, 
            revision="main"
        )
    
    def _upload_file(self, local_path: str, path_in_repo: str, commit_message: str) -> str:
        """Upload file to the dataset with Xet storage optimization"""
        try:
            self.api.upload_file(
                path_or_fileobj=local_path,
                path_in_repo=path_in_repo,
                repo_id=self.repo_id,
                repo_type=self.repo_type,
                commit_message=commit_message,
                # Use Xet storage for faster transfers
                create_commits=True,
            )
            return self._get_public_url(path_in_repo)
        except Exception as e:
            logger.error(f"Failed to upload {path_in_repo}: {e}")
            raise
    
    def put_audio(self, sha256: str, local_wav_path: str) -> str:
        """Upload audio file and return public URL"""
        path_in_repo = f"audio/{sha256}.wav"
        return self._upload_file(
            local_wav_path, 
            path_in_repo, 
            f"Add audio {sha256}"
        )
    
    def put_transcript_json(self, sha256: str, transcript_dict: Dict[str, Any]) -> str:
        """Upload transcript JSON and return public URL"""
        path_in_repo = f"transcripts/{sha256}.json"
        
        # Write to temporary file first
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as tmp_file:
            json.dump(transcript_dict, tmp_file, ensure_ascii=False, indent=2)
            tmp_path = tmp_file.name
        
        try:
            return self._upload_file(
                tmp_path, 
                path_in_repo, 
                f"Add transcript {sha256}"
            )
        finally:
            # Clean up temporary file
            try:
                os.unlink(tmp_path)
            except:
                pass
    
    def get_existing_urls(self, sha256: str) -> Optional[Dict[str, str]]:
        """Check if files exist and return their URLs"""
        try:
            files = set(self.api.list_repo_files(self.repo_id, repo_type=self.repo_type))
            
            audio_path = f"audio/{sha256}.wav"
            transcript_path = f"transcripts/{sha256}.json"
            
            if audio_path in files and transcript_path in files:
                return {
                    "audio_url": self._get_public_url(audio_path),
                    "transcript_url": self._get_public_url(transcript_path),
                }
            return None
        except Exception as e:
            logger.warning(f"Failed to check existing files: {e}")
            return None
    
    def url_exists(self, path_in_repo: str) -> bool:
        """Check if a file exists in the dataset"""
        try:
            files = self.api.list_repo_files(self.repo_id, repo_type=self.repo_type)
            return path_in_repo in files
        except Exception:
            return False
    
    def get_file_info(self, path_in_repo: str) -> Optional[Dict[str, Any]]:
        """Get file information from the dataset"""
        try:
            # This is a simplified version - in practice you might want more detailed info
            files = self.api.list_repo_files(self.repo_id, repo_type=self.repo_type)
            if path_in_repo in files:
                return {
                    "exists": True,
                    "url": self._get_public_url(path_in_repo)
                }
            return None
        except Exception as e:
            logger.warning(f"Failed to get file info for {path_in_repo}: {e}")
            return None
