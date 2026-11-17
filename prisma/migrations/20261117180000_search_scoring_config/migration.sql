-- Phase C: save the weights and theses-run count used to score each history snapshot,
-- so a restored search re-scores the same way. Nullable: older snapshots have none.
ALTER TABLE "searches" ADD COLUMN "scoringConfig" JSONB;
