BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Transfer] (
    [id] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [Transfer_currency_df] DEFAULT 'USD',
    [date] DATETIME2 NOT NULL,
    [notes] NVARCHAR(max),
    [householdId] NVARCHAR(1000) NOT NULL,
    [fromInstrumentId] NVARCHAR(1000) NOT NULL,
    [toInstrumentId] NVARCHAR(1000) NOT NULL,
    [createdById] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Transfer_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Transfer_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[Transfer] ADD CONSTRAINT [Transfer_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transfer] ADD CONSTRAINT [Transfer_fromInstrumentId_fkey] FOREIGN KEY ([fromInstrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transfer] ADD CONSTRAINT [Transfer_toInstrumentId_fkey] FOREIGN KEY ([toInstrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transfer] ADD CONSTRAINT [Transfer_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
