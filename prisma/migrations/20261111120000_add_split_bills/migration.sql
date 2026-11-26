BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Transaction] ADD [splitGroupId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[ItemCategoryRule] (
    [id] NVARCHAR(1000) NOT NULL,
    [householdId] NVARCHAR(1000) NOT NULL,
    [itemKey] NVARCHAR(100) NOT NULL,
    [categoryId] NVARCHAR(1000) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ItemCategoryRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ItemCategoryRule_householdId_itemKey_key] UNIQUE NONCLUSTERED ([householdId],[itemKey])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Transaction_splitGroupId_idx] ON [dbo].[Transaction]([splitGroupId]);

-- AddForeignKey
ALTER TABLE [dbo].[ItemCategoryRule] ADD CONSTRAINT [ItemCategoryRule_householdId_fkey] FOREIGN KEY ([householdId]) REFERENCES [dbo].[Household]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ItemCategoryRule] ADD CONSTRAINT [ItemCategoryRule_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[TransactionCategory]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

