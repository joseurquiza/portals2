import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 
      (typeof localStorage !== 'undefined' ? localStorage.getItem('SUPABASE_URL') : null);
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      (typeof localStorage !== 'undefined' ? localStorage.getItem('SUPABASE_ANON_KEY') : null);

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: documents, error } = await supabase
      .from('knowledge_documents')
      .select('*')
      .order('upload_date', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ documents });
  } catch (error: any) {
    console.error('List documents error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list documents' },
      { status: 500 }
    );
  }
}
