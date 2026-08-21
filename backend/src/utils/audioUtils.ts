// backend/src/utils/audioUtils.ts
// Float32Array(브라우저 오디오) → WAV 버퍼 변환
//
// 📚 학습 포인트:
//   WAV 파일 구조를 직접 바이트로 작성합니다.
//   오디오 포맷 이해의 핵심입니다.
//
// WAV 파일 구조:
//   [RIFF 헤더 12바이트]
//   [fmt  청크 24바이트]  ← 포맷 정보 (샘플레이트, 비트심도 등)
//   [data 청크 헤더 8바이트 + 오디오 데이터]
//
// whisper.cpp는 반드시 16kHz 모노 16bit PCM WAV를 요구합니다.

export function float32ToWav(
  samples: Float32Array,
  sampleRate = 16000
): Buffer {
  const numSamples = samples.length;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  // ── RIFF 청크 ──
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // ── fmt 청크 ──
  // 📚 여기가 오디오 포맷의 핵심입니다
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;           // PCM fmt size
  buffer.writeUInt16LE(1, offset); offset += 2;            // AudioFormat=PCM
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // ── data 청크 ──
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // ── Float32 → Int16 변환 ──
  // 📚 Float32(-1.0~1.0) × 32767 = Int16
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }

  return buffer;
}

/**
 * 리샘플링: 44100Hz → 16000Hz (선형 보간)
 * 📚 브라우저는 44100Hz로 캡처, whisper는 16000Hz 필요
 * ✏️ 나중에 C++로 옮기면 품질/속도 크게 향상됩니다
 */
export function resample(
  samples: Float32Array,
  fromRate: number,
  toRate = 16000
): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    output[i] = (samples[idx] ?? 0) + frac * ((samples[idx + 1] ?? 0) - (samples[idx] ?? 0));
  }
  return output;
}

/** 스테레오 → 모노 */
export function stereoToMono(stereo: Float32Array): Float32Array {
  const mono = new Float32Array(stereo.length / 2);
  for (let i = 0; i < mono.length; i++) {
    mono[i] = (stereo[i * 2] + stereo[i * 2 + 1]) / 2;
  }
  return mono;
}

/**
 * RMS 음량 측정 — JS VAD에 사용
 * 📚 RMS = 오디오 에너지. 0.01 이상이면 발화로 판단
 */
export function calculateRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** 전체 파이프라인: 브라우저 오디오 → whisper용 WAV */
export function prepareForWhisper(
  samples: Float32Array,
  inputSampleRate: number,
  channels = 1
): Buffer {
  let processed = samples;
  if (channels === 2) processed = stereoToMono(processed);
  processed = resample(processed, inputSampleRate, 16000);
  return float32ToWav(processed, 16000);
}
