import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseIntegrationSecrets,
  parseRegistrationDefinition,
  verifyIntegrationSecret,
} from "../src/modules/integrations/integration-service.ts";

test("integration secrets require a non-reserved code and at least 32 characters", () => {
  const secret = "x".repeat(32);
  assert.deepEqual(parseIntegrationSecrets(JSON.stringify({ transport: secret })), { transport: secret });
  assert.throws(() => parseIntegrationSecrets(JSON.stringify({ transport: "short" })), /secreto no válido/u);
  assert.throws(() => parseIntegrationSecrets(JSON.stringify({ files: secret })), /integración o secreto no válido/u);
  assert.throws(() => parseIntegrationSecrets("[]"), /objeto JSON/u);
});

test("service credentials compare only against the selected integration secret", () => {
  const secret = "integration-secret-with-32-chars-minimum";
  const secrets = { transport: secret };
  assert.equal(verifyIntegrationSecret("transport", secret, secrets), true);
  assert.equal(verifyIntegrationSecret("transport", "wrong", secrets), false);
  assert.equal(verifyIntegrationSecret("other", secret, secrets), false);
});

test("registration requires namespaced permissions and a declared audit permission", () => {
  const definition = parseRegistrationDefinition({
    displayName: "Transporte",
    auditPermissionCode: "transport.audit.write",
    permissions: [
      { code: "transport.audit.write", description: "Registrar cambios" },
      { code: "transport.files.read", description: "Consultar archivos" },
    ],
    fileResources: [{
      resourceType: "VEHICLE",
      readPermissionCode: "transport.files.read",
      uploadPermissionCode: "transport.files.read",
      downloadPermissionCode: "transport.files.read",
      deletePermissionCode: "transport.files.read",
    }],
  }, "transport");
  assert.equal(definition.auditPermissionCode, "transport.audit.write");
  assert.equal(definition.fileResources[0]?.resourceType, "VEHICLE");
  assert.throws(() => parseRegistrationDefinition({
    displayName: "Transporte",
    auditPermissionCode: "transport.audit.write",
    permissions: [{ code: "companies.read", description: "No permitido" }],
    fileResources: [],
  }, "transport"), /INVALID_INTEGRATION_PERMISSION/u);
  assert.throws(() => parseRegistrationDefinition({
    displayName: "Transporte",
    auditPermissionCode: "transport.audit.write",
    permissions: [{ code: "transport.files.read", description: "Consultar archivos" }],
    fileResources: [],
  }, "transport"), /INVALID_INTEGRATION_AUDIT_PERMISSION/u);
});
