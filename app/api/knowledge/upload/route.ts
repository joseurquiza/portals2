import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processFile } from '@/utils/fileProcessor';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds for file processing

export async function POST(request: NextRequest) {
  try {
    // Get Supabase config from localStorage (passed via request body)
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const supabaseUrl = formData.get('supabaseUrl') as string;
    const supabaseKey = formData.get('supabaseKey') as string;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing. Please configure database first.' },
        { status: 400 }
      );
    }

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const results = [];

    for (const file of files) {
      try {
        // Process the file to extract text
        const processed = await processFile(file);

        // Upload file to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `knowledge/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('knowledge-base')
          .upload(filePath, file);

        if (uploadError) {
          // Create bucket if it doesn't exist
          const { error: bucketError } = await supabase.storage.createBucket('knowledge-base', {
            public: false,
            fileSizeLimit: 52428800, // 50MB
          });

          if (bucketError && !bucketError.message.includes('already exists')) {
            throw bucketError;
          }

          // Retry upload
          const { data: retryData, error: retryError } = await supabase.storage
            .from('knowledge-base')
            .upload(filePath, file);

          if (retryError) throw retryError;
        }

        // Get public URL (or signed URL for private buckets)
        const { data: { publicUrl } } = supabase.storage
          .from('knowledge-base')
          .getPublicUrl(filePath);

        // Insert document metadata into database
        const { data: docData, error: dbError } = await supabase
          .from('knowledge_documents')
          .insert({
            filename: file.name,
            file_type: processed.fileType,
            file_size: processed.fileSize,
            storage_url: publicUrl,
            extracted_text: processed.extractedText,
            metadata: processed.metadata,
          })
          .select()
          .single();

        if (dbError) throw dbError;

        results.push({
          success: true,
          filename: file.name,
          documentId: docData.id,
          extractedLength: processed.extractedText.length,
        });
      } catch (fileError: any) {
        console.error(`Error processing ${file.name}:`, fileError);
        results.push({
          success: false,
          filename: file.name,
          error: fileError.message,
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return NextResponse.json({
      message: `Uploaded ${successCount} of ${files.length} files successfully`,
      results,
    });

  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload files' },
      { status: 500 }
    );
  }
}
