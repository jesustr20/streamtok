#!/usr/bin/env bash
# Corre esto UNA VEZ, después de `gh repo create` y el primer push, desde
# WSL/Ubuntu con `gh auth login` ya hecho. Crea labels + milestone + el
# primer lote de issues (área/prioridad, siguiendo el mismo patrón que ya
# usas en otros proyectos: area:*, P0-P2, colgados de una milestone).
set -euo pipefail

# --- labels --------------------------------------------------------------
gh label create "area:shared"  --color "1D76DB" --description "packages/shared (esquemas Zod)" --force
gh label create "area:sidecar" --color "0E8A16" --description "packages/sidecar (servidor WS)" --force
gh label create "area:desktop" --color "5319E7" --description "apps/desktop (Tauri + React)"   --force
gh label create "area:ci"      --color "BFD4F2" --description "GitHub Actions / tooling"        --force
gh label create "P0" --color "B60205" --description "bloqueante" --force
gh label create "P1" --color "D93F0B" --description "importante, no bloqueante" --force
gh label create "P2" --color "FBCA04" --description "nice to have" --force

# --- milestone -------------------------------------------------------------
gh api repos/:owner/:repo/milestones -f title="v1.0 — integración local con el mod de GTA V" \
  -f description="Servidor WS + botón de instalar el mod, funcionando de punta a punta en la máquina de Jesús." \
  || echo "milestone ya existe, sigo"

# --- issues del primer lote --------------------------------------------------
gh issue create \
  --title "Compilar y correr el Tauri en Windows nativo" \
  --label "area:desktop,P0" \
  --milestone "v1.0 — integración local con el mod de GTA V" \
  --body-file - <<'EOF'
El scaffold de `apps/desktop/src-tauri` (Rust) se escribió sin poder
compilarlo (se hizo fuera de Windows). Correr `pnpm install` y
`pnpm tauri dev` en Windows nativo (NO WSL — el código usa la crate
`windows` y abre una ventana con WebView2), arreglar cualquier error de
compilación sin cambiar las firmas de los comandos Tauri
(`install_gta_v_mod`, `find_gta_v_path`, `pick_gta_v_folder`) porque el
frontend React ya los llama así. Ver AGENTS.md antes de tocar nada.
EOF

gh issue create \
  --title "Conectar tiktok-live-connector de verdad" \
  --label "area:sidecar,P0" \
  --milestone "v1.0 — integración local con el mod de GTA V" \
  --body-file - <<'EOF'
Reemplazar el TODO en `packages/sidecar/src/index.ts` con una conexión real
a TikTok LIVE vía `tiktok-live-connector`, normalizando sus eventos al
`LiveEventSchema` de `packages/shared/src/live-event.ts`. Ver AGENTS.md
(Regla #1: no tocar los esquemas de shared) y Regla #3 (agregar tests en
sidecar para la normalización, especialmente el manejo de streaks de
regalo).
EOF

gh issue create \
  --title "Persistir las reglas de mapeo desde la UI" \
  --label "area:sidecar,area:desktop,P1" \
  --milestone "v1.0 — integración local con el mod de GTA V" \
  --body-file - <<'EOF'
Las `MappingRule` de `packages/sidecar/src/mapping.ts` hoy son un array
hardcodeado. Necesitamos crearlas/editarlas/borrarlas desde la UI y que
persistan entre reinicios (JSON local vía `@tauri-apps/plugin-fs` o similar).
Es una decisión con cierto costo de deshacer (formato de persistencia) —
ver Regla #5 del AGENTS.md, considerar un ADR corto antes de implementar.
EOF

gh issue create \
  --title "Editor de params en ActionsPanel" \
  --label "area:desktop,P1" \
  --milestone "v1.0 — integración local con el mod de GTA V" \
  --body-file - <<'EOF'
`apps/desktop/src/components/ActionsPanel.tsx` hoy solo lista el catálogo
en modo lectura. Agregar, por cada acción, un editor de sus `params`
(`ModActionParam` en `packages/shared/src/mod-protocol.ts`): enum→select,
bool→switch, int→input numérico con botones para `presets` si existen,
respetando `min`/`max`. No hace falta persistencia todavía (issue aparte).
EOF

echo "Listo. Revisa con: gh issue list --milestone \"v1.0 — integración local con el mod de GTA V\""
