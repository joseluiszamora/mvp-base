# TASK-014 — Renombrar el proyecto a MVP Base
Estado: renombre remoto completo; PR [#35](https://github.com/joseluiszamora/mvp-base/pull/35) abierto hacia `main`. Rama: `task/014-renombrar-mvp-base`. Issue GitHub: [#34](https://github.com/joseluiszamora/mvp-base/issues/34).

## Contexto
El propietario define que el producto es una base administrativa reutilizable, independiente de rubro. El nombre anterior asociaba el repositorio con transporte y no corresponde al alcance aprobado.

## Objetivo y alcance
Renombrar el proyecto y el repositorio GitHub de `mvp-transporte` a `mvp-base`. Actualizar el nombre raíz de npm, el scope de workspaces, imports, identidad usada por fixtures y documentación con enlaces canónicos. Registrar los cambios de compatibilidad en `docs/decisions.md`.

## Fuera de alcance
No añadir módulos, cambiar rutas API, alterar el esquema o los datos, modificar reglas de autorización ni desplegar producción. Mantener estables los issuer/audience JWT, los nombres de coordinación entre pestañas y los advisory locks PostgreSQL para que versiones existentes sigan interoperando.

## Criterios de aceptación
- El repositorio remoto se llama `joseluiszamora/mvp-base`.
- `npm` reconoce los workspaces `@mvp-base/api`, `@mvp-base/web` y `@mvp-base/contracts`.
- Los imports, scripts, identidad de correo de prueba y enlaces activos/documentales usan el nombre nuevo.
- Las preferencias de tema guardadas con la clave anterior se leen y migran sin perder el valor.
- No quedan nombres antiguos en identidad pública, paquetes o documentación activa; los identificadores internos estables quedan justificados en decisiones.
- Los checks afectados pasan y no hay cambios en API, esquema ni migraciones.

## Validación
Actualizar `package-lock.json` desde los manifests y ejecutar lint, typecheck, pruebas unitarias, build e integración con recursos desechables. Verificar los enlaces canónicos y buscar referencias residuales, distinguiendo identificadores internos conservados.

### Resultados — 03/11/2026
- `npm install --package-lock-only --ignore-scripts --offline`: actualizó solo nombres de raíz/workspaces; no cambió versiones de dependencias. `npm install --ignore-scripts --offline --no-audit --no-fund` actualizó los enlaces locales de workspaces.
- `npm run lint`: pasó; Biome revisó 77 archivos.
- `npm run typecheck`: pasó en contracts, API y web.
- `npm test`: pasó, 12/12. La ejecución en sandbox bloqueó loopback (`EACCES`); la repetición con acceso local pasó.
- `npm run build`: pasó; Vite mantiene la advertencia de bundle principal de 1,127.24 kB por encima del umbral de 500 kB.
- `npm run test:integration`: la primera ejecución llegó al flujo SMTP pero cuatro envíos fallaron; la repetición pasó todas las verificaciones de aislamiento, archivos, autenticación, permisos y correo, aplicó ocho migraciones/seed a recursos Docker desechables y los eliminó. No se usó una base persistente.
- `git diff --check`: pasó. `npm ls` resuelve los tres workspaces con `@mvp-base`.
- GitHub confirma el nombre `joseluiszamora/mvp-base`; el ID del repositorio se mantuvo. `origin` apunta a `git@github.com:joseluiszamora/mvp-base.git`.

## Entrega
Commit identificable como TASK-014, enlaces canónicos y estado de implementación/validación en `docs/tracking.md`. No cerrar la issue hasta completar el cambio remoto y la revisión técnica.
