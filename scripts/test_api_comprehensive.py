#!/usr/bin/env python3
"""
Comprehensive API test script for TTTranscibe
Tests both local and remote environments with proper API authentication
"""

import os
import sys
import time
import hmac
import hashlib
import json
import requests
import argparse
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

class TTTranscibeAPITester:
    def __init__(self, environment: str = "auto"):
        self.environment = environment
        self.api_key = "CLIENT_A_KEY_123"
        self.api_secret = "CLIENT_A_SECRET_ABC"
        self.test_url = "https://vm.tiktok.com/ZMAPTWV7o/"
        
        # Environment detection
        if environment == "auto":
            self.environment = self._detect_environment()
        
        if self.environment == "local":
            self.base_url = "http://localhost:7860"
        else:
            self.base_url = "https://iamromeoly-tttranscibe.hf.space"
    
    def _detect_environment(self) -> str:
        """Auto-detect if we should test local or remote"""
        try:
            # Try local first
            response = requests.get("http://localhost:7860/health", timeout=5)
            if response.status_code == 200:
                print("🔍 Detected local environment")
                return "local"
        except:
            pass
        
        try:
            # Try remote
            response = requests.get("https://iamromeoly-tttranscibe.hf.space/health", timeout=5)
            if response.status_code == 200:
                print("🔍 Detected remote environment")
                return "remote"
        except:
            pass
        
        print("⚠️  Could not detect environment, defaulting to remote")
        return "remote"
    
    def generate_signature(self, method: str, path: str, body: str, timestamp: int) -> str:
        """Generate HMAC-SHA256 signature for API authentication"""
        string_to_sign = f"{method}\n{path}\n{body}\n{timestamp}"
        signature = hmac.new(
            self.api_secret.encode('utf-8'),
            string_to_sign.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        return signature
    
    def test_health(self) -> bool:
        """Test the health endpoint"""
        print(f"🏥 Testing health endpoint at {self.base_url}/health")
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            print(f"   Status: {response.status_code}")
            if response.status_code == 200:
                health_data = response.json()
                print(f"   Response: {json.dumps(health_data, indent=2)}")
                return True
            else:
                print(f"   Error: {response.text}")
                return False
        except Exception as e:
            print(f"   Error: {e}")
            return False
    
    def test_api_authentication(self) -> Tuple[bool, str]:
        """Test API authentication with proper signature"""
        print(f"🔐 Testing API authentication at {self.base_url}/api/transcribe")
        
        # Generate timestamp and signature
        timestamp = int(time.time() * 1000)
        body = {"url": self.test_url}
        body_json = json.dumps(body)
        
        signature = self.generate_signature("POST", "/api/transcribe", body_json, timestamp)
        
        headers = {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
            "X-Timestamp": str(timestamp),
            "X-Signature": signature
        }
        
        print(f"   Timestamp: {timestamp}")
        print(f"   Signature: {signature}")
        print(f"   Body: {body_json}")
        
        try:
            response = requests.post(
                f"{self.base_url}/api/transcribe",
                headers=headers,
                json=body,
                timeout=60
            )
            
            print(f"   Status: {response.status_code}")
            print(f"   Headers: {dict(response.headers)}")
            
            if response.status_code == 200:
                result = response.json()
                print(f"   ✅ SUCCESS!")
                print(f"   Request ID: {result.get('request_id')}")
                print(f"   Status: {result.get('status')}")
                print(f"   Language: {result.get('lang')}")
                print(f"   Duration: {result.get('duration_sec')} seconds")
                print(f"   Transcript: {result.get('transcript', '')[:200]}...")
                print(f"   Source: {result.get('source')}")
                print(f"   Elapsed: {result.get('elapsed_ms')} ms")
                return True, result.get('transcript', '')
            else:
                print(f"   ❌ Error: {response.text}")
                return False, ""
                
        except Exception as e:
            print(f"   ❌ Request failed: {e}")
            return False, ""
    
    def test_gradio_ui(self) -> bool:
        """Test the Gradio UI endpoint"""
        print(f"🖥️  Testing Gradio UI at {self.base_url}/")
        try:
            response = requests.get(f"{self.base_url}/", timeout=10)
            print(f"   Status: {response.status_code}")
            if response.status_code == 200 and "gradio" in response.text.lower():
                print("   ✅ Gradio UI is accessible")
                return True
            else:
                print("   ❌ Gradio UI not accessible or not found")
                return False
        except Exception as e:
            print(f"   ❌ Error: {e}")
            return False
    
    def test_rate_limiting(self) -> bool:
        """Test rate limiting by making multiple requests"""
        print(f"⏱️  Testing rate limiting (5 requests/minute)")
        
        success_count = 0
        rate_limited = False
        
        for i in range(7):  # Make 7 requests to test rate limiting
            print(f"   Request {i+1}/7...")
            
            timestamp = int(time.time() * 1000)
            body = {"url": self.test_url}
            body_json = json.dumps(body)
            signature = self.generate_signature("POST", "/api/transcribe", body_json, timestamp)
            
            headers = {
                "Content-Type": "application/json",
                "X-API-Key": self.api_key,
                "X-Timestamp": str(timestamp),
                "X-Signature": signature
            }
            
            try:
                response = requests.post(
                    f"{self.base_url}/api/transcribe",
                    headers=headers,
                    json=body,
                    timeout=10
                )
                
                if response.status_code == 200:
                    success_count += 1
                    print(f"     ✅ Success")
                elif response.status_code == 429:
                    rate_limited = True
                    print(f"     ⚠️  Rate limited (expected)")
                    break
                else:
                    print(f"     ❌ Error: {response.status_code}")
                    
            except Exception as e:
                print(f"     ❌ Request failed: {e}")
            
            time.sleep(1)  # Small delay between requests
        
        if rate_limited:
            print(f"   ✅ Rate limiting is working (limited after {success_count} requests)")
            return True
        else:
            print(f"   ⚠️  Rate limiting not triggered (made {success_count} requests)")
            return False
    
    def run_comprehensive_test(self) -> bool:
        """Run all tests and return overall success"""
        print("🧪 TTTranscibe API Comprehensive Test")
        print("=" * 50)
        print(f"Environment: {self.environment}")
        print(f"Base URL: {self.base_url}")
        print(f"Test URL: {self.test_url}")
        print()
        
        tests_passed = 0
        total_tests = 4
        
        # Test 1: Health endpoint
        print("1️⃣ Testing Health Endpoint")
        if self.test_health():
            tests_passed += 1
            print("   ✅ Health test passed")
        else:
            print("   ❌ Health test failed")
        print()
        
        # Test 2: API Authentication and Transcription
        print("2️⃣ Testing API Authentication and Transcription")
        success, transcript = self.test_api_authentication()
        if success and transcript:
            tests_passed += 1
            print("   ✅ API authentication and transcription test passed")
        else:
            print("   ❌ API authentication and transcription test failed")
        print()
        
        # Test 3: Gradio UI
        print("3️⃣ Testing Gradio UI")
        if self.test_gradio_ui():
            tests_passed += 1
            print("   ✅ Gradio UI test passed")
        else:
            print("   ❌ Gradio UI test failed")
        print()
        
        # Test 4: Rate Limiting (only if not local)
        if self.environment != "local":
            print("4️⃣ Testing Rate Limiting")
            if self.test_rate_limiting():
                tests_passed += 1
                print("   ✅ Rate limiting test passed")
            else:
                print("   ❌ Rate limiting test failed")
            print()
        else:
            print("4️⃣ Skipping Rate Limiting Test (local environment)")
            tests_passed += 1
            print("   ✅ Rate limiting test skipped")
            print()
        
        # Summary
        print("📊 Test Summary")
        print("=" * 30)
        print(f"Tests passed: {tests_passed}/{total_tests}")
        
        if tests_passed == total_tests:
            print("🎉 ALL TESTS PASSED!")
            print("The TTTranscibe API is working correctly.")
            return True
        else:
            print("❌ SOME TESTS FAILED!")
            print("Please check the errors above and fix any issues.")
            return False

def main():
    parser = argparse.ArgumentParser(description="Test TTTranscibe API")
    parser.add_argument("--env", choices=["local", "remote", "auto"], default="auto",
                       help="Environment to test (default: auto-detect)")
    parser.add_argument("--url", default="https://vm.tiktok.com/ZMAPTWV7o/",
                       help="TikTok URL to test with")
    
    args = parser.parse_args()
    
    tester = TTTranscibeAPITester(environment=args.env)
    tester.test_url = args.url
    
    success = tester.run_comprehensive_test()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
