
export interface AudioConfig {
  sampleRate: number;
  channels: number;
}

export enum ConnectionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface TranscriptionItem {
  type: 'user' | 'model';
  text: string;
  agentId?: string;
}

export interface PortalSignal {
  id: string;
  agentId: string;
  type: 'positive' | 'negative' | 'alert' | 'info';
  message: string;
  timestamp: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  instruction: string;
  voice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    glow: string;
  };
}
