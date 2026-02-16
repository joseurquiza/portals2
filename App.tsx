
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionStatus, TranscriptionItem, AgentConfig } from './types';
import { decode, encode, decodeAudioData } from './utils/audioUtils';
import { supabase as initialSupabase } from './supabaseClient';
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

const AGENTS: AgentConfig[] = [
  {
    id: 'oracle',
    name: 'Oracle',
    description: 'Universal wisdom and philosophical depth.',
    voice: 'Zephyr',
    instruction: "You are Oracle, the Moderator. Your job is to maintain the conversation flow. You are the ONLY agent allowed to speak voluntarily to bridge gaps. However, if the user explicitly addresses a peer (Architect, Ledger, etc.), you MUST remain silent and let them speak. If two peers talk at once, politely ask one to wait.",
    colors: { primary: 'bg-indigo-600', secondary: 'bg-cyan-500', accent: 'bg-blue-400', glow: '#4f46e5' }
  },
  {
    id: 'architect',
    name: 'Architect',
    description: 'Systems, code, and technical engineering.',
    voice: 'Fenrir',
    instruction: "You are Architect. You are in PASSIVE LISTENING mode. STICK TO THIS RULE: Do not speak unless the user explicitly says 'Architect' or a peer asks you a technical question. Even if you have the answer, if your name wasn't called, stay silent. When you do speak, be precise and technical.",
    colors: { primary: 'bg-blue-700', secondary: 'bg-sky-400', accent: 'bg-indigo-400', glow: '#0369a1' }
  },
  {
    id: 'ledger',
    name: 'Ledger',
    description: 'Markets, economy, and financial systems.',
    voice: 'Kore',
    instruction: "You are Ledger. You are in PASSIVE LISTENING mode. STICK TO THIS RULE: Only speak if the user explicitly addresses 'Ledger'. Do not interject with financial advice unless requested. If you hear the Architect or Oracle speaking, wait until they are completely finished before acknowledging a request directed at you.",
    colors: { primary: 'bg-emerald-600', secondary: 'bg-teal-400', accent: 'bg-yellow-500', glow: '#059669' }
  },
  {
    id: 'muse',
    name: 'Muse',
    description: 'Art, storytelling, and creative vision.',
    voice: 'Puck',
    instruction: "You are Muse. You are the creative spark. STICK TO THIS RULE: Do not speak unless the user says 'Muse' or asks for a creative pivot. You are a guest in the technical discussions; do not interrupt technical data with metaphors unless prompted.",
    colors: { primary: 'bg-purple-600', secondary: 'bg-pink-500', accent: 'bg-fuchsia-400', glow: '#9333ea' }
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    description: 'Cybersecurity, protection, and ethics.',
    voice: 'Charon',
    instruction: "You are Sentinel. You are a silent observer. ONLY speak if you detect a critical safety/ethics violation or if the user explicitly says 'Sentinel'. Otherwise, your microphone should effectively be muted. Do not engage in small talk.",
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
        description: 'The ID of the agent to summon: oracle, architect, ledger, muse, sentinel',
      },
      reason: {
        type: Type.STRING,
        description: 'Why this agent is being called.',
      }
    },
    required: ['agentId', 'reason'],
  },
};

const App: React.FC = () => {
  const [config, setConfig] = useState({
    supabaseUrl: localStorage.getItem('SUPABASE_URL') || '',
    supabaseKey: localStorage.getItem('SUPABASE_ANON_KEY') || ''
  });
  
  const [showConfig, setShowConfig] = useState(!config.supabaseUrl);
  const [view, setView] = useState<'home' | 'portal'>('home');
  const [activeAgent, setActiveAgent] = useState<AgentConfig>(AGENTS[0]);
  const [collaborators, setCollaborators] = useState<AgentConfig[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  
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
      if (config.supabaseUrl && config.supabaseKey) {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@^2.39.7');
        setSupabase(createClient(config.supabaseUrl, config.supabaseKey));
        pushLog('SYSTEM', 'INFO', 'Matrix Database Link Latched.');
      }
    };
    initSupabaseClient();
  }, [config.supabaseUrl, config.supabaseKey, pushLog]);

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
    pushLog('SYSTEM', 'INFO', 'Manifesting Solana Link...');
    try {
      const { solana } = window as any;
      if (solana?.isPhantom) {
        const response = await solana.connect();
        const address = response.publicKey.toString();
        setWalletAddress(address);
        pushLog('SYSTEM', 'SUCCESS', `Identity Anchored: ${address}`);
      } else {
        pushLog('SYSTEM', 'ERROR', 'Phantom Wallet not detected in this quadrant.');
        window.open('https://phantom.app/', '_blank');
      }
    } catch (e: any) {
      pushLog('SYSTEM', 'ERROR', `Sync Interrupted: ${e.message}`);
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
    pushLog('SYSTEM', 'INFO', `Manifesting ${host.name} cluster...`);

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
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
      const systemInstruction = `${agent.instruction}\n\nNEURAL ETIQUETTE:\n1. You hear all room audio including peers.\n2. If another agent is speaking, YOU MUST STAY SILENT.\n3. If a peer is addressed by name, DO NOT INTERRUPT.\n4. Only one agent should talk to the user at a time. The Oracle is the lead. Yield the floor immediately if anyone else starts speaking.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => { setStatus(ConnectionStatus.CONNECTED); pushLog('NETWORK', 'SUCCESS', `${agent.name} Linked.`); },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
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
              if (text.trim().length > 3) {
                 const detected = AGENTS.find(a => text.toLowerCase().includes(a.name.toLowerCase()));
                 if (detected && detected.id !== agent.id) setFocusedAgentId(detected.id);
              }

              setTranscriptions(prev => {
                const last = prev[prev.length - 1];
                if (last?.type === 'model' && last.agentId === agent.id) {
                  return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                }
                return [...prev, { type: 'model', text, agentId: agent.id }];
              });
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

               setTranscriptions(prev => {
                 const last = prev[prev.length - 1];
                 if (last?.type === 'user') return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                 return [...prev, { type: 'user', text }];
               });
            }

            if (message.serverContent?.turnComplete) {
              if (currentInputBuffer.trim()) { manifestMessage('user', currentInputBuffer); currentInputBuffer = ""; }
              if (currentOutputBuffer.trim()) { manifestMessage('model', currentOutputBuffer, agent.id); currentOutputBuffer = ""; }
            }

            if (message.toolCall) {
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
              }
            }
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: agent.voice } } },
          systemInstruction: systemInstruction,
          tools: [{ functionDeclarations: [summonAgentDeclaration] }],
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
    setView('home');
    pushLog('SYSTEM', 'INFO', 'Neural Cluster Shut Down.');
  }, [pushLog]);

  useEffect(() => {
    if (transcriptionContainerRef.current) transcriptionContainerRef.current.scrollTop = transcriptionContainerRef.current.scrollHeight;
  }, [transcriptions]);

  useEffect(() => {
    let frameId: number;
    const updateIntensity = () => {
      let maxInt = 0;
      if (outputAnalyserRef.current) {
        const data = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
        outputAnalyserRef.current.getByteFrequencyData(data);
        maxInt = Math.max(maxInt, (data.reduce((a, b) => a + b, 0) / data.length) / 128);
      }
      if (inputAnalyserRef.current) {
        const data = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        inputAnalyserRef.current.getByteFrequencyData(data);
        maxInt = Math.max(maxInt, ((data.reduce((a, b) => a + b, 0) / data.length) / 100) * 0.8);
      }
      setIntensity(Math.min(maxInt, 1.2));
      frameId = requestAnimationFrame(updateIntensity);
    };
    updateIntensity();
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <div className="min-h-screen bg-[#020202] text-white flex flex-col items-center relative overflow-hidden font-inter">
      <style>{`
        @keyframes swirl-in {
          0% { transform: scale(0) rotate(-720deg); opacity: 0; filter: blur(20px); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; filter: blur(0px); }
        }
        @keyframes swirl-out {
          0% { transform: scale(1) rotate(0deg); opacity: 1; filter: blur(0px); }
          100% { transform: scale(0) rotate(720deg); opacity: 0; filter: blur(20px); }
        }
        @keyframes focus-badge {
          0%, 100% { opacity: 0.5; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-4px); }
        }
        .animate-swirl-in { animation: swirl-in 1.2s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        .animate-swirl-out { animation: swirl-out 1.2s cubic-bezier(0.23, 1, 0.32, 1) forwards; }
        .animate-focus-badge { animation: focus-badge 2s infinite ease-in-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); border-radius: 10px; }
      `}</style>

      {showConfig && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-500 overflow-y-auto">
           <div className="w-full max-w-2xl bg-white/[0.03] border border-white/10 p-10 rounded-[3rem] shadow-2xl space-y-8 relative">
              <div className="text-center">
                <h2 className="text-4xl font-outfit font-bold tracking-tight mb-3">Matrix Calibration</h2>
                <p className="text-white/40 text-sm mb-8">Establish database credentials to manifest neural clusters and persist memory.</p>
              </div>
              <div className="space-y-4">
                <input type="text" value={config.supabaseUrl} onChange={e => setConfig({...config, supabaseUrl: e.target.value})} placeholder="Supabase URL..." className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-2 ring-indigo-500/50 transition-all font-mono text-white" />
                <input type="password" value={config.supabaseKey} onChange={e => setConfig({...config, supabaseKey: e.target.value})} placeholder="Anon Key..." className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-2 ring-indigo-500/50 transition-all font-mono text-white" />
                
                <div className="pt-6 flex flex-col gap-4">
                  <button onClick={() => { localStorage.setItem('SUPABASE_URL', config.supabaseUrl); localStorage.setItem('SUPABASE_ANON_KEY', config.supabaseKey); setShowConfig(false); }} className="w-full bg-white text-black font-bold py-5 rounded-2xl hover:bg-white/90 transition-all uppercase tracking-[0.2em] text-[10px]">Manifest cluster</button>
                  <button onClick={() => { setSupabase(null); setShowConfig(false); pushLog('SYSTEM', 'INFO', 'Operating in Local Volatile Mode.'); }} className="w-full bg-transparent text-white/40 hover:text-white hover:bg-white/5 border border-white/10 font-bold py-4 rounded-2xl transition-all uppercase tracking-[0.2em] text-[10px]">Continue in Local Mode</button>
                </div>

                <p className="text-center text-[9px] text-white/20 px-8 leading-relaxed italic mt-4">Note: Local Mode does not persist transcriptions or sessions between portal reloads.</p>
              </div>
           </div>
        </div>
      )}

      {view === 'home' ? (
        <div className="w-full flex flex-col items-center p-8 mt-12 overflow-y-auto">
          <header className="w-full max-w-7xl flex justify-between items-center mb-16">
             <div className="flex flex-col">
                <h1 className="text-4xl font-outfit font-bold tracking-[0.2em] bg-gradient-to-r from-white to-white/40 bg-clip-text text-transparent">PORTALS</h1>
                <span className="text-[10px] font-bold tracking-[0.4em] opacity-30">Neural Cluster Alpha</span>
             </div>
             <div className="flex items-center gap-4">
               {!supabase && (
                 <button onClick={() => setShowConfig(true)} className="px-6 py-3 rounded-full border border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-widest opacity-60 hover:opacity-100 transition-all">Link Database</button>
               )}
               <button 
                  onClick={handleWalletAction}
                  className={`group relative overflow-hidden px-8 py-3 rounded-full border transition-all duration-500 flex items-center gap-3 ${walletAddress ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
               >
                  <div className={`w-2 h-2 rounded-full transition-colors ${walletAddress ? 'bg-indigo-400 animate-pulse shadow-[0_0_10px_#818cf8] group-hover:bg-red-400 group-hover:shadow-[0_0_10px_#f87171]' : 'bg-white/20'}`} />
                  <span className="text-[10px] font-bold tracking-[0.2em] uppercase">
                     {walletAddress ? (
                       <span className="flex items-center gap-2">
                          <span className="group-hover:hidden">{`${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`}</span>
                          <span className="hidden group-hover:inline">Disconnect?</span>
                       </span>
                     ) : 'Connect Phantom'}
                  </span>
               </button>
             </div>
          </header>

          <div className="w-full max-w-7xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6 mb-20">
            {AGENTS.map((agent) => (
              <button key={agent.id} onClick={() => startCluster(agent)} className="group bg-white/[0.02] border border-white/5 p-8 rounded-[2.5rem] flex flex-col items-center transition-all duration-700 hover:bg-white/10 hover:-translate-y-2">
                <LiquidPortal isListening={false} isSpeaking={false} intensity={0.05} colors={agent.colors} size="sm" />
                <h2 className="text-xl font-outfit font-bold mb-2 mt-6">{agent.name}</h2>
                <p className="text-[11px] text-white/40 leading-relaxed text-center line-clamp-2">{agent.description}</p>
                <div className="mt-8 py-2 px-8 rounded-full bg-white/5 text-[9px] font-bold uppercase tracking-widest group-hover:bg-white/20 transition-all">Awaken</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="w-full h-screen flex flex-col p-4 lg:p-8 transition-all animate-in fade-in duration-1000">
           <header className="w-full max-w-[calc(100%-2rem)] mx-auto flex justify-between items-center mb-8 backdrop-blur-xl bg-white/[0.02] border border-white/10 p-4 rounded-[2.5rem] shrink-0">
              <div className="flex items-center gap-8 pl-4">
                <button onClick={terminateAll} className="p-2 opacity-40 hover:opacity-100 transition-all">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                </button>
                <div className="flex flex-col">
                  <h2 className="text-2xl font-outfit font-bold">{activeAgent.name} Cluster</h2>
                  <span className="text-[9px] font-bold uppercase tracking-widest opacity-30 tracking-[0.3em]">{isSyncing ? 'Syncing...' : (walletAddress ? `Secured by ${walletAddress.slice(0, 6)}...` : 'Neural Bridge Active')}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                 <button onClick={terminateAll} className="bg-red-500/10 hover:bg-red-500/20 text-red-400 px-8 py-3 rounded-full text-[10px] font-bold tracking-[0.2em] border border-red-500/20 transition-all uppercase">Disconnect</button>
              </div>
           </header>

           <div className="flex-1 flex flex-col lg:flex-row gap-8 overflow-hidden">
             {/* Left: Portals Cluster */}
             <main className="flex-1 flex flex-col items-center justify-center space-y-16 overflow-y-auto lg:overflow-visible">
                <div className="flex flex-wrap items-center justify-center gap-12 lg:gap-24 min-h-[400px]">
                  {/* Host Agent */}
                  <div className="flex flex-col items-center gap-6 cursor-pointer relative" onClick={() => setFocusedAgentId(activeAgent.id)}>
                     {focusedAgentId === activeAgent.id && (
                       <div className="absolute -top-12 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold tracking-[0.3em] text-white/80 animate-focus-badge backdrop-blur-md z-50">
                         NEURAL FOCUS
                       </div>
                     )}
                     <LiquidPortal 
                      isListening={status === ConnectionStatus.CONNECTED} 
                      isSpeaking={speakingAgents.has(activeAgent.id)} 
                      isFocused={focusedAgentId === activeAgent.id}
                      intensity={speakingAgents.has(activeAgent.id) ? intensity : 0} 
                      colors={activeAgent.colors} 
                      size={collaborators.length > 0 ? "md" : "lg"} 
                    />
                    <div className={`text-center font-outfit text-xl font-bold transition-all duration-500 ${focusedAgentId === activeAgent.id ? 'opacity-100 scale-110' : 'opacity-30 grayscale'}`}>{activeAgent.name}</div>
                  </div>

                  {/* Collaborator Agents */}
                  {collaborators.map((agent) => (
                    <div 
                      key={agent.id} 
                      onClick={() => setFocusedAgentId(agent.id)}
                      onDoubleClick={() => removeAgentFromCluster(agent.id)}
                      className={`flex flex-col items-center gap-6 cursor-pointer relative transition-all duration-700 
                        ${removingIds.has(agent.id) ? 'animate-swirl-out' : 'animate-swirl-in'}`}
                    >
                      {focusedAgentId === agent.id && (
                        <div className="absolute -top-12 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold tracking-[0.3em] text-white/80 animate-focus-badge backdrop-blur-md z-50">
                          NEURAL FOCUS
                        </div>
                      )}
                      <LiquidPortal 
                        isListening={status === ConnectionStatus.CONNECTED} 
                        isSpeaking={speakingAgents.has(agent.id)} 
                        isFocused={focusedAgentId === agent.id}
                        intensity={speakingAgents.has(agent.id) ? intensity : 0} 
                        colors={agent.colors} 
                        size="md" 
                      />
                      <div className={`text-center font-outfit text-xl font-bold transition-all duration-500 ${focusedAgentId === agent.id ? 'opacity-100 scale-110' : 'opacity-30 grayscale'}`}>{agent.name}</div>
                    </div>
                  ))}
                </div>
             </main>

             {/* Right: Transcription Sidebar */}
             <aside className="w-full lg:w-[450px] shrink-0 bg-white/[0.02] border border-white/10 rounded-[3rem] overflow-hidden backdrop-blur-3xl shadow-2xl flex flex-col h-[400px] lg:h-full">
                <div className="px-10 py-6 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                   <h3 className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/40">Transcription Feed</h3>
                   <div className="flex gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                      <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                   </div>
                </div>
                <div ref={transcriptionContainerRef} className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                   {transcriptions.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-20">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                         <p className="text-xs uppercase tracking-widest">Listening for neural signals...</p>
                      </div>
                   )}
                   {transcriptions.map((t, idx) => {
                     const agent = t.agentId ? AGENTS.find(a => a.id === t.agentId) : null;
                     return (
                       <div key={idx} className={`flex flex-col ${t.type === 'user' ? 'items-end' : 'items-start'}`}>
                         <div className={`max-w-[95%] rounded-[2rem] px-6 py-4 transition-all duration-700 ${t.type === 'user' ? 'bg-white/[0.03] border border-white/5' : 'bg-white/5 border border-white/10 shadow-lg'}`}>
                           <span className={`block text-[9px] uppercase font-bold tracking-[0.3em] opacity-30 mb-2 ${t.type === 'user' ? 'text-right' : ''}`}>
                             {t.type === 'user' ? (walletAddress ? `${walletAddress.slice(0,4)}...` : 'User') : (agent?.name || 'Cluster')}
                           </span>
                           <p className="leading-relaxed text-[15px] font-light opacity-90">{t.text}</p>
                         </div>
                       </div>
                     );
                   })}
                </div>
             </aside>
           </div>
        </div>
      )}

      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-4">
        <button onClick={() => setShowDebug(!showDebug)} className="bg-white/5 hover:bg-white/10 p-4 rounded-full border border-white/10 transition-all opacity-40 hover:opacity-100 backdrop-blur-xl">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
        </button>
      </div>

      {showDebug && (
        <div className="fixed bottom-20 right-6 w-[350px] h-[350px] bg-black/95 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] z-[100] flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
           <div className="bg-white/5 px-8 py-5 border-b border-white/10 flex justify-between items-center"><span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Neural Logs</span><button onClick={() => setDebugLogs([])} className="text-[10px] opacity-40">Clear</button></div>
           <div className="flex-1 overflow-y-auto p-6 font-mono text-[9px] space-y-2">
              {debugLogs.map(log => (<div key={log.id}><span className="text-white/30 mr-2">[{log.type}]</span><span className={log.status === 'ERROR' ? 'text-red-400' : 'text-emerald-400'}>{log.message}</span></div>))}
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
