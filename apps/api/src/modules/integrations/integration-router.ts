import { createReadStream } from "node:fs";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Pool } from "pg";
import { createAuthenticationMiddleware, getAuthenticatedSession, sendAuthError, type AuthLocals } from "../auth/auth-middleware.ts";
import { AuthServiceError, type AuthSettings } from "../auth/auth-service.ts";
import { resolveFileStorageRoot, removeStoredPath } from "../files/file-storage.ts";
import { receiveMultipartUpload } from "../files/multipart-upload.ts";
import {
  appendIntegrationAuditEvent,
  authorizeIntegrationTarget,
  isIntegrationCode,
  isPlainRecord,
  parseRegistrationDefinition,
  registerIntegration,
  verifyIntegrationSecret,
} from "./integration-service.ts";
import {
  authorizeIntegratedFileTarget,
  getIntegratedFileContent,
  getIntegratedFileMetadata,
  listIntegratedFiles,
  requestIntegratedFileDeletion,
  storeIntegratedFile,
} from "./integration-files-service.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const resourceTypePattern = /^[A-Z][A-Z0-9_]{0,59}$/u;
const auditActionPattern = /^[A-Z][A-Z0-9_]{1,99}$/u;
const auditResourceTypePattern = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9_.-]{0,79}$/u;
const untrustedContextKeys = new Set([
  "actor", "actorid", "userid", "membershipid", "sessionid", "organizationid", "companyid", "branchid", "integrationcode",
]);

function asyncRoute(action: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void action(request, response).catch((error: unknown) => {
      if (response.headersSent) next(error);
      else sendAuthError(response, error);
    });
  };
}

function requestId(response: Response): string {
  return (response.locals as AuthLocals).requestId;
}

function requireIntegrationCode(request: Request): string {
  const code = request.params.integrationCode;
  if (isIntegrationCode(code)) return code;
  throw new AuthServiceError(404, "NOT_FOUND", "Recurso no encontrado.");
}

function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value === "string") return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", "La ruta no es válida.");
}

function requireContext(database: Pool | undefined, response: Response) {
  const session = getAuthenticatedSession(response);
  if (!database || !session) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
  return { database, session };
}

function bodyRecord(request: Request): Record<string, unknown> {
  if (isPlainRecord(request.body)) return request.body;
  throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function bodyText(value: unknown, label: string, maximum: number): string {
  if (typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !/[\0\r\n]/u.test(value)) return value.trim();
  throw new AuthServiceError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function bodyUuid(value: unknown, label: string): string {
  if (typeof value === "string" && uuidPattern.test(value)) return value;
  throw new AuthServiceError(400, "INVALID_REQUEST", `${label} no es válido.`);
}

function queryValue(request: Request, name: string, required = false): string | undefined {
  const value = request.query[name];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length > 120 || /[\0\r\n]/u.test(value)) {
    throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
  }
  return value;
}

function queryUuid(request: Request, name: string, required: true): string;
function queryUuid(request: Request, name: string, required?: false): string | undefined;
function queryUuid(request: Request, name: string, required = false): string | undefined {
  const value = queryValue(request, name, required);
  if (value === undefined) return undefined;
  return bodyUuid(value, name);
}

function queryInteger(request: Request, name: string, fallback: number, maximum: number, minimum = 0): number {
  const raw = request.query[name];
  const value = typeof raw === "string" ? raw : String(fallback);
  if (!/^\d{1,9}$/u.test(value)) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new AuthServiceError(400, "INVALID_REQUEST", "La paginación no es válida.");
  return parsed;
}

function sanitizeIntegrationDiff(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isPlainRecord(value)) throw new AuthServiceError(400, "INVALID_AUDIT_EVENT", "El detalle de auditoría no es válido.");
  const clean = (item: unknown, depth: number): unknown => {
    if (depth > 4) return undefined;
    if (Array.isArray(item)) return item.slice(0, 50).map((child) => clean(child, depth + 1)).filter((child) => child !== undefined);
    if (isPlainRecord(item)) {
      const output = Object.create(null) as Record<string, unknown>;
      for (const [key, child] of Object.entries(item).slice(0, 50)) {
        if (untrustedContextKeys.has(key.toLocaleLowerCase("en-US"))) continue;
        const sanitized = clean(child, depth + 1);
        if (sanitized !== undefined) output[key] = sanitized;
      }
      return output;
    }
    if (item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) return item;
    return undefined;
  };
  return clean(value, 0) as Record<string, unknown>;
}

function contentDispositionName(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function createIntegrationRouter(
  database: Pool | undefined,
  settings: AuthSettings,
  configuredSecrets: Readonly<Record<string, string>>,
  configuredStorageRoot?: string,
): Router {
  const router = Router();
  const authenticateUser = createAuthenticationMiddleware(database, settings);
  const storageRoot = resolveFileStorageRoot(configuredStorageRoot);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store, private"); next(); });

  router.use("/:integrationCode", (request, response, next) => {
    try {
      const integrationCode = requireIntegrationCode(request);
      if (!verifyIntegrationSecret(integrationCode, request.get("x-mvp-integration-key"), configuredSecrets)) {
        response.status(401).json({
          error: { code: "INTEGRATION_UNAUTHENTICATED", message: "La integración no está autenticada.", requestId: requestId(response) },
        });
        return;
      }
      if (!database) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
      next();
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  router.put("/:integrationCode/registration", asyncRoute(async (request, response) => {
    if (!database) throw new AuthServiceError(503, "SERVICE_NOT_READY", "Servicio temporalmente no disponible.");
    const integrationCode = requireIntegrationCode(request);
    const definition = parseRegistrationDefinition(bodyRecord(request), integrationCode);
    response.status(200).json(await registerIntegration(database, integrationCode, definition));
  }));

  router.use("/:integrationCode", authenticateUser);

  router.post("/:integrationCode/authorize", asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const body = bodyRecord(request);
    if (!exactKeys(body, ["permissionCode", "companyId", "branchId"])) throw new AuthServiceError(400, "INVALID_REQUEST", "La solicitud no es válida.");
    const target = await authorizeIntegrationTarget(db, requireIntegrationCode(request), session, {
      permissionCode: bodyText(body.permissionCode, "El permiso", 100),
      companyId: bodyUuid(body.companyId, "La empresa"),
      ...(body.branchId === undefined ? {} : { branchId: bodyUuid(body.branchId, "La sucursal") }),
    });
    response.status(200).json({
      authorized: true,
      actorId: target.actorId,
      organizationId: target.organizationId,
      membershipId: target.membershipId,
      companyId: target.companyId,
      branchId: target.branchId,
      permissionCode: body.permissionCode,
    });
  }));

  router.post("/:integrationCode/audit-events", asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const body = bodyRecord(request);
    if (!exactKeys(body, ["companyId", "branchId", "action", "resourceType", "resourceId", "before", "after"])) {
      throw new AuthServiceError(400, "INVALID_AUDIT_EVENT", "El evento de auditoría no es válido.");
    }
    const integrationCode = requireIntegrationCode(request);
    const action = bodyText(body.action, "La acción", 100);
    const resourceType = bodyText(body.resourceType, "El recurso", 100);
    if (!auditActionPattern.test(action) || !auditResourceTypePattern.test(resourceType) || !resourceType.startsWith(`${integrationCode}.`)) {
      throw new AuthServiceError(400, "INVALID_AUDIT_EVENT", "El evento de auditoría no es válido.");
    }
    const result = await appendIntegrationAuditEvent(db, integrationCode, session, {
      companyId: bodyUuid(body.companyId, "La empresa"),
      ...(body.branchId === undefined ? {} : { branchId: bodyUuid(body.branchId, "La sucursal") }),
      action,
      resourceType,
      ...(body.resourceId === undefined ? {} : { resourceId: bodyText(body.resourceId, "El identificador del recurso", 100) }),
      ...(body.before === undefined ? {} : { before: sanitizeIntegrationDiff(body.before) }),
      ...(body.after === undefined ? {} : { after: sanitizeIntegrationDiff(body.after) }),
      requestId: requestId(response),
    });
    response.status(201).json({ id: result.id, organizationId: result.target.organizationId, actorId: result.target.actorId });
  }));

  router.get("/:integrationCode/files/:fileId/content", asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const file = await getIntegratedFileContent(db, requireIntegrationCode(request), session,
      bodyUuid(pathParam(request, "fileId"), "El archivo"), storageRoot);
    const stream = createReadStream(file.path);
    await new Promise<void>((resolveStream, rejectStream) => {
      stream.once("open", () => {
        response.status(200);
        response.setHeader("Content-Type", file.item.detectedMime);
        response.setHeader("Content-Length", String(file.item.bytes));
        response.setHeader("Content-Disposition", `attachment; filename="download"; filename*=UTF-8''${contentDispositionName(file.item.originalName)}`);
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        response.setHeader("Referrer-Policy", "no-referrer");
        stream.pipe(response);
        resolveStream();
      });
      stream.once("error", (error: NodeJS.ErrnoException) => {
        if (response.headersSent) response.destroy(error);
        else if (error.code === "ENOENT") rejectStream(new AuthServiceError(404, "FILE_NOT_FOUND", "El archivo no está disponible."));
        else rejectStream(error);
      });
      response.once("close", () => { if (!response.writableEnded) stream.destroy(); });
    });
  }));

  router.get("/:integrationCode/files/:resourceType/:resourceId", asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const resourceType = pathParam(request, "resourceType");
    if (!resourceTypePattern.test(resourceType)) throw new AuthServiceError(400, "INVALID_FILE_RESOURCE", "El tipo de recurso no es válido.");
    response.status(200).json(await listIntegratedFiles(db, requireIntegrationCode(request), session, {
      resourceType,
      resourceId: bodyUuid(pathParam(request, "resourceId"), "El recurso"),
      companyId: queryUuid(request, "companyId", true),
      branchId: queryUuid(request, "branchId"),
      limit: queryInteger(request, "limit", 20, 100, 1),
      offset: queryInteger(request, "offset", 0, 1_000_000),
      search: queryValue(request, "search"),
    }));
  }));

  router.post("/:integrationCode/files/:resourceType/:resourceId", asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    const resourceType = pathParam(request, "resourceType");
    if (!resourceTypePattern.test(resourceType)) throw new AuthServiceError(400, "INVALID_FILE_RESOURCE", "El tipo de recurso no es válido.");
    const integrationCode = requireIntegrationCode(request);
    const resourceId = bodyUuid(pathParam(request, "resourceId"), "El recurso");
    const companyId = queryUuid(request, "companyId", true);
    const branchId = queryUuid(request, "branchId");
    await authorizeIntegratedFileTarget(db, integrationCode, session, { resourceType, resourceId, companyId, branchId, action: "upload" });
    const content = await receiveMultipartUpload(request, storageRoot);
    try {
      response.status(201).json(await storeIntegratedFile(db, integrationCode, session, {
        storageRoot, resourceType, resourceId, companyId, branchId, content, requestId: requestId(response),
      }));
    } finally {
      await removeStoredPath(content.tempPath).catch(() => undefined);
    }
  }));

  router.get("/:integrationCode/files/:fileId", asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    response.status(200).json(await getIntegratedFileMetadata(db, requireIntegrationCode(request), session,
      bodyUuid(pathParam(request, "fileId"), "El archivo")));
  }));

  router.delete("/:integrationCode/files/:fileId", asyncRoute(async (request, response) => {
    const { database: db, session } = requireContext(database, response);
    await requestIntegratedFileDeletion(db, requireIntegrationCode(request), session,
      bodyUuid(pathParam(request, "fileId"), "El archivo"), requestId(response));
    response.status(204).end();
  }));

  return router;
}
