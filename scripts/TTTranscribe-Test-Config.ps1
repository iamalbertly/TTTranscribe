# TTTranscribe Test Configuration
# Centralized configuration for all test scenarios

# Test Environment Configuration
$TestConfig = @{
    # API Configuration
    API = @{
        BaseUrl = "http://localhost:8788"
        AuthSecret = "super-long-random"
        TimeoutSeconds = 30
    }
    
    # Test URLs
    TestUrls = @{
        ValidTikTok = "https://www.tiktok.com/@test/video/1234567890"
        InvalidUrl = "https://invalid-url.com"
        RedirectUrl = "https://vm.tiktok.com/redirect"
    }
    
    # (Android/ADB config removed — service-only)
    
    # Test Scenarios
    Scenarios = @{
        QuickTest = @{
            Name = "Quick API Test"
            Duration = 30
            Tests = @("Health", "Transcribe", "Status")
        }
        FullTest = @{
            Name = "Full Integration Test"
            Duration = 120
            Tests = @("Health", "Transcribe", "Status", "Journey")
        }
    }
    
    # Error Handling
    ErrorHandling = @{
        TerminateOnFirstError = $true
        RetryCount = 3
        RetryDelay = 5
        LogLevel = "Detailed"
    }
    
    # Performance Thresholds
    Performance = @{
        MaxResponseTime = 5  # seconds
        MaxJobCompletionTime = 60  # seconds
        MaxMemoryUsage = 512  # MB
    }
}

# Export configuration
return $TestConfig
