BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Budget] (
    [id] NVARCHAR(1000) NOT NULL,
    [monthlyLimit] DECIMAL(12,2) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [categoryId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Budget_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Budget_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Budget_householdId_categoryId_key] UNIQUE NONCLUSTERED ([householdId],[categoryId])
);

-- AddForeignKey
ALTER TABLE [dbo].[Budget] ADD CONSTRAINT [Budget_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Budget] ADD CONSTRAINT [Budget_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[TransactionCategory]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
