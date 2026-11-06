-- Family Finance: apply migration 20261105120000_add_transaction_source from the Azure Query editor.
-- Run this whole file ONCE. Part 1 adds the Transaction.source column; Part 2 records the
-- migration so 'npx prisma migrate deploy' won't try to run it again later.

-- ===== Part 1: the migration =====
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Transaction] ADD [source] NVARCHAR(1000);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH


-- ===== Part 2: record it for Prisma =====
INSERT INTO [dbo].[_prisma_migrations] (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), 'f6b4a30de780bf9ca4cacc44b182dcdfdf1de48b8a5787377445cac0b4300992', SYSUTCDATETIME(), '20261105120000_add_transaction_source', NULL, NULL, SYSUTCDATETIME(), 1);

-- Check: should list the new migration first
SELECT TOP 3 migration_name, finished_at FROM [dbo].[_prisma_migrations] ORDER BY started_at DESC;
