# Seguimiento GitHub Issues
GitHub Issues es la fuente de estado de ejecución; roadmap describe dependencias. Inicialmente todos los archivos son plantillas, no issues reales.
Crear una issue por TASK y enlazar la especificación; no duplicar. Labels sugeridas: foundation, module, security, blocked, needs-review. Estados: lista, en desarrollo, bloqueada, en revisión, aceptada. Dependencias explícitas en cuerpo; ramas task/NNN-slug; commits e integración referencian issue real una vez creada.
Codex puede integrar tareas que pasan checks dentro de autonomía acordada; issue permanece en revisión hasta aceptación funcional del propietario. No usar auto-close de issue si aceptación sigue pendiente. No afirmar checks ejecutados por CI si solo se ejecutaron localmente.
## Reporte por tarea
Implementado; criterios cumplidos/pendientes; comandos con resultado; pruebas manuales; decisión nueva; commit/PR real; siguiente dependencia disponible.
## Revisión del propietario
Probar flujo feliz, errores, usuario limitado, otra empresa/tenant; comparar criterio con evidencia. No aceptar por compilación solamente.
## Semana de revisión
Día 1: arranque/tenant; 2: login/sesiones; 3: roles/alcances; 4: catálogos/config; 5: personal/archivos; 6: SMTP/audit; 7: regresión/backup. Agenda aplicable cuando entregas estén disponibles; no exige implementar todo en esa semana.

## Estado verificado 15/10/2026
- TASK-001: aceptación funcional confirmada por el propietario; PR #14 integrado en `main`, CI aprobada y issue #1 cerrada.
- TASK-002: PR #15 integrado en `main` con CI aprobada; issue #2 abierta hasta aceptación funcional. La integración de TASK-003 usa una base desechable y no aplica migraciones a producción ni a la base persistente local.
- TASK-003: entrega registrada en PR #16; validaciones locales y CI remota aprobadas. Issue #3 abierta hasta aceptación funcional del propietario.
- TASK-004: integrada en `main` por PR #17, merge commit `642940f4e71358571a9facb0e2981c0aaa6c32b5`; CI run #10 aprobó lint, typecheck, unitarias, build e integración PostgreSQL. Issue #4 permanece abierta hasta aceptación funcional. La base persistente local no se usó.
- TASK-005: integrada en `main` por PR #18, merge commit `2aab75c03f86056a1f478d0d107029453b3cdf2`; CI run #12 aprobó validación. Issue #5 permanece abierta hasta aceptación funcional; no se aplicaron migraciones a la base persistente ni se desplegó producción.
- TASK-006: integrada en `main` mediante PR #19, merge commit `f2bf803746afd9158fdb5e3095512f576d94aeb1`; CI run #14 aprobó lint, typecheck, unitarias, build e integración PostgreSQL desechable. Issue #6 sigue abierta hasta aceptación funcional. No se aplicaron migraciones a una base persistente ni se desplegó producción.
- TASK-007: integrada en `main` por PR #20; Issue #7 sigue abierta hasta aceptación funcional del propietario. La base persistente local no se usó.

## Estado verificado 16/10/2026
- TASK-008: implementación completa en `task/008-configuracion`, depende de TASK-007 integrada por PR #20. Validaciones locales `lint`, `typecheck`, unitarias (7/7), build e integración con PostgreSQL 18/Mailpit desechables aprobadas. Issue #8 permanece abierta hasta aceptación funcional; revisión técnica y prueba manual pendientes. La migración nueva solo se aplicó a la base desechable; no se desplegó producción.

## Estado verificado 18/10/2026
- TASK-008: PR #23 integrada en `main` por merge commit `3967f82a071e78c5bf5e75a70066bd7d66e34f20`; CI aprobada. Issue #8 sigue abierta hasta aceptación funcional del propietario.
- TASK-009: PR #24 integrada en `main` por merge commit `3c76c3aa9321578d07af4c04e4424b99dbe806a5`, tras validaciones locales `lint`, `typecheck`, pruebas unitarias (7/7), build e integración PostgreSQL/Mailpit desechables correctas. Issue #9 sigue abierta; prueba manual de UI y aceptación funcional pendientes. Producción y base persistente local no se tocaron.
- Política registrada: ADM-08 acepta adjuntos de empresa y sucursal con permiso de archivos más permiso del recurso. Enlaces a documentos personales se rechazan hasta que ADM-05 registre entidad y autorización.

- TASK-010: integrada en `main` por PR #25, merge commit `0b5fd5fa0e40280a37928c946cd1bc66a1d2789d`; CI #30 aprobó lint, typecheck, unitarias, build e integración PostgreSQL desechable. Issue #10 cerrada tras aceptación funcional del propietario. No se usó la base persistente local ni se desplegó producción.
- TASK-011: integrada en `main` por PR #26, merge commit `47d4a160a6b09627e92b3c27d746b7b943e3b2ba`; CI #34 aprobó lint, typecheck, pruebas unitarias, build e integración PostgreSQL desechable. El propietario confirmó la prueba funcional el 25/10/2026 y la issue #11 se cerró como completada. Validó permisos, filtros, listado/detalle, aislamiento de organización y sucursal, eventos dentro/fuera de sucursal, solo lectura, sanitización de datos sensibles e historial disponible. Decisiones aprobadas: conservar todos los eventos sin purga y resolver visibilidad por sucursal según asignación actual. No se usó la base persistente local ni se desplegó producción.


## Estado verificado 25/10/2026
- TASK-012: ADM-09 integrada en `main` mediante PR #27 (merge commit `dd0b20c458e952b5c0af50df65e2ebf2674f90be`) y ajuste de reintentos por PR #32 (merge commit `ae86d1ad633958175cb7008e58c783b9b8e7f6e7`). CI #41 y #45 aprobaron. Validaciones locales del ajuste: lint, typecheck, build, `git diff --check`, `npm run test` (12/12) e integración PostgreSQL/Mailpit desechables. El propietario aceptó funcionalmente ADM-09 y cerró la issue #12 el 25/10/2026 después de verificar permisos de `PLATFORM_ADMIN`, persistencia y secreto SMTP, errores de validación, prueba/envío fallido/reintento, auditoría e historial con filtros y `notifications.read`. La política conserva cinco intentos con backoff exponencial con jitter desde 30 segundos; mensajes que ya agotaron intentos quedan terminales. No se usó la base persistente local ni se desplegó producción.
- TASK-013: siguiente tarea, depende de TASK-012 aceptada; issue #13 está abierta. Alcance: pruebas end-to-end críticas, revisión de seguridad, OpenAPI final, manual de instalación, prueba local de backup/restauración de base y archivos, y guía DigitalOcean sin desplegar producción.

## Estado verificado 03/11/2026
- El propietario aceptó el desarrollo actual y cerró la Issue #13. Las verificaciones realizadas y sus resultados se registran en `docs/tasks/TASK-013.md` y en la Issue #13.
- Pasaron lint, typecheck, 12 pruebas unitarias, build e integración contra PostgreSQL/Mailpit desechables, incluso desde un snapshot limpio instalado con `npm ci`.
- La comparación OpenAPI encontró 77 rutas/métodos implementados y documentados, sin diferencias. La prueba de backup/restore recuperó una fila `FileLink` y sus bytes con hash SHA-256 coincidente.
- `npm audit` reportó una vulnerabilidad alta (`body-parser@2.3.0`) y dos moderadas (`fast-uri@3.1.8`, `nodemailer@10.1.1`) en el árbol de producción. No se actualizaron dependencias.
- El recorrido manual de los 14 escenarios de UI y la guía de DigitalOcean no quedaron realizados en esta verificación.

## Estado verificado 03/11/2026 — TASK-014
- El propietario solicitó renombrar proyecto y repositorio de `mvp-transporte` a `mvp-base`.
- Se creó la Issue GitHub [#34](https://github.com/joseluiszamora/mvp-base/issues/34), cerrada como completada tras la integración.
- TASK-014 se integró en `main` por el PR [#35](https://github.com/joseluiszamora/mvp-base/pull/35), merge commit `ef2c6009b70ba5888f192c518bc58bcc9c4627d0`; el check remoto `validate` pasó. La entrega cambió manifests, imports, referencias canónicas e identidad de fixtures, migró la preferencia de tema y conservó identificadores internos de compatibilidad.
- Lockfile actualizado solo en los nombres de workspaces; lint, typecheck, unitarias (12/12), build e integración PostgreSQL/Mailpit desechables pasaron. La primera integración falló en cuatro envíos SMTP y la repetición pasó completa.
- GitHub confirma `joseluiszamora/mvp-base`; `origin` usa la URL nueva. La revisión técnica y la integración quedaron completadas antes de cerrar la issue.

## Estado verificado 10/11/2026 — TASK-015
- En desarrollo local en `task/007-transport-integration-contract`. Implementa el contrato que mvp-transporte denomina TASK-007; no añade reglas ni modelos de transporte a Base.
- `npm run lint`, `npm run typecheck`, `npm test` (15/15) y `npm run build` pasaron. El build conserva la advertencia existente del bundle web principal (~1.13 MB).
- `npm run test:integration` construyó contracts/API, pero no inició PostgreSQL: el entorno no contiene Docker CLI (`docker` no se encontró). Por tanto, la migración, autorización contextual, auditoría y ciclo de archivos aún esperan ejecución en PostgreSQL desechable.
- No se aplicaron migraciones a una base persistente. No se creó Issue/PR ni se publicó la rama.
