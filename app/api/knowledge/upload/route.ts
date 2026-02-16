import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processFile } from '@/utils/fileProcessor';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds for file processing

// Increase body size limit for file uploads (50MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export async function POST(request: NextRequest) {
  console.log('[v0] Upload API called');
  try {
    // Get Supabase config from request
    const formData = await request.formData();
    console.log('[v0] FormData parsed');
    const file = formData.get('file') as File;
    const supabaseUrl = formData.get('supabaseUrl') as string;
    const supabaseKey = formData.get('supabaseKey') as string;
    
    console.log('[v0] File:', file?.name, file?.size, file?.type);
    console.log('[v0] Supabase config:', { url: !!supabaseUrl, key: !!supabaseKey });

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing. Please configure database first.' },
        { status: 400 }
      );
    }

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Check file size (50MB limit)
    const maxSize = 50 * 1024 * 1024; // 50MB in bytes
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File too large. Maximum size is 50MB, file is ${(file.size / 1024 / 1024).toFixed(2)}MB` },
        { status: 413 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[v0] Supabase client created');
    
    try {
      // Process the file to extract text
      console.log('[v0] Starting file processing...');
      const processed = await processFile(file);
      console.log('[v0] File processed, extracted text length:', processed.extractedText.length);

        // Upload file to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `knowledge/${fileName}`;

        console.log('[v0] Uploading to storage:', filePath);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('knowledge-base')
          .upload(filePath, file);
        
        console.log('[v0] Upload result:', { success: !!uploadData, error: uploadError?.message });

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
        console.log('[v0] Inserting document into database...');
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

        console.log('[v0] DB insert result:', { success: !!docData, error: dbError?.message });
        if (dbError) throw dbError;

      return NextResponse.json({
        message: `Successfully uploaded ${file.name}`,
        results: [{
          success: true,
          filename: file.name,
          documentId: docData.id,
          extractedLength: processed.extractedText.length,
        }],
        document: docData
      });
    } catch (fileError: any) {
      console.error(`Error processing ${file.name}:`, fileError);
      return NextResponse.json({
        message: `Failed to upload ${file.name}`,
        results: [{
          success: false,
          filename: file.name,
          error: fileError.message,
        }]
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload files' },
      { status: 500 }
    );
  }
}
