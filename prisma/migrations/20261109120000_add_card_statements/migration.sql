BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[PaymentInstrument] ADD [dueDay] INT,
[statementDay] INT;

-- CreateTable
CREATE TABLE [dbo].[CardStatement] (
    [id] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [closingDate] DATETIME2 NOT NULL,
    [balance] DECIMAL(12,2) NOT NULL,
    [minimumDue] DECIMAL(12,2),
    [dueDate] DATETIME2,
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CardStatement_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CardStatement_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CardStatement_instrumentId_closingDate_key] UNIQUE NONCLUSTERED ([instrumentId],[closingDate])
);

-- AddForeignKey
ALTER TABLE [dbo].[CardStatement] ADD CONSTRAINT [CardStatement_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

