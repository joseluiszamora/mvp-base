import type { Pool, QueryResultRow } from "pg";

export const permissionDefinitions = [
  ["organizations.read", "Consultar organizaciones de plataforma"],
  ["organizations.create", "Crear organizaciones en plataforma"],
  ["organizations.update", "Actualizar organizaciones en plataforma"],
  ["organizations.activate", "Activar organizaciones en plataforma"],
  ["organizations.deactivate", "Desactivar organizaciones en plataforma"],
  ["companies.read", "Consultar empresas"],
  ["companies.create", "Crear empresas"],
  ["companies.update", "Actualizar empresas"],
  ["companies.deactivate", "Desactivar empresas"],
  ["branches.read", "Consultar sucursales"],
  ["branches.create", "Crear sucursales"],
  ["branches.update", "Actualizar sucursales"],
  ["branches.deactivate", "Desactivar sucursales"],
  ["users.read", "Consultar usuarios"],
  ["users.create", "Crear usuarios"],
  ["users.update", "Actualizar usuarios"],
  ["users.deactivate", "Desactivar usuarios"],
  ["roles.read", "Consultar roles"],
  ["roles.create", "Crear roles"],
  ["roles.update", "Actualizar roles"],
  ["roles.assign", "Asignar roles"],
  ["employees.read", "Consultar datos laborales"],
  ["employees.personal.read", "Consultar datos personales de empleados"],
  ["employees.create", "Crear empleados"],
  ["employees.update", "Actualizar empleados"],
  ["employees.deactivate", "Desactivar empleados"],
  ["employee_documents.read", "Consultar documentos de empleados"],
  ["employee_documents.manage", "Gestionar documentos de empleados"],
  ["settings.read", "Consultar configuración"],
  ["settings.update", "Actualizar configuración"],
  ["catalogs.read", "Consultar catálogos"],
  ["catalogs.manage", "Gestionar catálogos"],
  ["files.upload", "Cargar archivos privados"],
  ["files.read", "Consultar archivos autorizados"],
  ["files.download", "Descargar archivos autorizados"],
  ["files.delete", "Eliminar archivos autorizados"],
  ["audit.read", "Consultar auditoría"],
  ["notifications.read", "Consultar notificaciones"],
  ["notifications.manage", "Gestionar notificaciones"],
] as const;

export const tenantAdminPermissionCodes = permissionDefinitions
  .map(([code]) => code)
  .filter((code) => !code.startsWith("organizations."));

interface PermissionRow extends QueryResultRow {
  code: string;
  description: string;
}

type PermissionQueryable = Pick<Pool, "query">;

const basePermissionCodeSet = new Set<string>(permissionDefinitions.map(([code]) => code));

export async function loadTenantPermissionCatalog(
  database: PermissionQueryable,
): Promise<Array<{ code: string; description: string }>> {
  const result = await database.query<PermissionRow>(
    `SELECT permission.code, permission.description
     FROM permissions AS permission
     WHERE permission.code = ANY($1::text[])
        OR EXISTS (
          SELECT 1 FROM integration_permissions AS integration_permission
          WHERE integration_permission.permission_code = permission.code
        )
     ORDER BY permission.code`,
    [[...basePermissionCodeSet]],
  );
  return result.rows.filter((row) => !row.code.startsWith("organizations."));
}

export async function loadTenantAdminPermissionCodes(
  database: PermissionQueryable,
): Promise<string[]> {
  return (await loadTenantPermissionCatalog(database)).map(({ code }) => code);
}
