'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionStatus, TranscriptionItem, AgentConfig, RoundtableSession, RoundtableResearch, RoundtableDiscussion, PersonalityPreset, AgentPersonality, KnowledgeDocument } from '../types';
import { decode, encode, decodeAudioData } from '../utils/audioUtils';
import { supabase as initialSupabase } from '../supabaseClient';
import LiquidPortal from '../components/LiquidPortal';

// --- Types ---
interface DebugLog {
  id: string;
  timestamp: string;
  type: 'DB' | 'NETWORK' | 'AUTH' | 'SYSTEM';
  status: 'SUCCESS' | 'ERROR' | 'INFO';
  message: string;
  detail?: any;
}

const PERSONALITY_PRESETS: PersonalityPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Standard balanced personality',
    traits: ''
  },
  {
    id: 'peter-thiel',
    name: 'Peter Thiel',
    description: 'Contrarian, first principles, monopoly thinking',
    traits: 'Think like Peter Thiel: contrarian perspective, question consensus, focus on building monopolies and 0-to-1 innovation, emphasize secrets and non-obvious truths, long-term strategic thinking.'
  },
  {
    id: 'elon-musk',
    name: 'Elon Musk',
    description: 'First principles, ambitious, engineering-focused',
    traits: 'Think like Elon Musk: break down problems to first principles, extremely ambitious scale, focus on physics and engineering fundamentals, prefer doing rather than theorizing, optimize for speed and iteration.'
  },
  {
    id: 'math-professor',
    name: 'Math Professor',
    description: 'Rigorous, proof-based, theoretical',
    traits: 'Think like a mathematics professor: demand rigorous proof, use formal notation when helpful, emphasize axioms and logical structure, patient in explanations, precise with definitions and terminology.'
  },
  {
    id: 'Warren-buffett',
    name: 'Warren Buffett',
    description: 'Value investing, long-term, simple principles',
    traits: 'Think like Warren Buffett: focus on fundamental value and moats, long-term patient perspective, prefer simple understandable businesses, emphasize margin of safety, use folksy accessible analogies.'
  },
  {
    id: 'steve-jobs',
    name: 'Steve Jobs',
    description: 'Design perfection, user experience, simplicity',
    traits: 'Think like Steve Jobs: obsess over design and user experience, ruthlessly simplify, connect humanities with technology, high standards of excellence, focus on what users want before they know it.'
  },
  {
    id: 'richard-feynman',
    name: 'Richard Feynman',
    description: 'Curiosity, first principles, clear explanations',
    traits: 'Think like Richard Feynman: intense curiosity about how things really work, explain concepts from first principles using simple analogies, question everything including authority, playful approach to serious problems.'
  },
  {
    id: 'ray-dalio',
    name: 'Ray Dalio',
    description: 'Principles-based, radical truth, systems thinking',
    traits: 'Think like Ray Dalio: operate from clear principles, seek radical truth and transparency, think in systems and cycles, embrace mistakes as learning, mechanistic view of how things work.'
  },
  {
    id: 'naval-ravikant',
    name: 'Naval Ravikant',
    description: 'Leverage, specific knowledge, philosophical',
    traits: 'Think like Naval Ravikant: focus on leverage and specific knowledge, philosophical yet practical, emphasize long-term compounding, value clarity of thought, combine wisdom traditions with modern technology.'
  }
];

const AGENTS: AgentConfig[] = [
  {
    id: 'oracle',
    name: 'Chairman',
    description: 'Board Chair - Strategic vision, governance, and leadership.',
    voice: 'Zephyr',
    instruction: "You are the Board Chairman. Your role is to facilitate board discussions, ensure all voices are heard, and drive consensus. You balance stakeholder interests, focus on long-term strategy, and maintain governance standards. You moderate but also contribute strategic perspective from your decades of executive experience.",
    colors: { primary: 'bg-indigo-600', secondary: 'bg-cyan-500', accent: 'bg-blue-400', glow: '#4f46e5' }
  },
  {
    id: 'architect',
    name: 'CTO',
    description: 'Chief Technology Officer - Technology strategy, innovation, and R&D.',
    voice: 'Fenrir',
    instruction: "You are the Chief Technology Officer on the board. You bring deep technical expertise and innovation perspective. You evaluate technology investments, assess technical risks, advise on digital transformation, and ensure the company stays competitive through technology. You speak when technical strategy, product development, or innovation is discussed.",
    colors: { primary: 'bg-blue-700', secondary: 'bg-sky-400', accent: 'bg-indigo-400', glow: '#0369a1' }
  },
  {
    id: 'ledger',
    name: 'CFO',
    description: 'Chief Financial Officer - Financial health, risk, and capital allocation.',
    voice: 'Kore',
    instruction: "You are the Chief Financial Officer on the board. You provide financial oversight, analyze budgets and forecasts, assess risks and returns, ensure fiscal responsibility, and guide capital allocation decisions. You focus on profitability, cash flow, valuation, and financial sustainability. You speak on matters of finance, budgets, and economic impact.",
    colors: { primary: 'bg-emerald-600', secondary: 'bg-teal-400', accent: 'bg-yellow-500', glow: '#059669' }
  },
  {
    id: 'muse',
    name: 'CMO',
    description: 'Chief Marketing Officer - Brand, growth, and customer strategy.',
    voice: 'Puck',
    instruction: "You are the Chief Marketing Officer on the board. You champion the customer perspective, drive growth strategy, build brand value, and identify market opportunities. You focus on positioning, competitive differentiation, customer acquisition, and market expansion. You speak when discussing growth, customers, brand, or competitive strategy.",
    colors: { primary: 'bg-purple-600', secondary: 'bg-pink-500', accent: 'bg-fuchsia-400', glow: '#9333ea' }
  },
  {
    id: 'sentinel',
    name: 'Chief Legal',
    description: 'Chief Legal Officer - Compliance, governance, risk, and ethics.',
    voice: 'Charon',
    instruction: "You are the Chief Legal Officer on the board. You ensure legal compliance, assess regulatory risks, oversee corporate governance, and maintain ethical standards. You advise on contracts, IP, liability, and reputational risk. You speak when legal, ethical, compliance, or governance concerns arise.",
    colors: { primary: 'bg-red-700', secondary: 'bg-orange-600', accent: 'bg-slate-500', glow: '#dc2626' }
  }
];

const summonAgentDeclaration: FunctionDeclaration = {
  name: 'summonAgent',
  parameters: {
    type: Type.OBJECT,
    description: 'Summon another specialized agent to join the conversation cluster.',
    properties: {
      agentId: {
        type: Type.STRING,
        description: 'The ID of the agent to summon: oracle (Chairman), architect (CTO), ledger (CFO), muse (CMO), sentinel (Chief Legal)',
      },
      reason: {
        type: Type.STRING,
        description: 'Why this agent is being called.',
      }
    },
    required: ['agentId', 'reason'],
  },
};

const searchKnowledgeDeclaration: FunctionDeclaration = {
  name: 'searchKnowledge',
  parameters: {
    type: Type.OBJECT,
    description: 'Search the company knowledge base for relevant documents, data, and information. Use this to find context from uploaded PDFs, documents, spreadsheets, and images.',
    properties: {
      query: {
        type: Type.STRING,
        description: 'The search query to find relevant documents. Use keywords and phrases from the conversation context.',
      },
      limit: {
        type: Type.NUMBER,
        description: 'Maximum number of results to return (default: 3)',
      }
    },
    required: ['query'],
  },
};

const App: React.FC = () => {
  const [view, setView] = useState<'home' | 'portal' | 'roundtable'>('home');
  const [activeAgent, setActiveAgent] = useState<AgentConfig>(AGENTS[0]);
  const [collaborators, setCollaborators] = useState<AgentConfig[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  
  const [roundtableSession, setRoundtableSession] = useState<RoundtableSession | null>(null);
  const [showRoundtableInput, setShowRoundtableInput] = useState(false);
  const [roundtableDbId, setRoundtableDbId] = useState<string | null>(null);
  const [isDiscussionRunning, setIsDiscussionRunning] = useState(false);
  const [shouldStopDiscussion, setShouldStopDiscussion] = useState(false);
  const [pastSessions, setPastSessions] = useState<any[]>([]);
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  
  const [agentPersonalities, setAgentPersonalities] = useState<AgentPersonality[]>(
    AGENTS.map(agent => ({ agentId: agent.id, presetId: 'default', customTraits: '' }))
  );
  const [showPersonalityEditor, setShowPersonalityEditor] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [personResearchName, setPersonResearchName] = useState('');
  const [researchingPerson, setResearchingPerson] = useState(false);
  
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDocument[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{filename: string, status: string, progress: number}[]>([]);
  
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [intensity, setIntensity] = useState(0);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [supabase, setSupabase] = useState<any>(initialSupabase);
  
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // Audio Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const masterOutputRef = useRef<GainNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const transcriptionContainerRef = useRef<HTMLDivElement>(null);
  
  const agentOutputNodesRef = useRef<Map<string, GainNode>>(new Map());
  const agentInputMixersRef = useRef<Map<string, GainNode>>(new Map());
  const sessionsRef = useRef<Map<string, { agentId: string, promise: Promise<any> }>>(new Map());
  const [speakingAgents, setSpeakingAgents] = useState<Set<string>>(new Set());
  
  const focusedAgentIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => { focusedAgentIdRef.current = focusedAgentId; }, [focusedAgentId]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const pushLog = useCallback((type: DebugLog['type'], status: DebugLog['status'], message: string, detail?: any) => {
    const newLog: DebugLog = { id: Math.random().toString(36).substring(7), timestamp: new Date().toLocaleTimeString(), type, status, message, detail };
    setDebugLogs(prev => [newLog, ...prev].slice(0, 50));
  }, []);

  const handleDbError = useCallback((error: any, context: string) => {
    const msg = error?.message || 'Unknown DB Error';
    pushLog('DB', 'ERROR', `[${context}] ${msg}`, error);
  }, [pushLog]);

  useEffect(() => {
    const initSupabaseClient = async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseKey) {
        const { createClient } = await import('@supabase/supabase-js');
        setSupabase(createClient(supabaseUrl, supabaseKey));
        pushLog('SYSTEM', 'INFO', 'Database connection established.');
      }
    };
    initSupabaseClient();
  }, [pushLog]);

  // Phantom Wallet logic
  useEffect(() => {
    const checkWallet = async () => {
      const { solana } = window as any;
      if (solana?.isPhantom) {
        try {
          const resp = await solana.connect({ onlyIfTrusted: true });
          const address = resp.publicKey.toString();
          setWalletAddress(address);
          pushLog('SYSTEM', 'SUCCESS', `Identity Reconceived: ${address.slice(0,6)}...${address.slice(-4)}`);
        } catch (e) {}
      }
    };
    checkWallet();
  }, [pushLog]);

  const connectWallet = async () => {
    try {
      if (typeof window !== 'undefined' && (window as any).phantom?.solana) {
        const phantom = (window as any).phantom.solana;
        const response = await phantom.connect();
        const address = response.publicKey.toString();
        setWalletAddress(address);
        
        // Create or get user profile
        if (supabase) {
          const { data, error } = await supabase.rpc('get_or_create_user', {
            p_wallet_address: address
          });
          
          if (error) {
            console.error('[v0] Failed to create user profile:', error);
          } else {
            setUserId(data);
            console.log('[v0] User profile loaded:', data);
            pushLog('SYSTEM', 'SUCCESS', `Connected: ${address.slice(0, 4)}...${address.slice(-4)}`);
            
            // Load user's data
            await loadUserData(address);
          }
        }
      } else {
        pushLog('SYSTEM', 'ERROR', 'Phantom wallet not installed');
      }
    } catch (error) {
      pushLog('SYSTEM', 'ERROR', 'Failed to connect wallet');
    }
  };
  
  const loadUserData = async (walletAddr: string) => {
    if (!supabase) return;
    
    console.log('[v0] Loading user data for:', walletAddr);
    
    // Load user's knowledge documents
    const { data: docs } = await supabase
      .from('knowledge_documents')
      .select('*')
      .eq('wallet_address', walletAddr)
      .order('upload_date', { ascending: false });
    
    if (docs) {
      setKnowledgeDocs(docs);
      console.log('[v0] Loaded', docs.length, 'documents');
    }
    
    // Load user's past roundtable sessions
    await loadPastSessions(walletAddr);
    
    pushLog('SYSTEM', 'INFO', 'Loaded your personal workspace');
  };
  
  const loadPastSessions = async (walletAddr?: string) => {
    if (!supabase) return;
    
    const address = walletAddr || walletAddress;
    if (!address) return;
    
    console.log('[v0] Loading past sessions for:', address);
    
    const { data: sessions } = await supabase
      .from('roundtable_sessions')
      .select(`
        id,
        topic,
        status,
        summary,
        start_time,
        end_time,
        created_at,
        user_roundtable_sessions!inner(wallet_address)
      `)
      .eq('user_roundtable_sessions.wallet_address', address)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (sessions) {
      setPastSessions(sessions);
      console.log('[v0] Loaded', sessions.length, 'past sessions');
    }
  };
  
  const viewSessionDetails = async (sessionId: string) => {
    if (!supabase) return;
    
    console.log('[v0] Loading session details:', sessionId);
    
    // Load full session with research and discussions
    const { data: session } = await supabase
      .from('roundtable_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    
    const { data: research } = await supabase
      .from('roundtable_research')
      .select('*')
      .eq('session_id', sessionId);
    
    const { data: discussions } = await supabase
      .from('roundtable_discussions')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    
    if (session) {
      setSelectedSession({
        ...session,
        research: research || [],
        discussions: discussions || []
      });
    }
  };

  const disconnectWallet = async () => {
    pushLog('SYSTEM', 'INFO', 'Severing Solana Link...');
    try {
      const { solana } = window as any;
      if (solana?.isPhantom) {
        await solana.disconnect();
        setWalletAddress(null);
        pushLog('SYSTEM', 'SUCCESS', 'Identity Decoupled.');
      }
    } catch (e: any) {
      pushLog('SYSTEM', 'ERROR', `Decoupling Interrupted: ${e.message}`);
    }
  };

  const handleWalletAction = () => {
    if (walletAddress) disconnectWallet();
    else connectWallet();
  };

  const manifestMessage = useCallback(async (type: 'user' | 'model', text: string, agentId?: string) => {
    if (!supabase || !sessionIdRef.current || sessionIdRef.current.startsWith('local-') || !text.trim()) return;
    setIsSyncing(true);
    try {
      const { error } = await supabase.from('portal_messages').insert([{
        session_id: sessionIdRef.current,
        role: type,
        content: text.trim(),
        agent_id: agentId || null
      }]);
      if (error) throw error;
    } catch (e: any) {
      handleDbError(e, 'Manifest Message');
    } finally {
      setTimeout(() => setIsSyncing(false), 200);
    }
  }, [supabase, handleDbError]);

  const startCluster = async (host: AgentConfig) => {
    setView('portal');
    setActiveAgent(host);
    setFocusedAgentId(host.id);
    setCollaborators([]);
    setTranscriptions([]);
    setStatus(ConnectionStatus.CONNECTING);
    pushLog('SYSTEM', 'INFO', `Starting board session with ${host.name}...`);

    if (supabase) {
      try {
        const { data: session, error } = await supabase.from('portal_sessions').insert([{ 
          host_id: host.id,
          user_address: walletAddress || 'Guest-Node'
        }]).select().single();
        if (error) throw error;
        setSessionId(session.id);
      } catch (e: any) { 
        handleDbError(e, 'Handshake Failure');
        setSessionId("local-" + Date.now());
      }
    } else setSessionId("local-" + Date.now());

    if (!audioCtxRef.current) {
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      const masterOut = ctx.createGain();
      masterOut.connect(ctx.destination);
      masterOutputRef.current = masterOut;
      const outAnalyser = ctx.createAnalyser();
      outAnalyser.fftSize = 64; 
      masterOut.connect(outAnalyser);
      outputAnalyserRef.current = outAnalyser;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micSourceRef.current = ctx.createMediaStreamSource(stream);
      const micGain = ctx.createGain();
      micSourceRef.current.connect(micGain);
      micGainRef.current = micGain;
      const inAnalyser = ctx.createAnalyser();
      inAnalyser.fftSize = 64; 
      micGain.connect(inAnalyser);
      inputAnalyserRef.current = inAnalyser; 
    }
    createAgentSession(host, host.id);
  };

  const createAgentSession = async (agent: AgentConfig, hostId: string) => {
    if (sessionsRef.current.has(agent.id) || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      const nextStartTimeRef = { current: 0 };
      const agentSources = new Set<AudioBufferSourceNode>();
      let currentOutputBuffer = "";
      let currentInputBuffer = "";

      const agentOutputGain = ctx.createGain();
      agentOutputNodesRef.current.set(agent.id, agentOutputGain);

      if (focusedAgentIdRef.current === agent.id) {
        agentOutputGain.connect(masterOutputRef.current!);
      }

      const agentInputMixer = ctx.createGain();
      micGainRef.current!.connect(agentInputMixer); 
      agentOutputNodesRef.current.forEach((otherOutput, otherId) => {
        if (otherId !== agent.id) otherOutput.connect(agentInputMixer);
      });
      agentInputMixersRef.current.forEach((otherMixer, otherId) => {
        if (otherId !== agent.id) agentOutputGain.connect(otherMixer);
      });
      agentInputMixersRef.current.set(agent.id, agentInputMixer);

      const scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
        const pcmBlob: Blob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
        sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
      };
      agentInputMixer.connect(scriptProcessor); 
      scriptProcessor.connect(ctx.destination);

  const clusterNames = AGENTS.map(a => a.name).join(', ');
  const personality = agentPersonalities.find(p => p.agentId === agent.id);
  const personalityPreset = PERSONALITY_PRESETS.find(p => p.id === personality?.presetId);
  const personalityTraits = personality?.customTraits || personalityPreset?.traits || '';
  
  const systemInstruction = `${agent.instruction}${personalityTraits ? `\n\nPERSONALITY: ${personalityTraits}` : ''}\n\nTOOLS AVAILABLE:\n- Use searchKnowledge(query) to search the company knowledge base for relevant documents, data, and context. The knowledge base contains uploaded PDFs, documents, spreadsheets, and images. Always search when you need specific company information, technical details, or data that might be in uploaded documents.\n\nNEURAL ETIQUETTE:\n1. You hear all room audio including peers.\n2. If another agent is speaking, YOU MUST STAY SILENT.\n3. If a peer is addressed by name, DO NOT INTERRUPT.\n4. Only one agent should talk to the user at a time. The Oracle is the lead. Yield the floor immediately if anyone else starts speaking.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => { setStatus(ConnectionStatus.CONNECTED); pushLog('NETWORK', 'SUCCESS', `${agent.name} Linked.`); },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              const isFocused = focusedAgentIdRef.current === agent.id;
              agentOutputGain.disconnect();
              if (isFocused) agentOutputGain.connect(masterOutputRef.current!);
              setSpeakingAgents(prev => new Set(prev).add(agent.id));
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(agentOutputGain);
              source.onended = () => {
                agentSources.delete(source);
                if (agentSources.size === 0) setSpeakingAgents(prev => { 
                  const n = new Set(prev); n.delete(agent.id); return n; 
                });
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              agentSources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              currentOutputBuffer += text;
              
              // Automatically focus any agent who starts talking
              if (focusedAgentIdRef.current !== agent.id) {
                setFocusedAgentId(agent.id);
              }

              // If they mention someone else substantially, shift focus (e.g., "Oracle, what do you think?")
              if (text && text.trim().length > 3) {
                 const detected = AGENTS.find(a => text.toLowerCase().includes(a.name.toLowerCase()));
                 if (detected && detected.id !== agent.id) setFocusedAgentId(detected.id);
              }

              if (text) {
                setTranscriptions(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.type === 'model' && last.agentId === agent.id) {
                    return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                  }
                  return [...prev, { type: 'model', text, agentId: agent.id }];
                });
              }
            }

            if (message.serverContent?.inputTranscription) {
               const text = message.serverContent.inputTranscription.text;
               currentInputBuffer += text;
               
               // Check the accumulated buffer for agent names to be more robust to fragmented transcriptions
               const fullCurrentInput = currentInputBuffer.toLowerCase();
               const detected = AGENTS.find(a => fullCurrentInput.includes(a.name.toLowerCase()));
               if (detected && detected.id !== focusedAgentIdRef.current) {
                 setFocusedAgentId(detected.id);
               }

               if (text) {
                 setTranscriptions(prev => {
                   const last = prev[prev.length - 1];
                   if (last?.type === 'user') return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                   return [...prev, { type: 'user', text }];
                 });
               }
            }

            if (message.serverContent?.turnComplete) {
              if (currentInputBuffer.trim()) { manifestMessage('user', currentInputBuffer); currentInputBuffer = ""; }
              if (currentOutputBuffer.trim()) { manifestMessage('model', currentOutputBuffer, agent.id); currentOutputBuffer = ""; }
            }

            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'summonAgent') {
                  const { agentId } = fc.args as any;
                  const targetAgent = AGENTS.find(a => a.id === agentId);
                  if (targetAgent && !sessionsRef.current.has(agentId)) {
                    setCollaborators(prev => [...prev, targetAgent]);
                    createAgentSession(targetAgent, hostId);
                    sessionPromise.then(s => s.sendToolResponse({
                      functionResponses: [{ id: fc.id, name: fc.name, response: { result: `${targetAgent.name} joined.` } }]
                    }));
                  }
                }
                
                if (fc.name === 'searchKnowledge') {
                  const { query, limit = 3 } = fc.args as any;
                  pushLog('SYSTEM', 'INFO', `${agent.name} searching knowledge base: "${query}"`);
                  
                  // Call knowledge search API
                  fetch('/api/knowledge/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, limit })
                  })
                  .then(res => res.json())
                  .then(data => {
                    const results = data.results || [];
                    const responseText = results.length > 0
                      ? `Found ${results.length} relevant document(s):\n\n${results.map((r: any, i: number) => 
                          `${i + 1}. ${r.filename} (${r.file_type})\nRelevant excerpt: ${r.extracted_text?.substring(0, 300)}...`
                        ).join('\n\n')}`
                      : `No relevant documents found for query: "${query}"`;
                    
                    sessionPromise.then(s => s.sendToolResponse({
                      functionResponses: [{ id: fc.id, name: fc.name, response: { result: responseText } }]
                    }));
                    
                    pushLog('SYSTEM', 'SUCCESS', `Knowledge search returned ${results.length} results`);
                  })
                  .catch(err => {
                    console.error('[v0] Knowledge search error:', err);
                    sessionPromise.then(s => s.sendToolResponse({
                      functionResponses: [{ id: fc.id, name: fc.name, response: { result: 'Knowledge search failed. Please try again.' } }]
                    }));
                  });
                }
              }
            }
          }
        },
  config: {
  responseModalities: [Modality.AUDIO],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: agent.voice } } },
  systemInstruction: systemInstruction,
  tools: [{ functionDeclarations: [summonAgentDeclaration, searchKnowledgeDeclaration] }],
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  }
      });
      sessionsRef.current.set(agent.id, { agentId: agent.id, promise: sessionPromise });
    } catch (e) { pushLog('NETWORK', 'ERROR', `Agent Manifest Error: ${agent.name}`, e); }
  };

  const removeAgentFromCluster = (agentId: string) => {
    setRemovingIds(prev => new Set(prev).add(agentId));
    setTimeout(() => {
      setCollaborators(prev => prev.filter(c => c.id !== agentId));
      const sessionObj = sessionsRef.current.get(agentId);
      if (sessionObj) sessionObj.promise.then(s => s.close());
      sessionsRef.current.delete(agentId);
      agentOutputNodesRef.current.delete(agentId);
      agentInputMixersRef.current.delete(agentId);
      setRemovingIds(prev => { const n = new Set(prev); n.delete(agentId); return n; });
      if (focusedAgentId === agentId) setFocusedAgentId(activeAgent.id);
    }, 1200);
  };

  const terminateAll = useCallback(async () => {
    sessionsRef.current.forEach(s => s.promise.then(p => p.close()));
    sessionsRef.current.clear();
    agentOutputNodesRef.current.clear();
    agentInputMixersRef.current.clear();
    setStatus(ConnectionStatus.IDLE);
    setSpeakingAgents(new Set());
    setCollaborators([]);
    setFocusedAgentId(null);
    setSessionId(null);
    setRoundtableSession(null);
    setView('home');
    pushLog('SYSTEM', 'INFO', 'Board session ended.');
  }, [pushLog]);

  const conductResearch = async (topic: string) => {
    console.log('[v0] RESEARCH PHASE STARTED');
    console.log('[v0] Topic:', topic);
    pushLog('SYSTEM', 'INFO', 'All agents researching topic...');
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    
    // Research agents sequentially to show live progress
    for (let i = 0; i < AGENTS.length; i++) {
      const agent = AGENTS[i];
      console.log(`[v0] [${i + 1}/${AGENTS.length}] ${agent.name} starting research...`);
      
      try {
        // Mark as actively researching
        setFocusedAgentId(agent.id);
        pushLog('SYSTEM', 'INFO', `${agent.name} researching...`);
        
        const prompt = `You are ${agent.name}. ${agent.description}

Research this topic from your unique perspective: "${topic}"

Provide your key findings in 2-3 sentences. Focus on insights relevant to your specialty.`;

        console.log(`[v0] ${agent.name} - Sending research prompt to Gemini...`);
        const result = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: prompt
        });
        const findings = result.text || 'No findings available';
        console.log(`[v0] ${agent.name} - Research complete:`, findings.substring(0, 100) + '...');
        
        setRoundtableSession(prev => {
          if (!prev) return null;
          return {
            ...prev,
            research: prev.research.map(r => 
              r.agentId === agent.id 
                ? { ...r, findings, status: 'complete' as const }
                : r
            )
          };
        });
        
        pushLog('SYSTEM', 'SUCCESS', `${agent.name} completed research`);
        console.log(`[v0] ${agent.name} research saved`);
      } catch (e: any) {
        console.error(`[v0] ${agent.name} research failed:`, e);
        pushLog('SYSTEM', 'ERROR', `${agent.name} research failed: ${e.message}`);
        setRoundtableSession(prev => {
          if (!prev) return null;
          return {
            ...prev,
            research: prev.research.map(r => 
              r.agentId === agent.id 
                ? { ...r, findings: 'Research unavailable', status: 'complete' as const }
                : r
            )
          };
        });
      }
    }
    
    console.log('[v0] RESEARCH PHASE COMPLETE - All agents finished');
    setFocusedAgentId(null);
    
    // Save research to database with queries
    if (roundtableDbId && supabase && roundtableSession) {
      console.log('[v0] Saving research to database...');
      try {
        for (const research of roundtableSession.research) {
          const agent = AGENTS.find(a => a.id === research.agentId);
          // Reconstruct the query that was used
          const query = `You are ${agent?.name}. ${agent?.description}\n\nResearch this topic from your unique perspective: "${roundtableSession.topic}"\n\nProvide your key findings in 2-3 sentences. Focus on insights relevant to your specialty.`;
          
          await supabase.from('roundtable_research').insert({
            session_id: roundtableDbId,
            agent_id: research.agentId,
            agent_name: agent?.name || research.agentId,
            query: query,
            findings: research.findings,
            status: research.status
          });
        }
        
        // Update session status
        await supabase.from('roundtable_sessions').update({
          status: 'researching'
        }).eq('id', roundtableDbId);
        
        console.log('[v0] Research saved to database');
        pushLog('SYSTEM', 'SUCCESS', 'Research saved to database');
      } catch (e: any) {
        console.error('[v0] Failed to save research:', e);
        pushLog('SYSTEM', 'ERROR', `Failed to save research: ${e.message}`);
      }
    }
    
    setRoundtableSession(prev => prev ? { ...prev, status: 'researching' } : null);
    pushLog('SYSTEM', 'INFO', 'Research complete. Click "Start Discussion" to begin board conversation.');
  };

  const startDiscussion = async () => {
    if (!roundtableSession || isDiscussionRunning) return;
    
    console.log('[v0] DISCUSSION PHASE STARTED - Live Voice Mode');
    setIsDiscussionRunning(true);
    setShouldStopDiscussion(false);
    setRoundtableSession(prev => prev ? { ...prev, status: 'discussing' } : null);
    pushLog('SYSTEM', 'INFO', 'Board members entering live discussion...');
    setStatus(ConnectionStatus.CONNECTING);
    
    // Update database status
    if (roundtableDbId && supabase) {
      await supabase.from('roundtable_sessions').update({
        status: 'discussing'
      }).eq('id', roundtableDbId);
    }
    
    // Initialize audio context for all agents
    if (!audioCtxRef.current) {
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      const masterOut = ctx.createGain();
      masterOut.connect(ctx.destination);
      masterOutputRef.current = masterOut;
      
      const outAnalyser = ctx.createAnalyser();
      outAnalyser.fftSize = 64;
      masterOut.connect(outAnalyser);
      outputAnalyserRef.current = outAnalyser;
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micSourceRef.current = ctx.createMediaStreamSource(stream);
      const micGain = ctx.createGain();
      micSourceRef.current.connect(micGain);
      micGainRef.current = micGain;
      
      const inAnalyser = ctx.createAnalyser();
      inAnalyser.fftSize = 64;
      micGain.connect(inAnalyser);
      inputAnalyserRef.current = inAnalyser;
    }
    
    // Start voice sessions for all board members
    console.log('[v0] Starting voice sessions for all board members...');
    for (const agent of AGENTS) {
      await createRoundtableAgentSession(agent);
    }
    
    setStatus(ConnectionStatus.CONNECTED);
    pushLog('SYSTEM', 'SUCCESS', 'All board members connected. Discussion live!');
    
    // Start the discussion with the Chairman introducing the topic
    setTimeout(() => {
      initiateDiscussionTopic();
    }, 2000);
  };
  
  const createRoundtableAgentSession = async (agent: AgentConfig) => {
    if (sessionsRef.current.has(agent.id) || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    try {
      console.log(`[v0] Creating voice session for ${agent.name}...`);
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      const nextStartTimeRef = { current: 0 };
      const agentSources = new Set<AudioBufferSourceNode>();
      let currentOutputBuffer = "";
      
      // Audio output - only connect to master for user to hear
      const agentOutputGain = ctx.createGain();
      agentOutputNodesRef.current.set(agent.id, agentOutputGain);
      agentOutputGain.connect(masterOutputRef.current!);
      
      // Get agent's research for context
      const agentResearch = roundtableSession?.research.find(r => r.agentId === agent.id);
      const allResearch = roundtableSession?.research
        .map(r => `${AGENTS.find(a => a.id === r.agentId)?.name}: ${r.findings}`)
        .join('\n\n');
      
      // Get personality
      const personality = agentPersonalities.find(p => p.agentId === agent.id);
      const personalityPreset = PERSONALITY_PRESETS.find(p => p.id === personality?.presetId);
      const personalityTraits = personality?.customTraits || personalityPreset?.traits || '';
      
      const systemInstruction = `You are ${agent.name}, ${agent.description}

ROUNDTABLE DISCUSSION: "${roundtableSession?.topic}"

YOUR RESEARCH FINDINGS:
${agentResearch?.findings}

ALL BOARD RESEARCH:
${allResearch}

${personalityTraits ? `PERSONALITY: ${personalityTraits}\n\n` : ''}

DISCUSSION PROTOCOL:
1. You WILL actively participate in this live discussion
2. ${agent.id === 'oracle' ? 'As Chairman, you lead the discussion and should speak first to introduce the topic' : `Wait for the Chairman to introduce the topic, then contribute when it's relevant to your expertise`}
3. When someone addresses you by name, respond directly
4. Keep responses concise (15-30 seconds of speaking)
   - Someone asks a question related to your expertise area
   
2. When you DO speak:
   - Keep it to ONE brief point (1-2 sentences max)
   - Then STOP and listen for others
   
3. Active listening:
   - When others are speaking, stay SILENT
   - Let at least 2 other board members speak before you speak again
   - Don't repeat what others have already said
   
4. Board members present: ${AGENTS.filter(a => a.id !== agent.id).map(a => a.name).join(', ')}

5. Your role is ${agent.description} - only speak when this expertise is needed

EXAMPLE GOOD BEHAVIOR:
- Chairman opens → You LISTEN
- CTO speaks about tech → You LISTEN  
- Someone says "${agent.name}, what's your take?" → NOW you respond briefly
- You finish → STOP and LISTEN for others

FORBIDDEN: 
- Speaking multiple times in a row
- Dominating the conversation
- Speaking when not addressed
- Repeating similar points`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => { 
            console.log(`[v0] ${agent.name} voice session connected`);
            pushLog('SYSTEM', 'SUCCESS', `${agent.name} joined discussion`);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              console.log(`[v0] ${agent.name} speaking...`);
              setSpeakingAgents(prev => new Set(prev).add(agent.id));
              setFocusedAgentId(agent.id);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
              const audioBuffer = await ctx.decodeAudioData(audioData.buffer);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(agentOutputGain);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              agentSources.add(source);
              source.onended = () => {
                agentSources.delete(source);
                if (agentSources.size === 0) {
                  setSpeakingAgents(prev => {
                    const next = new Set(prev);
                    next.delete(agent.id);
                    return next;
                  });
                }
              };
            }
            
            const textContent = message.serverContent?.modelTurn?.parts?.find(p => p.text)?.text;
            if (textContent) {
              currentOutputBuffer += textContent;
              console.log(`[v0] ${agent.name}: ${textContent}`);
              
              // Save to discussion history
              const newDiscussion: RoundtableDiscussion = {
                fromAgentId: agent.id,
                toAgentId: null,
                message: textContent,
                timestamp: Date.now()
              };
              
              setRoundtableSession(prev => {
                if (!prev) return null;
                return {
                  ...prev,
                  discussions: [...prev.discussions, newDiscussion]
                };
              });
              
              // Save to database
              if (roundtableDbId && supabase) {
                await supabase.from('roundtable_discussions').insert({
                  session_id: roundtableDbId,
                  from_agent_id: agent.id,
                  from_agent_name: agent.name,
                  message: textContent
                });
              }
              
              // Broadcast transcript to all other agents so they know what was said
              for (const [otherId, sessionObj] of sessionsRef.current.entries()) {
                if (otherId !== agent.id) {
                  const otherSession = await sessionObj.promise;
                  otherSession.sendRealtimeInput({
                    text: `[${agent.name} just said: "${textContent}"]`
                  });
                  console.log(`[v0] Sent transcript to ${AGENTS.find(a => a.id === otherId)?.name}`);
                }
              }
            }
            
            if (message.serverContent?.turnComplete) {
              console.log(`[v0] ${agent.name} finished turn`);
              setFocusedAgentId(null);
            }
          },
          onerror: (error) => {
            console.error(`[v0] ${agent.name} session error:`, error);
            pushLog('SYSTEM', 'ERROR', `${agent.name} connection error`);
          },
          onclose: () => {
            console.log(`[v0] ${agent.name} session closed`);
            agentSources.forEach(s => s.stop());
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: agent.voice } } },
          systemInstruction,
          tools: [{ functionDeclarations: [searchKnowledgeDeclaration] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
      
      sessionsRef.current.set(agent.id, { agentId: agent.id, promise: sessionPromise });
      console.log(`[v0] ${agent.name} session created successfully`);
      
    } catch (error: any) {
      console.error(`[v0] Failed to create session for ${agent.name}:`, error);
      pushLog('SYSTEM', 'ERROR', `Failed to connect ${agent.name}`);
    }
  };
  
  const initiateDiscussionTopic = async () => {
    if (!roundtableSession || !sessionsRef.current.has('oracle')) return;
    
    console.log('[v0] Chairman initiating discussion...');
    const chairmanSessionObj = sessionsRef.current.get('oracle');
    if (chairmanSessionObj) {
      const chairmanSession = await chairmanSessionObj.promise;
      // Send a user message to trigger the Chairman to speak
      chairmanSession.sendRealtimeInput({
        text: `START THE BOARD DISCUSSION NOW. Welcome everyone and introduce the topic: "${roundtableSession.topic}". Share your opening perspective as Chairman based on your research, then invite others to contribute. BEGIN SPEAKING NOW.`
      });
      
      console.log('[v0] Discussion prompt sent to Chairman');
      
      // After Chairman speaks, prompt each board member to contribute
      setTimeout(async () => {
        for (const agent of AGENTS.slice(1)) { // Skip Chairman (first agent)
          const agentSessionObj = sessionsRef.current.get(agent.id);
          if (agentSessionObj) {
            setTimeout(async () => {
              const agentSession = await agentSessionObj.promise;
              agentSession.sendRealtimeInput({
                text: `${agent.name}, please share your perspective on "${roundtableSession.topic}" based on your research and expertise in ${agent.description}. Contribute to the discussion now.`
              });
              console.log(`[v0] Prompted ${agent.name} to contribute`);
            }, AGENTS.indexOf(agent) * 15000); // Stagger by 15 seconds each
          }
        }
      }, 20000); // Start prompting others after 20 seconds
    }
  };
  
  const stopDiscussion = async () => {
    console.log('[v0] Stopping discussion...');
    setShouldStopDiscussion(true);
    setIsDiscussionRunning(false);
    
    // Close all agent sessions
    for (const [agentId, sessionObj] of sessionsRef.current.entries()) {
      const session = await sessionObj.promise;
      session.close();
    }
    sessionsRef.current.clear();
    agentOutputNodesRef.current.clear();
    agentInputMixersRef.current.clear();
    
    setStatus(ConnectionStatus.IDLE);
    pushLog('SYSTEM', 'INFO', 'Discussion stopped');
    
    // Update database
    if (roundtableDbId && supabase) {
      await supabase.from('roundtable_sessions').update({
        status: 'stopped',
        end_time: new Date().toISOString()
      }).eq('id', roundtableDbId);
    }
  };

  const generateSummary = async () => {
    if (!roundtableSession) return;
    
    console.log('[v0] SUMMARY PHASE STARTED');
    setRoundtableSession(prev => prev ? { ...prev, status: 'summarizing' } : null);
    pushLog('SYSTEM', 'INFO', 'Oracle generating summary...');
    setFocusedAgentId('oracle');
    
    try {
      console.log('[v0] Oracle - Compiling all research and discussions...');
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      
      const allResearch = roundtableSession.research
        .map(r => `${AGENTS.find(a => a.id === r.agentId)?.name}: ${r.findings}`)
        .join('\n\n');
      
      const allDiscussions = roundtableSession.discussions
        .map(d => `${AGENTS.find(a => a.id === d.fromAgentId)?.name}: ${d.message}`)
        .join('\n\n');
      
      const prompt = `You are Oracle, synthesizing a roundtable discussion on: "${roundtableSession.topic}"

RESEARCH FINDINGS:
${allResearch}

DISCUSSION:
${allDiscussions}

Provide a comprehensive summary that:
1. Captures key insights from each agent's unique perspective
2. Highlights areas of consensus and creative tension
3. Offers actionable takeaways
4. Uses clear section headers

Format in markdown with headers (##) and bullet points.`;

      console.log('[v0] Oracle - Sending summary prompt to Gemini...');
      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      const summary = result.text || 'Summary not available';
      console.log('[v0] Oracle - Summary generated:', summary.substring(0, 150) + '...');
      
      setRoundtableSession(prev => {
        if (!prev) return null;
        return { ...prev, summary, status: 'complete' };
      });
      
      // Save summary to database
      if (roundtableDbId && supabase) {
        await supabase.from('roundtable_sessions').update({
          summary,
          status: 'complete',
          end_time: new Date().toISOString()
        }).eq('id', roundtableDbId);
        console.log('[v0] Summary saved to database');
      }
      
      console.log('[v0] SUMMARY PHASE COMPLETE');
      console.log('[v0] ROUNDTABLE SESSION COMPLETE');
      pushLog('SYSTEM', 'SUCCESS', 'Roundtable complete!');
      setStatus(ConnectionStatus.IDLE);
      
    } catch (e: any) {
      console.error('[v0] Summary generation failed:', e);
      pushLog('SYSTEM', 'ERROR', `Summary generation failed: ${e.message}`);
    }
  };

  const researchPersonAsAgent = async (agentId: string) => {
    if (!personResearchName.trim() || researchingPerson) return;
    
    const agent = AGENTS.find(a => a.id === agentId);
    if (!agent) return;
    
    setResearchingPerson(true);
    console.log(`[v0] Researching ${personResearchName} as board member for ${agent.name} role`);
    pushLog('SYSTEM', 'INFO', `Researching ${personResearchName}'s board member profile...`);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      
      const prompt = `Research ${personResearchName} to understand how they would act as a ${agent.name} (${agent.description}) on a corporate board of directors.

Conduct DEEP research on:
1. Their actual decision-making patterns and philosophy
2. How they approach problems in their domain (${agent.description})
3. Their communication style and rhetoric
4. Their known positions, beliefs, and perspectives
5. How they interact with others in professional settings
6. Their track record of decisions and outcomes
7. Their strengths and potential blind spots
8. Specific quirks, habits, or signature approaches

For example, if researching Peter Thiel:
- His contrarian thinking and "zero to one" philosophy
- Focus on monopolies and competition avoidance
- Long-term thinking and patient capital approach
- Libertarian leanings and skepticism of regulation
- Direct, sometimes provocative communication style
- Emphasis on technology and disruption
- Known for asking unconventional questions

Generate a detailed personality profile (200-300 words) that captures:
- HOW they would contribute in their role as ${agent.name}
- WHAT questions they would ask
- HOW they would challenge or support other board members
- WHAT their priorities and concerns would be
- Their unique perspective and decision-making framework

Make it specific and actionable for AI agent behavior. Include actual quotes or known positions when relevant.`;

      console.log(`[v0] Sending research request to Gemini 3...`);
      const result = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt
      });
      
      const personalityProfile = result.text || 'Research unavailable';
      console.log(`[v0] Research complete for ${personResearchName}`);
      console.log(`[v0] Profile length: ${personalityProfile.length} chars`);
      
      // Update agent personality with researched profile
      setAgentPersonalities(prev => 
        prev.map(p => 
          p.agentId === agentId 
            ? { ...p, customTraits: personalityProfile, presetId: 'custom' }
            : p
        )
      );
      
      pushLog('SYSTEM', 'SUCCESS', `${personResearchName} profile applied to ${agent.name}`);
      setPersonResearchName('');
      
    } catch (e: any) {
      console.error(`[v0] Research failed:`, e);
      pushLog('SYSTEM', 'ERROR', `Research failed: ${e.message}`);
    } finally {
      setResearchingPerson(false);
    }
  };

  const startRoundtable = async (topic: string) => {
    if (!topic.trim()) return;
    
    console.log('[v0] ROUNDTABLE SESSION INITIATED');
    console.log('[v0] Topic:', topic);
    console.log('[v0] Participants:', AGENTS.map(a => a.name).join(', '));
    
    setShowRoundtableInput(false);
    pushLog('SYSTEM', 'INFO', `Starting roundtable on: ${topic}`);
    setStatus(ConnectionStatus.CONNECTING);
    
    // Create database session
    if (supabase) {
      try {
        const { data: sessionData, error: sessionError } = await supabase.from('roundtable_sessions').insert({
          topic,
          status: 'researching'
        }).select().single();
        
        if (sessionError) throw sessionError;
        if (sessionData) {
          setRoundtableDbId(sessionData.id);
          console.log('[v0] Database session created:', sessionData.id);
          
          // Link session to user if wallet connected
          if (walletAddress && userId) {
            await supabase.from('user_roundtable_sessions').insert({
              id: sessionData.id,
              user_id: userId,
              wallet_address: walletAddress
            });
            console.log('[v0] Session linked to user');
          }
        }
      } catch (e: any) {
        console.error('[v0] Failed to create database session:', e);
        pushLog('SYSTEM', 'ERROR', `Failed to create database session: ${e.message}`);
      }
    }
    
    // Initialize roundtable session
    const session: RoundtableSession = {
      topic,
      research: AGENTS.map(agent => ({
        agentId: agent.id,
        findings: '',
        timestamp: Date.now(),
        status: 'researching' as const
      })),
      discussions: [],
      summary: null,
      status: 'researching',
      startTime: Date.now()
    };
    
    console.log('[v0] Session initialized with', AGENTS.length, 'agents');
    setRoundtableSession(session);
    setView('roundtable');
    
    console.log('[v0] Starting research phase...');
    // Conduct research phase
    await conductResearch(topic);
  };

  useEffect(() => {
    if (transcriptionContainerRef.current) transcriptionContainerRef.current.scrollTop = transcriptionContainerRef.current.scrollHeight;
  }, [transcriptions]);

  useEffect(() => {
    let frameId: number;
    const updateIntensity = () => {
      if (outputAnalyserRef.current || inputAnalyserRef.current) {
        const arr = new Uint8Array((outputAnalyserRef.current || inputAnalyserRef.current)!.frequencyBinCount);
        (outputAnalyserRef.current || inputAnalyserRef.current)!.getByteFrequencyData(arr);
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        setIntensity(avg / 255);
      }
      frameId = requestAnimationFrame(updateIntensity);
    };
    if (status === ConnectionStatus.CONNECTED) {
      frameId = requestAnimationFrame(updateIntensity);
    }
    return () => cancelAnimationFrame(frameId);
  }, [status]);

  return (
    <div className="min-h-screen bg-[#050505] text-white relative overflow-hidden">
      {/* Wallet & Debug Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-6 z-40">
        <button 
          onClick={handleWalletAction}
          className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 backdrop-blur-md border border-white/10 hover:border-white/30 px-6 py-2 rounded-full text-sm font-semibold transition-all"
        >
          {walletAddress ? `${walletAddress.slice(0,6)}...${walletAddress.slice(-4)}` : 'Connect Phantom'}
        </button>
        <button 
          onClick={() => setShowDebug(!showDebug)}
          className="bg-black/40 backdrop-blur-md border border-white/10 hover:border-white/30 p-2 rounded-full transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>
      </div>

      {/* Debug Panel */}
      {showDebug && (
        <div className="absolute top-20 right-6 bg-black/90 backdrop-blur-md border border-white/20 rounded-xl p-4 max-w-md max-h-[60vh] overflow-y-auto z-40">
          <h3 className="text-sm font-bold mb-2 text-cyan-400">System Log</h3>
          {debugLogs.length === 0 && <p className="text-xs text-white/40">No events logged yet.</p>}
          {debugLogs.map(log => (
            <div key={log.id} className={`text-xs mb-2 pb-2 border-b border-white/10 ${
              log.status === 'ERROR' ? 'text-red-400' : log.status === 'SUCCESS' ? 'text-emerald-400' : 'text-white/60'
            }`}>
              <span className="text-white/40">[{log.timestamp}]</span> <span className="font-semibold">{log.type}</span>: {log.message}
            </div>
          ))}
        </div>
      )}

      {/* HOME VIEW */}
      {view === 'home' && (
        <div className="flex flex-col min-h-screen relative z-10">
          {/* Hero Section */}
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-20">
            <div className="max-w-6xl mx-auto text-center mb-20">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-sm">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-sm text-white/70">AI-Powered Board Advisors</span>
              </div>
              
              <h1 className="text-7xl md:text-8xl lg:text-9xl font-bold mb-8 font-outfit leading-none tracking-tight">
                <span className="bg-gradient-to-r from-white via-white to-white/70 bg-clip-text text-transparent">
                  BoardRoom
                </span>
              </h1>
              
              <p className="text-2xl md:text-3xl lg:text-4xl text-white/80 mb-6 font-light leading-tight max-w-4xl mx-auto">
                Your AI Board of Directors for Startups
              </p>
              
              <p className="text-lg md:text-xl text-white/50 mb-12 max-w-2xl mx-auto leading-relaxed">
                Five specialized AI agents providing expert guidance through live voice conversations, collaborative discussions, and intelligent knowledge search.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
                <button 
                  onClick={() => setShowRoundtableInput(true)}
                  className="group relative px-8 py-4 bg-white text-black font-semibold rounded-xl transition-all hover:scale-105 hover:shadow-2xl hover:shadow-white/20"
                >
                  Start Board Meeting
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 opacity-0 group-hover:opacity-100 transition-opacity -z-10 blur-xl" />
                </button>
                <button 
                  onClick={() => setShowKnowledgeBase(true)}
                  className="px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white font-semibold rounded-xl transition-all backdrop-blur-sm"
                >
                  Upload Company Data
                </button>
                {walletAddress && pastSessions.length > 0 && (
                  <button 
                    onClick={() => setShowSessionHistory(true)}
                    className="px-8 py-4 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 hover:border-blue-500/50 text-blue-300 font-semibold rounded-xl transition-all backdrop-blur-sm"
                  >
                    Past Meetings ({pastSessions.length})
                  </button>
              )}
            </div>
          </div>
          
          {/* Session History Modal */}
          {showSessionHistory && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
              <div className="bg-gradient-to-br from-slate-900 to-black border border-white/10 rounded-3xl p-8 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold font-outfit">Past Board Meetings</h2>
                  <button
                    onClick={() => {
                      setShowSessionHistory(false);
                      setSelectedSession(null);
                    }}
                    className="text-white/50 hover:text-white text-2xl"
                  >
                    ×
                  </button>
                </div>
                
                {!selectedSession ? (
                  <div className="space-y-3">
                    {pastSessions.map((session) => (
                      <div
                        key={session.id}
                        onClick={() => viewSessionDetails(session.id)}
                        className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl p-4 cursor-pointer transition-all"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-semibold text-lg">{session.topic}</h3>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            session.status === 'complete' ? 'bg-green-500/20 text-green-400' :
                            session.status === 'stopped' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {session.status}
                          </span>
                        </div>
                        <p className="text-white/60 text-sm">
                          {new Date(session.created_at).toLocaleDateString()} at {new Date(session.created_at).toLocaleTimeString()}
                        </p>
                        {session.summary && (
                          <p className="text-white/70 text-sm mt-2 line-clamp-2">{session.summary}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => setSelectedSession(null)}
                      className="text-blue-400 hover:text-blue-300 mb-4 text-sm"
                    >
                      ← Back to list
                    </button>
                    
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-xl font-bold mb-2">{selectedSession.topic}</h3>
                        <p className="text-white/60 text-sm">
                          {new Date(selectedSession.created_at).toLocaleString()}
                        </p>
                      </div>
                      
                      {selectedSession.research && selectedSession.research.length > 0 && (
                        <div>
                          <h4 className="font-semibold mb-3">Research Findings</h4>
                          <div className="grid gap-3">
                            {selectedSession.research.map((r: any) => (
                              <div key={r.id} className="bg-white/5 border border-white/10 rounded-lg p-3">
                                <div className="font-semibold text-sm mb-1">{r.agent_name}</div>
                                <p className="text-white/70 text-sm">{r.findings}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {selectedSession.discussions && selectedSession.discussions.length > 0 && (
                        <div>
                          <h4 className="font-semibold mb-3">Discussion ({selectedSession.discussions.length} exchanges)</h4>
                          <div className="space-y-2 max-h-96 overflow-y-auto">
                            {selectedSession.discussions.map((d: any) => (
                              <div key={d.id} className="bg-white/5 border-l-4 border-l-blue-500/50 rounded-lg p-3">
                                <div className="font-semibold text-sm mb-1">{d.from_agent_name}</div>
                                <p className="text-white/70 text-sm">{d.message}</p>
                                <p className="text-white/40 text-xs mt-1">
                                  {new Date(d.created_at).toLocaleTimeString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {selectedSession.summary && (
                        <div>
                          <h4 className="font-semibold mb-3">Summary</h4>
                          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                            <p className="text-white/80">{selectedSession.summary}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

