import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { hasPermission, resolveAccessContext, type AccessContext } from "../access/access-context.ts";
import { appendAuditEvent } from "../audit/audit-service.ts";
import { AuthServiceError, type AuthenticatedSession } from "../auth/auth-service.ts";
import { getStoredFilePath, removeStoredPath } from "../files/file-storage.ts";
import type { UploadedFileContent } from "../files/files-service.ts";
import {
  authorizeIntegrationTarget,
  loadIntegrationFileResource,
  type IntegrationFileResourceRow,
  type IntegrationTarget,
} from "./integration-service.ts";

interface IntegratedFileRow extends QueryResultRow {
  id: string;
  organization_id: string;
  company_id: string;
  branch_id: string | null;
  storage_key: string;
  original_name: string;
  detected_mime: string;
  bytes: string;
  status: "ACTIVE" | "DELETE_PENDING";
  resource_type: string;
  resource_id: string;
  integration_code: string;
  created_at: Date;
}

type FileAction = "read" | "upload" | "download" | "delete";

function permissionFor(resource: IntegrationFileResourceRow, action: FileAction): string {
  switch (action) {
    case "read": return resource.readPermissionCode;
    case "upload": return resource.uploadPermissionCode;
    case "download": return resource.downloadPermissionCode;
    case "delete": return resource.deletePermissionCode;
  }
}

function basePermissionFor(action: FileAction): string {
  switch (action) {
    case "read": return "files.read";
    case "upload": return "files.upload";
    case "download": return "files.download";
    case "delete": return "files.delete";
  }
}

async function requireBaseFilePermission(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  session: AuthenticatedSession,
  action: FileAction,
  target: IntegrationTarget,
): Promise<AccessContext> {
  const context = await resolveAccessContext(database as Pick<Pool, "query">, session.userId, target.organizationId);
  if (!context || context.membershipId !== target.membershipId || !hasPermission(context, basePermissionFor(action), target)) {
    throw new AuthServiceError(403, "FORBIDDEN", "No tienes permiso para esta operación de archivos.");
  }
  return context;
}

async function authorizeFileTarget(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  integrationCode: string,
  session: AuthenticatedSession,
  resourceType: string,
  scope: { companyId: string; branchId?: string },
  action: FileAction,
  lock = false,
): Promise<{ target: IntegrationTarget; resource: IntegrationFileResourceRow; context: AccessContext }> {
  const resource = await loadIntegrationFileResource(database, integrationCode, resourceType);
  const target = await authorizeIntegrationTarget(database, integrationCode, session, {
    permissionCode: permissionFor(resource, action),
    companyId: scope.companyId,
    branchId: scope.branchId,
  }, lock);
  const context = await requireBaseFilePermission(database, session, action, target);
  return { target, resource, context };
}

function assertWritableTarget(target: IntegrationTarget): void {
  if (target.organizationStatus !== "ACTIVE" || target.companyStatus !== "ACTIVE" || target.branchStatus === "INACTIVE") {
    throw new AuthServiceError(409, "FILE_RESOURCE_INACTIVE", "El recurso inactivo no admite cambios de archivos.");
  }
}

async function inTransaction<T>(database: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
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

function mapIntegratedFile(row: IntegratedFileRow, canDownload: boolean) {
  return {
    id: row.id,
    integrationCode: row.integration_code,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    originalName: row.original_name,
    detectedMime: row.detected_mime,
    bytes: Number(row.bytes),
    createdAt: row.created_at.toISOString(),
    canDownload,
  };
}

export async function authorizeIntegratedFileTarget(
  database: Pool,
  integrationCode: string,
  session: AuthenticatedSession,
  input: { resourceType: string; resourceId: string; companyId: string; branchId?: string; action: "read" | "upload" },
): Promise<IntegrationTarget> {
  const { target } = await authorizeFileTarget(database, integrationCode, session,
    input.resourceType,
    { companyId: input.companyId, branchId: input.branchId }, input.action);
  if (input.action === "upload") assertWritableTarget(target);
  return target;
}

export async function storeIntegratedFile(
  database: Pool,
  integrationCode: string,
  session: AuthenticatedSession,
  input: {
    storageRoot: string;
    resourceType: string;
    resourceId: string;
    companyId: string;
    branchId?: string;
    content: UploadedFileContent;
    requestId: string;
  },
) {
  const id = randomUUID();
  const storageKey = randomUUID();
  const finalPath = getStoredFilePath(input.storageRoot, storageKey);
  await mkdir(dirname(finalPath), { recursive: true, mode: 0o700 });
  await rename(input.content.tempPath, finalPath);
  try {
    const item = await inTransaction(database, async (client) => {
      const { target } = await authorizeFileTarget(client, integrationCode, session,
        input.resourceType,
        { companyId: input.companyId, branchId: input.branchId }, "upload", true);
      assertWritableTarget(target);
      const inserted = await client.query<IntegratedFileRow>(
        `INSERT INTO files (
           id, organization_id, company_id, branch_id, storage_key, original_name, detected_mime,
           bytes, sha256, status, uploaded_by, created_at, updated_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, 'ACTIVE', $10::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, organization_id, company_id, branch_id, storage_key, original_name, detected_mime,
           bytes::text, sha256, status, CURRENT_TIMESTAMP AS created_at`,
        [id, target.organizationId, target.companyId, target.branchId, storageKey, input.content.originalName,
          input.content.detectedMime, input.content.bytes, input.content.sha256, target.actorId],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Integrated file could not be created.");
      await client.query(
        `INSERT INTO file_links (id, file_id, resource_type, resource_id, integration_code, external_resource_type, created_at)
         VALUES ($1::uuid, $2::uuid, 'INTEGRATED_RESOURCE', $3::uuid, $4, $5, CURRENT_TIMESTAMP)`,
        [randomUUID(), id, input.resourceId, integrationCode, input.resourceType],
      );
      await appendAuditEvent(client, {
        organizationId: target.organizationId,
        companyId: target.companyId,
        branchId: target.branchId,
        integrationCode,
        actor: { type: "USER", userId: target.actorId },
        action: "INTEGRATION_FILE_UPLOADED",
        resourceType: `${integrationCode}.${input.resourceType}`,
        resourceId: input.resourceId,
        requestId: input.requestId,
        after: { fileId: id, detectedMime: input.content.detectedMime, bytes: input.content.bytes },
      });
      return mapIntegratedFile({
        ...row,
        status: "ACTIVE",
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        integration_code: integrationCode,
      }, true);
    });
    return { item };
  } catch (error) {
    await removeStoredPath(finalPath).catch(() => undefined);
    throw error;
  }
}

export async function listIntegratedFiles(
  database: Pool,
  integrationCode: string,
  session: AuthenticatedSession,
  input: { resourceType: string; resourceId: string; companyId: string; branchId?: string; limit: number; offset: number; search?: string },
) {
  const { target, resource, context } = await authorizeFileTarget(database, integrationCode, session,
    input.resourceType,
    { companyId: input.companyId, branchId: input.branchId }, "read");
  const search = input.search?.trim() || null;
  if (search && (search.length > 120 || /[\0\r\n]/u.test(search))) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La búsqueda no es válida.");
  }
  const canDownload = hasPermission(context, "files.download", target) &&
    hasPermission(context, resource.downloadPermissionCode, target);
  const params = [integrationCode, input.resourceType, input.resourceId, target.organizationId, target.companyId, target.branchId, search];
  const count = await database.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM files AS file
     JOIN file_links AS link ON link.file_id = file.id
     WHERE link.integration_code = $1 AND link.external_resource_type = $2 AND link.resource_id = $3::uuid
       AND file.organization_id = $4::uuid AND file.company_id = $5::uuid
       AND file.branch_id IS NOT DISTINCT FROM $6::uuid AND file.status = 'ACTIVE'
       AND ($7::text IS NULL OR strpos(lower(file.original_name), lower($7)) > 0)`, params,
  );
  const rows = await database.query<IntegratedFileRow>(
    `SELECT file.id, file.organization_id, file.company_id, file.branch_id, file.storage_key,
        file.original_name, file.detected_mime, file.bytes::text, file.status,
        link.external_resource_type AS resource_type, link.resource_id::text AS resource_id,
        link.integration_code, file.created_at
     FROM files AS file JOIN file_links AS link ON link.file_id = file.id
     WHERE link.integration_code = $1 AND link.external_resource_type = $2 AND link.resource_id = $3::uuid
       AND file.organization_id = $4::uuid AND file.company_id = $5::uuid
       AND file.branch_id IS NOT DISTINCT FROM $6::uuid AND file.status = 'ACTIVE'
       AND ($7::text IS NULL OR strpos(lower(file.original_name), lower($7)) > 0)
     ORDER BY file.created_at DESC, file.id LIMIT $8 OFFSET $9`,
    [...params, input.limit, input.offset],
  );
  return {
    items: rows.rows.map((row) => mapIntegratedFile(row, canDownload)),
    total: Number(count.rows[0]?.total ?? "0"),
    limit: input.limit,
    offset: input.offset,
  };
}

async function loadIntegratedFile(
  database: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  integrationCode: string,
  fileId: string,
  lock = false,
): Promise<IntegratedFileRow> {
  const result = await database.query<IntegratedFileRow>(
    `SELECT file.id, file.organization_id, file.company_id, file.branch_id, file.storage_key,
        file.original_name, file.detected_mime, file.bytes::text, file.status,
        link.external_resource_type AS resource_type, link.resource_id::text AS resource_id,
        link.integration_code, file.created_at
     FROM files AS file JOIN file_links AS link ON link.file_id = file.id
     WHERE file.id = $1::uuid AND link.integration_code = $2
     ${lock ? "FOR UPDATE OF file, link" : ""}`,
    [fileId, integrationCode],
  );
  const row = result.rows[0];
  if (row?.status !== "ACTIVE") throw new AuthServiceError(404, "FILE_NOT_FOUND", "El archivo no está disponible.");
  return row;
}

function fileScope(row: IntegratedFileRow): { companyId: string; branchId?: string } {
  return { companyId: row.company_id, ...(row.branch_id ? { branchId: row.branch_id } : {}) };
}

export async function getIntegratedFileMetadata(
  database: Pool,
  integrationCode: string,
  session: AuthenticatedSession,
  fileId: string,
) {
  const row = await loadIntegratedFile(database, integrationCode, fileId);
  const { target, resource, context } = await authorizeFileTarget(database, integrationCode, session,
    row.resource_type, fileScope(row), "read");
  const canDownload = hasPermission(context, "files.download", target) &&
    hasPermission(context, resource.downloadPermissionCode, target);
  return { item: mapIntegratedFile(row, canDownload) };
}

export async function getIntegratedFileContent(
  database: Pool,
  integrationCode: string,
  session: AuthenticatedSession,
  fileId: string,
  storageRoot: string,
) {
  const row = await loadIntegratedFile(database, integrationCode, fileId);
  const { target, resource } = await authorizeFileTarget(database, integrationCode, session,
    row.resource_type, fileScope(row), "download");
  return {
    item: mapIntegratedFile(row, true),
    path: getStoredFilePath(storageRoot, row.storage_key),
    target,
    resource,
  };
}

export async function requestIntegratedFileDeletion(
  database: Pool,
  integrationCode: string,
  session: AuthenticatedSession,
  fileId: string,
  requestId: string,
): Promise<void> {
  await inTransaction(database, async (client) => {
    const row = await loadIntegratedFile(client, integrationCode, fileId, true);
    const { target } = await authorizeFileTarget(client, integrationCode, session,
      row.resource_type, fileScope(row), "delete", true);
    assertWritableTarget(target);
    await client.query("DELETE FROM file_links WHERE file_id = $1::uuid", [fileId]);
    await client.query(
      `UPDATE files SET status = 'DELETE_PENDING', delete_requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid AND status = 'ACTIVE'`,
      [fileId],
    );
    await appendAuditEvent(client, {
      organizationId: target.organizationId,
      companyId: target.companyId,
      branchId: target.branchId,
      integrationCode,
      actor: { type: "USER", userId: target.actorId },
      action: "INTEGRATION_FILE_DELETE_REQUESTED",
      resourceType: `${integrationCode}.${row.resource_type}`,
      resourceId: row.resource_id,
      requestId,
      before: { fileId, status: "ACTIVE" },
      after: { fileId, status: "DELETE_PENDING", graceHours: 24 },
    });
  });
}
