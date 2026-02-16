'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, Type, FunctionDeclaration } from '@google/genai';
import { ConnectionStatus, TranscriptionItem, AgentConfig, RoundtableSession, RoundtableResearch, RoundtableDiscussion, PersonalityPreset, AgentPersonality } from '../types';
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
    supabaseUrl: typeof window !== 'undefined' ? localStorage.getItem('SUPABASE_URL') || '' : '',
    supabaseKey: typeof window !== 'undefined' ? localStorage.getItem('SUPABASE_ANON_KEY') || '' : ''
  });
  
  const [showConfig, setShowConfig] = useState(!config.supabaseUrl);
  const [view, setView] = useState<'home' | 'portal' | 'roundtable'>('home');
  const [activeAgent, setActiveAgent] = useState<AgentConfig>(AGENTS[0]);
  const [collaborators, setCollaborators] = useState<AgentConfig[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  
  const [roundtableSession, setRoundtableSession] = useState<RoundtableSession | null>(null);
  const [showRoundtableInput, setShowRoundtableInput] = useState(false);
  
  const [agentPersonalities, setAgentPersonalities] = useState<AgentPersonality[]>(
    AGENTS.map(agent => ({ agentId: agent.id, presetId: 'default', customTraits: '' }))
  );
  const [showPersonalityEditor, setShowPersonalityEditor] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  
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
        const { createClient } = await import('@supabase/supabase-js');
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
  
  const systemInstruction = `${agent.instruction}${personalityTraits ? `\n\nPERSONALITY: ${personalityTraits}` : ''}\n\nNEURAL ETIQUETTE:\n1. You hear all room audio including peers.\n2. If another agent is speaking, YOU MUST STAY SILENT.\n3. If a peer is addressed by name, DO NOT INTERRUPT.\n4. Only one agent should talk to the user at a time. The Oracle is the lead. Yield the floor immediately if anyone else starts speaking.`;

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
    setRoundtableSession(null);
    setView('home');
    pushLog('SYSTEM', 'INFO', 'Neural Cluster Shut Down.');
  }, [pushLog]);

  const startRoundtable = async (topic: string) => {
    if (!topic.trim()) return;
    
    setView('roundtable');
    setShowRoundtableInput(false);
    pushLog('SYSTEM', 'INFO', `Starting Roundtable: ${topic}`);
    
    const newSession: RoundtableSession = {
      topic,
      research: AGENTS.map(agent => ({
        agentId: agent.id,
        findings: '',
        timestamp: Date.now(),
        status: 'researching'
      })),
      discussions: [],
      summary: null,
      status: 'researching',
      startTime: Date.now()
    };
    
    setRoundtableSession(newSession);
    setStatus(ConnectionStatus.CONNECTING);
    
    // Initialize audio context if needed
    if (!audioCtxRef.current) {
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      const masterOut = ctx.createGain();
      masterOut.connect(ctx.destination);
      masterOutputRef.current = masterOut;
    }
    
    // Conduct research phase
    await conductResearch(topic);
  };

  const conductResearch = async (topic: string) => {
    pushLog('SYSTEM', 'INFO', 'All agents researching topic...');
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    
    // Each agent does independent research
    const researchPromises = AGENTS.map(async (agent) => {
      try {
        const prompt = `You are ${agent.name}. ${agent.description}

Research this topic from your unique perspective: "${topic}"

Provide your key findings in 2-3 sentences. Focus on insights relevant to your specialty.`;

        const result = await ai.models.generateContent({
          model: 'gemini-2.0-flash-exp',
          contents: prompt
        });
        const findings = result.text || 'No findings available';
        
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
        return { agentId: agent.id, findings };
      } catch (e: any) {
        pushLog('SYSTEM', 'ERROR', `${agent.name} research failed: ${e.message}`);
        return { agentId: agent.id, findings: 'Research unavailable' };
      }
    });
    
    await Promise.all(researchPromises);
    
    // Move to discussion phase
    setTimeout(() => startDiscussion(), 2000);
  };

  const startDiscussion = async () => {
    if (!roundtableSession) return;
    
    setRoundtableSession(prev => prev ? { ...prev, status: 'discussing' } : null);
    pushLog('SYSTEM', 'INFO', 'Agents entering discussion phase...');
    setStatus(ConnectionStatus.CONNECTED);
    
    const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
    
    // Simulate discussion rounds
    const discussionRounds = 3; // Each agent speaks once per round
    
    for (let round = 0; round < discussionRounds; round++) {
      for (const agent of AGENTS) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Pause between speakers
        
        try {
          const agentResearch = roundtableSession.research.find(r => r.agentId === agent.id);
          const allResearch = roundtableSession.research
            .map(r => `${AGENTS.find(a => a.id === r.agentId)?.name}: ${r.findings}`)
            .join('\n\n');
          
          const recentDiscussions = roundtableSession.discussions
            .slice(-5)
            .map(d => `${AGENTS.find(a => a.id === d.fromAgentId)?.name}: ${d.message}`)
            .join('\n');
          
          const prompt = `You are ${agent.name} in a roundtable discussion about: "${roundtableSession.topic}"

Your research: ${agentResearch?.findings}

All research findings:
${allResearch}

Recent discussion:
${recentDiscussions || 'Discussion just starting'}

This is discussion round ${round + 1} of ${discussionRounds}. ${
  round === 0 ? 'Share your perspective and react to others\' research.' :
  round === 1 ? 'Build on what others said and add deeper insights.' :
  'Synthesize the discussion and offer final thoughts.'
}

Respond in 1-2 sentences. Be conversational and reference others' points.`;

          const result = await ai.models.generateContent({
            model: 'gemini-2.0-flash-exp',
            contents: prompt
          });
          const message = result.text || 'No response available';
          
          const newDiscussion: RoundtableDiscussion = {
            fromAgentId: agent.id,
            toAgentId: null,
            message,
            timestamp: Date.now()
          };
          
          setRoundtableSession(prev => {
            if (!prev) return null;
            return {
              ...prev,
              discussions: [...prev.discussions, newDiscussion]
            };
          });
          
          setFocusedAgentId(agent.id);
          pushLog('SYSTEM', 'INFO', `${agent.name} speaking...`);
          
        } catch (e: any) {
          pushLog('SYSTEM', 'ERROR', `${agent.name} discussion error: ${e.message}`);
        }
      }
    }
    
    // Move to summary phase
    setTimeout(() => generateSummary(), 1000);
  };

  const generateSummary = async () => {
    if (!roundtableSession) return;
    
    setRoundtableSession(prev => prev ? { ...prev, status: 'summarizing' } : null);
    pushLog('SYSTEM', 'INFO', 'Oracle generating summary...');
    setFocusedAgentId('oracle');
    
    try {
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

      const result = await ai.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt
      });
      const summary = result.text || 'Summary not available';
      
      setRoundtableSession(prev => {
        if (!prev) return null;
        return { ...prev, summary, status: 'complete' };
      });
      
      pushLog('SYSTEM', 'SUCCESS', 'Roundtable complete!');
      setStatus(ConnectionStatus.IDLE);
      
    } catch (e: any) {
      pushLog('SYSTEM', 'ERROR', `Summary generation failed: ${e.message}`);
    }
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

  const handleSaveConfig = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('SUPABASE_URL', config.supabaseUrl);
      localStorage.setItem('SUPABASE_ANON_KEY', config.supabaseKey);
      setShowConfig(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white relative overflow-hidden">
      {/* Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-slate-900 to-black border border-white/20 rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-4 font-outfit">System Configuration</h2>
            <p className="text-sm text-white/60 mb-6">Connect to your Supabase database to enable session persistence.</p>
            <input 
              type="text" 
              placeholder="Supabase URL" 
              value={config.supabaseUrl}
              onChange={(e) => setConfig({...config, supabaseUrl: e.target.value})}
              className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 mb-3 focus:outline-none focus:border-cyan-500 transition"
            />
            <input 
              type="password" 
              placeholder="Supabase Anon Key" 
              value={config.supabaseKey}
              onChange={(e) => setConfig({...config, supabaseKey: e.target.value})}
              className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 mb-6 focus:outline-none focus:border-cyan-500 transition"
            />
            <div className="flex gap-3">
              <button onClick={handleSaveConfig} className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold py-3 rounded-lg transition">
                Save & Continue
              </button>
              <button onClick={() => setShowConfig(false)} className="px-6 bg-white/10 hover:bg-white/20 rounded-lg transition">
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

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
        <div className="flex flex-col items-center justify-center min-h-screen relative z-10 px-4">
          <h1 className="text-6xl md:text-8xl font-bold mb-4 font-outfit bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600 bg-clip-text text-transparent">
            PORTALS
          </h1>
          <p className="text-white/60 text-lg mb-12 text-center max-w-md">
            Summon specialized AI agents into a live, voice-powered collaboration cluster.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl w-full">
            {AGENTS.map(agent => (
              <button 
                key={agent.id}
                onClick={() => startCluster(agent)}
                className="group relative bg-gradient-to-br from-white/5 to-white/[0.02] backdrop-blur-sm border border-white/10 hover:border-white/30 rounded-2xl p-6 transition-all hover:scale-105 hover:shadow-2xl overflow-hidden"
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{background: `radial-gradient(circle at 50% 50%, ${agent.colors.glow}22, transparent)`}} />
                <div className="relative z-10">
                  <div className={`w-12 h-12 rounded-full ${agent.colors.primary} mb-4 shadow-lg`} style={{boxShadow: `0 0 30px ${agent.colors.glow}66`}} />
                  <h3 className="text-xl font-bold mb-2 font-outfit">{agent.name}</h3>
                  <p className="text-sm text-white/60">{agent.description}</p>
                </div>
              </button>
            ))}
          </div>
          
          <div className="mt-12 flex flex-col gap-4 items-center">
            <button 
              onClick={() => setShowRoundtableInput(true)}
              className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white font-semibold rounded-full transition-all shadow-lg hover:shadow-purple-500/50"
            >
              Start Roundtable
            </button>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowPersonalityEditor(true)}
                className="text-sm text-white/60 hover:text-white/90 transition underline"
              >
                Customize Personalities
              </button>
              <button 
                onClick={() => setShowConfig(true)}
                className="text-sm text-white/40 hover:text-white/80 transition underline"
              >
                Configure Database
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
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roundtableSession.research.map((research) => {
                    const agent = AGENTS.find(a => a.id === research.agentId);
                    if (!agent) return null;
                    return (
                      <div 
                        key={research.agentId}
                        className={`bg-white/5 border ${research.status === 'complete' ? 'border-emerald-500/50' : 'border-white/10'} rounded-xl p-4 transition-all`}
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <div 
                            className={`w-3 h-3 rounded-full ${agent.colors.primary}`}
                            style={{boxShadow: `0 0 10px ${agent.colors.glow}`}}
                          />
                          <span className="font-bold">{agent.name}</span>
                          {research.status === 'researching' && (
                            <div className="ml-auto">
                              <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                          {research.status === 'complete' && (
                            <div className="ml-auto text-emerald-400">✓</div>
                          )}
                        </div>
                        <p className="text-sm text-white/70">
                          {research.findings || 'Researching...'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Discussion Phase */}
              {roundtableSession.discussions.length > 0 && (
                <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="text-2xl">💬</span>
                    Discussion
                  </h2>
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
