# TTTranscribe E2E Test Suite

Comprehensive end-to-end testing suite for TTTranscribe service, designed to validate all functionality, performance, and protocol compliance.

## Overview

This test suite provides automated testing for:
- Core API functionality
- Error handling and edge cases
- Cache behavior (48-hour TTL)
- Protocol compliance with Pluct Business Engine
- Performance characteristics
- Load handling and concurrency

## Structure

```
scripts/nodejs/
├── orchestrator.js          # Main test orchestrator
├── BaseTest.js              # Base test class with common functionality
├── config.js                # Centralized configuration
├── package.json             # Node.js package configuration
├── README.md                # This file
└── journeys/                # Individual test journey files
    ├── CoreAPIJourney.js     # Basic API functionality tests
    ├── ErrorHandlingJourney.js # Error scenarios and edge cases
    ├── CacheBehaviorJourney.js # Cache functionality tests
    ├── ProtocolComplianceJourney.js # Protocol compliance validation
    └── PerformanceJourney.js # Performance and load tests
```

## Quick Start

### Prerequisites
- Node.js 14+ 
- Access to TTTranscribe service (local or remote)

### Running Tests

```bash
# Run all tests
npm run test:all

# Run specific test journeys
npm run test:core        # Core API functionality
npm run test:errors      # Error handling
npm run test:cache       # Cache behavior
npm run test:protocol    # Protocol compliance
npm run test:performance # Performance tests
```

### Environment Variables

Configure tests using environment variables:

```bash
# Service configuration
export BASE_URL="https://iamromeoly-tttranscribe.hf.space"
export ENGINE_SHARED_SECRET="hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU"
export TEST_URL="https://www.tiktok.com/@test/video/1234567890"

# Test configuration
export TEST_TIMEOUT="30000"
export MAX_RETRIES="3"
export VERBOSE="true"
export LOG_LEVEL="info"

# Performance test configuration
export CONCURRENT_REQUESTS="5"
export CONSISTENCY_TESTS="10"
export ACCEPTABLE_RESPONSE_TIME="5000"
export EXCELLENT_RESPONSE_TIME="1000"

# Cache test configuration
export CACHE_HIT_THRESHOLD="500"
```

## Test Journeys

### 1. Core API Journey (`CoreAPIJourney.js`)

Tests the fundamental API functionality:
- Health endpoint validation
- Authentication mechanisms
- Job creation via POST /transcribe
- Job status checking via GET /status/:id
- Job completion and result validation

**Key Validations:**
- Response status codes (202 for transcribe, 200 for status)
- Required field presence and types
- Job ID generation and consistency
- Result object structure and content

### 2. Error Handling Journey (`ErrorHandlingJourney.js`)

Tests error scenarios and edge cases:
- Invalid URL handling
- Missing authentication
- Non-existent job requests
- Malformed request bodies
- Rate limiting behavior

**Key Validations:**
- Proper HTTP status codes (400, 401, 404, 429)
- Structured error response format
- Error message clarity and consistency
- Graceful degradation

### 3. Cache Behavior Journey (`CacheBehaviorJourney.js`)

Tests the 48-hour job result caching:
- Cache miss on first request
- Cache hit on subsequent identical requests
- Cache performance improvements
- URL normalization and cache key generation

**Key Validations:**
- Response time improvements on cache hits
- Identical results for cached requests
- Proper cache key generation
- Cache miss behavior for different URLs

### 4. Protocol Compliance Journey (`ProtocolComplianceJourney.js`)

Validates compliance with Pluct Business Engine protocols:
- POST /transcribe response format
- GET /status/:id response format
- Error response structure
- Field naming and data types
- Timestamp formats

**Key Validations:**
- Required fields: `id`, `status`, `submittedAt`, `estimatedProcessingTime`
- Status values: `queued`, `processing`, `completed`, `failed`, `cancelled`
- Result object structure with `transcription`, `confidence`, `language`, `duration`
- Error response format with `error`, `message`, `details`

### 5. Performance Journey (`PerformanceJourney.js`)

Tests performance characteristics and load handling:
- Single request response times
- Concurrent request handling
- Response time consistency
- Memory usage patterns

**Key Validations:**
- Response time thresholds (excellent: <1s, good: <5s)
- Concurrent request success rates (target: >80%)
- Response time consistency (CV <20% excellent, <50% good)
- Memory usage patterns and leaks

## Test Results

### Output Format

Tests provide detailed logging and structured results:

```
[2025-10-26T19:00:00.000Z] [INFO] Starting Core API Journey Test
[2025-10-26T19:00:00.100Z] [INFO] Testing health endpoint...
[2025-10-26T19:00:00.200Z] [INFO] Health check passed
[2025-10-26T19:00:00.300Z] [INFO] Testing authentication...
[2025-10-26T19:00:00.400Z] [INFO] Authentication tests passed
...
[2025-10-26T19:00:05.000Z] [INFO] ✅ CoreAPIJourney passed (5000ms)

============================================================
TEST EXECUTION SUMMARY
============================================================
Total Tests: 5
Passed: 5 (100%)
Failed: 0
Skipped: 0
Duration: 25000ms
============================================================
```

### Success Criteria

- **Core API**: All endpoints respond correctly with proper status codes
- **Error Handling**: All error scenarios return appropriate responses
- **Cache Behavior**: Cache hits are faster and return identical results
- **Protocol Compliance**: All responses match Pluct Business Engine format
- **Performance**: Response times meet thresholds, concurrent requests succeed

## Integration with CI/CD

### GitHub Actions Example

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '16'
      
      - name: Run E2E Tests
        run: |
          cd scripts/nodejs
          npm run test:all
        env:
          BASE_URL: ${{ secrets.TTTRANSCRIBE_URL }}
          ENGINE_SHARED_SECRET: ${{ secrets.ENGINE_SHARED_SECRET }}
```

### Local Development

```bash
# Test against local instance
export BASE_URL="http://localhost:8788"
npm run test:all

# Test against staging
export BASE_URL="https://staging-tttranscribe.hf.space"
npm run test:all

# Test against production
export BASE_URL="https://iamromeoly-tttranscribe.hf.space"
npm run test:all
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify `ENGINE_SHARED_SECRET` matches service configuration
   - Check `X-Engine-Auth` header format

2. **Timeout Errors**
   - Increase `TEST_TIMEOUT` for slow networks
   - Check service availability and performance

3. **Cache Test Failures**
   - Verify cache is enabled and working
   - Check cache TTL configuration (should be 48 hours)

4. **Protocol Compliance Failures**
   - Compare actual responses with expected format
   - Check field names and data types
   - Validate timestamp formats

### Debug Mode

Enable verbose logging for detailed debugging:

```bash
export VERBOSE="true"
export LOG_LEVEL="debug"
npm run test:all
```

## Contributing

### Adding New Test Journeys

1. Create new journey file in `journeys/` directory
2. Extend `BaseTest` class
3. Implement `run()` method
4. Add to orchestrator discovery
5. Update documentation

### Test Best Practices

- Use descriptive test names and logging
- Include both positive and negative test cases
- Validate response formats and data types
- Test edge cases and error conditions
- Measure and report performance metrics
- Ensure tests are independent and repeatable

## License

MIT License - see main project license for details.
