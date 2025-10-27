/**
 * Protocol Compliance Journey Test
 * Tests compliance with Pluct Business Engine communication protocols
 */

const BaseTest = require('../BaseTest');

class ProtocolComplianceJourney extends BaseTest {
  async run() {
    this.logger.info('Starting Protocol Compliance Journey Test');
    
    try {
      // Step 1: Test POST /transcribe response format
      const transcribeFormatResult = await this.testTranscribeResponseFormat();
      if (!transcribeFormatResult.success) {
        return { success: false, error: `Transcribe format test failed: ${transcribeFormatResult.error}` };
      }

      const jobId = transcribeFormatResult.details.jobId;

      // Step 2: Test GET /status/:id response format
      const statusFormatResult = await this.testStatusResponseFormat(jobId);
      if (!statusFormatResult.success) {
        return { success: false, error: `Status format test failed: ${statusFormatResult.error}` };
      }

      // Step 3: Wait for completion and test final result format
      const completionResult = await this.waitForCompletion(jobId, 60000);
      if (!completionResult.success) {
        return { success: false, error: `Job completion failed: ${completionResult.error}` };
      }

      // Step 4: Test final result format
      const finalResultFormatResult = await this.testFinalResultFormat(completionResult.details);
      if (!finalResultFormatResult.success) {
        return { success: false, error: `Final result format test failed: ${finalResultFormatResult.error}` };
      }

      // Step 5: Test error response formats
      const errorFormatResult = await this.testErrorResponseFormats();
      if (!errorFormatResult.success) {
        return { success: false, error: `Error format test failed: ${errorFormatResult.error}` };
      }

      this.logger.info('Protocol Compliance Journey Test completed successfully');
      
      return {
        success: true,
        details: {
          transcribeFormat: transcribeFormatResult.details,
          statusFormat: statusFormatResult.details,
          finalResultFormat: finalResultFormatResult.details,
          errorFormats: errorFormatResult.details,
          jobId,
          protocolCompliant: true
        }
      };

    } catch (error) {
      this.logger.error('Protocol Compliance Journey Test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testTranscribeResponseFormat() {
    this.logger.info('Testing POST /transcribe response format...');
    
    try {
      const response = await this.makeRequest('POST', '/transcribe', {
        url: this.config.TEST_URL
      }, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      if (response.statusCode !== 202) {
        throw new Error(`Expected 202, got ${response.statusCode}`);
      }

      const body = response.body;
      
      // Check required fields according to protocol
      const requiredFields = ['id', 'status', 'submittedAt', 'estimatedProcessingTime', 'url'];
      const missingFields = requiredFields.filter(field => !body[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      // Check field types and values
      if (typeof body.id !== 'string' || body.id.length === 0) {
        throw new Error('Invalid job ID format');
      }

      if (body.status !== 'queued') {
        throw new Error(`Expected status 'queued', got '${body.status}'`);
      }

      if (typeof body.estimatedProcessingTime !== 'number' || body.estimatedProcessingTime <= 0) {
        throw new Error('Invalid estimatedProcessingTime');
      }

      if (body.url !== this.config.TEST_URL) {
        throw new Error(`URL mismatch: expected '${this.config.TEST_URL}', got '${body.url}'`);
      }

      // Validate timestamp format
      const submittedAt = new Date(body.submittedAt);
      if (isNaN(submittedAt.getTime())) {
        throw new Error('Invalid submittedAt timestamp format');
      }

      this.logger.info('POST /transcribe response format test passed');
      
      return {
        success: true,
        details: {
          jobId: body.id,
          status: body.status,
          submittedAt: body.submittedAt,
          estimatedProcessingTime: body.estimatedProcessingTime,
          url: body.url
        }
      };
      
    } catch (error) {
      this.logger.error('POST /transcribe response format test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testStatusResponseFormat(jobId) {
    this.logger.info(`Testing GET /status/:id response format for job ${jobId}...`);
    
    try {
      const response = await this.makeRequest('GET', `/status/${jobId}`, null, {
        'X-Engine-Auth': this.config.AUTH_SECRET
      });

      if (response.statusCode !== 200) {
        throw new Error(`Expected 200, got ${response.statusCode}`);
      }

      const body = response.body;
      
      // Check required fields
      const requiredFields = ['id', 'status', 'progress', 'submittedAt'];
      const missingFields = requiredFields.filter(field => !body[field]);
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      // Check field types and values
      if (body.id !== jobId) {
        throw new Error(`Job ID mismatch: expected '${jobId}', got '${body.id}'`);
      }

      const validStatuses = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
      if (!validStatuses.includes(body.status)) {
        throw new Error(`Invalid status: '${body.status}'. Must be one of: ${validStatuses.join(', ')}`);
      }

      if (typeof body.progress !== 'number' || body.progress < 0 || body.progress > 100) {
        throw new Error(`Invalid progress: ${body.progress}. Must be between 0 and 100`);
      }

      // Validate timestamp format
      const submittedAt = new Date(body.submittedAt);
      if (isNaN(submittedAt.getTime())) {
        throw new Error('Invalid submittedAt timestamp format');
      }

      // Check optional fields if present
      if (body.completedAt) {
        const completedAt = new Date(body.completedAt);
        if (isNaN(completedAt.getTime())) {
          throw new Error('Invalid completedAt timestamp format');
        }
      }

      if (body.estimatedCompletion) {
        const estimatedCompletion = new Date(body.estimatedCompletion);
        if (isNaN(estimatedCompletion.getTime())) {
          throw new Error('Invalid estimatedCompletion timestamp format');
        }
      }

      this.logger.info('GET /status/:id response format test passed');
      
      return {
        success: true,
        details: {
          id: body.id,
          status: body.status,
          progress: body.progress,
          submittedAt: body.submittedAt,
          completedAt: body.completedAt,
          estimatedCompletion: body.estimatedCompletion,
          currentStep: body.currentStep
        }
      };
      
    } catch (error) {
      this.logger.error('GET /status/:id response format test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testFinalResultFormat(finalResult) {
    this.logger.info('Testing final result format...');
    
    try {
      if (finalResult.status !== 'completed') {
        throw new Error(`Expected completed status, got '${finalResult.status}'`);
      }

      if (!finalResult.result) {
        throw new Error('Missing result object');
      }

      const result = finalResult.result;
      
      // Check required result fields
      const requiredResultFields = ['transcription', 'confidence', 'language', 'duration'];
      const missingResultFields = requiredResultFields.filter(field => result[field] === undefined);
      
      if (missingResultFields.length > 0) {
        throw new Error(`Missing required result fields: ${missingResultFields.join(', ')}`);
      }

      // Check field types and values
      if (typeof result.transcription !== 'string') {
        throw new Error('Invalid transcription type');
      }

      if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
        throw new Error(`Invalid confidence: ${result.confidence}. Must be between 0 and 1`);
      }

      if (typeof result.language !== 'string' || result.language.length === 0) {
        throw new Error('Invalid language format');
      }

      if (typeof result.duration !== 'number' || result.duration <= 0) {
        throw new Error(`Invalid duration: ${result.duration}. Must be positive number`);
      }

      // Check optional fields if present
      if (result.wordCount !== undefined && (typeof result.wordCount !== 'number' || result.wordCount < 0)) {
        throw new Error('Invalid wordCount');
      }

      if (result.speakerCount !== undefined && (typeof result.speakerCount !== 'number' || result.speakerCount < 0)) {
        throw new Error('Invalid speakerCount');
      }

      if (result.audioQuality !== undefined && typeof result.audioQuality !== 'string') {
        throw new Error('Invalid audioQuality type');
      }

      if (result.processingTime !== undefined && (typeof result.processingTime !== 'number' || result.processingTime < 0)) {
        throw new Error('Invalid processingTime');
      }

      this.logger.info('Final result format test passed');
      
      return {
        success: true,
        details: {
          transcription: result.transcription,
          confidence: result.confidence,
          language: result.language,
          duration: result.duration,
          wordCount: result.wordCount,
          speakerCount: result.speakerCount,
          audioQuality: result.audioQuality,
          processingTime: result.processingTime
        }
      };
      
    } catch (error) {
      this.logger.error('Final result format test failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testErrorResponseFormats() {
    this.logger.info('Testing error response formats...');
    
    const errorTests = [
      {
        name: 'Invalid URL',
        request: { url: 'not-a-url' },
        expectedStatus: 400,
        expectedError: 'invalid_url'
      },
      {
        name: 'Unauthorized',
        request: { url: this.config.TEST_URL },
        headers: {},
        expectedStatus: 401,
        expectedError: 'unauthorized'
      },
      {
        name: 'Non-existent job',
        method: 'GET',
        endpoint: '/status/non-existent-job-id',
        expectedStatus: 404,
        expectedError: 'job_not_found'
      }
    ];

    const results = [];
    
    for (const test of errorTests) {
      try {
        let response;
        
        if (test.method === 'GET') {
          response = await this.makeRequest('GET', test.endpoint, null, {
            'X-Engine-Auth': this.config.AUTH_SECRET
          });
        } else {
          response = await this.makeRequest('POST', '/transcribe', test.request, {
            'X-Engine-Auth': this.config.AUTH_SECRET,
            ...test.headers
          });
        }

        if (response.statusCode !== test.expectedStatus) {
          throw new Error(`Expected ${test.expectedStatus}, got ${response.statusCode}`);
        }

        if (response.body && response.body.error !== test.expectedError) {
          throw new Error(`Expected error '${test.expectedError}', got '${response.body.error}'`);
        }

        // Check error response format
        if (response.body) {
          const requiredErrorFields = ['error', 'message'];
          const missingErrorFields = requiredErrorFields.filter(field => !response.body[field]);
          
          if (missingErrorFields.length > 0) {
            throw new Error(`Missing required error fields: ${missingErrorFields.join(', ')}`);
          }
        }

        results.push({ name: test.name, success: true });
        this.logger.info(`✅ ${test.name} error format test passed`);
        
      } catch (error) {
        results.push({ name: test.name, success: false, error: error.message });
        this.logger.error(`❌ ${test.name} error format test failed: ${error.message}`);
      }
    }

    const allPassed = results.every(r => r.success);
    return { success: allPassed, details: results };
  }
}

module.exports = ProtocolComplianceJourney;
