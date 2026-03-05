-- Add pipeline_docs column to generation_jobs table
-- Used by the micro-step pipeline to store heavy documents (documentTexts, rawUploads, markdownUploads)
-- separately from lightweight pipeline context (result_json) for lazy loading
ALTER TABLE generation_jobs ADD COLUMN pipeline_docs TEXT;
