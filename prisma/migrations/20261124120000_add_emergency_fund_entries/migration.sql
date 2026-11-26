BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[EmergencyFundEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [amountUsd] DECIMAL(12,2) NOT NULL,
    [byUserId] NVARCHAR(1000),
    [note] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EmergencyFundEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EmergencyFundEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmergencyFundEntry_householdId_date_idx] ON [dbo].[EmergencyFundEntry]([householdId], [date]);

-- AddForeignKey
ALTER TABLE [dbo].[EmergencyFundEntry] ADD CONSTRAINT [EmergencyFundEntry_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmergencyFundEntry] ADD CONSTRAINT [EmergencyFundEntry_byUserId_fkey] FOREIGN KEY ([byUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
