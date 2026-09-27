import { useState } from "react";
import type { ModActionParam } from "@streamtok/shared";

/**
 * Editor genérico de parámetros de una acción del mod, manejado 100% por las
 * formas de `ModActionParam` (packages/shared/src/mod-protocol.ts):
 *   - enum  → select de sus `options`
 *   - bool  → checkbox
 *   - int   → input numérico + botones de `presets` + validación de min/max
 *
 * Guarda estado local (sin persistencia); notifica por `onChange` para que
 * quien lo consuma pueda leer los valores actuales.
 */
export type ParamValues = Record<string, number | string | boolean>;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#17181D",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#F4F4F5",
  fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 11,
  color: "#9A9CA5",
};

const presetStyle: React.CSSProperties = {
  padding: "5px 10px",
  background: "#1F222B",
  border: "1px solid #2A2C33",
  borderRadius: 6,
  color: "#C4C5CC",
  fontSize: 11.5,
  cursor: "pointer",
};

function initValues(params: ModActionParam[]): ParamValues {
  const out: ParamValues = {};
  for (const p of params) out[p.name] = p.default;
  return out;
}

function ParamField({
  param,
  value,
  onChange,
}: {
  param: ModActionParam;
  value: number | string | boolean | undefined;
  onChange: (v: number | string | boolean) => void;
}) {
  if (param.type === "enum") {
    const options = param.options ?? [];
    const str = typeof value === "string" ? value : "";
    if (options.length === 0) {
      return (
        <label style={labelStyle}>
          {param.name}
          <input style={inputStyle} value={str} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    }
    return (
      <label style={labelStyle}>
        {param.name}
        <select style={inputStyle} value={str} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (param.type === "bool") {
    return (
      <label
        style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8, cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {param.name}
      </label>
    );
  }

  // int
  const n = typeof value === "number" ? value : Number(value);
  const finite = Number.isFinite(n);
  const outOfRange =
    finite &&
    ((param.min !== undefined && n < param.min) || (param.max !== undefined && n > param.max));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={labelStyle}>
        {param.name}
        <input
          type="number"
          style={{ ...inputStyle, borderColor: outOfRange ? "#E23A57" : "#2A2C33" }}
          value={finite ? n : ""}
          min={param.min}
          max={param.max}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        />
      </label>
      {param.presets && param.presets.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {param.presets.map((p) => (
            <button key={p} type="button" onClick={() => onChange(p)} style={presetStyle}>
              {p}
            </button>
          ))}
        </div>
      )}
      {outOfRange && (
        <div style={{ fontSize: 11, color: "#F4A5B4" }}>
          Fuera de rango
          {param.min !== undefined ? ` (mín ${param.min})` : ""}
          {param.max !== undefined ? ` (máx ${param.max})` : ""}.
        </div>
      )}
    </div>
  );
}

export function ParamEditor({
  params,
  onChange,
}: {
  params: ModActionParam[];
  onChange?: (values: ParamValues) => void;
}) {
  const [values, setValues] = useState<ParamValues>(() => initValues(params));

  function setParam(name: string, value: number | string | boolean) {
    const next = { ...values, [name]: value };
    setValues(next);
    onChange?.(next);
  }

  if (params.length === 0) {
    return <div style={{ fontSize: 12, color: "#5B5D66" }}>Esta acción no tiene parámetros.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {params.map((param) => (
        <ParamField
          key={param.name}
          param={param}
          value={values[param.name]}
          onChange={(v) => setParam(param.name, v)}
        />
      ))}
    </div>
  );
}
