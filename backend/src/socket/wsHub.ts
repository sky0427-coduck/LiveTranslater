// backend/src/socket/wsHub.ts
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';
import type {
  ClientMessage,
  ServerMessage,
  SessionState,
  ClientInfo,
} from '../../../shared/types';
import { whisperService } from '../services/whisperService';
import { translationService } from '../services/translationService';
import { prepareForWhisper, calculateRms } from '../utils/audioUtils';

const VAD_RMS_THRESHOLD = 0.01;
const CHUNK_SECONDS     = 2;
const SAMPLE_RATE       = 44100;
const DEFAULT_TIMER_SECONDS = 300;
const DISPLAY_TEXT_CLEAR_DELAY_MS = 1500;
const TEAM_COLORS = ['#2563eb', '#14b8a6', '#f97316', '#a855f7', '#ef4444', '#16a34a'];
type DisplayTextListener = (text: string) => void;

class AudioBuffer {
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private readonly TARGET = SAMPLE_RATE * CHUNK_SECONDS;

  append(chunk: Float32Array): Float32Array | null {
    this.chunks.push(chunk);
    this.totalSamples += chunk.length;
    if (this.totalSamples >= this.TARGET) return this.flush();
    return null;
  }

  flush(): Float32Array {
    const merged = new Float32Array(this.totalSamples);
    let offset = 0;
    for (const c of this.chunks) { merged.set(c, offset); offset += c.length; }
    const overlap = Math.floor(SAMPLE_RATE * 0.5);
    this.chunks = [merged.slice(-overlap)];
    this.totalSamples = overlap;
    return merged;
  }

  clear(): void { this.chunks = []; this.totalSamples = 0; }
}

function createDefaultSession(): SessionState {
  return {
    id: uuidv4(),
    topic: '',
    teams: [],
    currentTeamId: null,
    timer: createTimer(DEFAULT_TIMER_SECONDS),
    sttEngine: 'whisper-local',
    // This app is for an English debate with a Korean audience.
    translationEngine: 'openai-realtime',
    sourceLang: 'en',
    targetLang: 'ko',
    translations: [],
    status: 'idle',
  };
}

function createTimer(seconds: number) {
  const safeSeconds = normalizeSeconds(seconds);
  return { totalSeconds: safeSeconds, remainingSeconds: safeSeconds, isRunning: false };
}

function normalizeSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_TIMER_SECONDS;
  return Math.max(1, Math.min(Math.round(seconds), 24 * 60 * 60));
}

export class WsHub {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientInfo>();
  private session: SessionState = createDefaultSession();
  private audioBuffer = new AudioBuffer();
  private timerInterval: NodeJS.Timeout | null = null;
  private lastTranscript = '';
  private displayText = '';
  private displayTranslationLines: string[] = [];
  private displayTranslationPending = '';
  private displayTextClearTimeout: NodeJS.Timeout | null = null;
  private displayTextListeners = new Set<DisplayTextListener>();

  constructor(server: http.Server) {
    this.wss = new WebSocketServer({ server });
    this.wss.on('connection', this.onConnection.bind(this));
    console.log('[wsHub] WebSocket 서버 준비');
  }

  getDisplayText(): string {
    return this.displayText;
  }

  onDisplayText(listener: DisplayTextListener): () => void {
    this.displayTextListeners.add(listener);
    return () => this.displayTextListeners.delete(listener);
  }

  private setDisplayText(text: string): void {
    this.displayText = text;
    this.broadcast({ type: 'DISPLAY_TEXT_UPDATE', payload: { text } });
    for (const listener of this.displayTextListeners) listener(text);
  }

  private scheduleDisplayTextClear(): void {
    if (this.displayTextClearTimeout) clearTimeout(this.displayTextClearTimeout);
    this.displayTextClearTimeout = setTimeout(() => {
      this.displayTextClearTimeout = null;
      this.displayTranslationLines = [];
      this.displayTranslationPending = '';
      this.setDisplayText('');
    }, DISPLAY_TEXT_CLEAR_DELAY_MS);
  }

  private updateDisplayTextFromDelta(delta: string): void {
    const combined = this.displayTranslationPending + delta;
    const sentencePattern = /[^.!?。！？]*[.!?。！？]+["'”’」』)]*/gu;
    let match: RegExpExecArray | null;
    let consumed = 0;
    while ((match = sentencePattern.exec(combined)) !== null) {
      const sentence = match[0].trim();
      if (sentence) this.displayTranslationLines.push(sentence);
      consumed = sentencePattern.lastIndex;
    }

    this.displayTranslationPending = combined.slice(consumed).trimStart();
    this.setDisplayText(
      [...this.displayTranslationLines, this.displayTranslationPending].filter(Boolean).join('\n')
    );
    if (delta) this.scheduleDisplayTextClear();
  }

  private updateDisplayTextFromTranslation(text: string): void {
    this.displayTranslationLines = text
      .split(/(?<=[.!?。！？])\s*/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    this.displayTranslationPending = '';
    this.setDisplayText(this.displayTranslationLines.join('\n'));
    this.scheduleDisplayTextClear();
  }

  private onConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const role = (url.searchParams.get('role') ?? 'display') as ClientInfo['role'];
    const client: ClientInfo = { id: uuidv4(), role, connectedAt: Date.now() };
    this.clients.set(ws, client);
    console.log(`[wsHub] 연결: ${role} (총 ${this.clients.size}명)`);
    this.send(ws, { type: 'SESSION_UPDATE', payload: this.session });
    this.send(ws, { type: 'DISPLAY_TEXT_UPDATE', payload: { text: this.displayText } });
    this.send(ws, { type: 'WHISPER_STATUS', payload: { ready: whisperService.isReady() } });
    ws.on('message', (data, isBinary) => this.onMessage(ws, client, data, isBinary));
    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[wsHub] 해제: ${role} (총 ${this.clients.size}명)`);
    });
    ws.on('error', (err) => console.error('[wsHub] WS 오류:', err));
  }

  private async onMessage(
    ws: WebSocket,
    client: ClientInfo,
    data: import('ws').RawData,
    isBinary: boolean
  ): Promise<void> {
    if (isBinary && data instanceof Buffer && client.role === 'operator') {
      await this.handleAudioChunk(data);
      return;
    }
    try {
      const msg: ClientMessage = JSON.parse(data.toString());
      await this.handleCommand(msg);
    } catch (err) {
      console.error('[wsHub] 메시지 파싱 오류:', err);
    }
  }

  private async handleAudioChunk(rawBuffer: Buffer): Promise<void> {
    // Float32Array 조건:
    //   1) byteLength가 4의 배수 → 아니면 끝 바이트 버림
    //   2) byteOffset이 4의 배수 → slice()로 복사본 생성하면 항상 0
    const safeByteLength = Math.floor(rawBuffer.byteLength / 4) * 4;
    if (safeByteLength === 0) return;

    // slice()로 독립 ArrayBuffer 복사 → byteOffset 문제 해결
    const aligned = rawBuffer.buffer.slice(
      rawBuffer.byteOffset,
      rawBuffer.byteOffset + safeByteLength
    );
    const samples = new Float32Array(aligned);

    if (calculateRms(samples) < VAD_RMS_THRESHOLD) return;

    this.session.status = 'listening';
    const ready = this.audioBuffer.append(samples);
    if (!ready) return;
    await this.processAudioWindow(ready);
  }

  private async processAudioWindow(samples: Float32Array): Promise<void> {
    if (!whisperService.isReady()) return;
    try {
      this.session.status = 'translating';
      const wavBuffer = prepareForWhisper(samples, SAMPLE_RATE);

      const transcript = await whisperService.transcribe(wavBuffer, this.session.sourceLang);
      if (!transcript || transcript === this.lastTranscript) {
        this.session.status = 'listening';
        return;
      }
      this.lastTranscript = transcript;
      console.log(`[wsHub] STT: "${transcript}"`);

      this.broadcast({
        type: 'PARTIAL_TRANSCRIPT',
        payload: {
          text: transcript,
          isFinal: false,
          teamId: this.session.currentTeamId ?? undefined,
          timestamp: Date.now(),
        },
      });

      let translated = '';
      try {
        const result = await translationService.translate(
          transcript, this.session.sourceLang, this.session.targetLang, this.session.translationEngine
        );
        translated = result.translated;
        console.log(`[wsHub] 번역: "${translated}"`);
      } catch (translErr) {
        console.error('[wsHub] 번역 오류:', translErr);
        this.broadcast({
          type: 'ERROR',
          payload: {
            message: `번역에 실패했습니다: ${translErr instanceof Error ? translErr.message : String(translErr)}`,
          },
        });
      }

      const resultId = uuidv4();
      this.broadcast({
        type: 'TRANSCRIPT_FINAL',
        payload: {
          text: transcript,
          isFinal: true,
          teamId: this.session.currentTeamId ?? undefined,
          timestamp: Date.now(),
        },
      });

      if (translated) {
        this.updateDisplayTextFromTranslation(translated);
        this.broadcast({
          type: 'TRANSLATION_RESULT',
          payload: {
            id: resultId,
            original: transcript,
            translated,
            sourceLang: this.session.sourceLang,
            targetLang: this.session.targetLang,
            teamId: this.session.currentTeamId ?? undefined,
            timestamp: Date.now(),
          },
        });
        this.session.translations.push({
          id: resultId,
          original: transcript,
          translated,
          sourceLang: this.session.sourceLang,
          targetLang: this.session.targetLang,
          teamId: this.session.currentTeamId ?? undefined,
          timestamp: Date.now(),
        });
        if (this.session.translations.length > 50) this.session.translations.shift();
      }

      this.session.status = 'listening';
    } catch (err) {
      console.error('[wsHub] 오디오 처리 오류:', err);
      this.session.status = 'idle';
    }
  }

  private async handleCommand(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'SET_TOPIC':
        this.session.topic = msg.payload.topic;
        this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
        break;
      case 'SET_TEAM':
        this.pauseTimer(false);
        this.setCurrentTeam(msg.payload.teamId);
        this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
        break;
      case 'ADD_TEAM':
        {
          const team = {
            id: uuidv4(),
            name: msg.payload.name,
            color: msg.payload.color ?? TEAM_COLORS[this.session.teams.length % TEAM_COLORS.length],
            timer: createTimer(msg.payload.seconds ?? this.session.timer.totalSeconds),
          };
          this.session.teams.push(team);
          if (!this.session.currentTeamId) this.setCurrentTeam(team.id);
        }
        this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
        break;
      case 'REMOVE_TEAM':
        this.session.teams = this.session.teams.filter(t => t.id !== msg.payload.teamId);
        if (this.session.currentTeamId === msg.payload.teamId) {
          this.pauseTimer(false);
          this.setCurrentTeam(this.session.teams[0]?.id ?? null);
        }
        this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
        break;
      case 'TIMER_START':  this.startTimer(); break;
      case 'TIMER_PAUSE':  this.pauseTimer(); break;
      case 'TIMER_RESET':  this.resetTimer(msg.payload.seconds); break;
      case 'SWITCH_ENGINE':
        this.session.translationEngine = msg.payload.engine;
        translationService.switchEngine(msg.payload.engine);
        this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
        break;
      case 'SET_LANGUAGE':
        this.session.sourceLang = msg.payload.sourceLang;
        this.session.targetLang = msg.payload.targetLang;
        this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
        break;
      case 'REALTIME_TRANSCRIPT':
        this.broadcast({
          type: 'PARTIAL_TRANSCRIPT',
          payload: {
            text: msg.payload.text,
            isFinal: false,
            teamId: this.session.currentTeamId ?? undefined,
            timestamp: Date.now(),
          },
        });
        break;
      case 'REALTIME_TRANSLATION':
        this.updateDisplayTextFromDelta(msg.payload.delta);
        this.broadcast({
          type: 'REALTIME_TRANSLATION_DELTA',
          payload: { original: msg.payload.original, delta: msg.payload.delta },
        });
        break;
      case 'RESET_SESSION':
        this.pauseTimer(false);
        this.session = createDefaultSession();
        this.audioBuffer.clear();
        this.lastTranscript = '';
        if (this.displayTextClearTimeout) clearTimeout(this.displayTextClearTimeout);
        this.displayTextClearTimeout = null;
        this.displayTranslationLines = [];
        this.displayTranslationPending = '';
        this.setDisplayText('');
        this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
        break;
    }
  }

  private getCurrentTeam() {
    return this.session.teams.find((team) => team.id === this.session.currentTeamId);
  }

  private setCurrentTeam(teamId: string | null): void {
    const nextTeam = teamId ? this.session.teams.find((team) => team.id === teamId) : undefined;
    this.session.currentTeamId = nextTeam?.id ?? null;
    this.session.timer = nextTeam ? { ...nextTeam.timer } : createTimer(this.session.timer.totalSeconds);
  }

  private updateCurrentTeamTimer(timer: Partial<SessionState['timer']>): void {
    const nextTimer = { ...this.session.timer, ...timer };
    this.session.timer = nextTimer;
    const currentTeam = this.getCurrentTeam();
    if (currentTeam) currentTeam.timer = { ...nextTimer };
  }

  private startTimer(): void {
    if (this.timerInterval) return;
    this.updateCurrentTeamTimer({ isRunning: true });
    this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
    this.timerInterval = setInterval(() => {
      if (this.session.timer.remainingSeconds <= 0) { this.pauseTimer(); return; }
      const remainingSeconds = this.session.timer.remainingSeconds - 1;
      this.updateCurrentTeamTimer({ remainingSeconds });
      this.broadcast({
        type: 'TIMER_TICK',
        payload: { remaining: remainingSeconds, teamId: this.session.currentTeamId },
      });
    }, 1000);
  }

  private pauseTimer(shouldBroadcast = true): void {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    this.updateCurrentTeamTimer({ isRunning: false });
    if (shouldBroadcast) this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
  }

  private resetTimer(seconds: number): void {
    this.pauseTimer(false);
    const safeSeconds = normalizeSeconds(seconds);
    this.updateCurrentTeamTimer({
      totalSeconds: safeSeconds,
      remainingSeconds: safeSeconds,
      isRunning: false,
    });
    this.broadcast({ type: 'SESSION_UPDATE', payload: this.session });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage): void {
    const s = JSON.stringify(msg);
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
    }
  }
}
