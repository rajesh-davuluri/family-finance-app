BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Debt] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000) NOT NULL,
    [originalPrincipal] DECIMAL(12,2) NOT NULL,
    [interestRate] DECIMAL(5,2),
    [startDate] DATETIME2 NOT NULL,
    [installmentAmount] DECIMAL(12,2),
    [installmentFrequency] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Debt_status_df] DEFAULT 'ACTIVE',
    [notes] NVARCHAR(max),
    [householdId] NVARCHAR(1000) NOT NULL,
    [ownerId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Debt_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Debt_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DebtPayment] (
    [id] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [paymentDate] DATETIME2 NOT NULL,
    [note] NVARCHAR(max),
    [debtId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DebtPayment_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [DebtPayment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[Debt] ADD CONSTRAINT [Debt_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Debt] ADD CONSTRAINT [Debt_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DebtPayment] ADD CONSTRAINT [DebtPayment_debtId_fkey] FOREIGN KEY ([debtId]) REFERENCES [dbo].[Debt]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
