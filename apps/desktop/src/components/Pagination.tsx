import { useEffect, useState } from "react";

/** Filas por página en las tablas de Acciones y Eventos (como Interactive). */
export const PAGE_SIZE = 15;

const ACCENT = "#E23A57";

/**
 * Paginación de una lista ya filtrada. Vuelve a la página 1 cuando cambia
 * `resetKey` (por ejemplo el texto de búsqueda) y se ajusta sola si la lista
 * se acorta (borrar el último elemento de la última página).
 */
export function usePagination<T>(items: T[], resetKey: string, pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    pageCount,
    setPage,
    pageItems: items.slice(start, start + pageSize),
  };
}

/** Páginas a mostrar: siempre la primera y la última, la actual y sus vecinas,
 * con `…` en los huecos. */
export function pageWindow(page: number, pageCount: number): (number | "…")[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

/** Barra "‹ 1 2 3 ›". No se muestra si todo cabe en una sola página. */
export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Paginación" style={{ display: "flex", justifyContent: "center", gap: 6, padding: "4px 0" }}>
      <button
        type="button"
        aria-label="Página anterior"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        style={{ ...buttonStyle, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? "default" : "pointer" }}
      >
        ‹
      </button>
      {pageWindow(page, pageCount).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} style={{ ...buttonStyle, background: "transparent", cursor: "default" }}>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onChange(p)}
            style={{
              ...buttonStyle,
              background: p === page ? ACCENT : "#1A1B21",
              color: p === page ? "#FFFFFF" : "#C4C5CC",
              fontWeight: p === page ? 700 : 500,
            }}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="Página siguiente"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        style={{
          ...buttonStyle,
          opacity: page >= pageCount ? 0.4 : 1,
          cursor: page >= pageCount ? "default" : "pointer",
        }}
      >
        ›
      </button>
    </nav>
  );
}

const buttonStyle: React.CSSProperties = {
  minWidth: 32,
  height: 32,
  padding: "0 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#1A1B21",
  border: "1px solid #2A2C33",
  borderRadius: 8,
  color: "#C4C5CC",
  fontSize: 12.5,
  fontFamily: "inherit",
  boxSizing: "border-box",
};
