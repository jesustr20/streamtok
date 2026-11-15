import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "streamtok.agente.micId";

function readSaved(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export interface MicDevice {
  id: string;
  label: string;
}

export type MicStatus = "idle" | "starting" | "listening" | "denied" | "error";

/**
 * Micrófono del streamer (ADR 0024, §8, fase 6): lista de entradas, elegida (se recuerda en este equipo),
 * nivel de volumen en vivo y una prueba de grabación de 3 s. La misma captura servirá para la voz (fase 7).
 */
export function useMicrofono() {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [deviceId, setDeviceIdState] = useState<string>(readSaved);
  const [status, setStatus] = useState<MicStatus>("idle");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState<"" | "recording" | "playing">("");
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef(0);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((d) => d.kind === "audioinput" && d.deviceId)
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Micrófono ${i + 1}` })),
      );
    } catch {
      /* sin lista */
    }
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    setLevel(0);
    setStatus("idle");
  }, []);

  const start = useCallback(
    async (id: string = deviceId) => {
      stop();
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("Este equipo no permite usar el micrófono desde la app.");
        return;
      }
      setStatus("starting");
      setError("");
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: id ? { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true },
        });
        stream.current = s;
        const ac = new AudioContext();
        ctx.current = ac;
        const analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        ac.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, (peak / 128) * 1.6));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
        setStatus("listening");
        await refreshDevices(); // con permiso ya vienen los nombres
      } catch (e) {
        const name = (e as { name?: string })?.name ?? "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setError("Windows o la app no tienen permiso para el micrófono. Actívalo en Configuración de Windows → Privacidad → Micrófono.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus("error");
          setError("No se encontró ese micrófono. Conéctalo o elige otro de la lista.");
        } else {
          setStatus("error");
          setError(`No se pudo abrir el micrófono (${name || "error"}).`);
        }
      }
    },
    [deviceId, refreshDevices, stop],
  );

  const setDeviceId = useCallback(
    (id: string) => {
      setDeviceIdState(id);
      try {
        localStorage.setItem(KEY, id);
      } catch {
        /* sin guardado */
      }
      if (stream.current) void start(id);
    },
    [start],
  );

  /** Graba 3 s con el micrófono elegido y los reproduce, para comprobar que se oye bien. */
  const test = useCallback(async () => {
    if (!stream.current || testing) return;
    setTesting("recording");
    try {
      const rec = new MediaRecorder(stream.current);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start();
      await new Promise((r) => setTimeout(r, 3000));
      rec.stop();
      await done;
      setTesting("playing");
      const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      const audio = new Audio(url);
      await new Promise<void>((r) => {
        audio.onended = () => r();
        audio.onerror = () => r();
        void audio.play().catch(() => r());
      });
      URL.revokeObjectURL(url);
    } catch {
      setError("No se pudo hacer la prueba de grabación.");
    } finally {
      setTesting("");
    }
  }, [testing]);

  useEffect(() => {
    void refreshDevices();
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", refreshDevices);
    return () => md?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);
  useEffect(() => stop, [stop]);

  return { devices, deviceId, setDeviceId, status, error, level, testing, start: () => start(), stop, test };
}
