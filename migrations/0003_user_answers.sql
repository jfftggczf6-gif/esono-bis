-- Add user_answers table for storing module question answers
CREATE TABLE IF NOT EXISTS user_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  module_code TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  answer_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, module_code, question_id)
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_answers_user_module ON user_answers(user_id, module_code);

-- Update deliverables table to add status column if not exists
ALTER TABLE deliverables ADD COLUMN status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'ready', 'archived'));
