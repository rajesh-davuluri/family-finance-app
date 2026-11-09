BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[RemittanceDetail] (
    [id] NVARCHAR(1000) NOT NULL,
    [transactionId] NVARCHAR(1000) NOT NULL,
    [inrReceived] DECIMAL(14,2) NOT NULL,
    [feeUsd] DECIMAL(10,2),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RemittanceDetail_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RemittanceDetail_transactionId_key] UNIQUE NONCLUSTERED ([transactionId])
);

-- AddForeignKey
ALTER TABLE [dbo].[RemittanceDetail] ADD CONSTRAINT [RemittanceDetail_transactionId_fkey] FOREIGN KEY ([transactionId]) REFERENCES [dbo].[Transaction]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

