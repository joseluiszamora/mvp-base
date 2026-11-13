# TASK-016 — Contexto mínimo del empleado autenticado

**Estado:** En desarrollo · **Prioridad:** P1 · **Rama:** `task/016-employee-self-context`

## Contexto

TASK-005 de mvp-transporte necesita identificar al conductor desde la sesión Base. El contrato existente para consultar empleados requiere un `employeeId` conocido y permisos generales de lectura laboral o personal. El producto no debe inferir identidad desde un ID del cliente ni solicitar permisos amplios para obtenerla.

## Objetivo

Exponer una operación autenticada que resuelva, dentro de la organización seleccionada, solo al empleado activo asociado al usuario de la sesión vigente.

## Alcance

- `GET /api/v1/employees/me`, protegido por la autenticación habitual de Base.
- Resolver actor, organización y membresía exclusivamente desde la sesión validada.
- Comprobar usuario, membresía, organización, empresa y empleado activos.
- Responder solo `employeeId`, `organizationId` y `companyId`.
- Documentar el DTO TypeScript y el contrato OpenAPI.

## Fuera de alcance

- Cualquier parámetro `userId`, `employeeId`, `organizationId` o `companyId` enviado por el cliente.
- Datos personales, laborales, permisos o una concesión de acceso a la aplicación de producto.
- Cambios al esquema, migraciones, nuevas tablas o permisos.
- Cambios en mvp-transporte más allá del consumo del contrato.

## Criterios de aceptación

- La ruta requiere una sesión Bearer vigente con organización y membresía seleccionadas.
- La búsqueda usa el usuario y la membresía de sesión; ignora cualquier identidad indicada por el cliente.
- Solo devuelve una relación activa de la organización seleccionada y con empresa activa.
- Si no hay exactamente una relación disponible, responde `404 EMPLOYEE_NOT_FOUND`.
- La respuesta no incluye nombre, correo, documento, teléfono, cargo, sucursales ni datos de la membresía.
- La ruta no requiere `employees.read`, `employees.personal.read` ni `users.read`, y no otorga permisos de producto.
- Contracts, OpenAPI, seguridad y guía de APIs de producto documentan el contrato.
- No se requiere migración: `employees.user_id` y su unicidad por organización ya existen.

## Validación

Ejecutar `npm run lint`, `npm run typecheck` y `npm run build`. Las pruebas unitarias y de integración no se ejecutarán como parte de esta sesión.

## Entrega

El consumidor autorizado es mvp-transporte TASK-005. No crear Issue/PR ni publicar la rama sin solicitud explícita.
