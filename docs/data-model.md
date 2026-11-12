# Modelo de datos inicial
Especificación conceptual: TASK-002 concreta Prisma y migraciones conservando invariantes.

| Entidad | Campos/relaciones principales |
|---|---|
| Organization | id, name, status; cliente SaaS |
| Company | id, organization_id, legal_name, trade_name, nit, contact, address, status |
| Branch | id, organization_id, company_id, code, name, address, contact, status |
| User | id, normalized_email único, display_name, password_hash, status, platform_role opcional |
| OrganizationMembership | id, organization_id, user_id, status; único por pareja |
| Role | id, organization_id, code, name, status |
| Permission | code único global, description; catálogo definido por código |
| RolePermission | role_id, permission_code |
| Integration | code, display_name; consumidor de API confiable registrado |
| IntegrationPermission | integration_code, permission_code; namespace enlazado al catálogo global |
| IntegrationFileResource | integration_code, resource_type y permisos de lectura/carga/descarga/borrado |
| RoleAssignment | membership_id, role_id, scope_type, company_id?, branch_id? |
| Session | id, user_id, created_at, expires_at, revoked_at, metadata limitada |
| RefreshToken | session_id, token_hash único, consumed_at, expires_at, successor_id? |
| AccountToken | user_id, purpose, token_hash, expires_at, consumed_at |
| Employee | id, organization_id, company_id, internal_code, first_names, last_names, personal_document_number?, phone?, email?, address?, position_id?, hire_date, status, user_id?, photo_file_id? |
| EmployeeBranchAssignment | employee_id, organization_id, company_id, branch_id |
| EmployeeDocument | id, organization_id, company_id, employee_id, file_id, type_id, issued_at?, expires_at?, uploaded_by, created_at |
| Setting | organization_id?, company_id?, key, typed_value; alcance validado |
| BusinessHour | company_id/branch_id, weekday, intervals |
| NumberSequence | organization_id, company_id, branch_id?, document_type, period, next_value |
| Catalog | id, code, name, description?, scope (`GLOBAL`/`ORGANIZATION`/`COMPANY`), organization_id?, company_id?, status, is_protected |
| CatalogItem | id, catalog_id, code, name, description?, status; UUID estable para referencias históricas |
| File | organization_id, company_id, branch_id?, storage_key UUID único, original_name, detected_mime, bytes, sha256, status (`ACTIVE`/`DELETE_PENDING`), uploaded_by, delete_requested_at? |
| FileLink | file_id único, resource_type (`COMPANY_ATTACHMENT`/`BRANCH_ATTACHMENT`/`EMPLOYEE_PHOTO`/`EMPLOYEE_DOCUMENT`/`INTEGRATED_RESOURCE`), resource_id; enlaces externos guardan integration_code y external_resource_type además del scope de `File` |
| AuditEvent | organization_id?, company_id?, branch_id?, actor_id?, integration_code?, action, resource_type/id, diff filtrado, request_id, created_at |
| EmailTemplate | código conocido, subject/body, variables permitidas |
| EmailOutbox | organization_id?, template, recipient, payload limitado, deduplication_key único, status, attempts, next_attempt_at |
| EmailDelivery | outbox_id, result, timestamp, error sanitizado |
| InstallationSmtpSetting | configuración SMTP singleton de la instalación; contraseña en sobre AES-256-GCM y clave externa a la base/repositorio |

## Invariantes
tenant obligatorio en datos privados. Company/Branch y asociaciones validan mismo tenant vía claves compuestas donde aplique. branch code único por company; membership única organization/user; employee code único company. Scope ORGANIZATION no tiene company/branch; COMPANY exige company propia y branch nula; BRANCH exige branch y company consistentes. Role y membership de assignment comparten tenant. Un solo Session activo por user mediante índice parcial SQL o mecanismo transaccional equivalente verificable. Campos opcionales e índices con NULL requieren diseño explícito, no asumir unicidad PostgreSQL de NULL.
No borrar físicamente empresas, sucursales o empleados referenciados. Archivos y tokens tienen ciclo de limpieza separado. User vinculado a empleado debe tener membresía en su organización. Vincular empleado no otorga acceso por sí mismo. El código interno de empleado es único por empresa; un empleado puede estar asignado a varias sucursales activas de su empresa. La foto y los documentos se enlazan a un empleado de la misma organización y empresa mediante claves foráneas compuestas.
Timestamps UTC; importes futuros decimales, nunca float. No usar catálogos editables para estados de seguridad internos. NIT es texto; no inventar validación oficial no documentada. Metadata JSON solo para datos extensibles, no para relaciones fundamentales.

Los catálogos `GLOBAL` no tienen tenant/empresa y deben estar protegidos. Los de organización requieren `organization_id`; los de empresa requieren organización y una FK compuesta a una empresa de ese tenant. Índices únicos parciales separan el código global, el código por tenant y el código por empresa; las opciones son únicas por catálogo. API normaliza códigos a mayúsculas. Desactivar conserva filas; las FKs futuras a `CatalogItem` deben usar `RESTRICT`, y los módulos consumidores solo ofrecerán opciones activas de catálogos activos.

El driver de archivos guarda el contenido en un volumen privado configurado por `FILE_STORAGE_PATH`; PostgreSQL conserva metadatos y un enlace explícito. `company_id` es obligatorio incluso para un adjunto de sucursal y las FKs compuestas garantizan que ambos pertenecen al mismo tenant. Los enlaces de personal solo se crean desde las rutas ADM-05: una foto debe ser JPEG/PNG/WEBP y un documento exige metadatos de tipo y fechas. Cargos y tipos documentales deben pertenecer al catálogo activo y estar disponibles para la empresa.

Las integraciones se registran por API y usan códigos de permiso namespaced, asociados a `Permission`. El secreto de servicio queda fuera de la base de datos en configuración del servidor. Un `INTEGRATED_RESOURCE` no declara una FK al recurso externo: su producto conserva esa entidad y valida su titularidad antes de llamar a Base. La FK de integración y el trigger de `FileLink` exigen un tipo externo registrado; las FKs compuestas de `File` fijan tenant, empresa y sucursal a filas existentes de Base.
