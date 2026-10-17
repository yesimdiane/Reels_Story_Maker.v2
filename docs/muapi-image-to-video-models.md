# MuAPI Image-to-Video Model Reference

Development reference for Reels Factory. **Documentation only**: adding this file does not register models or trigger paid generation.

## 1. Grok Imagine Image-to-Video
- Model ID: `grok-imagine-image-to-video`
- Endpoint: `POST https://api.muapi.ai/api/v1/grok-imagine-image-to-video` (verify against live reference before implementation)
- Inputs: `prompt` (string), `images_list` (array, up to 7 image URLs), `aspect_ratio` (9:16, 16:9, 2:3, 3:2, 1:1), `mode` (fun, normal, spicy), `resolution` (480p, 720p), `duration` (integer, 6–30 seconds).
- Reference images in prompt with `@image1`, `@image2`, etc. Aspect ratio is ignored for single-image input. External image input does not support spicy mode and falls back to normal.
- Synchronized ambient audio advertised; **precise dialogue/lip-sync is not guaranteed**.
- Published rate: 480p $0.025/s, 720p $0.05/s (confirm live pricing).
- Source: https://muapi.ai/playground/grok-imagine-image-to-video/llms.txt

## 2. Seedance Pro Image-to-Video
- Model ID: `seedance-pro-i2v`
- Endpoint: `POST https://api.muapi.ai/api/v1/seedance-pro-i2v`
- Inputs: `prompt` (string), `image_url` (string), `resolution` (480p, 720p, 1080p), `duration` (integer), `camera_fixed` (boolean).
- The supplied API example uses duration 5 seconds; **full supported duration range and pricing must be verified**.
- Source: https://muapi.ai/playground/seedance-pro-i2v

## 3. Kling v2.1 Master Image-to-Video
- Model ID: `kling-v2.1-master-i2v`
- Endpoint: `POST https://api.muapi.ai/api/v1/kling-v2.1-master-i2v`
- Required: `prompt` (string), `image_url` (string).
- Optional: `aspect_ratio` (16:9 default, 9:16, 1:1), `duration` (integer, default 5 seconds).
- Published cost: 0.3 credits per call; check current pricing and dynamic adjustments.
- **Intended for final-quality image-to-video clip generation, not video assembly**. Use FFmpeg for final concatenation, timed audio, subtitles, and MP4 export.
- Source: https://muapi.ai/playground/kling-v2.1-master-i2v/llms.txt

## Common request lifecycle
1. Validate model-specific schema and credentials without starting a paid job. Never treat validation as free unless the provider confirms it.
2. Require approved script and explicit paid-generation authorization before submitting.
3. POST to model endpoint with `x-api-key: $MUAPI_API_KEY` and `Content-Type: application/json`; store `request_id`.
4. GET `https://api.muapi.ai/api/v1/predictions/{request_id}/result` with `x-api-key`. Handle `queued`, `pending`, `processing`, `completed`, `failed`, `cancelled`, with backoff and timeout.
5. On completion, validate media URLs from `outputs`; do not assume file type from example placeholder URLs. Provider may also support webhooks; validate per-model.
6. Keep secrets server-side; log model, parameters, request ID, elapsed time, estimated/actual cost, and failures.

## Reels Factory integration notes
- Show all three models as selectable providers with dynamic per-model fields.
- Grok uses `images_list`; Seedance Pro and Kling use `image_url`.
- Preserve audio timing in final FFmpeg render (project target: 0.3-second increments).
- Model selection and provider capabilities must be verified against the live API before enabling generation.
- This reference does **not** claim that chaining all three models is supported; each produces image-to-video clips independently.
