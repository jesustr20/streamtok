import {
  DUEL_METRIC_NAMES,
  DUEL_MODES,
  type DuelConfig,
  type DuelMetric,
  type DuelSideConfig,
  type DuelState,
  type GiftCatalogEntry,
} from "@streamtok/shared";
import { useEffect, useRef, useState } from "react";
import { useDuelos } from "../lib/use-duelos";
import { useGiftCatalog } from "../lib/use-gift-catalog";
import type { SidecarClient } from "../lib/ws-client";
import { GiftPicker } from "./GiftPicker";
import { Btn, Card, DesignCard, Field, UrlCard, cardStyle, inputStyle } from "./overlays-ui";

type Api = ReturnType<typeof useDuelos>;
type Side = 0 | 1;

/** Recuadro de la vista previa según el diseño (cada uno tiene su tamaño fijo). */
const RESERVE: Record<string, { w: number; h: number }> = {
  barra: { w: 560, h: 152 },
  versus: { w: 560, h: 266 },
  marcador: { w: 560, h: 146 },
};

/** Qué hace cada duelo de fábrica, para explicarlo en pantalla. */
const INTRO: Record<string, string> = {
  "regalo-vs-regalo":
    "Dos regalos compiten: cada vez que llega uno, suma a su lado. Elige de la lista los regalos de cada lado (puedes añadir varios). Si un lado tiene un solo regalo es “Gift vs Gift”; con varios, “Regalos vs Regalos”.",
  equipos:
    "La gente elige equipo escribiendo un comando en el chat (por ejemplo !azul o !rojo) y desde ese momento todo lo que haga suma a su equipo. Quien ya eligió se queda en su equipo hasta que reinicies el marcador.",
  top: "Muestra a los dos mayores donadores de esta sesión, con su foto, frente a frente. Se reinicia solo cuando te conectas a otro LIVE.",
};

const MODE_NAMES = Object.fromEntries(DUEL_MODES.map((m) => [m.id, m.name]));

/** Módulo "Batallas y duelos": una pantalla por duelo, ya creado y con su vista previa. */
export function DuelosView({ client, selected }: { client: SidecarClient | null; selected: string }) {
  const api = useDuelos(client);
  const gifts = useGiftCatalog(client);
  const config = api.configs?.find((c) => c.id === selected);
  const heading = config ? `Batallas · ${config.title || config.id}` : "Batallas y duelos";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 26, fontFamily: "'Space Grotesk', sans-serif" }}>{heading}</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9A9CA5" }}>
          Dos lados que compiten en pantalla. Elige el duelo en el menú de la izquierda.
        </p>
      </div>
      {api.error && <div style={{ color: "#E5484D", fontSize: 12.5 }}>{api.error}</div>}
      {!api.configs ? (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Conectando con el sidecar…</div>
      ) : config ? (
        <DuelBlock key={config.id} config={config} state={api.states.find((s) => s.id === config.id)} api={api} gifts={gifts} client={client} />
      ) : (
        <div style={{ ...cardStyle, color: "#9A9CA5", fontSize: 13 }}>Este duelo no existe.</div>
      )}
    </div>
  );
}

function DuelBlock({ config, state, api, gifts, client }: { config: DuelConfig; state: DuelState | undefined; api: Api; gifts: GiftCatalogEntry[]; client: SidecarClient | null }) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<DuelConfig>) => api.save({ ...config, ...p });
  const patchSide = (i: Side, p: Partial<DuelSideConfig>) => {
    const a = i === 0 ? { ...config.sides[0], ...p } : config.sides[0];
    const b = i === 1 ? { ...config.sides[1], ...p } : config.sides[1];
    patch({ sides: [a, b] });
  };
  const designId = config.style.designId;

  // Duelos guardados antes de que existiera la imagen: se rellena sola cuando el catálogo ya la conoce.
  useEffect(() => {
    if (config.mode !== "regalos") return;
    const fix = (s: DuelSideConfig): DuelSideConfig => {
      const icon = giftIcon(s.gifts, gifts) ?? s.icon;
      // el nombre es el del regalo; solo se pone cuando todos sus regalos ya están en el catálogo (o son nombres)
      const ready = s.gifts.length > 0 && s.gifts.every((t) => !/^\d+$/.test(t) || findToken(t, gifts));
      return { ...s, icon, cost: giftCost(s.gifts, gifts) ?? s.cost, name: ready ? giftsLabel(s.gifts, gifts) : s.name };
    };
    const [a, b] = config.sides;
    const na = fix(a);
    const nb = fix(b);
    if (na.icon === a.icon && na.cost === a.cost && na.name === a.name && nb.icon === b.icon && nb.cost === b.cost && nb.name === b.name) return;
    api.save({ ...config, sides: [na, nb] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gifts, config.mode, config.sides[0].gifts.join("|"), config.sides[1].gifts.join("|"), config.sides[0].icon, config.sides[1].icon, config.sides[0].cost, config.sides[1].cost]);

  // Envía un regalo de prueba por el mismo camino que uno real (igual que el Simulador), para ver cómo suma.
  const testGift = (g: GiftCatalogEntry) => {
    const id = g.id !== undefined && /^\d+$/.test(g.id) ? Number(g.id) : undefined;
    client?.send("live-event", {
      event: "gift",
      username: "@prueba",
      nickname: "Prueba",
      giftName: g.name,
      giftId: id,
      coins: g.cost,
      repeatEnd: true,
      timestamp: Date.now(),
    });
  };

  return (
    <>
      <Card title="Cómo funciona">
        <div style={{ fontSize: 13, color: "#C9CBD2", lineHeight: 1.55 }}>
          {INTRO[config.id] ?? `Modo: ${MODE_NAMES[config.mode]}.`}
        </div>
      </Card>

      <Scoreboard config={config} state={state} api={api} />
      <Settings config={config} patch={patch} patchSide={patchSide} gifts={gifts} onTest={testGift} />

      <UrlCard
        kind="duelo"
        id={config.id}
        title="Overlay"
        stable
        reserve={RESERVE[designId] ?? { w: 560, h: 152 }}
        onCustomize={() => setOpen((v) => !v)}
        customizeLabel={open ? "Ocultar diseño" : "Personalizar diseño"}
      />
      {open && <DesignCard kind="duelo" id={config.id} style={config.style} onChange={(style) => patch({ style })} />}
    </>
  );
}

/** Marcador en vivo, con botones para corregirlo a mano y reiniciarlo. */
function Scoreboard({ config, state, api }: { config: DuelConfig; state: DuelState | undefined; api: Api }) {
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const askReset = () => {
    if (!confirm) {
      setConfirm(true);
      timer.current = setTimeout(() => setConfirm(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirm(false);
    api.reset(config.id);
  };
  const manual = config.mode !== "top";
  return (
    <Card title="Marcador en vivo">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {([0, 1] as const).map((i) => {
          const side = state?.sides[i];
          const name = config.mode === "top" ? (side?.name ?? "—") : config.sides[i].name || (i ? "B" : "A");
          return (
            <div
              key={i}
              style={{ padding: 14, borderRadius: 12, background: "#0E0F12", border: `2px solid ${config.sides[i].color}`, minWidth: 0 }}
            >
              <div style={{ fontSize: 12, color: "#9A9CA5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {config.mode === "top" ? `TOP ${i + 1}` : name}
                {config.mode === "equipos" && side?.members !== undefined && ` · ${side.members} ${side.members === 1 ? "persona" : "personas"}`}
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {(side?.score ?? 0).toLocaleString("es")}
              </div>
              {config.mode === "top" && <div style={{ fontSize: 13, fontWeight: 700 }}>{name}</div>}
              {manual && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {[-10, -1, 1, 10].map((d) => (
                    <Btn key={d} onClick={() => api.adjust(config.id, i, d)}>
                      {d > 0 ? `+${d}` : d}
                    </Btn>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <TestRunner config={config} api={api} />
        <Btn onClick={askReset}>{confirm ? "¿Seguro? Pulsa otra vez" : "Reiniciar marcador"}</Btn>
        <span style={{ fontSize: 11.5, color: "#9A9CA5" }}>
          {config.mode === "top"
            ? "Reinicia el ranking de donadores de esta sesión. «Iniciar test» manda donadores de prueba."
            : config.mode === "equipos"
              ? "Pone los dos marcadores en 0 y vacía los equipos (cada quien vuelve a elegir). «Iniciar test» manda gente de prueba a los equipos."
              : "Pone los dos marcadores en 0. Los botones +/− corrigen un error a mano. «Iniciar test» manda regalos de prueba solo a este duelo."}
        </span>
      </div>
    </Card>
  );
}

const TEST_NAMES = ["Valentina", "Carlos_92", "Luna", "Diego", "Mia", "Joaquín", "Sofi", "Andrés", "Cami", "Nico"];
// en Top 1 vs Top 2 pocos nombres, para que se disputen los puestos
const TEST_DONORS = ["Valentina", "Carlos_92", "Luna", "Diego", "Mia"];
const TEST_COINS = [1, 5, 30, 100, 500];
const TEST_MAX = 30;

/**
 * "Iniciar test": manda regalos de prueba al azar (solo cuentan en este duelo, no activan Acciones).
 * Regalo vs Regalo: a un lado u otro; Azul vs Rojo: gente de prueba que entra a un equipo y suma; Top 1 vs
 * Top 2: donadores de prueba. Se detiene solo a los 30 o con "Detener"; el marcador queda donde estaba.
 */
function TestRunner({ config, api }: { config: DuelConfig; api: Api }) {
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ config, api });
  live.current = { config, api };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(false);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const ready = config.mode !== "regalos" || config.sides.every((s) => s.gifts.length > 0);

  const tick = (n: number) => {
    const { config: c, api: a } = live.current;
    const side = Math.random() < 0.5 ? 0 : 1;
    // casi siempre 1 o 2 regalos; de vez en cuando un combo grande
    const units = Math.random() < 0.15 ? 3 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 2);
    const pool = c.mode === "top" ? TEST_DONORS : TEST_NAMES;
    const coins = c.mode === "regalos" ? undefined : TEST_COINS[Math.floor(Math.random() * TEST_COINS.length)];
    a.test(c.id, side, units, pool[Math.floor(Math.random() * pool.length)], coins);
    setSent(n + 1);
    if (n + 1 >= TEST_MAX) return stop();
    timer.current = setTimeout(() => tick(n + 1), 350 + Math.random() * 1150);
  };
  const start = () => {
    setRunning(true);
    setSent(0);
    tick(0);
  };

  return (
    <>
      <Btn onClick={running ? stop : start} disabled={!running && !ready}>
        {running ? `■ Detener (${sent}/${TEST_MAX})` : "▶ Iniciar test"}
      </Btn>
    </>
  );
}

/** Título, qué se cuenta y los datos de cada lado según el modo. */
function Settings({
  config,
  patch,
  patchSide,
  gifts,
  onTest,
}: {
  config: DuelConfig;
  patch: (p: Partial<DuelConfig>) => void;
  patchSide: (i: Side, p: Partial<DuelSideConfig>) => void;
  gifts: GiftCatalogEntry[];
  onTest: (gift: GiftCatalogEntry) => void;
}) {
  const metrics = DUEL_MODES.find((m) => m.id === config.mode)?.metrics ?? ["coins"];
  return (
    <Card title="Configuración">
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Field label="Título" hint="se muestra sobre el duelo; déjalo vacío para no mostrarlo">
            <CommitInput value={config.title} max={60} onCommit={(v) => patch({ title: v })} />
          </Field>
        </div>
        <div style={{ width: 230 }}>
          <Field
            label="Qué se cuenta"
            hint={
              config.mode !== "regalos"
                ? ""
                : config.metric === "coins"
                  ? "cada regalo suma su valor en monedas"
                  : "cada regalo suma 1, cueste lo que cueste"
            }
          >
            {metrics.length > 1 ? (
              <select
                value={config.metric}
                onChange={(e) => patch({ metric: e.target.value as DuelMetric })}
                style={{ ...inputStyle, width: "100%" }}
              >
                {metrics.map((m) => (
                  <option key={m} value={m}>
                    {DUEL_METRIC_NAMES[m]}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ ...inputStyle, display: "flex", alignItems: "center", opacity: 0.7 }}>{DUEL_METRIC_NAMES[metrics[0]]}</div>
            )}
          </Field>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {([0, 1] as const).map((i) => {
          const side = config.sides[i];
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>Lado {i === 0 ? "izquierdo" : "derecho"}</div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                {config.mode === "equipos" && (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Field label="Nombre" hint="">
                      <CommitInput value={side.name} max={30} onCommit={(v) => patchSide(i, { name: v })} />
                    </Field>
                  </div>
                )}
                {config.mode === "regalos" && (
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#9A9CA5", lineHeight: 1.5, alignSelf: "center" }}>
                    En el overlay: arriba, quien más aporta a este lado; debajo, el regalo
                    {side.name ? <> «<b style={{ color: "#C9CBD2" }}>{side.name}</b>»</> : ""}. Hasta que alguien aporte, va el regalo arriba.
                  </div>
                )}
                <Field label="Color" hint="">
                  <input
                    type="color"
                    value={side.color}
                    onChange={(e) => patchSide(i, { color: e.target.value })}
                    style={{ width: 44, height: 34, padding: 0, background: "none", border: "1px solid #2A2C33" }}
                  />
                </Field>
              </div>
              {config.mode === "regalos" && (
                <Field label="Regalos de este lado" hint="">
                  <GiftListField
                    tokens={side.gifts}
                    gifts={gifts}
                    onTest={onTest}
                    onChange={(g) => {
                      // el nombre y la imagen del lado son siempre los de su regalo
                      patchSide(i, { gifts: g, icon: giftIcon(g, gifts), cost: giftCost(g, gifts), ...(g.length ? { name: giftsLabel(g, gifts) } : {}) });
                    }}
                  />
                </Field>
              )}
              {config.mode === "equipos" && (
                <Field label="Comandos para unirse" hint="separados por comas (p. ej. !azul, !blue)">
                  <CommitInput value={side.commands.join(", ")} onCommit={(v) => patchSide(i, { commands: splitList(v) })} />
                </Field>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function findToken(t: string, gifts: GiftCatalogEntry[]): GiftCatalogEntry | undefined {
  return /^\d+$/.test(t) ? gifts.find((g) => g.id === t) : gifts.find((g) => g.name.trim().toLowerCase() === t.trim().toLowerCase());
}

/** Nombre que se pone solo al lado: el del regalo, o "A + B" / "A +N" si son varios. */
function giftsLabel(tokens: string[], gifts: GiftCatalogEntry[]): string {
  const names = tokens.map((t) => findToken(t, gifts)?.name ?? t);
  if (names.length <= 2) return names.join(" + ").slice(0, 30);
  return `${names[0]} +${names.length - 1}`.slice(0, 30);
}

/** Imagen del lado: la del primer regalo que esté en el catálogo. */
function giftIcon(tokens: string[], gifts: GiftCatalogEntry[]): string | undefined {
  for (const t of tokens) {
    const g = findToken(t, gifts);
    if (g?.imageUrl) return g.imageUrl;
  }
  return undefined;
}

/** Valor en monedas del lado: el del primer regalo que esté en el catálogo. */
function giftCost(tokens: string[], gifts: GiftCatalogEntry[]): number | undefined {
  for (const t of tokens) {
    const g = findToken(t, gifts);
    if (g) return g.cost;
  }
  return undefined;
}

/**
 * Regalos de un lado: fichas con imagen y un selector del catálogo para añadir más. Se guarda el
 * nombre del regalo; si hay dos con el mismo nombre (p. ej. dos "Balloons"), su número, que es único.
 * Sigue habiendo un campo para escribir uno a mano, por si el catálogo aún no lo tiene.
 */
function GiftListField({ tokens, gifts, onChange, onTest }: { tokens: string[]; gifts: GiftCatalogEntry[]; onChange: (tokens: string[]) => void; onTest: (gift: GiftCatalogEntry) => void }) {
  const [manual, setManual] = useState("");
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const find = (t: string) => (/^\d+$/.test(t) ? gifts.find((g) => g.id === t) : gifts.find((g) => same(g.name, t)));
  const add = (t: string) => {
    const v = t.trim();
    if (v && !tokens.some((x) => same(x, v))) onChange([...tokens, v]);
  };
  const addFromCatalog = (g: GiftCatalogEntry) => {
    const repeated = gifts.filter((x) => same(x.name, g.name)).length > 1;
    add(repeated && g.id ? g.id : g.name);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 34 }}>
        {tokens.length === 0 && <span style={{ fontSize: 12, color: "#9A9CA5", alignSelf: "center" }}>Ningún regalo: este lado no suma nada.</span>}
        {tokens.map((t) => {
          const g = find(t);
          return (
            <span
              key={t}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 4px 3px 6px", borderRadius: 8, background: "#0E0F12", border: "1px solid #2A2C33", fontSize: 12.5 }}
            >
              {g && <img src={g.imageUrl} alt="" referrerPolicy="no-referrer" style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover" }} />}
              <b style={{ fontWeight: 700 }}>{g?.name ?? t}</b>
              {g && <span style={{ color: "#9A9CA5", fontSize: 11 }}>{g.cost} 🪙</span>}
              {g && (
                <button
                  type="button"
                  title="Envía un regalo de prueba (como el Simulador): suma en el marcador de este duelo"
                  onClick={() => onTest(g)}
                  style={{ border: "1px solid #2A2C33", borderRadius: 6, background: "#1A1C22", color: "#C9CBD2", cursor: "pointer", fontSize: 11, padding: "2px 7px" }}
                >
                  Probar
                </button>
              )}
              <button
                type="button"
                aria-label={`Quitar ${g?.name ?? t}`}
                onClick={() => onChange(tokens.filter((x) => x !== t))}
                style={{ border: "none", background: "transparent", color: "#9A9CA5", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 4px" }}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex" }}>
        <GiftPicker value={null} gifts={gifts} onSelect={addFromCatalog} placeholder="Añadir regalo de la lista…" />
      </div>
      <input
        value={manual}
        onChange={(e) => setManual(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          add(manual);
          setManual("");
        }}
        placeholder="¿No sale en la lista? Escribe su nombre y pulsa Enter"
        style={{ ...inputStyle, width: "100%", fontSize: 11.5 }}
      />
    </div>
  );
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Campo de texto que guarda al salir del campo o con Enter (no en cada letra). */
function CommitInput({ value, onCommit, max }: { value: string; onCommit: (v: string) => void; max?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      maxLength={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...inputStyle, width: "100%" }}
    />
  );
}
