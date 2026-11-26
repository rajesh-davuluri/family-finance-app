BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Household] ADD [yearAheadSetAsideUsd] DECIMAL(12,2),
[yearAheadPerPaydayUsd] DECIMAL(12,2);

-- CreateTable
CREATE TABLE [dbo].[PlannedExpense] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [PlannedExpense_currency_df] DEFAULT 'USD',
    [dueDate] DATETIME2 NOT NULL,
    [repeatMonths] INT,
    [sourceKey] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PlannedExpense_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PlannedExpense_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PlannedExpense_householdId_idx] ON [dbo].[PlannedExpense]([householdId]);

-- AddForeignKey
ALTER TABLE [dbo].[PlannedExpense] ADD CONSTRAINT [PlannedExpense_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
