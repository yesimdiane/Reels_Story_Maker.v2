# Reels Factory Studio (V2.3) — one container: web UI + API + background jobs + FFmpeg renderer.
# Data lives on a mounted volume at /data (RF_STUDIO_DIR). No dependencies to install: the Studio is dependency-free Node.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-nanum fonts-noto-cjk fontconfig ca-certificates tini \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY renderer ./renderer
COPY studio ./studio
COPY scripts ./scripts
ENV NODE_ENV=production \
    RF_ENV=production \
    RF_STUDIO_DIR=/data/studio \
    RF_STATE_DIR=/data/state \
    RF_FONT_NAME="NanumGothic" \
    PORT=8080
# The entrypoint starts as root only to fix volume ownership, then drops to uid 10001 (user rf).
RUN useradd -m -u 10001 rf && mkdir -p /data && chown -R rf /data /app && chmod +x /app/scripts/docker-entrypoint.sh
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--","/app/scripts/docker-entrypoint.sh"]
CMD ["node","studio/server.js"]
