# TASK-015 — Contratos seguros para APIs de producto

**Estado:** Implementación local; prueba de integración PostgreSQL pendiente · **Prioridad:** P0 · **Rama:** `task/007-transport-integration-contract`

Esta tarea implementa en MVP Base el contrato que mvp-transporte define como TASK-007. Se usa el identificador 015 porque TASK-007 de este repositorio ya corresponde a catálogos.

## Objetivo

Permitir que una API de producto separada revalide una sesión, autorice sus permisos registrados por organización/empresa/sucursal, guarde archivos privados de recursos externos y agregue eventos a la auditoría común. No incorporar reglas de transporte al núcleo.

## Alcance

- Autenticación de API consumidor con `MVP_INTEGRATION_SECRETS_JSON` y Bearer de usuario para cada operación protegida.
- Registro idempotente de permisos namespaced y tipos de archivo externos; exposición en el catálogo común de roles.
- Autorización contextual con membresía, sesión y permisos vigentes; empresa y sucursal comprobadas contra Base.
- Archivos externos mediante el almacenamiento, metadatos, controles de tipo y purga existentes.
- Escritura de auditoría con actor, tenant y alcance derivados de Base y detalle saneado.
- Contratos TypeScript/OpenAPI, migración aditiva y pruebas con PostgreSQL desechable.

## Fuera de alcance

- Modelos, tablas de dominio o reglas de negocio de Transporte.
- Importar código privado de Base o acceder directamente a su base/volumen desde otro servicio.
- Confiar en un ID externo para probar su titularidad empresarial; la API de producto debe cargar la fila en su propia base y derivar el alcance antes de invocar Base.
- Habilitar credenciales o migrar bases persistentes/producción como parte de esta tarea.

## Criterios de aceptación

- Credencial de servicio ausente/incorrecta, Bearer ausente, sesión revocada, cuenta/membresía inactiva o permiso ausente rechazan la operación.
- Los permisos registrados solo aceptan el namespace de la integración y aparecen en gestión de roles; los roles conservan aislamiento de organización, empresa y sucursal.
- Los archivos externos se leen, cargan, descargan y retiran mediante Base con autorización común, sin URL pública ni almacenamiento paralelo.
- La auditoría presenta `integration_code`, usuario, tenant y alcance validados; el permiso de escritura es fijo por integración y el cuerpo no puede elegir esos valores.
- Migración incremental; OpenAPI y contratos publicados; pruebas aisladas sin tocar bases persistentes.

## Validación

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:integration`
- `git diff --check`

## Entrega

Actualizar `docs/integration/product-apis.md`, arquitectura, seguridad, modelo de datos, decisiones, README y tracking. No crear Issue/PR ni publicar la rama sin solicitud explícita.
