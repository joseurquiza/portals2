-- Create knowledge_documents table for storing uploaded company documents
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_url TEXT NOT NULL,
  extracted_text TEXT,
  metadata JSONB DEFAULT '{}',
  upload_date TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ,
  access_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for full-text search on extracted_text
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_text_search 
ON knowledge_documents USING gin(to_tsvector('english', extracted_text));

-- Create index for filename search
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_filename 
ON knowledge_documents (filename);

-- Create index for file type filtering
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_file_type 
ON knowledge_documents (file_type);

-- Create index for upload date sorting
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_upload_date 
ON knowledge_documents (upload_date DESC);

-- Enable Row Level Security
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;

-- Create policy that allows all operations (adjust based on auth needs)
CREATE POLICY "Allow all operations on knowledge_documents" 
ON knowledge_documents FOR ALL 
USING (true) 
WITH CHECK (true);
