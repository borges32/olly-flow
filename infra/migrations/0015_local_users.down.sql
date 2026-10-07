DROP TABLE user_sessions;
ALTER TABLE users
  DROP COLUMN locked_until,
  DROP COLUMN failed_logins,
  DROP COLUMN is_admin,
  DROP COLUMN must_change_password,
  DROP COLUMN password_hash;
