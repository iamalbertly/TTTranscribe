import httpx
from .logging_utils import UILogHandler
import re
from urllib.parse import urlparse
from typing import Optional


logger = UILogHandler("tttranscribe")


def validate_tiktok_url(url: str) -> bool:
    """Validate that the URL is a TikTok URL and properly formatted."""
    if not url or not isinstance(url, str):
        return False
    
    # Basic URL validation
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return False
    except Exception:
        return False
    
    # Check if it's a TikTok URL
    tiktok_domains = ['tiktok.com', 'vm.tiktok.com', 'www.tiktok.com']
    return any(domain in parsed.netloc.lower() for domain in tiktok_domains)


def sanitize_url(url: str) -> str:
    """Sanitize URL by removing potentially dangerous characters and normalizing."""
    if not url:
        return ""
    
    # Remove whitespace
    url = url.strip()
    
    # Basic sanitization - remove any characters that could be problematic
    # Keep only alphanumeric, dots, slashes, colons, hyphens, underscores, and query parameters
    sanitized = re.sub(r'[^\w\-_./:?=&%]', '', url)
    
    return sanitized


def expand_tiktok_url(url: str) -> str:
    # Validate and sanitize input URL
    if not validate_tiktok_url(url):
        logger.log("error", "invalid tiktok url", original=url)
        raise ValueError(f"Invalid TikTok URL: {url}")
    
    sanitized_url = sanitize_url(url)
    if not sanitized_url:
        logger.log("error", "url sanitization failed", original=url)
        raise ValueError(f"URL sanitization failed: {url}")
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            "Referer": "https://www.tiktok.com/",
        }
        with httpx.Client(follow_redirects=True, timeout=20.0, headers=headers) as c:
            # Use GET to handle short-link flows that require a GET to resolve
            r = c.get(sanitized_url)
            r.raise_for_status()
            expanded = str(r.url)
            # Normalize strictly to https://www.tiktok.com/@<user>/video/<id>
            m = re.search(r"/video/(\d+)", expanded)
            if m:
                vid = m.group(1)
                # keep placeholder for user if not available; strip query/fragment
                canon = f"https://www.tiktok.com/@_/video/{vid}"
                logger.log("info", "expanded tiktok url (canonical)", original=url, expanded=expanded, canonical=canon)
                return canon
            logger.log("info", "expanded tiktok url", original=url, expanded=expanded)
            return expanded
    except Exception as e:
        logger.log("error", "failed to expand tiktok url", original=url, error=str(e))
        raise RuntimeError(f"Failed to expand TikTok URL: {str(e)}")


