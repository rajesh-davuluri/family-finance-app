BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Household] ADD [closeToleranceUsd] DECIMAL(12,2);

-- CreateTable
CREATE TABLE [dbo].[PeriodClose] (
    [id] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [periodEnd] DATETIME2 NOT NULL,
    [statementFigure] DECIMAL(14,2) NOT NULL,
    [appFigure] DECIMAL(14,2) NOT NULL,
    [adjustment] DECIMAL(14,2) NOT NULL CONSTRAINT [PeriodClose_adjustment_df] DEFAULT 0,
    [adjustmentTransactionId] NVARCHAR(64),
    [note] NVARCHAR(1000),
    [closedById] NVARCHAR(64) NOT NULL,
    [closedByName] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PeriodClose_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PeriodClose_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PeriodClose_instrumentId_periodEnd_key] UNIQUE NONCLUSTERED ([instrumentId],[periodEnd])
);

-- AddForeignKey
ALTER TABLE [dbo].[PeriodClose] ADD CONSTRAINT [PeriodClose_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
