/**
 * Core API Journey Test
 * Tests the basic API functionality: health, auth, transcribe, status
 */

const BaseTest = require('../BaseTest');

class CoreAPIJourney extends BaseTest {
  /**
   * Validate protocol compliance of the response
   */
  validateProtocolCompliance(result) {
    this.logger.info('Validating protocol compliance...');
    
    try {
      // Check required fields
      const requiredFields = ['id', 'status', 'progress', 'submittedAt'];
      for (const field of requiredFields) {
        if (!result[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Check status value
      const validStatuses = ['queued', 'processing', 'completed', 'failed'];
      if (!validStatuses.includes(result.status)) {
        throw new Error(`Invalid status: ${result.status}. Must be one of: ${validStatuses.join(', ')}`);
      }

      // Check result object for completed jobs
      if (result.status === 'completed') {
        if (!result.result) {
          throw new Error('Missing result object for completed job');
        }

        const requiredResultFields = ['transcription', 'confidence', 'language', 'duration', 'wordCount', 'speakerCount', 'audioQuality', 'processingTime'];
        for (const field of requiredResultFields) {
          if (result.result[field] === undefined || result.result[field] === null) {
            throw new Error(`Missing required result field: ${field}`);
          }
        }

        // Validate data types
        if (typeof result.result.confidence !== 'number' || result.result.confidence < 0 || result.result.confidence > 1) {
          throw new Error(`Invalid confidence value: ${result.result.confidence}. Must be a number between 0 and 1`);
        }

        if (typeof result.result.duration !== 'number' || result.result.duration < 0) {
          throw new Error(`Invalid duration value: ${result.result.duration}. Must be a positive number`);
        }

        if (typeof result.result.wordCount !== 'number' || result.result.wordCount < 0) {
          throw new Error(`Invalid wordCount value: ${result.result.wordCount}. Must be a non-negative number`);
        }

        if (typeof result.result.speakerCount !== 'number' || result.result.speakerCount < 1) {
          throw new Error(`Invalid speakerCount value: ${result.result.speakerCount}. Must be a positive number`);
        }

        if (typeof result.result.processingTime !== 'number' || result.result.processingTime < 0) {
          throw new Error(`Invalid processingTime value: ${result.result.processingTime}. Must be a non-negative number`);
        }
      }

      this.logger.info('Protocol compliance validation passed');
      return { success: true };

    } catch (error) {
      this.logger.error('Protocol compliance validation failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async run() {
    this.logger.info('Starting Core API Journey Test');
    
    try {
      // Step 1: Test health endpoint
      const healthResult = await this.testHealth();
      if (!healthResult.success) {
        return { success: false, error: `Health check failed: ${healthResult.error}` };
      }

      // Step 2: Test authentication
      const authResult = await this.testAuthentication();
      if (!authResult.success) {
        return { success: false, error: `Authentication test failed: ${authResult.error}` };
      }

      // Step 3: Test transcribe endpoint
      const transcribeResult = await this.testTranscribe();
      if (!transcribeResult.success) {
        return { success: false, error: `Transcribe test failed: ${transcribeResult.error}` };
      }

      const jobId = transcribeResult.details.id;
      this.logger.info(`Job created with ID: ${jobId}`);

      // Step 4: Test status endpoint
      const statusResult = await this.testStatus(jobId);
      if (!statusResult.success) {
        return { success: false, error: `Status test failed: ${statusResult.error}` };
      }

      // Step 5: Wait for completion (with timeout)
      const completionResult = await this.waitForCompletion(jobId, 60000); // 1 minute timeout
      if (!completionResult.success) {
        return { success: false, error: `Job completion failed: ${completionResult.error}` };
      }

      // Step 6: Validate final result
      const finalResult = completionResult.details;
      if (!finalResult.result || !finalResult.result.transcription) {
        return { success: false, error: 'Missing transcription in final result' };
      }

      // Step 7: Validate protocol compliance
      const protocolValidation = this.validateProtocolCompliance(finalResult);
      if (!protocolValidation.success) {
        return { success: false, error: `Protocol validation failed: ${protocolValidation.error}` };
      }

      this.logger.info('Core API Journey Test completed successfully');
      
      return {
        success: true,
        details: {
          jobId,
          finalStatus: finalResult.status,
          hasTranscription: !!finalResult.result.transcription,
          processingTime: finalResult.result.processingTime,
          confidence: finalResult.result.confidence,
          language: finalResult.result.language,
          duration: finalResult.result.duration,
          wordCount: finalResult.result.wordCount,
          speakerCount: finalResult.result.speakerCount,
          audioQuality: finalResult.result.audioQuality,
          protocolCompliant: true
        }
      };

    } catch (error) {
      this.logger.error('Core API Journey Test failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = CoreAPIJourney;
