-- Commit the new enum value before later migrations reference it in constraints and triggers.
ALTER TYPE "FileResourceType" ADD VALUE IF NOT EXISTS 'INTEGRATED_RESOURCE';
