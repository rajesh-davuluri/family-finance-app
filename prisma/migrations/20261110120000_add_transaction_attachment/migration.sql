BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[TransactionAttachment] (
    [id] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000) NOT NULL,
    [contentType] NVARCHAR(1000) NOT NULL,
    [size] INT NOT NULL,
    [data] VARBINARY(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TransactionAttachment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [TransactionAttachment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TransactionAttachment_transactionId_key] UNIQUE NONCLUSTERED ([transactionId])
);

-- AddForeignKey
ALTER TABLE [dbo].[TransactionAttachment] ADD CONSTRAINT [TransactionAttachment_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

