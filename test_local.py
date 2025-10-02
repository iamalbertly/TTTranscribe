#!/usr/bin/env python3
"""
Local test script for the TTTranscibe API
This script tests the API locally before deployment
"""

import os
import time
import hmac
import hashlib
import json
import requests
import subprocess
import sys

def test_local_api():
    """Test the API locally"""
    
    # API credentials (from the specification)
    API_KEY = "CLIENT_A_KEY_123"
    API_SECRET = "CLIENT_A_SECRET_ABC"
    
    # Generate timestamp
    timestamp = int(time.time() * 1000)
    
    # Request body
    body = {"url": "https://vm.tiktok.com/ZMAPTWV7o/"}
    
    # Create signature
    body_json = json.dumps(body)
    string_to_sign = f"POST\n/api/transcribe\n{body_json}\n{timestamp}"
    signature = hmac.new(
        API_SECRET.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    print(f"Timestamp: {timestamp}")
    print(f"String to sign: {string_to_sign}")
    print(f"Signature: {signature}")
    
    # Make request to local server
    url = "http://localhost:7860/api/transcribe"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
        "X-Timestamp": str(timestamp),
        "X-Signature": signature
    }
    
    print(f"\nMaking request to: {url}")
    print(f"Headers: {headers}")
    print(f"Body: {body_json}")
    
    try:
        response = requests.post(url, headers=headers, json=body, timeout=60)
        print(f"\nResponse Status: {response.status_code}")
        print(f"Response Headers: {dict(response.headers)}")
        print(f"Response Body: {response.text}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"\n✅ Success!")
            print(f"Request ID: {result.get('request_id')}")
            print(f"Status: {result.get('status')}")
            print(f"Language: {result.get('lang')}")
            print(f"Duration: {result.get('duration_sec')} seconds")
            print(f"Transcript: {result.get('transcript', '')[:200]}...")
            print(f"Source: {result.get('source')}")
            print(f"Elapsed: {result.get('elapsed_ms')} ms")
        else:
            print(f"❌ Error: {response.status_code}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection failed - is the local server running?")
        print("Start the server with: python app.py")
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")

def start_local_server():
    """Start the local server in background"""
    print("Starting local server...")
    try:
        # Start the server in background
        process = subprocess.Popen([sys.executable, "app.py"], 
                                 stdout=subprocess.PIPE, 
                                 stderr=subprocess.PIPE)
        print(f"Server started with PID: {process.pid}")
        
        # Wait a bit for server to start
        time.sleep(5)
        
        return process
    except Exception as e:
        print(f"Failed to start server: {e}")
        return None

if __name__ == "__main__":
    print("🧪 Testing TTTranscibe API Locally")
    print("=" * 50)
    
    # Check if server is already running
    try:
        response = requests.get("http://localhost:7860/health", timeout=5)
        if response.status_code == 200:
            print("✅ Server is already running")
        else:
            print("❌ Server is not responding properly")
    except:
        print("❌ Server is not running")
        print("Please start the server with: python app.py")
        print("Then run this test script again")
        sys.exit(1)
    
    print("\nTesting API endpoint:")
    test_local_api()
