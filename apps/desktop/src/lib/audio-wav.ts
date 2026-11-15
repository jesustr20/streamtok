/** Audio del micrófono → WAV de 16 kHz, mono, 16 bits, en base64 (lo que entiende Gemini). */
export const TARGET_RATE = 16000;

export function downsample(input: Float32Array, from: number, to = TARGET_RATE): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // promedio de la ventana: filtra un poco los agudos al bajar la frecuencia
    const a = Math.floor(i * ratio);
    const b = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += input[j] ?? 0;
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

export function encodeWavBase64(samples: Float32Array, rate = TARGET_RATE): string {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Detector de voz simple: junta lo que suena (con un poco de audio previo) y lo entrega al callarte ~0,8 s.
 * Ignora ruidos muy cortos y corta a los 10 s. Sin servicios externos: solo volumen.
 */
export class SpeechSegmenter {
  private pre: Float32Array[] = [];
  private cur: Float32Array[] = [];
  private samples = 0;
  private quiet = 0;
  constructor(
    private rate: number,
    private onSegment: (wav: string) => void,
    private threshold = 0.025,
  ) {}

  push(chunk: Float32Array) {
    let sum = 0;
    for (const s of chunk) sum += s * s;
    const loud = Math.sqrt(sum / chunk.length) > this.threshold;
    const secs = chunk.length / this.rate;
    if (this.cur.length === 0) {
      if (!loud) {
        this.pre.push(chunk);
        if (this.pre.length > 3) this.pre.shift();
        return;
      }
      this.cur = [...this.pre];
      this.pre = [];
      this.samples = this.cur.reduce((n, c) => n + c.length, 0);
    }
    this.cur.push(chunk);
    this.samples += chunk.length;
    this.quiet = loud ? 0 : this.quiet + secs;
    if (this.quiet >= 0.8 || this.samples / this.rate >= 10) this.flush();
  }

  private flush() {
    const total = this.samples;
    const all = new Float32Array(total);
    let o = 0;
    for (const c of this.cur) {
      all.set(c, o);
      o += c.length;
    }
    const voiced = total / this.rate - this.quiet;
    this.cur = [];
    this.samples = 0;
    this.quiet = 0;
    if (voiced < 0.35) return; // un golpe o un ruido, no una frase
    this.onSegment(encodeWavBase64(downsample(all, this.rate)));
  }

  reset() {
    this.pre = [];
    this.cur = [];
    this.samples = 0;
    this.quiet = 0;
  }
}
