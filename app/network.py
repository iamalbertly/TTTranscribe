import httpx
from .logging_utils import UILogHandler


logger = UILogHandler("tttranscribe")


def expand_tiktok_url(url: str) -> str:
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            "Referer": "https://www.tiktok.com/",
        }
        with httpx.Client(follow_redirects=True, timeout=15.0, headers=headers) as c:
            r = c.head(url)
            expanded = str(r.url)
            logger.log("info", "expanded tiktok url", original=url, expanded=expanded)
            return expanded
    except Exception as e:
        logger.log("error", "failed to expand tiktok url", original=url, error=str(e))
        return url


