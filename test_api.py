#!/usr/bin/env python3
"""
Test script for the TTTranscibe API
This script implements the curl test from the API specification
"""

import os
import time
import hmac
import hashlib
import subprocess
import json
import requests

def test_api_signature():
    """Test the API signature generation and request"""
    
    # API credentials (from the specification)
    API_KEY = "CLIENT_A_KEY_123"
    API_SECRET = "CLIENT_A_SECRET_ABC"
    
    # Generate timestamp
    timestamp = int(time.time() * 1000)
    
    # Request body
    body = '{"url":"https://vm.tiktok.com/ZMAPTWV7o/"}'
    
    # Create signature
    string_to_sign = f"POST\n/api/transcribe\n{body}\n{timestamp}"
    signature = hmac.new(
        API_SECRET.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    print(f"Timestamp: {timestamp}")
    print(f"String to sign: {string_to_sign}")
    print(f"Signature: {signature}")
    
    # Make request
    url = "https://iamromeoly-tttranscibe.hf.space/api/transcribe"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
        "X-Timestamp": str(timestamp),
        "X-Signature": signature
    }
    
    print(f"\nMaking request to: {url}")
    print(f"Headers: {headers}")
    print(f"Body: {body}")
    
    try:
        response = requests.post(url, headers=headers, json=json.loads(body), timeout=60)
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
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")

def test_curl_command():
    """Test using the exact curl command from the specification"""
    
    # Set up environment variables
    env = os.environ.copy()
    env.update({
        'API_KEY': 'CLIENT_A_KEY_123',
        'API_SECRET': 'CLIENT_A_SECRET_ABC'
    })
    
    # Generate timestamp using Python
    timestamp_cmd = [
        'python', '-c', 
        'import time; print(int(time.time()*1000))'
    ]
    
    try:
        result = subprocess.run(timestamp_cmd, capture_output=True, text=True, env=env)
        timestamp = result.stdout.strip()
        
        body = '{"url":"https://vm.tiktok.com/ZMAPTWV7o/"}'
        sign_input = f"POST\n/api/transcribe\n{body}\n{timestamp}"
        
        # Generate signature using openssl
        openssl_cmd = [
            'openssl', 'dgst', '-sha256', '-mac', 'HMAC', 
            f'-macopt', f'key:{env["API_SECRET"]}'
        ]
        
        openssl_process = subprocess.Popen(
            openssl_cmd, 
            stdin=subprocess.PIPE, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            text=True,
            env=env
        )
        
        stdout, stderr = openssl_process.communicate(input=sign_input)
        
        if openssl_process.returncode != 0:
            print(f"❌ OpenSSL failed: {stderr}")
            return
            
        signature = stdout.split()[1]  # Extract hex from openssl output
        
        # Build curl command
        curl_cmd = [
            'curl', '-sS', 
            'https://iamromeoly-tttranscibe.hf.space/api/transcribe',
            '-H', 'Content-Type: application/json',
            '-H', f'X-API-Key: {env["API_KEY"]}',
            '-H', f'X-Timestamp: {timestamp}',
            '-H', f'X-Signature: {signature}',
            '-d', body
        ]
        
        print(f"Running curl command: {' '.join(curl_cmd)}")
        
        # Execute curl
        curl_result = subprocess.run(curl_cmd, capture_output=True, text=True, env=env)
        
        print(f"Curl exit code: {curl_result.returncode}")
        print(f"Curl stdout: {curl_result.stdout}")
        if curl_result.stderr:
            print(f"Curl stderr: {curl_result.stderr}")
            
        if curl_result.returncode == 0:
            try:
                result_json = json.loads(curl_result.stdout)
                print(f"✅ Curl test successful!")
                print(f"Response: {json.dumps(result_json, indent=2)}")
            except json.JSONDecodeError:
                print(f"❌ Invalid JSON response: {curl_result.stdout}")
        else:
            print(f"❌ Curl failed with exit code {curl_result.returncode}")
            
    except Exception as e:
        print(f"❌ Test failed: {e}")

if __name__ == "__main__":
    print("🧪 Testing TTTranscibe API")
    print("=" * 50)
    
    print("\n1. Testing with Python requests:")
    test_api_signature()
    
    print("\n" + "=" * 50)
    print("\n2. Testing with curl command:")
    test_curl_command()
