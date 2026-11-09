BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[DuplicateDecision] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [txnA] NVARCHAR(64) NOT NULL,
    [txnB] NVARCHAR(64) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DuplicateDecision_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DuplicateDecision_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DuplicateDecision_householdId_txnA_txnB_key] UNIQUE NONCLUSTERED ([householdId],[txnA],[txnB])
);

-- AddForeignKey
ALTER TABLE [dbo].[DuplicateDecision] ADD CONSTRAINT [DuplicateDecision_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

