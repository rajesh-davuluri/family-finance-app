BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Medicine] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [strength] NVARCHAR(50),
    [unit] NVARCHAR(30) NOT NULL CONSTRAINT [Medicine_unit_df] DEFAULT 'tablets',
    [forWhom] NVARCHAR(100),
    [dailyDose] DECIMAL(8,2),
    [lowStockAt] DECIMAL(10,2),
    [notes] NVARCHAR(1000),
    [archived] BIT NOT NULL CONSTRAINT [Medicine_archived_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Medicine_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Medicine_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MedicineStock] (
    [id] NVARCHAR(1000) NOT NULL,
    [medicineId] NVARCHAR(1000) NOT NULL,
    [quantity] DECIMAL(10,2) NOT NULL,
    [remaining] DECIMAL(10,2) NOT NULL,
    [expiresOn] DATETIME2,
    [addedOn] DATETIME2 NOT NULL,
    [discardedOn] DATETIME2,
    [note] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MedicineStock_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MedicineStock_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MedicineDose] (
    [id] NVARCHAR(1000) NOT NULL,
    [medicineId] NVARCHAR(1000) NOT NULL,
    [takenOn] DATETIME2 NOT NULL,
    [quantity] DECIMAL(10,2) NOT NULL,
    [draws] NVARCHAR(max),
    [byUserId] NVARCHAR(1000),
    [note] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MedicineDose_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MedicineDose_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Medicine_householdId_idx] ON [dbo].[Medicine]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MedicineStock_medicineId_idx] ON [dbo].[MedicineStock]([medicineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MedicineDose_medicineId_takenOn_idx] ON [dbo].[MedicineDose]([medicineId], [takenOn]);

-- AddForeignKey
ALTER TABLE [dbo].[Medicine] ADD CONSTRAINT [Medicine_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MedicineStock] ADD CONSTRAINT [MedicineStock_medicineId_fkey] FOREIGN KEY ([medicineId]) REFERENCES [dbo].[Medicine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MedicineDose] ADD CONSTRAINT [MedicineDose_medicineId_fkey] FOREIGN KEY ([medicineId]) REFERENCES [dbo].[Medicine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MedicineDose] ADD CONSTRAINT [MedicineDose_byUserId_fkey] FOREIGN KEY ([byUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
