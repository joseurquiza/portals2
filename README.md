# PORTALS - Multi-Agent AI Collaboration Platform

A Next.js application enabling live, voice-powered collaboration with specialized AI agents.

## What Changed (Vite → Next.js)

This project has been **converted from Vite to Next.js 16**. Key changes:

### Project Structure
- **Removed**: `index.html`, `index.tsx`, `App.tsx`, `vite.config.ts`
- **Added**: `app/` directory with Next.js App Router structure
  - `app/layout.tsx` - Root layout with fonts and SVG filters
  - `app/page.tsx` - Main application (client component)
  - `app/globals.css` - Global styles with Tailwind

### Configuration Files
- **Updated**: `package.json` - Next.js dependencies and scripts
- **Updated**: `tsconfig.json` - Next.js TypeScript configuration
- **Added**: `next.config.ts` - Next.js configuration
- **Added**: `tailwind.config.ts` - Tailwind CSS configuration
- **Added**: `postcss.config.mjs` - PostCSS configuration

### Environment Variables
- Changed from `VITE_*` to `NEXT_PUBLIC_*` prefix
- **Required**: `NEXT_PUBLIC_GEMINI_API_KEY` (for Google GenAI)
- Optional: Supabase credentials (stored in localStorage)

### Code Changes
- All components now use standard npm imports instead of ESM CDN imports
- `process.env.API_KEY` → `process.env.NEXT_PUBLIC_GEMINI_API_KEY`
- `app/page.tsx` is a client component (`'use client'` directive)
- Supabase client dynamically imported to work with Next.js SSR

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set the `NEXT_PUBLIC_GEMINI_API_KEY` in [.env.local](.env.local):
   ```bash
   NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### Optional: Database Setup

To enable session persistence with Supabase:
1. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in localStorage (browser dev tools)
2. The app will automatically connect to your Supabase instance
3. Session data and knowledge documents will be stored in your database

## Features

- **Multi-Agent System**: Five specialized AI agents (Oracle, Architect, Ledger, Muse, Sentinel)
- **Live Voice Chat**: Real-time audio conversations with AI agents
- **Visual Portals**: Animated liquid portal visualizations for each agent
- **Collaborative Clusters**: Agents can summon each other into conversations
- **Customizable Personalities**: Assign thinking styles (Peter Thiel, Elon Musk, Math Professor, etc.) to each agent
- **Roundtable Discussions**: All agents research a topic, discuss findings, and provide summaries
- **Company Knowledge Base**: Upload PDFs, documents, spreadsheets, and images that agents can search and reference
- **Agentic Search**: Agents intelligently search uploaded documents during conversations
- **Transcription**: Live transcription of all conversations
- **Phantom Wallet Integration**: Connect your Solana wallet
- **Session Persistence**: Optional Supabase integration for saving conversations

## Tech Stack

- **Next.js 16** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Google GenAI SDK** - AI agent communication
- **Web Audio API** - Audio processing
- **Supabase** (optional) - Database for session persistence

## Scripts

- `npm run dev` - Start development server on port 3000
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## Deployment

This project is optimized for deployment on Vercel:

1. Push to GitHub
2. Import project in Vercel
3. Add environment variable: `NEXT_PUBLIC_GEMINI_API_KEY`
4. Deploy
