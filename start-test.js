#!/usr/bin/env node

/**
 * Start TTTranscribe server for testing
 * Loads environment variables and starts the server
 */

const { spawn } = require('child_process');
const path = require('path');

// Load environment variables from test.env
require('dotenv').config({ path: path.join(__dirname, 'test.env') });

console.log('🚀 Starting TTTranscribe server for testing...');
console.log('📋 Configuration:');
console.log(`   Port: ${process.env.PORT || 8788}`);
console.log(`   Auth Secret: ${process.env.ENGINE_SHARED_SECRET ? 'Set' : 'Not set'}`);
console.log(`   ASR Provider: ${process.env.ASR_PROVIDER || 'hf'}`);
console.log(`   Temp Dir: ${process.env.TMP_DIR || '/tmp/ttt'}`);
console.log('');

// Start the server
const server = spawn('node', ['dist/index.js'], {
  stdio: 'inherit',
  env: process.env
});

server.on('error', (error) => {
  console.error('❌ Failed to start server:', error.message);
  process.exit(1);
});

server.on('exit', (code) => {
  console.log(`\n🛑 Server exited with code ${code}`);
  process.exit(code);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.kill('SIGINT');
  process.exit(0);
});

console.log('✅ Server started! Press Ctrl+C to stop.');
console.log('🧪 Run test-api.js in another terminal to test the endpoints.');
