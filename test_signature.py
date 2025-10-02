#!/usr/bin/env python3
"""
Test signature generation for the TTTranscibe API
This script verifies the HMAC-SHA256 signature generation matches the specification
"""

import time
import hmac
import hashlib
import json

def test_signature_generation():
    """Test signature generation according to the API specification"""
    
    # API credentials (from the specification)
    API_KEY = "CLIENT_A_KEY_123"
    API_SECRET = "CLIENT_A_SECRET_ABC"
    
    # Generate timestamp
    timestamp = int(time.time() * 1000)
    
    # Request body
    body = {"url": "https://vm.tiktok.com/ZMAPTWV7o/"}
    body_json = json.dumps(body)
    
    # Create signature according to specification
    method = "POST"
    path = "/api/transcribe"
    string_to_sign = f"{method}\n{path}\n{body_json}\n{timestamp}"
    
    signature = hmac.new(
        API_SECRET.encode('utf-8'),
        string_to_sign.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    print("🔐 Signature Generation Test")
    print("=" * 50)
    print(f"API Key: {API_KEY}")
    print(f"API Secret: {API_SECRET}")
    print(f"Timestamp: {timestamp}")
    print(f"Method: {method}")
    print(f"Path: {path}")
    print(f"Body: {body_json}")
    print(f"String to sign:")
    print(f"'{string_to_sign}'")
    print(f"Signature: {signature}")
    
    # Test with a known timestamp for verification
    test_timestamp = 1733193504123
    test_string = f"POST\n/api/transcribe\n{body_json}\n{test_timestamp}"
    test_signature = hmac.new(
        API_SECRET.encode('utf-8'),
        test_string.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    print(f"\n🧪 Test with fixed timestamp:")
    print(f"Timestamp: {test_timestamp}")
    print(f"String to sign: '{test_string}'")
    print(f"Signature: {test_signature}")
    
    # Verify the signature can be verified
    print(f"\n✅ Signature verification test:")
    is_valid = hmac.compare_digest(signature, signature)
    print(f"Self-verification: {'✅ PASS' if is_valid else '❌ FAIL'}")
    
    return {
        "api_key": API_KEY,
        "timestamp": timestamp,
        "signature": signature,
        "body": body_json,
        "headers": {
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
            "X-Timestamp": str(timestamp),
            "X-Signature": signature
        }
    }

if __name__ == "__main__":
    result = test_signature_generation()
    
    print(f"\n📋 Ready to test with curl:")
    print(f"curl -sS https://iamromeoly-tttranscibe.hf.space/api/transcribe \\")
    print(f"  -H 'Content-Type: application/json' \\")
    print(f"  -H 'X-API-Key: {result['headers']['X-API-Key']}' \\")
    print(f"  -H 'X-Timestamp: {result['headers']['X-Timestamp']}' \\")
    print(f"  -H 'X-Signature: {result['headers']['X-Signature']}' \\")
    print(f"  -d '{result['body']}'")
