BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[TelegramLink] (
    [id] NVARCHAR(1000) NOT NULL,
    [chatId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TelegramLink_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [TelegramLink_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TelegramLink_chatId_key] UNIQUE NONCLUSTERED ([chatId])
);

-- CreateTable
CREATE TABLE [dbo].[PendingTelegramTransaction] (
    [id] NVARCHAR(1000) NOT NULL,
    [chatId] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [notes] NVARCHAR(max),
    [instrumentId] NVARCHAR(1000),
    [categoryId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PendingTelegramTransaction_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PendingTelegramTransaction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PendingTelegramTransaction_householdId_idx] ON [dbo].[PendingTelegramTransaction]([householdId]);

-- AddForeignKey
ALTER TABLE [dbo].[TelegramLink] ADD CONSTRAINT [TelegramLink_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TelegramLink] ADD CONSTRAINT [TelegramLink_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

