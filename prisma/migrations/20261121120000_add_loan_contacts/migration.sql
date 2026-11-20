BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Transaction] ADD [loanContactId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[LoanContact] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [openingBalance] DECIMAL(14,2) NOT NULL CONSTRAINT [LoanContact_openingBalance_df] DEFAULT 0,
    [openingDate] DATETIME2,
    [phone] NVARCHAR(50),
    [notes] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LoanContact_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LoanContact_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LoanContact_householdId_name_key] UNIQUE NONCLUSTERED ([householdId],[name])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_loanContactId_idx] ON [dbo].[Transaction]([loanContactId]);

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_loanContactId_fkey] FOREIGN KEY ([loanContactId]) REFERENCES [dbo].[LoanContact]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LoanContact] ADD CONSTRAINT [LoanContact_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
