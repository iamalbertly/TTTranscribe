from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

# Optional dotenv import to avoid hard crash if package missing
try:  # pragma: no cover
	from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
	def load_dotenv(*args, **kwargs):  # type: ignore
		return False

from pydantic import BaseModel, Field, ValidationError


class AppSettings(BaseModel):
	environment: str = Field(default=os.getenv("ENVIRONMENT", "development"))
	log_level: str = Field(default=os.getenv("LOG_LEVEL", "INFO"))

	# Supabase
	supabase_url: str = Field(default=os.getenv("SUPABASE_URL", ""))
	supabase_anon_key: str = Field(default=os.getenv("SUPABASE_ANON_KEY", ""))
	supabase_service_role_key: str = Field(default=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))
	supabase_storage_bucket: str = Field(default=os.getenv("SUPABASE_STORAGE_BUCKET", "transcripts"))

	# Resource limits / feature flags
	max_audio_seconds: int = Field(default=int(os.getenv("MAX_AUDIO_SECONDS", "120")))
	allow_tiktok_adapter: bool = Field(default=os.getenv("ALLOW_TIKTOK_ADAPTER", "true").lower() == "true")
	global_requests_per_minute: int = Field(default=int(os.getenv("GLOBAL_REQUESTS_PER_MINUTE", "5")))

	# Whisper
	whisper_model: str = Field(default=os.getenv("WHISPER_MODEL", "tiny"))
	whisper_cache_dir: str = Field(default=os.getenv("WHISPER_CACHE_DIR", "whisper-cache"))

	# Local storage root (used when not using Supabase storage)
	# In HF Spaces, /tmp is writable. Default to /tmp/local_storage in production.
	local_storage_root: str = Field(default=os.getenv("LOCAL_STORAGE_ROOT", ""))

	# CORS
	cors_origins: str = Field(default=os.getenv("CORS_ORIGINS", "*"))

	# Database
	database_url: str = Field(default=os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres"))

	# Worker runtimes and concurrency
	# WORKER_ID is generated once per process startup to identify leases
	worker_id: str = Field(default=os.getenv("WORKER_ID", ""))
	worker_lease_seconds: int = Field(default=int(os.getenv("WORKER_LEASE_SECONDS", "300")))
	worker_poll_interval_seconds: int = Field(default=int(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "5")))
	max_concurrent_fetches: int = Field(default=int(os.getenv("MAX_CONCURRENT_FETCHES", "2")))
	max_concurrent_transcribes: int = Field(default=int(os.getenv("MAX_CONCURRENT_TRANSCRIBES", "1")))


_cached_settings: Optional[AppSettings] = None


def load_settings(dotenv_path: Optional[str | Path] = None) -> AppSettings:
	"""
	Load environment variables and return validated settings with sensible defaults.

	Precedence: passed dotenv_path (if provided) → .env in CWD (if exists) → OS env.
	"""
	global _cached_settings
	# In test environment, always reload settings to honor env overrides set by tests
	if os.getenv("ENVIRONMENT", "").lower() != "test":
		if _cached_settings is not None:
			return _cached_settings

	if dotenv_path is not None:
		load_dotenv(dotenv_path)
	else:
		# Load .env if present, but do not error if missing
		default_env = Path(".env")
		if default_env.exists():
			load_dotenv(default_env)

	# Ensure cache dir exists for whisper
	# Use /tmp for Hugging Face Spaces compatibility
	cache_dir = Path(os.getenv("WHISPER_CACHE_DIR", "/tmp/whisper-cache"))
	try:
		cache_dir.mkdir(parents=True, exist_ok=True)
	except PermissionError:
		# Fallback to current directory if /tmp is not available
		cache_dir = Path("whisper-cache")
		try:
			cache_dir.mkdir(parents=True, exist_ok=True)
		except PermissionError:
			# In read-only environments, skip directory creation
			pass

	try:
		settings = AppSettings()
		# Choose a safe default local storage root if not provided
		if not settings.local_storage_root:
			if settings.environment.lower() in ("production", "staging"):
				settings.local_storage_root = "/tmp/local_storage"
			else:
				settings.local_storage_root = ".local_storage"
		# Generate WORKER_ID once per process if not provided
		if not settings.worker_id:
			import uuid
			settings.worker_id = f"worker-{uuid.uuid4()}"
		# Cache only when not running tests
		if settings.environment.lower() != "test":
			_cached_settings = settings
	except ValidationError as e:
		raise RuntimeError(f"Invalid configuration: {e}")
	# When in test env, return the newly created settings even if cache exists
	return settings if os.getenv("ENVIRONMENT", "").lower() == "test" else _cached_settings


def get_settings() -> AppSettings:
	return load_settings()


