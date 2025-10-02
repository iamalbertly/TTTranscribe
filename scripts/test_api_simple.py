#!/usr/bin/env python3
"""
Simple API test script for TTTranscibe
Quick test for API functionality
"""

import os
import sys
import time
import hmac
import hashlib
import json
import requests
import argparse

def test_api_quick(environment="auto", test_url="https://www.tiktok.com/@its.factsonly/video/7554590723895594258"):
    """Quick API test"""
    
    # Environment detection
    if environment == "auto":
        try:
            response = requests.get("http://localhost:7860/health", timeout=5)
            if response.status_code == 200:
                environment = "local"
                base_url = "http://localhost:7860"
            else:
                raise Exception("Local not available")
        except:
            environment = "remote"
            base_url = "https://iamromeoly-tttranscibe.hf.space"
    else:
        base_url = "http://localhost:7860" if environment == "local" else "https://iamromeoly-tttranscibe.hf.space"
    
    print(f"🧪 Quick API Test - {environment.upper()}")
    print(f"Base URL: {base_url}")
    print(f"Test URL: {test_url}")
    print()
    
    # API credentials
    api_key = "CLIENT_A_KEY_123"
    api_secret = "CLIENT_A_SECRET_ABC"
    
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
    
    print("🔐 Making authenticated request...")
    print(f"Timestamp: {timestamp}")
    print(f"Signature: {signature}")
    
    try:
        response = requests.post(
            f"{base_url}/api/transcribe",
            headers=headers,
            json=body,
            timeout=60
        )
        
        print(f"Response Status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print("✅ SUCCESS!")
            print(f"Request ID: {result.get('request_id')}")
            print(f"Status: {result.get('status')}")
            print(f"Language: {result.get('lang')}")
            print(f"Duration: {result.get('duration_sec')} seconds")
            print(f"Transcript: {result.get('transcript', '')[:200]}...")
            return True
        else:
            print(f"❌ Error: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Request failed: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Quick TTTranscibe API test")
    parser.add_argument("--env", choices=["local", "remote", "auto"], default="auto",
                       help="Environment to test (default: auto-detect)")
    parser.add_argument("--url", default="https://www.tiktok.com/@its.factsonly/video/7554590723895594258",
                       help="TikTok URL to test with")
    
    args = parser.parse_args()
    
    success = test_api_quick(args.env, args.url)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
