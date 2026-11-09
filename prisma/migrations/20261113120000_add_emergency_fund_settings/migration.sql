BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Household] ADD [emergencyFundUsd] DECIMAL(12,2),
[emergencyTargetMonths] INT NOT NULL CONSTRAINT [Household_emergencyTargetMonths_df] DEFAULT 6;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

