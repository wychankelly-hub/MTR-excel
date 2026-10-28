# （可選）供 Google Cloud Run、Fly.io 等容器平台使用。Render 部署不需要 Docker（見 render.yaml）。
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional
COPY . .
# INSTALL_TTS=true：同時安裝本機粵語 TTS（約 +400 MB），讓老師可在雲端「重新合成」配音；預設不安裝（已附帶全部配音）
ARG INSTALL_TTS=false
RUN if [ "$INSTALL_TTS" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg bzip2 ca-certificates && rm -rf /var/lib/apt/lists/* && \
      npm install --no-save sherpa-onnx-node && node scripts/tts-setup.js; \
    fi
EXPOSE 3000
CMD ["node", "server/index.js"]
