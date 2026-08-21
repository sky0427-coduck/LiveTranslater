import { useCallback, useEffect, useRef, useState } from 'react';

const BUFFER_SIZE = 4096;
const SEND_INTERVAL_MS = 80;

export interface AudioDevice {
  deviceId: string;
  label: string;
  isExternal: boolean;
  isDefault: boolean;
}

export interface UseAudioCaptureOptions {
  onAudioChunk: (samples: Float32Array, sampleRate: number) => void;
}

function scoreDevice(label: string, deviceId: string): number {
  const normalized = label.toLowerCase();
  let score = 0;

  if (normalized.includes('usb')) score += 100;
  if (normalized.includes('interface')) score += 90;
  if (normalized.includes('focusrite')) score += 90;
  if (normalized.includes('scarlett')) score += 90;
  if (normalized.includes('apollo')) score += 90;
  if (normalized.includes('motu')) score += 90;
  if (normalized.includes('zoom')) score += 85;
  if (normalized.includes('tascam')) score += 85;
  if (normalized.includes('roland')) score += 80;
  if (normalized.includes('yamaha')) score += 80;
  if (normalized.includes('behringer')) score += 75;
  if (normalized.includes('mixer')) score += 70;
  if (normalized.includes('external')) score += 60;
  if (normalized.includes('rode')) score += 65;
  if (normalized.includes('blue yeti')) score += 65;
  if (normalized.includes('shure')) score += 65;
  if (normalized.includes('microphone') && !normalized.includes('built-in')) score += 50;
  if (normalized.includes('built-in')) score -= 30;
  if (normalized.includes('internal')) score -= 30;
  if (normalized.includes('webcam')) score -= 20;
  if (normalized.includes('facetime')) score -= 20;
  if (deviceId === 'default') score += 0;

  return score;
}

export function useAudioCapture({ onAudioChunk }: UseAudioCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('default');
  const [autoSelectedLabel, setAutoSelectedLabel] = useState('');
  const [level, setLevel] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const accum = useRef<Float32Array[]>([]);
  const sendTimer = useRef<number | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    let all = await navigator.mediaDevices.enumerateDevices();
    let inputs = all.filter((device) => device.kind === 'audioinput');

    if (inputs.every((device) => !device.label)) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((track) => track.stop());
        all = await navigator.mediaDevices.enumerateDevices();
        inputs = all.filter((device) => device.kind === 'audioinput');
      } catch {
        // Browser permissions can hide device labels until the user grants access.
      }
    }

    const scored = inputs
      .map((device) => {
        const score = scoreDevice(device.label, device.deviceId);
        return {
          deviceId: device.deviceId,
          label: device.label || `Microphone (${device.deviceId.slice(0, 8)})`,
          score,
          isExternal: score > 0,
          isDefault: device.deviceId === 'default',
        };
      })
      .sort((a, b) => b.score - a.score);

    setDevices(scored);

    if (scored.length > 0 && !isCapturing) {
      setSelectedDeviceId(scored[0].deviceId);
      setAutoSelectedLabel(scored[0].label);
    }
  }, [isCapturing]);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  const startCapture = useCallback(async () => {
    if (isCapturing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedDeviceId !== 'default' ? { exact: selectedDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const sampleRate = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        accum.current.push(new Float32Array(input));

        let max = 0;
        for (let i = 0; i < input.length; i += 1) {
          max = Math.max(max, Math.abs(input[i]));
        }
        setLevel(max);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      sendTimer.current = window.setInterval(() => {
        if (accum.current.length === 0) return;

        const chunks = accum.current;
        accum.current = [];

        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Float32Array(total);
        let offset = 0;

        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        onAudioChunk(merged, sampleRate);
      }, SEND_INTERVAL_MS);

      setIsCapturing(true);
      console.log('[audio] capture started:', stream.getAudioTracks()[0]?.label);
    } catch (err) {
      console.error('[audio] capture failed:', err);
      alert(`마이크 접근에 실패했습니다: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [isCapturing, selectedDeviceId, onAudioChunk]);

  const stopCapture = useCallback(() => {
    if (sendTimer.current) {
      clearInterval(sendTimer.current);
      sendTimer.current = null;
    }

    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    accum.current = [];
    setIsCapturing(false);
    setLevel(0);
  }, []);

  return {
    isCapturing,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    autoSelectedLabel,
    level,
    startCapture,
    stopCapture,
    refreshDevices,
  };
}
