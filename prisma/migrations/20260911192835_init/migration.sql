BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Household] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [inviteCode] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Household_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Household_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Household_inviteCode_key] UNIQUE NONCLUSTERED ([inviteCode])
);

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(1000) NOT NULL,
    [email] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [passwordHash] NVARCHAR(1000) NOT NULL,
    [role] NVARCHAR(1000) NOT NULL CONSTRAINT [User_role_df] DEFAULT 'MEMBER',
    [mfaEnabled] BIT NOT NULL CONSTRAINT [User_mfaEnabled_df] DEFAULT 0,
    [mfaSecretEncrypted] NVARCHAR(max),
    [householdId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[PaymentInstrument] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [last4] NVARCHAR(1000),
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [PaymentInstrument_currency_df] DEFAULT 'USD',
    [archived] BIT NOT NULL CONSTRAINT [PaymentInstrument_archived_df] DEFAULT 0,
    [householdId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaymentInstrument_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PaymentInstrument_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TransactionCategory] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [direction] NVARCHAR(1000) NOT NULL,
    [isDefault] BIT NOT NULL CONSTRAINT [TransactionCategory_isDefault_df] DEFAULT 0,
    [householdId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TransactionCategory_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [TransactionCategory_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TransactionCategory_householdId_name_key] UNIQUE NONCLUSTERED ([householdId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[Transaction] (
    [id] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [Transaction_currency_df] DEFAULT 'USD',
    [date] DATETIME2 NOT NULL,
    [notes] NVARCHAR(max),
    [householdId] NVARCHAR(1000) NOT NULL,
    [categoryId] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [createdById] NVARCHAR(1000) NOT NULL,
    [recurringTemplateId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Transaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Transaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[RecurringTemplate] (
    [id] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [RecurringTemplate_currency_df] DEFAULT 'USD',
    [notes] NVARCHAR(max),
    [frequency] NVARCHAR(1000) NOT NULL,
    [nextRunAt] DATETIME2 NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [RecurringTemplate_active_df] DEFAULT 1,
    [householdId] NVARCHAR(1000) NOT NULL,
    [categoryId] NVARCHAR(1000) NOT NULL,
    [instrumentId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RecurringTemplate_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [RecurringTemplate_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_householdId_date_idx] ON [dbo].[Transaction]([householdId], [date]);

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentInstrument] ADD CONSTRAINT [PaymentInstrument_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TransactionCategory] ADD CONSTRAINT [TransactionCategory_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[TransactionCategory]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Transaction] ADD CONSTRAINT [Transaction_recurringTemplateId_fkey] FOREIGN KEY ([recurringTemplateId]) REFERENCES [dbo].[RecurringTemplate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecurringTemplate] ADD CONSTRAINT [RecurringTemplate_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecurringTemplate] ADD CONSTRAINT [RecurringTemplate_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[TransactionCategory]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecurringTemplate] ADD CONSTRAINT [RecurringTemplate_instrumentId_fkey] FOREIGN KEY ([instrumentId]) REFERENCES [dbo].[PaymentInstrument]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
