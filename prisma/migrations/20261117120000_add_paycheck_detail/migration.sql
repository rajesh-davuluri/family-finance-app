BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[PaycheckDetail] (
    [id] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000) NOT NULL,
    [hoursPaid] DECIMAL(7,2),
    [periodStart] DATE,
    [periodEnd] DATE,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaycheckDetail_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaycheckDetail_transactionId_key] UNIQUE NONCLUSTERED ([transactionId])
);

-- AddForeignKey
ALTER TABLE [dbo].[PaycheckDetail] ADD CONSTRAINT [PaycheckDetail_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
