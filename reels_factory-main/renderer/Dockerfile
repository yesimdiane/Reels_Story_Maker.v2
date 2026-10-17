# Cloud rendering image (Cloud Run Job / any container host). Same code and config keys as the Mac.
# Build from the repo root:  docker build -f renderer/Dockerfile -t reels-renderer .
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The renderer reuses the Apps Script sources for the approval fingerprint (single source of truth).
COPY apps-script ./apps-script
COPY renderer/cli.js ./renderer/cli.js
COPY renderer/lib ./renderer/lib
ENV RF_FONT_NAME="Noto Sans CJK KR" \
    RF_STATE_DIR=/mnt/state \
    RF_OUTPUT_DIR=/mnt/output \
    RF_CLIPS_DIR=/mnt/clips
# On Cloud Run, RF_TTS_AUTH defaults to the attached service account (metadata server); no API key needed.
ENTRYPOINT ["node", "renderer/cli.js"]
CMD ["check"]
