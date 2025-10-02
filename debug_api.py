#!/usr/bin/env python3
"""
Debug script to understand the current API format
"""

import requests
import json

def test_api_format():
    """Test different request formats to understand the API"""
    
    url = "https://iamromeoly-tttranscibe.hf.space/api/transcribe"
    
    # Test 1: Simple request without auth to see what it expects
    print("🧪 Test 1: Simple request without auth")
    try:
        response = requests.post(url, json={"url": "https://vm.tiktok.com/ZMAPTWV7o/"})
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")
    
    print("\n" + "="*50)
    
    # Test 2: Check if there's a different endpoint
    print("🧪 Test 2: Check health endpoint")
    try:
        response = requests.get("https://iamromeoly-tttranscibe.hf.space/health")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text}")
    except Exception as e:
        print(f"Error: {e}")
    
    print("\n" + "="*50)
    
    # Test 3: Check root endpoint
    print("🧪 Test 3: Check root endpoint")
    try:
        response = requests.get("https://iamromeoly-tttranscibe.hf.space/")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.text[:500]}...")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_api_format()
