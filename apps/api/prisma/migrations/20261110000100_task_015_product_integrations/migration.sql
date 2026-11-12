CREATE TABLE "integrations" (
  "code" VARCHAR(40) NOT NULL,
  "display_name" VARCHAR(120) NOT NULL,
  "audit_permission_code" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integrations_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "integrations_code_format" CHECK ("code" ~ '^[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT "integrations_display_name_nonempty" CHECK (length(btrim("display_name")) > 0)
);

CREATE TABLE "integration_permissions" (
  "integration_code" VARCHAR(40) NOT NULL,
  "permission_code" VARCHAR(100) NOT NULL,
  CONSTRAINT "integration_permissions_pkey" PRIMARY KEY ("integration_code", "permission_code"),
  CONSTRAINT "integration_permissions_permission_code_key" UNIQUE ("permission_code"),
  CONSTRAINT "integration_permissions_integration_fkey" FOREIGN KEY ("integration_code") REFERENCES "integrations"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_permissions_permission_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_permissions_code_namespace" CHECK ("permission_code" LIKE "integration_code" || '.%')
);

CREATE TABLE "integration_file_resources" (
  "integration_code" VARCHAR(40) NOT NULL,
  "resource_type" VARCHAR(60) NOT NULL,
  "read_permission_code" VARCHAR(100) NOT NULL,
  "upload_permission_code" VARCHAR(100) NOT NULL,
  "download_permission_code" VARCHAR(100) NOT NULL,
  "delete_permission_code" VARCHAR(100) NOT NULL,
  CONSTRAINT "integration_file_resources_pkey" PRIMARY KEY ("integration_code", "resource_type"),
  CONSTRAINT "integration_file_resources_integration_fkey" FOREIGN KEY ("integration_code") REFERENCES "integrations"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_file_resources_read_permission_fkey" FOREIGN KEY ("integration_code", "read_permission_code") REFERENCES "integration_permissions"("integration_code", "permission_code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_file_resources_upload_permission_fkey" FOREIGN KEY ("integration_code", "upload_permission_code") REFERENCES "integration_permissions"("integration_code", "permission_code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_file_resources_download_permission_fkey" FOREIGN KEY ("integration_code", "download_permission_code") REFERENCES "integration_permissions"("integration_code", "permission_code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_file_resources_delete_permission_fkey" FOREIGN KEY ("integration_code", "delete_permission_code") REFERENCES "integration_permissions"("integration_code", "permission_code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "integration_file_resources_type_format" CHECK ("resource_type" ~ '^[A-Z][A-Z0-9_]{0,59}$')
);

ALTER TABLE "file_links"
  ADD COLUMN "integration_code" VARCHAR(40),
  ADD COLUMN "external_resource_type" VARCHAR(60),
  ADD CONSTRAINT "file_links_integration_fkey" FOREIGN KEY ("integration_code") REFERENCES "integrations"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "file_links_integrated_scope_check" CHECK (
    ("resource_type" = 'INTEGRATED_RESOURCE' AND "integration_code" IS NOT NULL AND "external_resource_type" IS NOT NULL)
    OR ("resource_type" <> 'INTEGRATED_RESOURCE' AND "integration_code" IS NULL AND "external_resource_type" IS NULL)
  );

CREATE INDEX "file_links_integration_resource_created_idx"
  ON "file_links"("integration_code", "external_resource_type", "resource_id", "created_at");

ALTER TABLE "audit_events"
  ADD COLUMN "integration_code" VARCHAR(40),
  ADD CONSTRAINT "audit_events_integration_fkey" FOREIGN KEY ("integration_code") REFERENCES "integrations"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_file_link_target() RETURNS trigger AS $$
DECLARE
  target_organization_id UUID;
  target_company_id UUID;
  target_branch_id UUID;
  target_status "FileStatus";
  target_employee_status "RecordStatus";
  target_file_mime TEXT;
BEGIN
  SELECT organization_id, company_id, branch_id, status, detected_mime
    INTO target_organization_id, target_company_id, target_branch_id, target_status, target_file_mime
    FROM files WHERE id = NEW.file_id;
  IF target_organization_id IS NULL OR target_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'file link requires an active file' USING ERRCODE = '23503';
  END IF;

  IF NEW.resource_type = 'INTEGRATED_RESOURCE' THEN
    IF NEW.integration_code IS NULL OR NEW.external_resource_type IS NULL OR NOT EXISTS (
      SELECT 1 FROM integration_file_resources
      WHERE integration_code = NEW.integration_code AND resource_type = NEW.external_resource_type
    ) THEN
      RAISE EXCEPTION 'integrated file resource is not registered' USING ERRCODE = '23503';
    END IF;
  ELSIF NEW.integration_code IS NOT NULL OR NEW.external_resource_type IS NOT NULL THEN
    RAISE EXCEPTION 'integration metadata is only valid for integrated resources' USING ERRCODE = '23514';
  ELSIF NEW.resource_type = 'COMPANY_ATTACHMENT' THEN
    IF target_branch_id IS NOT NULL OR NEW.resource_id <> target_company_id THEN
      RAISE EXCEPTION 'company attachment link does not match file scope' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.resource_type = 'BRANCH_ATTACHMENT' THEN
    IF target_branch_id IS NULL OR NEW.resource_id <> target_branch_id THEN
      RAISE EXCEPTION 'branch attachment link does not match file scope' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.resource_type = 'EMPLOYEE_PHOTO' OR NEW.resource_type = 'EMPLOYEE_DOCUMENT' THEN
    SELECT organization_id, company_id, status INTO target_organization_id, target_company_id, target_employee_status
      FROM employees WHERE id = NEW.resource_id;
    IF target_employee_status IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'employee file link requires an active employee' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM files WHERE id = NEW.file_id AND (organization_id <> target_organization_id OR company_id <> target_company_id OR branch_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'employee file scope does not match the file' USING ERRCODE = '23514';
    END IF;
    IF NEW.resource_type = 'EMPLOYEE_PHOTO' AND target_file_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
      RAISE EXCEPTION 'employee photos must be images' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported file resource type' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
