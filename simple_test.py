#!/usr/bin/env python3
"""
Simple test to check if the API is accessible
"""

import requests
import time

def test_health():
    """Test the health endpoint"""
    try:
        print("Testing health endpoint...")
        response = requests.get("https://iamromeoly-tttranscibe.hf.space/health", timeout=10)
        print(f"Health Status: {response.status_code}")
        print(f"Health Response: {response.text}")
        return response.status_code == 200
    except Exception as e:
        print(f"Health test failed: {e}")
        return False

def test_root():
    """Test the root endpoint"""
    try:
        print("Testing root endpoint...")
        response = requests.get("https://iamromeoly-tttranscibe.hf.space/", timeout=10)
        print(f"Root Status: {response.status_code}")
        print(f"Root Response: {response.text[:200]}...")
        return response.status_code == 200
    except Exception as e:
        print(f"Root test failed: {e}")
        return False

if __name__ == "__main__":
    print("🧪 Simple API Test")
    print("=" * 30)
    
    health_ok = test_health()
    root_ok = test_root()
    
    if health_ok:
        print("✅ Health endpoint is working")
    else:
        print("❌ Health endpoint failed")
    
    if root_ok:
        print("✅ Root endpoint is working")
    else:
        print("❌ Root endpoint failed")
