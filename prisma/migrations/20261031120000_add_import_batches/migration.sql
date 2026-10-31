BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Transaction] ADD [importBatchId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[ImportBatch] (
    [id] NVARCHAR(1000) NOT NULL,
    [fileName] NVARCHAR(255) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [rowsInFile] INT NOT NULL,
    [importedCount] INT NOT NULL,
    [duplicateCount] INT NOT NULL,
    [periodStart] DATETIME2,
    [periodEnd] DATETIME2,
    [householdId] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [createdById] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ImportBatch_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ImportBatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ImportBatch_householdId_createdAt_idx] ON [dbo].[ImportBatch]([householdId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_importBatchId_fkey] FOREIGN KEY ([importBatchId]) REFERENCES [dbo].[ImportBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportBatch] ADD CONSTRAINT [ImportBatch_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportBatch] ADD CONSTRAINT [ImportBatch_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ImportBatch] ADD CONSTRAINT [ImportBatch_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

