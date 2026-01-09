import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

class Config:
    """Base configuration."""
    SECRET_KEY = os.getenv('SECRET_KEY', 'change-this-to-a-secure-random-key-in-production')
    
    # Database
    # Uses DATABASE_URL if defined (Postgres), else falls back to local SQLite
    # Note: We point to backend/data/auth.db now
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', f"sqlite:///{BASE_DIR / 'backend' / 'data' / 'auth.db'}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Uploads
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB
    
    # Rate Limiting
    RATELIMIT_DEFAULT = "200 per day;50 per hour"
    RATELIMIT_STORAGE_URI = "memory://"
