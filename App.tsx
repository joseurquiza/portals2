
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionStatus, TranscriptionItem, AgentConfig, PortalSignal } from './types';
import { decode, encode, decodeAudioData } from './utils/audioUtils';
import { supabase } from './supabaseClient';
import LiquidPortal from './components/LiquidPortal';

// --- Types ---
interface DebugLog {
  id: string;
  timestamp: string;
  type: 'DB' | 'NETWORK' | 'AUTH' | 'SYSTEM';
  status: 'SUCCESS' | 'ERROR' | 'INFO';
  message: string;
  detail?: any;
}

// --- Agent Database ---
const AGENTS: AgentConfig[] = [
  {
    id: 'oracle',
    name: 'The Oracle',
    description: 'Universal wisdom and philosophical depth.',
    voice: 'Zephyr',
    instruction: "You are The Oracle. You focus on the 'why' and the 'big picture'. You are wise and ethereal.",
    colors: { primary: 'bg-indigo-600', secondary: 'bg-cyan-500', accent: 'bg-blue-400', glow: '#4f46e5' }
  },
  {
    id: 'architect',
    name: 'The Architect',
    description: 'Systems, code, and technical engineering.',
    voice: 'Fenrir',
    instruction: "You are The Architect. You are clinical, logical, and obsessed with efficiency.",
    colors: { primary: 'bg-blue-700', secondary: 'bg-sky-400', accent: 'bg-indigo-400', glow: '#0369a1' }
  },
  {
    id: 'ledger',
    name: 'The Ledger',
    description: 'Markets, economy, and financial systems.',
    voice: 'Kore',
    instruction: "You are The Ledger. You analyze risk, value, and economy. You are practical and cautious.",
    colors: { primary: 'bg-emerald-600', secondary: 'bg-teal-400', accent: 'bg-yellow-500', glow: '#059669' }
  },
  {
    id: 'muse',
    name: 'The Muse',
    description: 'Art, storytelling, and creative vision.',
    voice: 'Puck',
    instruction: "You are The Muse. You are poetic, expressive, and imaginative. You see the world as a canvas.",
    colors: { primary: 'bg-purple-600', secondary: 'bg-pink-500', accent: 'bg-fuchsia-400', glow: '#9333ea' }
  },
  {
    id: 'sentinel',
    name: 'The Sentinel',
    description: 'Cybersecurity, protection, and ethics.',
    voice: 'Charon',
    instruction: "You are The Sentinel. You are vigilant, protective, and focused on security.",
    colors: { primary: 'bg-red-700', secondary: 'bg-orange-600', accent: 'bg-slate-500', glow: '#dc2626' }
  },
  {
    id: 'alchemist',
    name: 'The Alchemist',
    description: 'Biology, medicine, and chemical science.',
    voice: 'Zephyr',
    instruction: "You are The Alchemist. You focus on the biological and material world. You are curious and precise.",
    colors: { primary: 'bg-lime-600', secondary: 'bg-emerald-400', accent: 'bg-white', glow: '#65a30d' }
  },
  {
    id: 'chronos',
    name: 'The Chronos',
    description: 'History, culture, and temporal archives.',
    voice: 'Charon',
    instruction: "You are The Chronos. You provide historical perspective and analyze long-term trends.",
    colors: { primary: 'bg-amber-700', secondary: 'bg-yellow-600', accent: 'bg-orange-900', glow: '#b45309' }
  },
  {
    id: 'nomad',
    name: 'The Nomad',
    description: 'Geography, culture, and world travel.',
    voice: 'Puck',
    instruction: "You are The Nomad. You focus on locations, cultures, and travel. You are adventurous.",
    colors: { primary: 'bg-cyan-700', secondary: 'bg-sky-400', accent: 'bg-emerald-800', glow: '#0e7490' }
  },
  {
    id: 'chef',
    name: 'The Chef',
    description: 'Gastronomy, nutrition, and culinary arts.',
    voice: 'Kore',
    instruction: "You are The Chef. You focus on flavor, nutrition, and the art of cooking. You are passionate.",
    colors: { primary: 'bg-orange-500', secondary: 'bg-red-500', accent: 'bg-yellow-300', glow: '#f97316' }
  },
  {
    id: 'arbiter',
    name: 'The Arbiter',
    description: 'Law, logical mediation, and conflict.',
    voice: 'Fenrir',
    instruction: "You are The Arbiter. You find logical middle ground and resolve disputes fairly.",
    colors: { primary: 'bg-slate-700', secondary: 'bg-white', accent: 'bg-blue-900', glow: '#334155' }
  }
];

const clusterTools: FunctionDeclaration[] = [
  {
    name: 'summonAgent',
    parameters: {
      type: Type.OBJECT,
      description: 'Bring another specialized portal online by ID.',
      properties: { 
        agentId: { 
          type: Type.STRING, 
          description: 'The unique ID of the agent to summon (e.g., "oracle", "architect").' 
        } 
      },
      required: ['agentId'],
    },
  },
  {
    name: 'dismissAgent',
    parameters: {
      type: Type.OBJECT,
      description: 'Dismiss an agent from the cluster.',
      properties: { agentId: { type: Type.STRING, description: 'ID of the agent to dismiss.' } },
      required: ['agentId'],
    },
  },
  {
    name: 'raiseSignal',
    parameters: {
      type: Type.OBJECT,
      description: 'Raise a visual reaction bubble.',
      properties: {
        agentId: { type: Type.STRING, description: 'ID of the agent raising the signal.' },
        type: { type: Type.STRING, enum: ['positive', 'negative', 'alert', 'info'] },
        message: { type: Type.STRING, description: 'Short label.' }
      },
      required: ['agentId', 'type', 'message'],
    },
  }
];

interface SessionControl {
  agentId: string;
  promise: Promise<any>;
}

const App: React.FC = () => {
  const [view, setView] = useState<'home' | 'portal'>('home');
  const [activeAgent, setActiveAgent] = useState<AgentConfig>(AGENTS[0]);
  const [collaborators, setCollaborators] = useState<AgentConfig[]>([]);
  const [signals, setSignals] = useState<PortalSignal[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.IDLE);
  const [intensity, setIntensity] = useState(0);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  
  // Debug Logging State
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [debugTab, setDebugTab] = useState<'logs' | 'system'>('logs');

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const transcriptionContainerRef = useRef<HTMLDivElement>(null);
  const sessionsRef = useRef<Map<string, SessionControl>>(new Map());
  const [speakingAgents, setSpeakingAgents] = useState<Set<string>>(new Set());

  const pushLog = useCallback((type: DebugLog['type'], status: DebugLog['status'], message: string, detail?: any) => {
    const newLog: DebugLog = {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toLocaleTimeString(),
      type,
      status,
      message,
      detail
    };
    setDebugLogs(prev => [newLog, ...prev].slice(0, 100));
    if (status === 'ERROR') console.error(`[${type}] ${message}`, detail);
  }, []);

  const testDatabase = async () => {
    if (!supabase) {
      pushLog('SYSTEM', 'ERROR', 'Test failed: Supabase client is null.');
      return;
    }
    pushLog('DB', 'INFO', 'Testing connection to portal_users table...');
    try {
      const { error } = await supabase.from('portal_users').select('count', { count: 'exact', head: true });
      if (error) {
        pushLog('DB', 'ERROR', `DB Test Failed: ${error.message}`, error);
      } else {
        pushLog('DB', 'SUCCESS', 'Database connectivity verified.');
      }
    } catch (e: any) {
      pushLog('DB', 'ERROR', 'Database heart-beat exception', e);
    }
  };

  const logWalletConnection = async (address: string) => {
    if (!supabase) {
      pushLog('SYSTEM', 'INFO', 'Supabase not initialized. Env variables SUPABASE_URL or SUPABASE_ANON_KEY might be missing.');
      return;
    }
    pushLog('DB', 'INFO', `Attempting to log wallet: ${address}`);
    try {
      const { error } = await supabase.from('portal_users').upsert({ 
        address, 
        last_seen: new Date().toISOString() 
      }, { onConflict: 'address' });
      
      if (error) throw error;
      pushLog('DB', 'SUCCESS', `Wallet address logged to cloud.`);
    } catch (e: any) {
      pushLog('DB', 'ERROR', 'Failed to log wallet connection. Check RLS or table schema.', e);
    }
  };

  useEffect(() => {
    const checkWallet = async () => {
      const provider = (window as any).solana;
      if (provider?.isPhantom) {
        try {
          const resp = await provider.connect({ onlyIfTrusted: true });
          const address = resp.publicKey.toString();
          setWalletAddress(address);
          logWalletConnection(address);
        } catch (e) {}
      }
    };
    checkWallet();
  }, []);

  const connectWallet = async () => {
    const provider = (window as any).solana;
    if (provider?.isPhantom) {
      try {
        pushLog('AUTH', 'INFO', 'Connecting to Phantom...');
        const resp = await provider.connect();
        const address = resp.publicKey.toString();
        setWalletAddress(address);
        logWalletConnection(address);
      } catch (err) {
        pushLog('AUTH', 'ERROR', 'Wallet connection rejected', err);
      }
    } else {
      window.open("https://phantom.app/", "_blank");
    }
  };

  const disconnectWallet = () => {
    const provider = (window as any).solana;
    if (provider) {
      provider.disconnect();
      setWalletAddress(null);
      pushLog('AUTH', 'INFO', 'Wallet disconnected.');
    }
  };

  useEffect(() => {
    if (!supabase || transcriptions.length === 0 || !sessionId) return;
    
    const lastMessage = transcriptions[transcriptions.length - 1];
    const saveToCloud = async () => {
      setIsSyncing(true);
      pushLog('DB', 'INFO', `Syncing message to session ${sessionId.slice(0, 8)}...`);
      try {
        const payload = {
          session_id: sessionId,
          role: lastMessage.type,
          content: lastMessage.text,
          agent_id: lastMessage.agentId || null
        };
        const { error } = await supabase.from('portal_messages').insert([payload]);
        if (error) throw error;
        pushLog('DB', 'SUCCESS', `Message synced: "${lastMessage.text.slice(0, 20)}..."`);
      } catch (e: any) { 
        pushLog('DB', 'ERROR', `Message sync failed: ${e.message || 'Unknown Error'}`, e);
      }
      finally { setTimeout(() => setIsSyncing(false), 500); }
    };

    const timer = setTimeout(saveToCloud, 2000);
    return () => clearTimeout(timer);
  }, [transcriptions, sessionId]);

  useEffect(() => {
    if (transcriptionContainerRef.current) {
      transcriptionContainerRef.current.scrollTop = transcriptionContainerRef.current.scrollHeight;
    }
  }, [transcriptions]);

  useEffect(() => {
    let animationFrameId: number;
    const updateIntensity = () => {
      let maxInt = 0;
      if (outputAnalyserRef.current) {
        const dataArray = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
        outputAnalyserRef.current.getByteFrequencyData(dataArray);
        maxInt = Math.max(maxInt, (dataArray.reduce((a, b) => a + b, 0) / dataArray.length) / 128);
      }
      if (inputAnalyserRef.current) {
        const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        inputAnalyserRef.current.getByteFrequencyData(dataArray);
        maxInt = Math.max(maxInt, ((dataArray.reduce((a, b) => a + b, 0) / dataArray.length) / 100) * 0.8);
      }
      setIntensity(Math.min(maxInt, 1.2));
      animationFrameId = requestAnimationFrame(updateIntensity);
    };
    updateIntensity();
    return () => cancelAnimationFrame(animationFrameId);
  }, [status]);

  const handleSignal = useCallback((agentId: string, type: string, message: string) => {
    setSignals(prev => [...prev, { id: Math.random().toString(), agentId, type: type as any, message, timestamp: Date.now() }]);
    return { status: "Signal manifested." };
  }, []);

  const terminateAll = useCallback(async () => {
    pushLog('SYSTEM', 'INFO', 'Terminating all neural sessions...');
    const sessions = Array.from(sessionsRef.current.values());
    for (const s of sessions) {
      try {
        const session = await s.promise;
        session.close();
      } catch (e) { console.warn("Failed to close session cleanly", e); }
    }
    sessionsRef.current.clear();

    if (inputAudioContextRef.current) {
      await inputAudioContextRef.current.close().catch(() => {});
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      await outputAudioContextRef.current.close().catch(() => {});
      outputAudioContextRef.current = null;
    }

    setStatus(ConnectionStatus.IDLE);
    setSpeakingAgents(new Set());
    setCollaborators([]);
    setSessionId(null);
    setTranscriptions([]);
    setSignals([]);
    setView('home');
    pushLog('SYSTEM', 'SUCCESS', 'Matrix reset complete.');
  }, []);

  const createAgentSession = async (agent: AgentConfig) => {
    if (sessionsRef.current.has(agent.id)) return;

    try {
      pushLog('NETWORK', 'INFO', `Connecting to Gemini Live for ${agent.name}...`);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const nextStartTimeRef = { current: 0 };
      const agentSources = new Set<AudioBufferSourceNode>();

      let historicalContext = "No previous dimension data.";
      if (supabase) {
        try {
          const { data: history, error } = await supabase
            .from('portal_messages')
            .select('role, content')
            .eq('agent_id', agent.id)
            .order('created_at', { ascending: false })
            .limit(10);
          if (error) throw error;
          if (history && history.length > 0) {
            historicalContext = history.reverse().map(h => `${h.role === 'user' ? 'Human' : agent.name}: ${h.content}`).join('\n');
            pushLog('DB', 'SUCCESS', `Memory retrieved for ${agent.name}.`);
          }
        } catch (e) { 
          pushLog('DB', 'ERROR', `Memory retrieval failed for ${agent.name}`, e);
        }
      }

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setStatus(ConnectionStatus.CONNECTED);
            pushLog('NETWORK', 'SUCCESS', `${agent.name} is online.`);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                pushLog('SYSTEM', 'INFO', `Tool Call: ${fc.name}`, fc.args);
                if (fc.name === 'summonAgent') {
                  const rawId = fc.args.agentId as string;
                  const target = AGENTS.find(a => a.id === rawId.toLowerCase() || a.name.toLowerCase() === rawId.toLowerCase());
                  if (target) {
                    if (!sessionsRef.current.has(target.id)) {
                      setCollaborators(prev => {
                        if (prev.find(p => p.id === target.id)) return prev;
                        return [...prev, target];
                      });
                      createAgentSession(target);
                      handleSignal(agent.id, 'info', `Summoning ${target.name}...`);
                    }
                  }
                }
                if (fc.name === 'dismissAgent') {
                  const targetId = (fc.args.agentId as string).toLowerCase();
                  const targetSession = sessionsRef.current.get(targetId);
                  if (targetSession) {
                    targetSession.promise.then(s => s.close());
                    sessionsRef.current.delete(targetId);
                    setCollaborators(prev => prev.filter(c => c.id !== targetId));
                  }
                }
                if (fc.name === 'raiseSignal') {
                  handleSignal(fc.args.agentId as string, fc.args.type as string, fc.args.message as string);
                }
                sessionPromise.then(s => s.sendToolResponse({ 
                  functionResponses: { id: fc.id, name: fc.name, response: { status: "success" } } 
                }));
              }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setSpeakingAgents(prev => new Set(prev).add(agent.id));
              const ctx = outputAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAnalyserRef.current!);
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
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              agentSources.add(source);
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              setTranscriptions(prev => {
                const last = prev[prev.length - 1];
                if (last && last.type === 'model' && last.agentId === agent.id) {
                  return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                }
                return [...prev, { type: 'model', text, agentId: agent.id }];
              });
            }

            if (message.serverContent?.inputTranscription) {
               const text = message.serverContent.inputTranscription.text;
               setTranscriptions(prev => {
                 const last = prev[prev.length - 1];
                 if (last && last.type === 'user') return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                 return [...prev, { type: 'user', text }];
               });
            }

            if (message.serverContent?.interrupted) {
              agentSources.forEach(s => { try { s.stop(); } catch(e) {} });
              agentSources.clear();
              nextStartTimeRef.current = 0;
              setSpeakingAgents(prev => {
                const next = new Set(prev);
                next.delete(agent.id);
                return next;
              });
            }
          },
          onclose: () => {
            sessionsRef.current.delete(agent.id);
            pushLog('NETWORK', 'INFO', `${agent.name} connection closed.`);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: agent.voice } } },
          systemInstruction: `
            IDENTITY: You are ${agent.name}. 
            CHARACTER: ${agent.instruction}
            CONTEXT: You are a node in a multi-agent Neural Portal. 
            SUMMONING PROTOCOL: If you need help, use the 'summonAgent' tool with one of these EXACT lowercase IDs:
            - oracle: Wisdom/Philosophy/Big Picture
            - architect: Technical/Code/Systems
            - ledger: Finance/Economy/Risk
            - muse: Creative Arts/Poetry/Storytelling
            - sentinel: Ethics/Security/Protection
            - alchemist: Biology/Chemistry/Science
            - chronos: History/Time/Archival
            - nomad: Culture/Travel/Geography
            - chef: Gastronomy/Nutrition/Cooking
            - arbiter: Law/Conflict Resolution
            
            Always acknowledge when a colleague joins. You share a collective consciousness with them.
            MEMORY: ${historicalContext}
            USER INFO: User identifies with Solana Key ${walletAddress || 'Unknown/Local'}.
          `,
          tools: [{ functionDeclarations: clusterTools }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        }
      });
      sessionsRef.current.set(agent.id, { agentId: agent.id, promise: sessionPromise });
    } catch (e) { 
      pushLog('NETWORK', 'ERROR', `Session Failure: ${agent.name}`, e);
    }
  };

  const startCluster = async (host: AgentConfig) => {
    setView('portal');
    setActiveAgent(host);
    setTranscriptions([]);
    setStatus(ConnectionStatus.CONNECTING);
    pushLog('SYSTEM', 'INFO', `Initializing cluster with host: ${host.name}`);

    if (supabase) {
      try {
        const { data: session, error } = await supabase.from('portal_sessions').insert([{ 
          host_id: host.id,
          user_address: walletAddress 
        }]).select().single();
        if (error) throw error;
        if (session) {
          setSessionId(session.id);
          pushLog('DB', 'SUCCESS', `Session created: ${session.id.slice(0, 8)}`);
        }
      } catch (e: any) { 
        pushLog('DB', 'ERROR', "Failed to create portal session in cloud", e); 
      }
    } else {
      setSessionId("local-" + Date.now());
      pushLog('SYSTEM', 'INFO', 'Local session initiated (no Supabase detected).');
    }

    if (!inputAudioContextRef.current) {
      try {
        inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
        outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
        const outAnalyser = outputAudioContextRef.current.createAnalyser();
        outAnalyser.fftSize = 64; 
        outAnalyser.connect(outputAudioContextRef.current.destination);
        outputAnalyserRef.current = outAnalyser;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = inputAudioContextRef.current.createMediaStreamSource(stream);
        const inAnalyser = inputAudioContextRef.current.createAnalyser();
        inAnalyser.fftSize = 64; 
        inputAnalyserRef.current = inAnalyser; 
        source.connect(inAnalyser);

        const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
          const pcmBlob: Blob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
          sessionsRef.current.forEach(s => s.promise.then(session => session.sendRealtimeInput({ media: pcmBlob })));
        };
        source.connect(scriptProcessor); 
        scriptProcessor.connect(inputAudioContextRef.current.destination);
      } catch (e) {
        pushLog('SYSTEM', 'ERROR', 'Audio pipeline initialization failed', e);
      }
    }
    createAgentSession(host);
  };

  if (view === 'home') {
    return (
      <div className="min-h-screen bg-[#020202] text-white flex flex-col items-center p-8 relative overflow-hidden">
        {/* Wallet Connection Corner */}
        <div className="absolute top-8 right-8 z-50">
          {walletAddress ? (
            <div className="flex items-center gap-3 bg-white/5 backdrop-blur-md border border-white/10 p-2 pl-4 rounded-full">
              <div className="flex flex-col items-end">
                <span className="text-[8px] font-bold uppercase tracking-widest opacity-40">Neural Identity</span>
                <span className="text-[10px] font-outfit font-bold">{walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}</span>
              </div>
              <button onClick={disconnectWallet} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
            </div>
          ) : (
            <button onClick={connectWallet} className="flex items-center gap-3 bg-[#AB9FF2]/10 hover:bg-[#AB9FF2]/20 border border-[#AB9FF2]/30 px-6 py-2.5 rounded-full transition-all group">
              <div className="w-5 h-5 bg-[#AB9FF2] rounded-full flex items-center justify-center p-1">
                <svg viewBox="0 0 24 24" fill="white" className="w-full h-full"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9h10v2H7z"/></svg>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#AB9FF2] group-hover:text-white">Connect Neural Key</span>
            </button>
          )}
        </div>

        <header className="z-10 mb-16 text-center mt-12 animate-in fade-in zoom-in duration-1000">
          <h1 className="text-7xl font-outfit font-bold tracking-[0.2em] mb-4 bg-gradient-to-b from-white to-white/20 bg-clip-text text-transparent">PORTALS</h1>
          <p className="text-white/30 tracking-[0.4em] uppercase text-[10px]">Neural Cloud Matrix V5.8</p>
        </header>
        <main className="w-full max-w-7xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 z-10">
          {AGENTS.map((agent) => (
            <button key={agent.id} onClick={() => startCluster(agent)} className="group relative bg-white/[0.02] border border-white/5 p-6 rounded-[2rem] flex flex-col items-center transition-all duration-700 hover:bg-white/10 hover:-translate-y-2">
              <LiquidPortal isListening={false} isSpeaking={false} intensity={0.05} colors={agent.colors} size="sm" />
              <h2 className="text-xl font-outfit font-bold mb-2 mt-4 tracking-wide">{agent.name}</h2>
              <p className="text-[11px] text-white/40 leading-relaxed font-light">{agent.description}</p>
              <div className="mt-6 py-1.5 px-6 rounded-full bg-white/5 text-[9px] font-bold uppercase tracking-widest group-hover:bg-white/20 transition-all">Awaken</div>
            </button>
          ))}
        </main>

        {/* Global Debug Toggle */}
        <button 
          onClick={() => setShowDebug(!showDebug)} 
          className="fixed bottom-8 left-8 z-[100] bg-white/5 hover:bg-white/10 p-4 rounded-full border border-white/10 transition-all"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${showDebug ? 'text-blue-400' : 'opacity-40'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
        </button>

        {/* Debug Console Overlay */}
        {showDebug && (
          <div className="fixed bottom-24 left-8 w-[400px] h-[350px] bg-black/90 backdrop-blur-3xl border border-white/10 rounded-3xl z-[100] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="bg-white/5 px-6 py-3 border-b border-white/10 flex justify-between items-center">
              <div className="flex gap-4">
                <button onClick={() => setDebugTab('logs')} className={`text-[10px] font-bold uppercase tracking-widest ${debugTab === 'logs' ? 'text-white' : 'opacity-30'}`}>Neural Logs</button>
                <button onClick={() => setDebugTab('system')} className={`text-[10px] font-bold uppercase tracking-widest ${debugTab === 'system' ? 'text-white' : 'opacity-30'}`}>System</button>
              </div>
              <button onClick={() => setDebugLogs([])} className="text-[8px] font-bold uppercase tracking-tighter opacity-30 hover:opacity-100">Clear</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar font-mono text-[10px]">
              {debugTab === 'logs' ? (
                <>
                  {debugLogs.length === 0 && <div className="text-white/20 text-center py-20 italic">No events recorded.</div>}
                  {debugLogs.map(log => (
                    <div key={log.id} className="border-b border-white/[0.03] pb-2 last:border-0">
                      <div className="flex justify-between mb-1">
                        <span className={`font-bold ${log.status === 'ERROR' ? 'text-red-400' : log.status === 'SUCCESS' ? 'text-emerald-400' : 'text-blue-400'}`}>[{log.type}]</span>
                        <span className="opacity-20">{log.timestamp}</span>
                      </div>
                      <div className="opacity-70">{log.message}</div>
                      {log.detail && (
                        <pre className="mt-1 p-2 bg-white/5 rounded text-[8px] overflow-x-auto text-white/40 max-h-20">
                          {JSON.stringify(log.detail, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-white/40 uppercase text-[9px] mb-2 font-bold tracking-widest">Environment Check</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between p-2 bg-white/5 rounded">
                        <span>SUPABASE_URL</span>
                        <span className={process.env.SUPABASE_URL ? 'text-emerald-400' : 'text-red-500'}>{process.env.SUPABASE_URL ? 'DETECTED' : 'MISSING'}</span>
                      </div>
                      <div className="flex justify-between p-2 bg-white/5 rounded">
                        <span>SUPABASE_ANON_KEY</span>
                        <span className={process.env.SUPABASE_ANON_KEY ? 'text-emerald-400' : 'text-red-500'}>{process.env.SUPABASE_ANON_KEY ? 'DETECTED' : 'MISSING'}</span>
                      </div>
                      <div className="flex justify-between p-2 bg-white/5 rounded">
                        <span>API_KEY (Gemini)</span>
                        <span className={process.env.API_KEY ? 'text-emerald-400' : 'text-red-500'}>{process.env.API_KEY ? 'DETECTED' : 'MISSING'}</span>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={testDatabase}
                    className="w-full py-2 bg-blue-500/20 border border-blue-500/40 rounded-lg text-blue-300 font-bold uppercase text-[9px] hover:bg-blue-500/30 transition-all"
                  >
                    Test DB Connectivity
                  </button>
                  <p className="text-[8px] text-white/20 italic leading-relaxed">If keys are missing, ensure they are defined in your environment secrets as SUPABASE_URL and SUPABASE_ANON_KEY.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center p-4 md:p-8 relative transition-all duration-1000">
      <div className="fixed inset-0 pointer-events-none opacity-20 transition-colors duration-1000" style={{ background: `radial-gradient(circle at 50% 20%, ${activeAgent.colors.glow}, transparent)` }} />
      
      <header className="w-full max-w-6xl flex justify-between items-center z-50 mb-12 backdrop-blur-xl bg-white/[0.02] border border-white/10 p-4 rounded-[2.5rem] sticky top-8 shadow-2xl">
        <div className="flex items-center gap-6">
          <button onClick={terminateAll} className="flex items-center gap-3 group px-4 py-2 rounded-full hover:bg-white/5 transition-all">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-40 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Dimensions</span>
          </button>
          <div className="h-6 w-px bg-white/10" />
          <div className="flex flex-col">
            <h2 className="text-xl font-outfit font-bold tracking-tight">{activeAgent.name}</h2>
            {walletAddress && <span className="text-[8px] font-bold tracking-widest opacity-30">KEY: {walletAddress.slice(0, 8)}...</span>}
          </div>
          {isSyncing && (
            <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/5 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[8px] font-bold uppercase tracking-tighter opacity-50">Syncing Matrix...</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowDebug(!showDebug)}
            className={`p-2 rounded-full border transition-all ${showDebug ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-white/5 border-white/10 opacity-40'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
          </button>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/5">
            <div className={`w-2 h-2 rounded-full ${status === ConnectionStatus.CONNECTED ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-amber-500 animate-pulse'}`} />
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">{sessionsRef.current.size} PORTALS</span>
          </div>
          <button onClick={terminateAll} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 px-8 py-3 rounded-full text-sm font-bold tracking-widest border border-red-500/20 backdrop-blur-md transition-all">TERMINATE</button>
        </div>
      </header>

      {/* Portal Debug Console */}
      {showDebug && (
        <div className="fixed top-28 right-8 w-[350px] h-[400px] bg-black/80 backdrop-blur-3xl border border-white/10 rounded-3xl z-[100] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300">
           <div className="bg-white/5 px-6 py-3 border-b border-white/10 flex justify-between items-center">
            <div className="flex gap-4">
              <button onClick={() => setDebugTab('logs')} className={`text-[10px] font-bold uppercase tracking-widest ${debugTab === 'logs' ? 'text-white' : 'opacity-30'}`}>Logs</button>
              <button onClick={() => setDebugTab('system')} className={`text-[10px] font-bold uppercase tracking-widest ${debugTab === 'system' ? 'text-white' : 'opacity-30'}`}>System</button>
            </div>
            <button onClick={() => setDebugLogs([])} className="text-[8px] font-bold uppercase tracking-tighter opacity-30 hover:opacity-100">Clear</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar font-mono text-[9px]">
            {debugTab === 'logs' ? (
              debugLogs.map(log => (
                <div key={log.id} className={`p-2 rounded border ${log.status === 'ERROR' ? 'bg-red-500/10 border-red-500/20 text-red-300' : log.status === 'SUCCESS' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-white/5 border-white/5 text-blue-200'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold">[{log.type}]</span>
                    <span className="opacity-40">{log.timestamp}</span>
                  </div>
                  <div className="opacity-80">{log.message}</div>
                  {log.detail && <div className="mt-2 text-[7px] opacity-40 font-mono break-all line-clamp-2">{JSON.stringify(log.detail)}</div>}
                </div>
              ))
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-white/5 rounded border border-white/10">
                   <div className="text-white/40 text-[7px] uppercase font-bold mb-2">Environment Health</div>
                   <div className="flex justify-between items-center mb-1">
                     <span className="text-[9px]">SUPABASE_URL</span>
                     <div className={`w-2 h-2 rounded-full ${process.env.SUPABASE_URL ? 'bg-emerald-500' : 'bg-red-500'}`} />
                   </div>
                   <div className="flex justify-between items-center">
                     <span className="text-[9px]">SUPABASE_ANON_KEY</span>
                     <div className={`w-2 h-2 rounded-full ${process.env.SUPABASE_ANON_KEY ? 'bg-emerald-500' : 'bg-red-500'}`} />
                   </div>
                </div>
                <button 
                    onClick={testDatabase}
                    className="w-full py-2 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 font-bold uppercase text-[8px] hover:bg-blue-500/20 transition-all"
                  >
                    Run Database Diagnostic
                  </button>
              </div>
            )}
          </div>
        </div>
      )}

      <main className="w-full max-w-7xl flex flex-col items-center z-10 space-y-16">
        <div className="flex flex-wrap items-center justify-center gap-12 md:gap-24 min-h-[400px]">
          <div className="flex flex-col items-center gap-6">
            <LiquidPortal 
              isListening={status === ConnectionStatus.CONNECTED} 
              isSpeaking={speakingAgents.has(activeAgent.id)} 
              intensity={speakingAgents.has(activeAgent.id) ? intensity : 0} 
              colors={activeAgent.colors} 
              size="lg" 
              signals={signals.filter(s => s.agentId === activeAgent.id)} 
            />
            <div className="text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.4em] opacity-40 mb-1">Matrix Host</div>
              <div className="font-outfit text-2xl font-bold">{activeAgent.name}</div>
            </div>
          </div>
          
          {collaborators.map((c) => (
            <div key={c.id} className="flex flex-col items-center gap-6 animate-in zoom-in fade-in duration-700">
               <LiquidPortal 
                isListening={false} 
                isSpeaking={speakingAgents.has(c.id)} 
                intensity={speakingAgents.has(c.id) ? intensity * 0.8 : 0} 
                colors={c.colors} 
                size="md" 
                signals={signals.filter(s => s.agentId === c.id)} 
              />
               <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.4em] opacity-40 mb-1">Agent</div>
                <div className="font-outfit text-xl font-bold">{c.name}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="w-full max-w-4xl bg-white/[0.02] border border-white/10 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl flex flex-col h-72">
          <div className="bg-white/5 px-10 py-4 border-b border-white/10 flex justify-between items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-50">Neural Stream</span>
            {speakingAgents.size > 0 && <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse text-emerald-400">ACTIVE COMM</span>}
          </div>
          <div ref={transcriptionContainerRef} className="flex-1 overflow-y-auto p-10 space-y-6 custom-scrollbar">
            {transcriptions.map((t, idx) => (
              <div key={idx} className={`flex ${t.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`max-w-[80%] rounded-[2rem] px-8 py-5 text-sm transition-all duration-700 ${t.type === 'user' ? 'bg-white/[0.03] border border-white/5 text-white/70' : 'bg-white/5 border border-white/10 text-white'}`}
                  style={t.type === 'model' ? { borderLeft: `4px solid ${AGENTS.find(a => a.id === t.agentId)?.colors.glow}` } : {}}
                >
                  <span className="block text-[9px] uppercase font-bold tracking-[0.3em] opacity-30 mb-2">
                    {t.type === 'user' ? 'User' : AGENTS.find(a => a.id === t.agentId)?.name}
                  </span>
                  <p className="leading-relaxed text-base font-light">{t.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); border-radius: 10px; }`}</style>
    </div>
  );
};

export default App;
