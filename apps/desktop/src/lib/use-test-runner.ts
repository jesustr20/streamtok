import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bucle de "Iniciar test / Detener" que comparten las pantallas de overlays (duelos, metas, wins, alertas).
 *
 * `onTick(n)` hace el paso número `n` (0, 1, 2…) y devuelve los milisegundos hasta el siguiente, o `null`
 * para terminar (por ejemplo al llegar al tope). Se detiene también al salir de la pantalla. Detenerlo no
 * deshace nada: lo que ya se envió se queda donde estaba.
 */
export function useTestRunner(onTick: (n: number) => number | null) {
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef(onTick);
  tick.current = onTick;

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  const run = useCallback(
    (n: number) => {
      const next = tick.current(n);
      setCount(n + 1);
      if (next === null) return stop();
      timer.current = setTimeout(() => run(n + 1), next);
    },
    [stop],
  );

  const start = useCallback(() => {
    setRunning(true);
    setCount(0);
    run(0);
  }, [run]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return { running, count, start, stop };
}
