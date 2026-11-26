BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[SubscriptionMark] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(200) NOT NULL,
    [status] NVARCHAR(20) NOT NULL,
    [amount] DECIMAL(12,2),
    [markedAt] DATETIME2 NOT NULL CONSTRAINT [SubscriptionMark_markedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [SubscriptionMark_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SubscriptionMark_householdId_key_key] UNIQUE NONCLUSTERED ([householdId],[key])
);

-- AddForeignKey
ALTER TABLE [dbo].[SubscriptionMark] ADD CONSTRAINT [SubscriptionMark_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
