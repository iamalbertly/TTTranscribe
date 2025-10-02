#!/usr/bin/env python3
"""
Minimal API test to check basic functionality
"""

import hmac
import hashlib
import json
import requests
import time

def test_minimal():
    """Test minimal API functionality"""
    
    base_url = "https://iamromeoly-tttranscibe.hf.space"
    api_key = "CLIENT_A_KEY_123"
    api_secret = "CLIENT_A_SECRET_ABC"
    
    # Test with a simple mock URL that should fail gracefully
    test_url = "https://example.com/not-a-tiktok-url"
    
    print("🧪 Minimal API Test")
    print(f"Base URL: {base_url}")
    print(f"Test URL: {test_url}")
    print()
    
    # Generate signature
    timestamp = int(time.time() * 1000)
    body = {"url": test_url}
    body_json = json.dumps(body)
    
    string_to_sign = f"POST\n/api/transcribe\n{body_json}\n{timestamp}"
    signature = hmac.new(
        api_secret.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-Timestamp": str(timestamp),
        "X-Signature": signature
    }
    
    print("🔐 Making request...")
    print(f"Timestamp: {timestamp}")
    print(f"Signature: {signature}")
    
    try:
        response = requests.post(
            f"{base_url}/api/transcribe",
            headers=headers,
            json=body,
            timeout=30
        )
        
        print(f"Response Status: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        print(f"Response Body: {response.text}")
        
        if response.status_code == 200:
            print("✅ SUCCESS!")
            return True
        elif response.status_code == 400:
            print("✅ Expected error for invalid URL")
            return True
        else:
            print(f"❌ Unexpected error: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

if __name__ == "__main__":
    test_minimal()
