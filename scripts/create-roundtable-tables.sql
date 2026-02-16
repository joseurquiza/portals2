-- Create roundtable sessions table
CREATE TABLE IF NOT EXISTS roundtable_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('researching', 'discussing', 'summarizing', 'complete', 'stopped')),
  summary TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  end_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create roundtable research table
CREATE TABLE IF NOT EXISTS roundtable_research (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES roundtable_sessions(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  findings TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('researching', 'complete', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create roundtable discussions table
CREATE TABLE IF NOT EXISTS roundtable_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES roundtable_sessions(id) ON DELETE CASCADE,
  from_agent_id TEXT NOT NULL,
  from_agent_name TEXT NOT NULL,
  to_agent_id TEXT,
  to_agent_name TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_roundtable_research_session ON roundtable_research(session_id);
CREATE INDEX IF NOT EXISTS idx_roundtable_discussions_session ON roundtable_discussions(session_id);
CREATE INDEX IF NOT EXISTS idx_roundtable_sessions_status ON roundtable_sessions(status);
CREATE INDEX IF NOT EXISTS idx_roundtable_sessions_created ON roundtable_sessions(created_at DESC);
