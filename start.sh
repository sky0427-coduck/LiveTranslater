#!/bin/bash
# Ourhouse Translator — 로컬 실행 스크립트 (macOS/Linux)
# 사용법: bash start.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==================================="
echo "  Ourhouse Translator 시작"
echo "==================================="

# 1. whisper-server 시작
WHISPER_BIN="$ROOT/external/whisper.cpp/build/bin/whisper-server"
WHISPER_MODEL="$ROOT/external/whisper.cpp/models/ggml-base.en.bin"

if [ ! -f "$WHISPER_BIN" ]; then
  echo "❌ whisper-server 없음. macOS에서 빌드가 필요합니다:"
  echo "   cd external/whisper.cpp && cmake -B build && cmake --build build"
  exit 1
fi

echo "▶ whisper-server 시작 중 (포트 8080)..."
"$WHISPER_BIN" \
  --model "$WHISPER_MODEL" \
  --host 127.0.0.1 \
  --port 8080 \
  --threads 4 \
  --language auto &
WHISPER_PID=$!

# 잠시 대기
sleep 2

# 2. 백엔드 시작
echo "▶ 백엔드 서버 시작 중 (포트 3001)..."
cd "$ROOT/backend" && npm run dev &
BACKEND_PID=$!

# 3. 프론트엔드 시작
echo "▶ 프론트엔드 시작 중 (포트 5173)..."
cd "$ROOT/frontend" && npm run dev &
FRONTEND_PID=$!

echo ""
echo "==================================="
echo "  ✅ 실행 완료"
echo ""
echo "  운영자 화면: http://localhost:5173/operator"
echo "  출력 화면:   http://localhost:5173/display"
echo "==================================="
echo ""
echo "종료하려면 Ctrl+C"

# Ctrl+C 시 모든 프로세스 종료
trap "kill $WHISPER_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM

wait
