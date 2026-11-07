BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Transaction] ADD [policyId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[AccountDetails] (
    [id] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [bankName] NVARCHAR(1000),
    [branch] NVARCHAR(1000),
    [routingCode] NVARCHAR(1000),
    [accountNumberEncrypted] NVARCHAR(max),
    [accountNumberLast4] NVARCHAR(1000),
    [accountHolder] NVARCHAR(1000),
    [customerId] NVARCHAR(1000),
    [nominee] NVARCHAR(1000),
    [phone] NVARCHAR(1000),
    [website] NVARCHAR(1000),
    [loginNote] NVARCHAR(max),
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AccountDetails_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [AccountDetails_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AccountDetails_instrumentId_key] UNIQUE NONCLUSTERED ([instrumentId])
);

-- CreateTable
CREATE TABLE [dbo].[InsurancePolicy] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [InsurancePolicy_status_df] DEFAULT 'ACTIVE',
    [insurer] NVARCHAR(1000) NOT NULL,
    [planName] NVARCHAR(1000),
    [policyNumber] NVARCHAR(1000),
    [insuredPerson] NVARCHAR(1000),
    [nominee] NVARCHAR(1000),
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [InsurancePolicy_currency_df] DEFAULT 'INR',
    [sumAssured] DECIMAL(14,2),
    [maturityAmount] DECIMAL(14,2),
    [premiumAmount] DECIMAL(12,2),
    [premiumFrequency] NVARCHAR(1000),
    [nextDueDate] DATETIME2,
    [premiumEndDate] DATETIME2,
    [startDate] DATETIME2,
    [endDate] DATETIME2,
    [agentName] NVARCHAR(1000),
    [agentPhone] NVARCHAR(1000),
    [helpline] NVARCHAR(1000),
    [website] NVARCHAR(1000),
    [loginNote] NVARCHAR(max),
    [notes] NVARCHAR(max),
    [extraFields] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InsurancePolicy_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [InsurancePolicy_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PolicyDocument] (
    [id] NVARCHAR(1000) NOT NULL,
    [policyId] NVARCHAR(1000) NOT NULL,
    [fileName] NVARCHAR(255) NOT NULL,
    [contentType] NVARCHAR(1000) NOT NULL,
    [size] INT NOT NULL,
    [data] VARBINARY(max) NOT NULL,
    [uploadedById] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PolicyDocument_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PolicyDocument_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InsurancePolicy_householdId_idx] ON [dbo].[InsurancePolicy]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PolicyDocument_policyId_idx] ON [dbo].[PolicyDocument]([policyId]);

-- AddForeignKey
ALTER TABLE [dbo].[AccountDetails] ADD CONSTRAINT [AccountDetails_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InsurancePolicy] ADD CONSTRAINT [InsurancePolicy_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PolicyDocument] ADD CONSTRAINT [PolicyDocument_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[InsurancePolicy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[InsurancePolicy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

