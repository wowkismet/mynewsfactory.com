-- Rollback for 0001_core (§83: every schema change has a rollback strategy).
--
-- Destructive by definition: it removes the newsroom tables and everything in
-- them. Safe on an empty or seeded database, never to be run against one
-- holding real editorial content without a verified backup first.

DROP TRIGGER IF EXISTS news_touch      ON news;
DROP TRIGGER IF EXISTS reporters_touch ON reporters;
DROP TRIGGER IF EXISTS users_touch     ON users;
DROP TRIGGER IF EXISTS news_versions_no_delete ON news_versions;
DROP TRIGGER IF EXISTS news_versions_no_update ON news_versions;

DROP FUNCTION IF EXISTS touch_updated_at;
DROP FUNCTION IF EXISTS reject_mutation;

DROP TABLE IF EXISTS news_media;
DROP TABLE IF EXISTS news_versions;
DROP TABLE IF EXISTS news;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS reporter_languages;
DROP TABLE IF EXISTS reporters;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS states;
DROP TABLE IF EXISTS countries;
DROP TABLE IF EXISTS languages;
DROP TABLE IF EXISTS currencies;

DROP TYPE IF EXISTS media_kind;
DROP TYPE IF EXISTS news_status;
DROP TYPE IF EXISTS reporter_tier;
DROP TYPE IF EXISTS user_status;
