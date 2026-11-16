BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[BalanceCheck] (
    [id] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [asOfDate] DATETIME2 NOT NULL,
    [bankBalance] DECIMAL(12,2) NOT NULL,
    [appBalance] DECIMAL(12,2) NOT NULL,
    [adjusted] BIT NOT NULL CONSTRAINT [BalanceCheck_adjusted_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BalanceCheck_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BalanceCheck_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BalanceCheck_instrumentId_createdAt_idx] ON [dbo].[BalanceCheck]([instrumentId], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[BalanceCheck] ADD CONSTRAINT [BalanceCheck_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
