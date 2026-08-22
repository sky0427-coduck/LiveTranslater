# Ourhouse Translator

> README.md was Written by codex (문법 맞겠지)

영어 토론회의 음성을 한국어 자막으로 보여 주는 실시간 통역 PWA입니다.

기본 엔진은 **OpenAI Realtime Translation** (`gpt-realtime-translate`)입니다.
Whisper.cpp를 설치하거나 빌드하지 않아도 됩니다.

## 준비물

- macOS 12 이상, 인터넷 연결
- Node.js 20 이상 (LTS 권장) 및 npm
- 마이크를 허용할 수 있는 Chrome 또는 Safari
- 결제가 활성화되고 Realtime 모델을 사용할 수 있는 OpenAI Platform API 키

> OpenAI API 키는 ChatGPT 구독 키가 아니라 OpenAI Platform에서 만든 API 키여야 합니다.
> 키를 GitHub, `transmodel.json`, 프런트엔드 코드에 넣지 마세요.

## Mac에서 최초 1회 설정

프로젝트 폴더에서 실행합니다.

```bash
cp config/.env.example config/.env
```

`config/.env` 파일을 열어 아래 한 줄만 입력합니다.

```env
OPENAI_API_KEY=여기에_실제_OpenAI_Platform_API_키
```

그 다음 의존성을 설치합니다.

```bash
cd backend && npm install
cd ../frontend && npm install
cd ..
```

Whisper.cpp, CMake, 모델 파일은 이 기본 경로에서 필요하지 않습니다.

## 실행

프로젝트 최상위 폴더에서 실행합니다.

```bash
bash start.sh
```

다음 주소를 엽니다.

| 주소 | 용도 |
|---|---|
| `http://localhost:5173/operator` | 운영자 화면 — 오디오 장치 선택 및 캡처 시작 |
| `http://localhost:5173/display` | 청중용 한국어 자막 화면 |

종료하려면 `start.sh`를 실행한 터미널에서 `Ctrl+C`를 누릅니다.

## 실제 작동 순서

`start.sh`를 실행했다고 즉시 OpenAI 과금 세션이 열리지는 않습니다. 서버와 화면만 준비됩니다.

1. `start.sh`가 백엔드(`:3001`)와 프런트엔드(`:5173`)를 시작합니다.
2. 운영자가 `/operator`를 열고 입력 장치를 고른 뒤 **캡처 시작**을 누릅니다.
3. 브라우저가 마이크 권한을 요청합니다. **허용**해야 합니다.
4. 브라우저가 백엔드에 임시 Realtime 인증을 요청합니다.
5. 백엔드는 `config/.env`의 `OPENAI_API_KEY`로 OpenAI에 짧은 수명의 client secret을 요청합니다.
6. 브라우저는 그 임시 인증으로 `gpt-realtime-translate` WebRTC 세션을 열고 영어 음성을 전송합니다.
7. OpenAI가 원문과 한국어 번역 자막 델타를 스트리밍합니다.
8. 운영자 화면은 원문을, `/display` 화면은 한국어 번역을 바로 갱신합니다.

즉, API 키가 올바르고 마이크 권한·인터넷 연결이 정상이라면 **캡처 시작 시점에** 자동으로 Realtime Translation이 연결되고 작동합니다. 운영자 화면의 `Realtime 연결됨` 표시로 연결 상태를 확인할 수 있습니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `OPENAI_API_KEY가 설정되지 않았습니다` | `config/.env` 위치와 변수명을 확인하고, 백엔드를 재시작합니다. |
| `Realtime 대기 중` | 먼저 캡처 시작을 눌렀는지, 마이크 권한을 허용했는지 확인합니다. |
| Realtime 세션 생성 실패 | API 키의 프로젝트 결제·Realtime 접근 권한, 인터넷 연결을 확인합니다. |
| 자막이 표시되지 않음 | 운영자와 디스플레이가 같은 네트워크의 동일한 서버 주소를 보고 있는지 확인합니다. |

## DeepL + Whisper 백업 모드 (선택)

기본 운영에는 필요 없습니다. 이 모드를 쓰려면 whisper.cpp와 영어 모델을 설치·빌드하고,
`config/.env`에 `USE_WHISPER=true`와 `DEEPL_API_KEY`를 설정해야 합니다.

## 기술 구성

- 음성 번역: OpenAI Realtime Translation (`gpt-realtime-translate`, WebRTC)
- 화면/세션 동기화: React + Vite, Node.js + WebSocket
- 선택 백업 경로: whisper.cpp + DeepL

OpenAI Realtime Translation은 음성이 계속 들어오는 동안 번역 오디오와 자막 델타를 반환하는 전용 스트리밍 모델입니다. 자세한 인증 및 WebRTC 방식은 [OpenAI 공식 문서](https://developers.openai.com/api/docs/guides/realtime-translation)를 참고하세요.
