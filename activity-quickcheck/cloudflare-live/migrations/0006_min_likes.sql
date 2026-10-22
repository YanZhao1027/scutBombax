-- Optional minimum visible likes for activity screenshot review.
ALTER TABLE activity_events ADD COLUMN min_likes INTEGER CHECK(min_likes IS NULL OR (min_likes >= 0 AND min_likes <= 100000));
