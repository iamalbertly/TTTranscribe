import httpx
from .logging_utils import UILogHandler
import re


logger = UILogHandler("tttranscribe")


def expand_tiktok_url(url: str) -> str:
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            "Referer": "https://www.tiktok.com/",
        }
        with httpx.Client(follow_redirects=True, timeout=20.0, headers=headers) as c:
            # Use GET to handle short-link flows that require a GET to resolve
            r = c.get(url)
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
        return url


