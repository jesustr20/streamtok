# ADR 0020 — Aviso de cambios sin guardar al cerrar ventanas de edición

Estado: aceptado (2026-11-06). Solo UI de escritorio; no toca contratos ni el sidecar.

## Decisión

Toda ventana o formulario de edición que se cierre con cambios sin guardar pregunta antes de cerrar, con tres opciones:

- **Guardar**: ejecuta el guardado normal. Si no pasa la validación, la ventana queda abierta mostrando su error.
- **Salir sin guardar**: cierra y descarta los cambios.
- **Cancelar**: vuelve a la ventana para seguir editando.

Si no hubo cambios, cierra directo sin preguntar.

## Cómo

`useUnsavedGuard(snapshot, onClose, save)` (`apps/desktop/src/lib/unsaved-guard.tsx`). Cada ventana le pasa una "foto" serializable de todo lo editable; la del primer render es la de referencia y se compara al cerrar. Los ids aleatorios de filas (`key`) no cuentan como cambio.

Aplicado en: modal Nueva/Editar Acción, modal Nuevo/Editar Evento y el formulario de Metas.

## Fuera de alcance (por ahora)

- Cerrar la ventana de la app con cambios abiertos.
- Formularios mínimos de un solo campo (nombre de perfil) y las pantallas de configuración de overlays (guardan al instante o tienen su propio botón Guardar).
- Cerrar con la tecla Esc o con clic en el fondo: los modales actuales no lo hacen y no se añadió.
