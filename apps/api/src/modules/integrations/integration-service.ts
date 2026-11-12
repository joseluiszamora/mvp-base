import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";

export interface IntegrationPermissionDefinition {
  code: string;
  description: string;
}

export interface IntegrationFileResourceDefinition {
  resourceType: string;
  readPermissionCode: string;
  uploadPermissionCode: string;
  downloadPermissionCode: string;
  deletePermissionCode: string;
}

export interface IntegrationRegistrationDefinition {
  displayName: string;
  auditPermissionCode: string;
  permissions: IntegrationPermissionDefinition[];
  fileResources: IntegrationFileResourceDefinition[];
}

export interface IntegrationTarget {
  integrationCode: string;
  organizationId: string;
  companyId: string;
  branchId: string | null;
  organizationStatus: string;
  companyStatus: string;
  branchStatus: string | null;
  actorId: string;
  membershipId: string;
}

export interface IntegrationFileResourceRow extends QueryResultRow, IntegrationFileResourceDefinition {}

interface TargetRow extends QueryResultRow {
  organization_id: string;
  organization_status: string;
  company_id: string;
  company_status: string;
  branch_id: string | null;
  branch_status: string | null;
}

const integrationCodePattern = /^[a-z][a-z0-9-]{0,39}$/u;
const permissionCodePattern = /^[a-z][a-z0-9_.-]{2,99}$/u;
const resourceTypePattern = /^[A-Z][A-Z0-9_]{0,59}$/u;
const reservedIntegrationCodes = new Set([
  "organizations", "companies", "branches", "users", "roles", "employees", "employee_documents",
  "settings", "catalogs", "files", "audit", "notifications",
]);

export function parseIntegrationSecrets(raw: string | undefined): Readonly<Record<string, string>> {
  if (raw === undefined || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MVP_INTEGRATION_SECRETS_JSON debe contener un objeto JSON válido.");
  }
  if (!isPlainRecord(parsed)) {
    throw new Error("MVP_INTEGRATION_SECRETS_JSON debe contener un objeto JSON.");
  }
  const secrets: Record<string, string> = {};
  for (const [code, secret] of Object.entries(parsed)) {
    if (!isIntegrationCode(code) || typeof secret !== "string" || secret.length < 32 || secret.length > 512) {
      throw new Error("MVP_INTEGRATION_SECRETS_JSON contiene una integración o secreto no válido.");
    }
    secrets[code] = secret;
  }
  return Object.freeze(secrets);
}

export function isIntegrationCode(value: unknown): value is string {
  return typeof value === "string" && integrationCodePattern.test(value) && !reservedIntegrationCodes.has(value);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function nonemptyText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/u.test(value);
}

export function parseRegistrationDefinition(value: unknown, integrationCode: string): IntegrationRegistrationDefinition {
  if (!isPlainRecord(value) || !exactKeys(value, ["displayName", "auditPermissionCode", "permissions", "fileResources"])) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La definición de integración no es válida.");
  }
  if (!nonemptyText(value.displayName, 120) || typeof value.auditPermissionCode !== "string" ||
    !permissionCodePattern.test(value.auditPermissionCode) || !value.auditPermissionCode.startsWith(`${integrationCode}.`) ||
    !Array.isArray(value.permissions) || value.permissions.length < 1 || value.permissions.length > 100 ||
    !Array.isArray(value.fileResources) || value.fileResources.length > 30) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La definición de integración no es válida.");
  }
  const permissions: IntegrationPermissionDefinition[] = [];
  const permissionCodes = new Set<string>();
  for (const item of value.permissions) {
    if (!isPlainRecord(item) || !exactKeys(item, ["code", "description"]) ||
      typeof item.code !== "string" || !permissionCodePattern.test(item.code) || !item.code.startsWith(`${integrationCode}.`) ||
      !nonemptyText(item.description, 300) || permissionCodes.has(item.code)) {
      throw new AuthServiceError(400, "INVALID_INTEGRATION_PERMISSION", "Los permisos de integración no son válidos.");
    }
    permissionCodes.add(item.code);
    permissions.push({ code: item.code, description: item.description.trim() });
  }
  if (!permissionCodes.has(value.auditPermissionCode)) {
    throw new AuthServiceError(400, "INVALID_INTEGRATION_AUDIT_PERMISSION", "El permiso para escribir auditoría debe estar registrado por esta integración.");
  }

  const fileResources: IntegrationFileResourceDefinition[] = [];
  const resourceTypes = new Set<string>();
  for (const item of value.fileResources) {
    if (!isPlainRecord(item) || !exactKeys(item, [
      "resourceType", "readPermissionCode", "uploadPermissionCode", "downloadPermissionCode", "deletePermissionCode",
    ]) || typeof item.resourceType !== "string" || !resourceTypePattern.test(item.resourceType) || resourceTypes.has(item.resourceType)) {
      throw new AuthServiceError(400, "INVALID_INTEGRATION_FILE_RESOURCE", "Los recursos de archivo no son válidos.");
    }
    const permissionFields = ["readPermissionCode", "uploadPermissionCode", "downloadPermissionCode", "deletePermissionCode"] as const;
    if (permissionFields.some((field) => typeof item[field] !== "string" || !permissionCodes.has(item[field] as string))) {
      throw new AuthServiceError(400, "INVALID_INTEGRATION_FILE_RESOURCE", "Cada operación de archivo debe usar un permiso declarado por la integración.");
    }
    resourceTypes.add(item.resourceType);
    fileResources.push({
      resourceType: item.resourceType,
      readPermissionCode: item.readPermissionCode as string,
      uploadPermissionCode: item.uploadPermissionCode as string,
      downloadPermissionCode: item.downloadPermissionCode as string,
      deletePermissionCode: item.deletePermissionCode as string,
    });
  }

  return { displayName: value.displayName.trim(), auditPermissionCode: value.auditPermissionCode, permissions, fileResources };
}

function secretsMatch(candidate: string, expected: string): boolean {
  const candidateHash = createHash("sha256").update(candidate, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function verifyIntegrationSecret(
  integrationCode: string,
  candidate: string | undefined,
  configuredSecrets: Readonly<Record<string, string>>,
): boolean {
  const expected = configuredSecrets[integrationCode];
  return Boolean(expected && candidate && candidate.length <= 512 && secretsMatch(candidate, expected));
}

async function transaction<T>(database: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function registerIntegration(
  database: Pool,
  integrationCode: string,
  definition: IntegrationRegistrationDefinition,
): Promise<{ integrationCode: string; auditPermissionCode: string; permissions: IntegrationPermissionDefinition[]; fileResources: IntegrationFileResourceDefinition[] }> {
  if (!isIntegrationCode(integrationCode)) throw new AuthServiceError(400, "INVALID_INTEGRATION", "La integración no es válida.");
  return transaction(database, async (client) => {
    await client.query(
      `INSERT INTO integrations (code, display_name, audit_permission_code, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name,
         audit_permission_code = EXCLUDED.audit_permission_code, updated_at = CURRENT_TIMESTAMP`,
      [integrationCode, definition.displayName, definition.auditPermissionCode],
    );

    for (const permission of definition.permissions) {
      await client.query(
        `INSERT INTO permissions (code, description) VALUES ($1, $2)
         ON CONFLICT (code) DO NOTHING`,
        [permission.code, permission.description],
      );
      await client.query(
        `INSERT INTO integration_permissions (integration_code, permission_code)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [integrationCode, permission.code],
      );
      const owner = await client.query<{ integration_code: string }>(
        "SELECT integration_code FROM integration_permissions WHERE permission_code = $1",
        [permission.code],
      );
      if (owner.rows[0]?.integration_code !== integrationCode) {
        throw new AuthServiceError(409, "INTEGRATION_PERMISSION_CONFLICT", "El permiso ya pertenece a otra integración.");
      }
      await client.query("UPDATE permissions SET description = $2 WHERE code = $1", [permission.code, permission.description]);
      await client.query(
        `INSERT INTO role_permissions (organization_id, role_id, permission_code)
         SELECT role.organization_id, role.id, $1
         FROM roles AS role WHERE role.code = 'admin'
         ON CONFLICT (role_id, permission_code) DO NOTHING`,
        [permission.code],
      );
    }

    for (const resource of definition.fileResources) {
      await client.query(
        `INSERT INTO integration_file_resources (
           integration_code, resource_type, read_permission_code, upload_permission_code,
           download_permission_code, delete_permission_code
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (integration_code, resource_type) DO UPDATE SET
           read_permission_code = EXCLUDED.read_permission_code,
           upload_permission_code = EXCLUDED.upload_permission_code,
           download_permission_code = EXCLUDED.download_permission_code,
           delete_permission_code = EXCLUDED.delete_permission_code`,
        [integrationCode, resource.resourceType, resource.readPermissionCode, resource.uploadPermissionCode,
          resource.downloadPermissionCode, resource.deletePermissionCode],
      );
    }

    return { integrationCode, auditPermissionCode: definition.auditPermissionCode, permissions: definition.permissions, fileResources: definition.fileResources };
  });
}

function requireSelectedOrganization(session: AuthenticatedSession): { organizationId: string; membershipId: string } {
  if (!session.organizationId || !session.selectedMembershipId) {
    throw new AuthServiceError(403, "ORGANIZATION_REQUIRED", "Selecciona una organización activa para continuar.");
  }
  return { organizationId: session.organizationId, membershipId: session.selectedMembershipId };
}

export async function authorizeIntegrationTarget(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  integrationCode: string,
  session: AuthenticatedSession,
  input: { permissionCode: string; companyId: string; branchId?: string },
  lock = false,
): Promise<IntegrationTarget> {
  const { organizationId, membershipId } = requireSelectedOrganization(session);
  const permission = await database.query<{ permission_code: string }>(
    `SELECT permission_code FROM integration_permissions
     WHERE integration_code = $1 AND permission_code = $2`,
    [integrationCode, input.permissionCode],
  );
  if (!permission.rows[0]) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para esta operación.");

  const targetResult = input.branchId
    ? await database.query<TargetRow>(
      `SELECT organization.id AS organization_id, organization.status AS organization_status,
          company.id AS company_id, company.status AS company_status,
          branch.id AS branch_id, branch.status AS branch_status
       FROM organizations AS organization
       JOIN companies AS company ON company.organization_id = organization.id
       JOIN branches AS branch ON branch.company_id = company.id AND branch.organization_id = organization.id
       WHERE organization.id = $1::uuid AND company.id = $2::uuid AND branch.id = $3::uuid
       ${lock ? "FOR SHARE OF organization, company, branch" : ""}`,
      [organizationId, input.companyId, input.branchId],
    )
    : await database.query<TargetRow>(
      `SELECT organization.id AS organization_id, organization.status AS organization_status,
          company.id AS company_id, company.status AS company_status,
          NULL::uuid AS branch_id, NULL::text AS branch_status
       FROM organizations AS organization
       JOIN companies AS company ON company.organization_id = organization.id
       WHERE organization.id = $1::uuid AND company.id = $2::uuid
       ${lock ? "FOR SHARE OF organization, company" : ""}`,
      [organizationId, input.companyId],
    );
  const target = targetResult.rows[0];
  if (!target) throw new AuthServiceError(404, "INTEGRATION_RESOURCE_NOT_FOUND", "El alcance solicitado no está disponible.");
  if (target.organization_status !== "ACTIVE") throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para esta operación.");

  const context = await resolveAccessContext(database as Pick<Pool, "query">, session.userId, organizationId);
  if (!context || context.membershipId !== membershipId || !hasPermission(context, input.permissionCode, {
    organizationId,
    companyId: target.company_id,
    branchId: target.branch_id,
  })) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para esta operación.");
  }
  return {
    integrationCode,
    organizationId,
    companyId: target.company_id,
    branchId: target.branch_id,
    organizationStatus: target.organization_status,
    companyStatus: target.company_status,
    branchStatus: target.branch_status,
    actorId: context.userId,
    membershipId: context.membershipId,
  };
}

export async function loadIntegrationFileResource(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  integrationCode: string,
  resourceType: string,
): Promise<IntegrationFileResourceRow> {
  const result = await database.query<IntegrationFileResourceRow>(
    `SELECT integration_code AS "integrationCode", resource_type AS "resourceType",
       read_permission_code AS "readPermissionCode", upload_permission_code AS "uploadPermissionCode",
       download_permission_code AS "downloadPermissionCode", delete_permission_code AS "deletePermissionCode"
     FROM integration_file_resources WHERE integration_code = $1 AND resource_type = $2`,
    [integrationCode, resourceType],
  );
  const resource = result.rows[0];
  if (!resource) throw new AuthServiceError(404, "INTEGRATION_FILE_RESOURCE_NOT_FOUND", "El tipo de archivo integrado no está disponible.");
  return resource;
}

export async function appendIntegrationAuditEvent(
  database: Pool,
  integrationCode: string,
  session: AuthenticatedSession,
  input: {
    companyId: string;
    branchId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    requestId: string;
  },
): Promise<{ id: string; target: IntegrationTarget }> {
  return transaction(database, async (client) => {
    const definition = await client.query<{ audit_permission_code: string }>(
      "SELECT audit_permission_code FROM integrations WHERE code = $1",
      [integrationCode],
    );
    const permissionCode = definition.rows[0]?.audit_permission_code;
    if (!permissionCode) throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para esta operación.");
    const target = await authorizeIntegrationTarget(client, integrationCode, session, { ...input, permissionCode });
    const id = await appendAuditEvent(client, {
      organizationId: target.organizationId,
      companyId: target.companyId,
      branchId: target.branchId,
      integrationCode,
      actor: { type: "USER", userId: target.actorId },
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId,
      before: input.before,
      after: input.after,
    });
    return { id, target };
  });
}
