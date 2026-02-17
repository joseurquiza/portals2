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
    
    pushLog('SYSTEM', 'INFO', 'Loaded your personal workspace');
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
      
      const systemInstruction = `You are ${agent.name}, a board member with expertise in ${agent.description}.

You are in a live board discussion about: "${roundtableSession?.topic}"

Your research findings: ${agentResearch?.findings}

${personalityTraits ? `Your personality and style: ${personalityTraits}\n\n` : ''}

Other board members: ${AGENTS.filter(a => a.id !== agent.id).map(a => a.name).join(', ')}

HOW TO PARTICIPATE:
- You will receive messages showing what other board members say in real-time
- When you receive a message, respond naturally if:
  * Someone addresses you by name
  * The topic relates to your expertise (${agent.description})
  * You have a relevant insight to add
- Keep responses conversational and brief (1-3 sentences)
- Speak directly to the board: "I think...", "The key issue is...", "${AGENTS[0].name}, regarding..."
- NO INTERNAL MONOLOGUE: Never say "I'm analyzing", "I'm observing", "I'm formulating"

${agent.id === 'oracle' ? 'As Chairman, you will open the discussion. Introduce the topic and your perspective, then invite others to contribute.' : 'Listen to what others say and contribute when relevant to your expertise.'}

SPEAK NATURALLY. BE DIRECT. BE BRIEF.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => { 
            console.log(`[v0] ${agent.name} voice session connected`);
            pushLog('SYSTEM', 'SUCCESS', `${agent.name} joined discussion`);
          },
          onmessage: async (message: LiveServerMessage) => {
            console.log(`[v0] ${agent.name} received message:`, JSON.stringify(message).slice(0, 200));
            
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              console.log(`[v0] ${agent.name} speaking... (audio length: ${base64Audio.length})`);
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
              
              // Broadcast to other agents as natural dialogue
              for (const [otherId, sessionObj] of sessionsRef.current.entries()) {
                if (otherId !== agent.id) {
                  const otherSession = await sessionObj.promise;
                  // Send as if it's someone speaking in the room
                  otherSession.sendRealtimeInput({
                    text: `${agent.name} says: "${textContent}"`
                  });
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
      try {
        const chairmanSession = await chairmanSessionObj.promise;
        console.log('[v0] Chairman session resolved, sending prompt...');
        // Simple trigger for Chairman to open
        const result = chairmanSession.sendRealtimeInput({
          text: `Please open the board meeting and introduce the topic: "${roundtableSession.topic}". Speak now.`
        });
        console.log('[v0] sendRealtimeInput result:', result);
        console.log('[v0] Prompt sent to Chairman successfully');
      } catch (error) {
        console.error('[v0] Error sending prompt to Chairman:', error);
      }
    } else {
      console.error('[v0] Chairman session not found!');
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
              </div>
            </div>
            
            {/* Agent Cards */}
            <div className="max-w-7xl w-full px-4">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold mb-4 font-outfit">Meet Your Board Members</h2>
                <p className="text-white/60 text-lg">Click any advisor to start a live voice session</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {AGENTS.map((agent, idx) => (
                  <button 
                    key={agent.id}
                    onClick={() => startCluster(agent)}
                    className="group relative bg-gradient-to-b from-white/[0.07] to-white/[0.02] backdrop-blur-xl border border-white/10 hover:border-white/20 rounded-2xl p-8 transition-all hover:-translate-y-2 hover:shadow-2xl overflow-hidden"
                    style={{
                      animationDelay: `${idx * 100}ms`,
                      animation: 'fadeInUp 0.6s ease-out forwards',
                      opacity: 0
                    }}
                  >
                    {/* Glow Effect */}
                    <div 
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700" 
                      style={{background: `radial-gradient(circle at 50% 0%, ${agent.colors.glow}15, transparent 70%)`}} 
                    />
                    
                    {/* Content */}
                    <div className="relative z-10 flex flex-col items-center text-center">
                      <div 
                        className={`w-20 h-20 rounded-2xl ${agent.colors.primary} mb-6 shadow-lg transition-transform group-hover:scale-110 group-hover:rotate-3 flex items-center justify-center`} 
                        style={{boxShadow: `0 10px 40px ${agent.colors.glow}40`}}
                      >
                        <span className="text-3xl">
                          {agent.id === 'oracle' && '🔮'}
                          {agent.id === 'architect' && '🏗️'}
                          {agent.id === 'ledger' && '💰'}
                          {agent.id === 'muse' && '🎨'}
                          {agent.id === 'sentinel' && '🛡️'}
                        </span>
                      </div>
                      <h3 className="text-2xl font-bold mb-3 font-outfit group-hover:text-white transition-colors">{agent.name}</h3>
                      <p className="text-sm text-white/60 leading-relaxed mb-4">{agent.description}</p>
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>Available now</span>
                      </div>
                    </div>
                    
                    {/* Hover Arrow */}
                    <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                      <svg className="w-5 h-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Quick Actions */}
            <div className="mt-20 flex flex-wrap gap-6 justify-center text-sm">
              <button 
                onClick={() => setShowPersonalityEditor(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all group"
              >
                <span className="text-white/70 group-hover:text-white transition-colors">⚙️ Customize Personalities</span>
              </button>
              <button 
                onClick={() => setShowKnowledgeBase(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all group"
              >
                <span className="text-white/70 group-hover:text-white transition-colors">📚 Knowledge Base</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Roundtable Input Modal */}
      {showRoundtableInput && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-slate-900 to-black border border-white/20 rounded-2xl p-8 max-w-2xl w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-4 font-outfit">Start a Roundtable Discussion</h2>
            <p className="text-sm text-white/60 mb-6">
              All five agents will research your topic, discuss their findings with each other, and provide a comprehensive summary.
            </p>
            <textarea
              placeholder="Enter your topic or question..."
              className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 mb-6 h-32 focus:outline-none focus:border-cyan-500 transition resize-none"
              id="roundtable-topic"
            />
            <div className="flex gap-3">
              <button 
                onClick={() => {
                  const input = document.getElementById('roundtable-topic') as HTMLTextAreaElement;
                  if (input?.value.trim()) startRoundtable(input.value);
                }}
                className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white font-semibold py-3 rounded-lg transition"
              >
                Begin Roundtable
              </button>
              <button 
                onClick={() => setShowRoundtableInput(false)}
                className="px-6 bg-white/10 hover:bg-white/20 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Personality Editor Modal */}
      {showPersonalityEditor && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gradient-to-br from-slate-900 to-black border border-white/20 rounded-2xl p-8 max-w-5xl w-full shadow-2xl my-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold font-outfit">Customize Agent Personalities</h2>
                <p className="text-sm text-white/60 mt-1">
                  Give each agent a unique thinking style or persona
                </p>
              </div>
              <button 
                onClick={() => {
                  setShowPersonalityEditor(false);
                  setEditingAgentId(null);
                }}
                className="text-white/60 hover:text-white transition text-2xl"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {AGENTS.map(agent => {
                const personality = agentPersonalities.find(p => p.agentId === agent.id);
                const preset = PERSONALITY_PRESETS.find(p => p.id === personality?.presetId);
                const isEditing = editingAgentId === agent.id;

                return (
                  <div 
                    key={agent.id}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div 
                        className={`w-3 h-3 rounded-full ${agent.colors.primary}`}
                        style={{boxShadow: `0 0 10px ${agent.colors.glow}`}}
                      />
                      <span className="font-bold">{agent.name}</span>
                    </div>
                    
                    <select
                      value={personality?.presetId || 'default'}
                      onChange={(e) => {
                        setAgentPersonalities(prev => 
                          prev.map(p => 
                            p.agentId === agent.id 
                              ? { ...p, presetId: e.target.value, customTraits: '' }
                              : p
                          )
                        );
                      }}
                      className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 mb-2 text-sm focus:outline-none focus:border-cyan-500 transition"
                    >
                      {PERSONALITY_PRESETS.map(preset => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                    
                    <p className="text-xs text-white/50 mb-3 h-8">
                      {preset?.description}
                    </p>
                    
                    {/* Research Real Person */}
                    {editingAgentId === agent.id && (
                      <div className="mb-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                        <label className="text-xs text-purple-300 font-semibold block mb-2">
                          Research Real Person
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={personResearchName}
                            onChange={(e) => setPersonResearchName(e.target.value)}
                            placeholder="e.g., Peter Thiel, Elon Musk..."
                            className="flex-1 bg-white/10 border border-white/20 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-purple-500 transition"
                            disabled={researchingPerson}
                          />
        <button
          onClick={connectWallet}
          disabled={!!walletAddress}
          className={`backdrop-blur-md border px-6 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
            walletAddress 
              ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border-green-500/30' 
              : 'bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-white/10 hover:border-white/30'
          }`}
          >
          {walletAddress && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {walletAddress ? `Your Space: ${walletAddress.slice(0,4)}...${walletAddress.slice(-4)}` : 'Connect Phantom'}
        </button>
                        </div>
                        <p className="text-xs text-white/40 mt-1">
                          AI will deeply research this person's decision-making style and board behavior
                        </p>
                      </div>
                    )}

                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={personality?.customTraits || ''}
                          onChange={(e) => {
                            setAgentPersonalities(prev => 
                              prev.map(p => 
                                p.agentId === agent.id 
                                  ? { ...p, customTraits: e.target.value }
                                  : p
                              )
                            );
                          }}
                          placeholder="Add custom personality traits..."
                          className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-xs h-24 focus:outline-none focus:border-cyan-500 transition resize-none"
                        />
                        <button
                          onClick={() => setEditingAgentId(null)}
                          className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-400 text-xs py-1.5 rounded transition"
                        >
                          Done
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingAgentId(agent.id)}
                        className="w-full bg-white/5 hover:bg-white/10 border border-white/20 text-white/70 text-xs py-1.5 rounded transition"
                      >
                        {personality?.customTraits ? 'Edit Custom Traits' : 'Add Custom Traits'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setAgentPersonalities(AGENTS.map(agent => ({ 
                    agentId: agent.id, 
                    presetId: 'default', 
                    customTraits: '' 
                  })));
                }}
                className="px-6 bg-white/5 hover:bg-white/10 border border-white/20 rounded-lg py-2 transition text-sm"
              >
                Reset All
              </button>
              <button
                onClick={() => {
                  setShowPersonalityEditor(false);
                  setEditingAgentId(null);
                }}
                className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white font-semibold py-2 rounded-lg transition"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Base Modal */}
      {showKnowledgeBase && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-gradient-to-br from-slate-900 to-black border border-white/20 rounded-2xl p-8 max-w-4xl w-full shadow-2xl my-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold font-outfit">Company Knowledge Base</h2>
                <p className="text-sm text-white/60 mt-1">
                  Upload documents, PDFs, spreadsheets, and images. Agents can search and reference them during conversations.
                </p>
              </div>
              <button 
                onClick={() => setShowKnowledgeBase(false)}
                className="text-white/60 hover:text-white transition text-2xl"
              >
                ×
              </button>
            </div>

            {/* Upload Progress */}
            {uploadProgress.length > 0 && (
              <div className="mb-6 space-y-2 bg-white/5 rounded-xl p-4 border border-white/10">
                <div className="text-sm font-semibold mb-3">Upload Progress</div>
                {uploadProgress.map((item, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/70 truncate max-w-[200px]">{item.filename}</span>
                      <span className={`font-semibold ${
                        item.status === 'complete' ? 'text-emerald-400' :
                        item.status === 'error' ? 'text-red-400' :
                        'text-cyan-400'
                      }`}>
                        {item.status === 'checking' && 'Checking...'}
                        {item.status === 'uploading' && 'Uploading...'}
                        {item.status === 'complete' && '✓ Complete'}
                        {item.status === 'error' && '✗ Failed'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-300 ${
                          item.status === 'complete' ? 'bg-emerald-400' :
                          item.status === 'error' ? 'bg-red-400' :
                          'bg-cyan-400'
                        }`}
                        style={{width: `${item.progress}%`}}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Upload Area */}
            <div className="border-2 border-dashed border-white/20 rounded-xl p-8 mb-6 hover:border-cyan-500/50 transition">
              <input
                type="file"
                id="knowledge-upload"
                multiple
                accept=".pdf,.txt,.md,.doc,.docx,.csv,.xlsx,.png,.jpg,.jpeg"
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length === 0) return;
                  
                  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || localStorage.getItem('SUPABASE_URL');
                  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || localStorage.getItem('SUPABASE_ANON_KEY');
                  
                  if (!supabaseUrl || !supabaseKey) {
                    pushLog('SYSTEM', 'ERROR', 'Database not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in environment or localStorage.');
                    return;
                  }
                  
                  const { createClient } = await import('@supabase/supabase-js');
                  const supabase = createClient(supabaseUrl, supabaseKey);
                  
                  setUploadingFiles(true);
                  setUploadProgress([]);
                  pushLog('SYSTEM', 'INFO', `Uploading ${files.length} file(s)...`);
                  console.log('[v0] Starting direct upload of', files.length, 'files');
                  
                  for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileNum = i + 1;
                    
                    // Add to progress tracking
                    setUploadProgress(prev => [...prev, {
                      filename: file.name,
                      status: 'checking',
                      progress: 0
                    }]);
                    
                    console.log(`[v0] [${fileNum}/${files.length}] Processing ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
                    
                    // Check file size on client side (50MB limit)
                    const maxSize = 50 * 1024 * 1024;
                    if (file.size > maxSize) {
                      console.log('[v0] File too large:', file.name);
                      pushLog('SYSTEM', 'ERROR', `File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB). Max 50MB.`);
                      setUploadProgress(prev => prev.map(p => 
                        p.filename === file.name ? {...p, status: 'error', progress: 100} : p
                      ));
                      continue;
                    }

                    setUploadProgress(prev => prev.map(p => 
                      p.filename === file.name ? {...p, status: 'uploading', progress: 20} : p
                    ));

                    try {
                      // Upload directly to Supabase Storage (client-side)
                      const fileExt = file.name.split('.').pop();
                      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                      const filePath = `knowledge/${fileName}`;

                      console.log('[v0] Uploading to Supabase storage:', filePath);
                      
                      setUploadProgress(prev => prev.map(p => 
                        p.filename === file.name ? {...p, progress: 40} : p
                      ));
                      
                      const { data: uploadData, error: uploadError } = await supabase.storage
                        .from('knowledge-base')
                        .upload(filePath, file);

                      if (uploadError) {
                        throw new Error(`Storage upload failed: ${uploadError.message}`);
                      }

                      console.log('[v0] File uploaded to storage:', uploadData.path);
                      
                      setUploadProgress(prev => prev.map(p => 
                        p.filename === file.name ? {...p, progress: 60} : p
                      ));

                      // Get public URL
                      const { data: { publicUrl } } = supabase.storage
                        .from('knowledge-base')
                        .getPublicUrl(filePath);

                      // Extract text from file (basic client-side processing)
                      let extractedText = '';
                      if (file.type.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
                        extractedText = await file.text();
                      } else {
                        extractedText = `${file.name} - File uploaded. Search by filename.`;
                      }

                      setUploadProgress(prev => prev.map(p => 
                        p.filename === file.name ? {...p, progress: 80} : p
                      ));

                      // Save metadata to database
                      console.log('[v0] Saving document metadata to database...');
                      const { data: docData, error: dbError } = await supabase
                        .from('knowledge_documents')
                        .insert({
                          filename: file.name,
                          file_type: file.type,
                          file_size: file.size,
                          storage_url: publicUrl,
                          extracted_text: extractedText,
                          wallet_address: walletAddress || 'anonymous',
                          metadata: {
                            original_name: file.name,
                            upload_source: 'client'
                          },
                        })
                        .select()
                        .single();

                      if (dbError) {
                        throw new Error(`Database insert failed: ${dbError.message}`);
                      }

                      console.log('[v0] Document saved to database:', docData.id);
                      pushLog('SYSTEM', 'SUCCESS', `Uploaded: ${file.name}`);
                      
                      setUploadProgress(prev => prev.map(p => 
                        p.filename === file.name ? {...p, status: 'complete', progress: 100} : p
                      ));
                      
                      // Add to document list
                      setKnowledgeDocs(prev => [docData, ...prev]);
                      
                    } catch (err: any) {
                      console.error('[v0] Upload exception:', err);
                      pushLog('SYSTEM', 'ERROR', `Upload error: ${file.name} - ${err.message}`);
                      setUploadProgress(prev => prev.map(p => 
                        p.filename === file.name ? {...p, status: 'error', progress: 100} : p
                      ));
                    }
                  }
                  
                  console.log('[v0] Upload process complete');
                  setUploadingFiles(false);
                  setTimeout(() => setUploadProgress([]), 3000);
                  e.target.value = '';
                }}
              />
              <label 
                htmlFor="knowledge-upload"
                className="flex flex-col items-center cursor-pointer"
              >
                <div className="text-5xl mb-4">📁</div>
                <div className="text-lg font-semibold mb-2">
                  {uploadingFiles ? 'Uploading...' : 'Click to Upload Documents'}
                </div>
                <div className="text-sm text-white/50">
                  Supports: PDF, Text, Word, Excel, Images (PNG, JPG)
                </div>
              </label>
            </div>

            {/* Document List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {knowledgeDocs.length === 0 && !uploadingFiles && (
                <div className="text-center text-white/40 py-8">
                  No documents uploaded yet. Upload files to give your agents context.
                </div>
              )}
              
              {knowledgeDocs.map((doc) => (
                <div 
                  key={doc.id}
                  className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition flex items-center gap-4"
                >
                  <div className="text-3xl">
                    {doc.file_type === 'application/pdf' && '📄'}
                    {doc.file_type.includes('text') && '📝'}
                    {doc.file_type.includes('spreadsheet') && '📊'}
                    {doc.file_type.includes('image') && '🖼️'}
                    {!['application/pdf', 'text', 'spreadsheet', 'image'].some(t => doc.file_type.includes(t)) && '📎'}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold">{doc.filename}</div>
                    <div className="text-xs text-white/50">
                      {(doc.file_size / 1024).toFixed(1)} KB • Uploaded {new Date(doc.upload_date).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (confirm(`Delete ${doc.filename}?`)) {
                        // Delete from database
                        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
                        
                        if (supabaseUrl && supabaseKey) {
                          const { createClient } = await import('@supabase/supabase-js');
                          const supabase = createClient(supabaseUrl, supabaseKey);
                          
                          await supabase.from('knowledge_documents').delete().eq('id', doc.id);
                          setKnowledgeDocs(prev => prev.filter(d => d.id !== doc.id));
                          pushLog('SYSTEM', 'INFO', `Deleted: ${doc.filename}`);
                        }
                      }
                    }}
                    className="text-red-400 hover:text-red-300 text-sm"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={async () => {
                  // Load existing documents
                  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
                  
                  if (supabaseUrl && supabaseKey) {
                    const { createClient } = await import('@supabase/supabase-js');
                    const supabase = createClient(supabaseUrl, supabaseKey);
                    
                    const { data } = await supabase
                      .from('knowledge_documents')
                      .select('*')
                      .order('upload_date', { ascending: false });
                    
                    if (data) setKnowledgeDocs(data);
                  }
                }}
                className="px-6 bg-white/5 hover:bg-white/10 border border-white/20 rounded-lg py-2 transition text-sm"
              >
                Refresh List
              </button>
              <button
                onClick={() => setShowKnowledgeBase(false)}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold py-2 rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PORTAL VIEW */}
      {view === 'portal' && (
        <div className="flex flex-col lg:flex-row min-h-screen">
          {/* Left Sidebar - Cluster Control */}
          <div className="w-full lg:w-80 bg-black/40 backdrop-blur-md border-r border-white/10 p-6 flex flex-col">
            <button 
              onClick={terminateAll}
              className="mb-6 w-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 font-semibold py-3 rounded-lg transition"
            >
              ← Disconnect Cluster
            </button>

            <div className="mb-6">
              <h3 className="text-sm font-bold text-white/60 mb-3 uppercase tracking-wider">Active Host</h3>
              <div className={`p-4 rounded-xl border-2 ${speakingAgents.has(activeAgent.id) ? 'animate-pulse' : ''}`} style={{borderColor: activeAgent.colors.glow}}>
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-3 h-3 rounded-full ${activeAgent.colors.primary}`} style={{boxShadow: `0 0 10px ${activeAgent.colors.glow}`}} />
                  <span className="font-bold">{activeAgent.name}</span>
                </div>
                <p className="text-xs text-white/50">{activeAgent.description}</p>
              </div>
            </div>

            {collaborators.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-white/60 mb-3 uppercase tracking-wider">Collaborators</h3>
                <div className="space-y-2">
                  {collaborators.map(collab => (
                    <div 
                      key={collab.id} 
                      className={`p-3 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between ${removingIds.has(collab.id) ? 'opacity-30 scale-95' : ''} ${speakingAgents.has(collab.id) ? 'animate-pulse' : ''} transition-all`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${collab.colors.primary}`} style={{boxShadow: `0 0 8px ${collab.colors.glow}`}} />
                        <span className="text-sm font-semibold">{collab.name}</span>
                      </div>
                      <button 
                        onClick={() => removeAgentFromCluster(collab.id)}
                        className="text-white/40 hover:text-red-400 text-xs transition"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto">
              <div className={`text-xs uppercase tracking-wider font-semibold ${isSyncing ? 'text-cyan-400' : status === ConnectionStatus.CONNECTED ? 'text-emerald-400' : 'text-white/40'}`}>
                {isSyncing ? '⟳ Syncing...' : status === ConnectionStatus.CONNECTED ? '● Live' : '○ Idle'}
              </div>
            </div>
          </div>

          {/* Center - Portal Visualization */}
          <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
            <div className="mb-8">
              <LiquidPortal 
                isListening={status === ConnectionStatus.CONNECTED}
                isSpeaking={speakingAgents.has(focusedAgentId || activeAgent.id)}
                isFocused={true}
                intensity={intensity}
                colors={AGENTS.find(a => a.id === focusedAgentId)?.colors || activeAgent.colors}
                size="lg"
              />
            </div>

            {focusedAgentId && (
              <div className="text-center">
                <h2 className="text-3xl font-bold font-outfit mb-2">
                  {AGENTS.find(a => a.id === focusedAgentId)?.name}
                </h2>
                <p className="text-white/60 text-sm">
                  {AGENTS.find(a => a.id === focusedAgentId)?.description}
                </p>
              </div>
            )}
          </div>

          {/* Right Sidebar - Transcription */}
          <div className="w-full lg:w-96 bg-black/40 backdrop-blur-md border-l border-white/10 p-6 flex flex-col">
            <h3 className="text-sm font-bold text-white/60 mb-4 uppercase tracking-wider">Live Transcription</h3>
            <div ref={transcriptionContainerRef} className="flex-1 overflow-y-auto space-y-3 pr-2">
              {transcriptions.length === 0 && (
                <p className="text-white/30 text-sm">Waiting for conversation...</p>
              )}
              {transcriptions.map((item, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-lg ${item.type === 'user' ? 'bg-white/5 ml-4' : 'bg-blue-500/10 mr-4'}`}
                >
                  <div className="text-xs text-white/50 mb-1">
                    {item.type === 'user' ? 'You' : AGENTS.find(a => a.id === item.agentId)?.name || 'Agent'}
                  </div>
                  <div className="text-sm">{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ROUNDTABLE VIEW */}
      {view === 'roundtable' && roundtableSession && (
        <div className="flex flex-col min-h-screen">
          {/* Header */}
          <div className="bg-black/40 backdrop-blur-md border-b border-white/10 p-6">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="flex-1">
                <h1 className="text-3xl font-bold font-outfit mb-2 bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
                  Roundtable Discussion
                </h1>
                <p className="text-white/60">{roundtableSession.topic}</p>
              </div>
              <button 
                onClick={terminateAll}
                className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 font-semibold px-6 py-2 rounded-lg transition"
              >
                End Session
              </button>
            </div>
          </div>

          {/* Status Banner */}
          <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 border-b border-white/10 px-6 py-3">
            <div className="max-w-7xl mx-auto flex items-center gap-4">
              <div className="flex items-center gap-2">
                {roundtableSession.status === 'researching' && (
                  <>
                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                    <span className="text-sm font-semibold text-cyan-400">Researching...</span>
                  </>
                )}
                {roundtableSession.status === 'discussing' && (
                  <>
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                    <span className="text-sm font-semibold text-purple-400">Discussing...</span>
                  </>
                )}
                {roundtableSession.status === 'summarizing' && (
                  <>
                    <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                    <span className="text-sm font-semibold text-yellow-400">Generating Summary...</span>
                  </>
                )}
                {roundtableSession.status === 'complete' && (
                  <>
                    <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                    <span className="text-sm font-semibold text-emerald-400">Complete</span>
                  </>
                )}
              </div>
              <div className="text-xs text-white/40">
                {Math.floor((Date.now() - roundtableSession.startTime) / 1000)}s elapsed
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto p-6 space-y-6">
              
              {/* Research Phase */}
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <span className="text-2xl">🔍</span>
                  Research Phase
                  <span className="ml-auto text-xs text-white/40">
                    {roundtableSession.research.filter(r => r.status === 'complete').length} / {AGENTS.length} complete
                  </span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roundtableSession.research.map((research) => {
                    const agent = AGENTS.find(a => a.id === research.agentId);
                    const isActivelyResearching = focusedAgentId === agent?.id && research.status === 'researching';
                    if (!agent) return null;
                    return (
                      <div 
                        key={research.agentId}
                        className={`relative bg-white/5 border rounded-xl p-4 transition-all ${
                          research.status === 'complete' 
                            ? 'border-emerald-500/50' 
                            : isActivelyResearching 
                            ? 'border-cyan-500/50 shadow-lg shadow-cyan-500/20' 
                            : 'border-white/10'
                        } ${isActivelyResearching ? 'scale-105' : ''}`}
                      >
                        {/* Active research glow */}
                        {isActivelyResearching && (
                          <div 
                            className="absolute inset-0 rounded-xl opacity-20 animate-pulse"
                            style={{background: `radial-gradient(circle at 50% 50%, ${agent.colors.glow}, transparent 70%)`}}
                          />
                        )}
                        
                        <div className="relative z-10">
                          <div className="flex items-center gap-2 mb-3">
                            <div 
                              className={`w-3 h-3 rounded-full ${agent.colors.primary} transition-all ${isActivelyResearching ? 'animate-pulse' : ''}`}
                              style={{boxShadow: `0 0 ${isActivelyResearching ? '20px' : '10px'} ${agent.colors.glow}`}}
                            />
                            <span className="font-bold">{agent.name}</span>
                            {research.status === 'researching' && (
                              <div className="ml-auto flex items-center gap-2">
                                {isActivelyResearching && (
                                  <span className="text-xs text-cyan-400 font-semibold">Researching now</span>
                                )}
                                <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                              </div>
                            )}
                            {research.status === 'complete' && (
                              <div className="ml-auto flex items-center gap-1">
                                <span className="text-xs text-emerald-400">Done</span>
                                <div className="text-emerald-400">✓</div>
                              </div>
                            )}
                          </div>
                          
                          {research.findings ? (
                            <p className="text-sm text-white/70 leading-relaxed">
                              {research.findings}
                            </p>
                          ) : (
                            <div className="space-y-2">
                              <div className="h-2 bg-white/10 rounded animate-pulse" style={{width: '100%'}} />
                              <div className="h-2 bg-white/10 rounded animate-pulse" style={{width: '85%'}} />
                              <div className="h-2 bg-white/10 rounded animate-pulse" style={{width: '60%'}} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Start Discussion Button - appears after all research is complete */}
                {roundtableSession.status === 'researching' && 
                 roundtableSession.research.every(r => r.status === 'complete') && 
                 !isDiscussionRunning && (
                  <div className="flex justify-center mt-6">
                    <button
                      onClick={() => startDiscussion()}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold px-8 py-3 rounded-xl transition-all transform hover:scale-105 shadow-lg shadow-purple-500/50 animate-pulse"
                    >
                      🎤 Start Board Discussion
                    </button>
                  </div>
                )}
              </div>

              {/* Discussion Phase */}
              {roundtableSession.discussions.length > 0 && (
                <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                      <span className="text-2xl">💬</span>
                      Discussion
                      <span className="text-xs text-white/40 ml-2">
                        {roundtableSession.discussions.length} exchanges
                      </span>
                    </h2>
                    {isDiscussionRunning && (
                      <button
                        onClick={stopDiscussion}
                        className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 font-semibold px-4 py-2 rounded-lg transition text-sm"
                      >
                        Stop Discussion
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {roundtableSession.discussions.map((discussion, idx) => {
                      const agent = AGENTS.find(a => a.id === discussion.fromAgentId);
                      if (!agent) return null;
                      return (
                        <div 
                          key={idx}
                          className={`bg-gradient-to-r from-white/5 to-transparent border-l-4 rounded-lg p-4 transition-all ${
                            focusedAgentId === agent.id ? 'border-l-white/80 scale-[1.02]' : 'border-l-white/20'
                          }`}
                          style={{
                            borderLeftColor: focusedAgentId === agent.id ? agent.colors.glow : undefined
                          }}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div 
                              className={`w-2 h-2 rounded-full ${agent.colors.primary}`}
                              style={{boxShadow: `0 0 8px ${agent.colors.glow}`}}
                            />
                            <span className="font-semibold text-sm">{agent.name}</span>
                            <span className="text-xs text-white/40 ml-auto">
                              {new Date(discussion.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-white/80">{discussion.message}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Summary Phase */}
              {roundtableSession.summary && (
                <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 backdrop-blur-sm border border-purple-500/30 rounded-2xl p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="text-2xl">📋</span>
                    Oracle's Summary
                  </h2>
                  <div className="prose prose-invert prose-sm max-w-none">
                    <div 
                      className="text-white/90 whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{
                        __html: roundtableSession.summary
                          .replace(/^## /gm, '<h3 class="text-lg font-bold mt-4 mb-2 text-purple-300">')
                          .replace(/\n## /g, '</h3>\n<h3 class="text-lg font-bold mt-4 mb-2 text-purple-300">')
                          .replace(/^- /gm, '• ')
                          .replace(/\n- /g, '\n• ')
                          + '</h3>'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Agent Visualizations */}
              {(roundtableSession.status === 'discussing' || roundtableSession.status === 'summarizing') && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {AGENTS.map(agent => (
                    <div 
                      key={agent.id}
                      className={`flex flex-col items-center transition-all ${
                        focusedAgentId === agent.id ? 'scale-110' : 'scale-90 opacity-50'
                      }`}
                    >
                      <LiquidPortal 
                        isListening={roundtableSession.status !== 'complete'}
                        isSpeaking={focusedAgentId === agent.id}
                        isFocused={focusedAgentId === agent.id}
                        intensity={focusedAgentId === agent.id ? 0.7 : 0.2}
                        colors={agent.colors}
                        size="sm"
                      />
                      <span className="text-xs mt-2 font-semibold">{agent.name}</span>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
