/**
 * Core API Journey Test
 * Tests the basic API functionality: health, auth, transcribe, status
 */

const BaseTest = require('../BaseTest');

class CoreAPIJourney extends BaseTest {
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
          duration: finalResult.result.duration
        }
      };

    } catch (error) {
      this.logger.error('Core API Journey Test failed:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = CoreAPIJourney;
