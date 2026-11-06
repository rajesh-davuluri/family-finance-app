-- Family Finance: apply migration 20261104120000_add_telegram from the Azure Query editor.
-- Run this whole file ONCE. Part 1 creates the two Telegram tables; Part 2 records the
-- migration as applied so 'npx prisma migrate deploy' won't try to run it again later.

-- ===== Part 1: the migration =====
BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[TelegramLink] (
    [id] NVARCHAR(1000) NOT NULL,
    [chatId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TelegramLink_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [TelegramLink_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TelegramLink_chatId_key] UNIQUE NONCLUSTERED ([chatId])
);

-- CreateTable
CREATE TABLE [dbo].[PendingTelegramTransaction] (
    [id] NVARCHAR(1000) NOT NULL,
    [chatId] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [notes] NVARCHAR(max),
    [instrumentId] NVARCHAR(1000),
    [categoryId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PendingTelegramTransaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PendingTelegramTransaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PendingTelegramTransaction_householdId_idx] ON [dbo].[PendingTelegramTransaction]([householdId]);

-- AddForeignKey
ALTER TABLE [dbo].[TelegramLink] ADD CONSTRAINT [TelegramLink_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TelegramLink] ADD CONSTRAINT [TelegramLink_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

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
VALUES (LOWER(CONVERT(NVARCHAR(36), NEWID())), 'f2ce9a2a0ea78bd5ab6ae09b7b09e59aff3d6a07507efc9a08f3412b5bfea24c', SYSUTCDATETIME(), '20261104120000_add_telegram', NULL, NULL, SYSUTCDATETIME(), 1);

-- Check: should list the new migration last
SELECT TOP 3 migration_name, finished_at FROM [dbo].[_prisma_migrations] ORDER BY started_at DESC;
