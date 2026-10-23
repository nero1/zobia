BEGIN;
ALTER TABLE creator_earnings DROP CONSTRAINT IF EXISTS creator_earnings_source_type_check;
ALTER TABLE creator_earnings ADD CONSTRAINT creator_earnings_source_type_check CHECK(source_type IN ('gift','subscription','drop_entry','classroom_enrolment','sponsored_quest','merch','creator_fund','broadcast','blog_paywall','blog_gift','tale_paywall'));
COMMIT;
