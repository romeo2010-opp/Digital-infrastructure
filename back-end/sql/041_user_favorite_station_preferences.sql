ALTER TABLE user_preferences
  ADD COLUMN favorite_station_public_ids_json LONGTEXT NOT NULL DEFAULT '[]' AFTER completed_welcome_tour;

UPDATE user_preferences
SET favorite_station_public_ids_json = '[]'
WHERE favorite_station_public_ids_json IS NULL OR TRIM(favorite_station_public_ids_json) = '';
