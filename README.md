# Ourhouse Translator

토론회용 실시간 번역 및 진행 보조 웹앱 (PWA)

## 빠른 시작

### 1. 의존성 설치

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 환경 변수 설정

```bash
cp config/.env.example config/.env
# .env에 API 키 입력
```

### 3. (macOS) whisper-server 빌드 — 최초 1회만

```bash
cd external/whisper.cpp
cmake -B build
cmake --build build --config Release
```

> Windows에서 이미 빌드된 .exe가 있지만, macOS에서는 재빌드 필요합니다.

### 4. 실행

```bash
bash start.sh
```

## 화면 구성

| URL | 역할 |
|---|---|
| `localhost:5173/operator` | 운영자 화면 — 토론 제어 |
| `localhost:5173/display` | 번역 출력 화면 — 청중용 |

## 기술 스택

- **프론트엔드**: React + Vite + TypeScript + Zustand (PWA)
- **백엔드**: Node.js + WebSocket (ws)
- **STT**: whisper.cpp (로컬, HTTP 서버 모드)
- **번역**: OpenAI Realtime 또는 DeepL
- **C++ 모듈**: node-addon-api (오디오 전처리, 추후 추가)

## 프로젝트 구조

```
LiveTranslater/
├── frontend/          React PWA
├── backend/           Node.js WebSocket 서버
├── shared/            공통 TypeScript 타입
├── native/            C++ 오디오 전처리 모듈 (추후)
├── external/
│   └── whisper.cpp/   로컬 STT 엔진 (git clone)
├── config/            환경 변수
└── docs/              아키텍처 문서
    ├── ARCHITECTURE.md
    └── WHISPER_INTEGRATION.md
```

## 문서

- [전체 아키텍처](docs/ARCHITECTURE.md)
- [Whisper.cpp 연동 가이드](docs/WHISPER_INTEGRATION.md)
