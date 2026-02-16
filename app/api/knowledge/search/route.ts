import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { query, supabaseUrl, supabaseKey, limit = 5 } = await request.json();

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 400 }
      );
    }

    if (!query || query.trim() === '') {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Use PostgreSQL full-text search
    const { data, error } = await supabase.rpc('search_knowledge_documents', {
      search_query: query,
      result_limit: limit
    });

    if (error) {
      // Fallback to basic text search if function doesn't exist
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('knowledge_documents')
        .select('*')
        .ilike('extracted_text', `%${query}%`)
        .limit(limit);

      if (fallbackError) throw fallbackError;

      return NextResponse.json({
        results: fallbackData || [],
        searchMethod: 'basic',
      });
    }

    // Update access tracking
    if (data && data.length > 0) {
      const docIds = data.map((doc: any) => doc.id);
      await supabase
        .from('knowledge_documents')
        .update({
          last_accessed: new Date().toISOString(),
          access_count: supabase.rpc('increment', { row_id: docIds[0] }),
        })
        .in('id', docIds);
    }

    return NextResponse.json({
      results: data || [],
      searchMethod: 'full-text',
    });

  } catch (error: any) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: error.message || 'Search failed' },
      { status: 500 }
    );
  }
}
