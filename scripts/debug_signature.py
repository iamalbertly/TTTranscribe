#!/usr/bin/env python3
"""
Debug signature generation and verification
"""

import hmac
import hashlib
import json
import time

def debug_signature():
    api_key = "CLIENT_A_KEY_123"
    api_secret = "CLIENT_A_SECRET_ABC"
    timestamp = int(time.time() * 1000)
    body = {"url": "https://vm.tiktok.com/ZMAPTWV7o/"}
    body_json = json.dumps(body)
    
    print("🔍 Signature Debug")
    print("=" * 50)
    print(f"API Key: {api_key}")
    print(f"API Secret: {api_secret}")
    print(f"Timestamp: {timestamp}")
    print(f"Body: {body}")
    print(f"Body JSON: {body_json}")
    
    # Generate signature
    string_to_sign = f"POST\n/api/transcribe\n{body_json}\n{timestamp}"
    signature = hmac.new(
        api_secret.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    print(f"String to sign:")
    print(f"'{string_to_sign}'")
    print(f"Signature: {signature}")
    
    # Test with different JSON serialization
    print("\n🧪 Testing different JSON serialization:")
    
    # Test 1: json.dumps with default settings
    json1 = json.dumps(body)
    print(f"json.dumps(body): '{json1}'")
    
    # Test 2: json.dumps with sort_keys=True
    json2 = json.dumps(body, sort_keys=True)
    print(f"json.dumps(body, sort_keys=True): '{json2}'")
    
    # Test 3: json.dumps with separators
    json3 = json.dumps(body, separators=(',', ':'))
    print(f"json.dumps(body, separators=(',', ':')): '{json3}'")
    
    # Test signatures with different JSON formats
    for i, json_str in enumerate([json1, json2, json3], 1):
        test_string = f"POST\n/api/transcribe\n{json_str}\n{timestamp}"
        test_signature = hmac.new(
            api_secret.encode('utf-8'),
            test_string.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        print(f"Test {i} signature: {test_signature}")
    
    return signature, body_json

if __name__ == "__main__":
    debug_signature()
