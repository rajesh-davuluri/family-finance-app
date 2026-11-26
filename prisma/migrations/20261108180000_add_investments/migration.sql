BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[InvestmentAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [broker] NVARCHAR(1000),
    [country] NVARCHAR(1000) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [owner] NVARCHAR(1000),
    [loginNote] NVARCHAR(max),
    [notes] NVARCHAR(max),
    [archived] BIT NOT NULL CONSTRAINT [InvestmentAccount_archived_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InvestmentAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [InvestmentAccount_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Holding] (
    [id] NVARCHAR(1000) NOT NULL,
    [accountId] NVARCHAR(1000) NOT NULL,
    [symbol] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000),
    [exchange] NVARCHAR(1000) NOT NULL,
    [assetType] NVARCHAR(1000) NOT NULL,
    [sector] NVARCHAR(1000),
    [currency] NVARCHAR(1000) NOT NULL,
    [lastPrice] DECIMAL(18,6),
    [lastPriceAt] DATETIME2,
    [priceSource] NVARCHAR(1000),
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Holding_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Holding_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InvestmentTrade] (
    [id] NVARCHAR(1000) NOT NULL,
    [holdingId] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [quantity] DECIMAL(18,6),
    [price] DECIMAL(18,6),
    [fees] DECIMAL(12,2),
    [amount] DECIMAL(14,2),
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InvestmentTrade_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InvestmentTrade_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MarketRate] (
    [pair] NVARCHAR(1000) NOT NULL,
    [rate] DECIMAL(18,6) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MarketRate_pkey] PRIMARY KEY CLUSTERED ([pair])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InvestmentAccount_householdId_idx] ON [dbo].[InvestmentAccount]([householdId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Holding_accountId_idx] ON [dbo].[Holding]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InvestmentTrade_holdingId_idx] ON [dbo].[InvestmentTrade]([holdingId]);

-- AddForeignKey
ALTER TABLE [dbo].[InvestmentAccount] ADD CONSTRAINT [InvestmentAccount_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Holding] ADD CONSTRAINT [Holding_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[InvestmentAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InvestmentTrade] ADD CONSTRAINT [InvestmentTrade_holdingId_fkey] FOREIGN KEY ([holdingId]) REFERENCES [dbo].[Holding]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

