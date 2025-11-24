# TTTranscribe Deployment Fix
**Date:** 2025-11-24
**Issue:** 401 Unauthorized on Hugging Face Spaces

## Problem
The TTTranscribe service was rejecting valid authentication requests with a 401 error.
Analysis revealed that while the client was sending the correct `X-Engine-Auth` header, the server on Hugging Face Spaces did not have the `ENGINE_SHARED_SECRET` environment variable configured. As a result, the server was comparing the provided secret against an undefined or default value, causing the mismatch.

## Solution
We have created a script to configure the `ENGINE_SHARED_SECRET` in the Hugging Face Space using the `huggingface-cli` (or Python API).

### Applied Changes
1. **New Script:** `scripts/configure-hf-auth.ps1`
   - Sets the `ENGINE_SHARED_SECRET` in the `iamromeoly/TTTranscibe` space.
   - Uses the Python `huggingface_hub` API for reliable secret management.

2. **Enhanced Test:** `test-simple.js`
   - Added `/health` endpoint check to verify server configuration.
   - Added logic to warn if the server reports missing auth secret.
   - Implemented full workflow testing (Submit -> Poll -> Result).

## Verification Steps
1. Run the configuration script:
   ```powershell
   .\scripts\configure-hf-auth.ps1
   ```
   *Note: Requires `huggingface_hub` installed and logged in.*

2. Wait for the Space to restart (usually 2-5 minutes).

3. Run the test script:
   ```powershell
   node test-simple.js
   ```

4. Check `ttt-test-output.txt` for success.

## Troubleshooting
If authentication still fails:
- Verify the secret value in Hugging Face Space settings (Settings -> Variables and secrets).
- Check the Space logs for "Config loaded: isHuggingFace=true" and "Auth Secret: Set".
- Ensure the `huggingface-cli` is logged in to the correct account with write permissions.
