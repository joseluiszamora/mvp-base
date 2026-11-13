# Integración de APIs de producto

La API de producto y MVP Base son servicios independientes con bases de datos separadas. El producto conserva sus entidades y reglas; Base valida las sesiones y permisos compartidos, guarda archivos privados y escribe auditoría común. El consumidor solo usa los endpoints y tipos públicos de `@mvp-base/contracts`; no importa módulos internos ni consulta tablas de Base.

## Credenciales y límite de confianza

Configura una credencial de servicio de al menos 32 caracteres aleatorios por integración en `MVP_INTEGRATION_SECRETS_JSON`. El ejemplo local usa `{}` y no registra servicios habilitados. Guarda el valor solo en el entorno del API consumidor y de Base; nunca lo entregues al navegador, a una aplicación móvil ni a logs. Reinicia el API Base después de cambiar la variable.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Ejemplo con un valor ficticio:

```dotenv
MVP_INTEGRATION_SECRETS_JSON='{"transport":"reemplazar-por-un-secreto-aleatorio-de-32-caracteres-o-mas"}'
```

El consumidor envía `X-MVP-Integration-Key` para identificarse y el `Authorization: Bearer <access-token>` del usuario en cada operación. Base vuelve a comprobar firma, expiración, revocación, estado de usuario y membresía en cada solicitud. La credencial de servicio identifica al backend consumidor; el Bearer identifica al actor humano. Ambas son necesarias para autorizar, escribir auditoría o leer archivos.

La credencial confía en el API de producto para cargar primero su propio recurso y derivar su empresa y sucursal desde la base de datos de producto. Base comprueba que la empresa/sucursal exista dentro de la organización seleccionada y aplica el permiso exacto; no puede confirmar que un ID externo pertenezca a esa empresa. Nunca reenvíes IDs de empresa/sucursal recibidos directamente del navegador como alcance confiable.

## Registrar permisos y recursos de archivo

Al iniciar o desplegar el API de producto, registra sus definiciones con `PUT /api/v1/integrations/{integrationCode}/registration`. Esta llamada requiere solo `X-MVP-Integration-Key`; no necesita un usuario. El código usa minúsculas y el prefijo de cada permiso debe coincidir con él. Las definiciones aceptadas aparecen en `GET /api/v1/organizations/roles/permissions` y pueden asignarse desde la administración común de roles.

```json
{
  "displayName": "Transporte",
  "auditPermissionCode": "transport.audit.write",
  "permissions": [
    { "code": "transport.vehicles.read", "description": "Consultar vehículos" },
    { "code": "transport.audit.write", "description": "Registrar cambios en auditoría" },
    { "code": "transport.vehicle_files.read", "description": "Consultar archivos de vehículos" },
    { "code": "transport.vehicle_files.upload", "description": "Cargar archivos de vehículos" },
    { "code": "transport.vehicle_files.download", "description": "Descargar archivos de vehículos" },
    { "code": "transport.vehicle_files.delete", "description": "Retirar archivos de vehículos" }
  ],
  "fileResources": [
    {
      "resourceType": "VEHICLE",
      "readPermissionCode": "transport.vehicle_files.read",
      "uploadPermissionCode": "transport.vehicle_files.upload",
      "downloadPermissionCode": "transport.vehicle_files.download",
      "deletePermissionCode": "transport.vehicle_files.delete"
    }
  ]
}
```

Cada llamada envía el manifiesto completo de permisos y recursos vigente de la integración. El registro es idempotente y acumulativo: puede agregar permisos y recursos o actualizar descripciones y asociaciones; no borra definiciones con las que roles o archivos existentes pueden estar relacionados. `auditPermissionCode` debe ser uno de los permisos namespaced del manifiesto y es el único permiso que permite escribir auditoría para esa integración. Los permisos nuevos se agregan al rol común `admin` de las organizaciones existentes y a los administradores de las nuevas organizaciones. Después, los administradores pueden delegarlos en roles de empresa o sucursal.

## Autorizar recursos

`POST /api/v1/integrations/{integrationCode}/authorize` recibe `permissionCode`, `companyId` y opcionalmente `branchId`. Base deriva organización, usuario y membresía del Bearer; valida que los IDs base pertenezcan a esa organización y evalúa permisos actuales en el alcance exacto. Responde con el actor y el alcance validados, o `401`, `403` o `404`. No almacenes una autorización positiva para reutilizarla en operaciones posteriores.

```json
{
  "permissionCode": "transport.vehicles.read",
  "companyId": "<uuid-de-empresa-base>",
  "branchId": "<uuid-de-sucursal-base>"
}
```

Una concesión de sucursal no permite operar en otra sucursal ni en toda la empresa. Para una operación de empresa omite `branchId`; una concesión de sucursal no cubre ese alcance.

## Resolver el empleado de la sesión

`GET /api/v1/employees/me` resuelve el empleado activo vinculado al usuario autenticado dentro de la organización seleccionada en la sesión. No recibe identificadores de usuario, empleado, organización ni empresa. La respuesta contiene únicamente `employeeId`, `organizationId` y `companyId`; no expone datos personales, laborales ni permisos de Base. Requiere una sesión vigente y membresía activa, y devuelve `404 EMPLOYEE_NOT_FOUND` cuando no hay una relación activa disponible. No requiere `employees.read`, `employees.personal.read` ni `users.read`, y no concede por sí sola acceso a una aplicación de producto. El API consumidor debe comprobar sus propios permisos después de cargar el recurso y derivar el alcance desde su base.

## Archivos externos privados

Usa `POST /api/v1/integrations/{integrationCode}/files/{resourceType}/{resourceId}?companyId=...&branchId=...` con `multipart/form-data` y el campo `file`. `resourceType` debe estar registrado; el identificador externo es UUID. Base conserva los bytes en el mismo volumen privado y crea `File`/`FileLink` con integración, recurso externo, empresa, sucursal y usuario validados. No devuelve una URL pública.

Para listar usa `GET` en la misma ruta; para metadatos, `GET /files/{fileId}`; para contenido, `GET /files/{fileId}/content`; y para retirar, `DELETE /files/{fileId}` bajo la ruta de integración. Cada consulta vuelve a comprobar la sesión y exige tanto el permiso `files.*` de Base como el permiso de la operación definido para el tipo externo. Descarga el contenido desde el API de producto y entrégalo al usuario solo después de comprobar de nuevo su sesión y autorización en Transporte.

Los archivos aceptan PDF, JPEG, PNG y WEBP hasta 10 MiB. El API vuelve a validar extensión, MIME y firma del contenido. Retirar un archivo quita su enlace y programa la purga después de 24 horas, igual que los otros archivos privados de Base.

## Auditoría de producto

`POST /api/v1/integrations/{integrationCode}/audit-events` requiere la credencial de servicio y el Bearer del usuario. El cuerpo incluye empresa/sucursal, acción, tipo/ID externo y `before`/`after`. Base aplica el `auditPermissionCode` registrado y no permite que el consumidor elija otro permiso. No acepta campos superiores `actorId`, `organizationId`, `membershipId` ni `integrationCode`; Base deriva esos datos de la solicitud autenticada. El tipo de recurso debe usar el namespace de la integración, por ejemplo `transport.vehicle`. El detalle se filtra antes de persistirlo y se quitan claves de identidad declaradas en los mapas de diferencias.

Los eventos se guardan en la auditoría común con `integration_code`, actor `USER`, tenant, empresa y sucursal validados. La lectura continúa protegida por `audit.read` y el alcance habitual de Base.

## Contratos y despliegue

`GET /api/v1/openapi.json` documenta rutas, esquemas y seguridad. `packages/contracts` declara los DTO de registro, autorización, auditoría y metadatos de archivo. Aplicar la migración de Base por el procedimiento normal sobre una base de desarrollo/prueba antes de registrar una integración. No habilitar credenciales ni ejecutar migraciones sobre producción sin el procedimiento de despliegue aprobado.
