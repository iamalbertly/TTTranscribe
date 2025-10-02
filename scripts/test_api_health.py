#!/usr/bin/env python3
"""
Test API health and basic functionality
"""

import requests
import json

def test_health():
    """Test health endpoint"""
    print("🏥 Testing Health Endpoint")
    
    try:
        response = requests.get("https://iamromeoly-tttranscibe.hf.space/health", timeout=10)
        print(f"Status: {response.status_code}")
        print(f"Content: {response.text}")
        
        if response.status_code == 200:
            health_data = response.json()
            print("✅ Health endpoint working")
            return True
        else:
            print("❌ Health endpoint failed")
            return False
    except Exception as e:
        print(f"❌ Health test failed: {e}")
        return False

def test_gradio_ui():
    """Test Gradio UI"""
    print("\n🖥️ Testing Gradio UI")
    
    try:
        response = requests.get("https://iamromeoly-tttranscibe.hf.space/", timeout=10)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200 and "gradio" in response.text.lower():
            print("✅ Gradio UI accessible")
            return True
        else:
            print("❌ Gradio UI not accessible")
            return False
    except Exception as e:
        print(f"❌ Gradio UI test failed: {e}")
        return False

def test_api_structure():
    """Test API structure without processing"""
    print("\n🔧 Testing API Structure")
    
    # Test with invalid request to see error handling
    try:
        response = requests.post(
            "https://iamromeoly-tttranscibe.hf.space/api/transcribe",
            json={"invalid": "request"},
            timeout=10
        )
        print(f"Status: {response.status_code}")
        print(f"Content: {response.text}")
        
        if response.status_code in [400, 401, 403, 422]:
            print("✅ API structure working (expected error)")
            return True
        else:
            print(f"❌ Unexpected response: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ API structure test failed: {e}")
        return False

def main():
    print("🧪 API Health and Structure Test")
    print("=" * 40)
    
    tests = [
        test_health,
        test_gradio_ui,
        test_api_structure
    ]
    
    passed = 0
    for test in tests:
        if test():
            passed += 1
    
    print(f"\n📊 Results: {passed}/{len(tests)} tests passed")
    
    if passed == len(tests):
        print("✅ All basic tests passed")
        return True
    else:
        print("❌ Some tests failed")
        return False

if __name__ == "__main__":
    main()
