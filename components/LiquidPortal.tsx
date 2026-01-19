
import React, { useMemo } from 'react';
import { PortalSignal } from '../types';

interface LiquidPortalProps {
  isListening: boolean;
  isSpeaking: boolean;
  intensity: number;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    glow: string;
  };
  size?: 'sm' | 'md' | 'lg';
  signals?: PortalSignal[];
}

const LiquidPortal: React.FC<LiquidPortalProps> = ({ 
  isListening, 
  isSpeaking, 
  intensity, 
  colors,
  size = 'lg',
  signals = []
}) => {
  const blobs = useMemo(() => [
    { id: 1, baseSize: size === 'lg' ? 'w-64 h-64' : size === 'md' ? 'w-48 h-48' : 'w-24 h-24', color: colors.primary, duration: '8s' },
    { id: 2, baseSize: size === 'lg' ? 'w-48 h-48' : size === 'md' ? 'w-36 h-36' : 'w-16 h-16', color: colors.secondary, duration: '6s' },
    { id: 3, baseSize: size === 'lg' ? 'w-56 h-56' : size === 'md' ? 'w-40 h-40' : 'w-20 h-20', color: colors.accent, duration: '10s' },
    { id: 4, baseSize: size === 'lg' ? 'w-40 h-40' : size === 'md' ? 'w-32 h-32' : 'w-12 h-12', color: colors.primary, duration: '7s' },
  ], [colors, size]);

  const scale = 1 + intensity * 0.4;
  const opacity = 0.6 + intensity * 0.4;

  return (
    <div className={`relative flex items-center justify-center transition-all duration-1000 ${size === 'lg' ? 'w-80 h-80' : size === 'md' ? 'w-64 h-64' : 'w-32 h-32'}`}>
      {/* Floating Signals */}
      <div className="absolute inset-0 pointer-events-none z-30">
        {signals.map((signal) => (
          <div 
            key={signal.id}
            className={`absolute px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest animate-float-up whitespace-nowrap border shadow-2xl backdrop-blur-md
              ${signal.type === 'positive' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 
                signal.type === 'negative' ? 'bg-red-500/20 border-red-500/50 text-red-400' : 
                signal.type === 'alert' ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 
                'bg-blue-500/20 border-blue-500/50 text-blue-400'}`}
            style={{ 
              left: `${50 + (Math.random() * 40 - 20)}%`, 
              top: '20%',
              animationDuration: '3s'
            }}
          >
            {signal.message}
          </div>
        ))}
      </div>

      {/* Background Glow */}
      <div 
        className={`absolute inset-0 blur-[100px] rounded-full transition-all duration-1000 ${isListening || isSpeaking ? 'opacity-60 scale-150' : 'opacity-20 scale-100'}`}
        style={{ backgroundColor: colors.glow }}
      />

      {/* The Liquid Container */}
      <div 
        className={`liquid-filter relative flex items-center justify-center transition-transform duration-300 w-full h-full`}
        style={{ transform: `scale(${scale})` }}
      >
        {blobs.map((blob) => (
          <div
            key={blob.id}
            className={`absolute rounded-full mix-blend-screen opacity-70 animate-blob ${blob.baseSize} ${blob.color}`}
            style={{
              animationDuration: isSpeaking ? '2s' : isListening ? '4s' : blob.duration,
              animationDelay: `${blob.id * 0.5}s`,
              opacity: opacity
            }}
          />
        ))}
        
        {/* Core Portal Element */}
        <div 
          className="absolute inset-4 rounded-full bg-black/40 backdrop-blur-3xl border border-white/10 flex items-center justify-center shadow-inner"
          style={{ boxShadow: `0 0 60px ${colors.glow}33` }}
        >
          <div className="w-1/2 h-1/2 rounded-full bg-white/5 border border-white/10 animate-pulse flex items-center justify-center overflow-hidden">
             <div 
              className={`w-full h-full bg-gradient-to-br from-white/20 to-transparent transition-opacity duration-1000 ${isSpeaking ? 'opacity-100' : 'opacity-0'}`} 
             />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float-up {
          0% { transform: translate(-50%, 0) scale(0.5); opacity: 0; }
          20% { opacity: 1; transform: translate(-50%, -20px) scale(1.1); }
          100% { transform: translate(-50%, -120px) scale(1); opacity: 0; }
        }
        .animate-float-up {
          animation: float-up 3s ease-out forwards;
        }
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(15%, -20%) scale(1.1); }
          66% { transform: translate(-10%, 10%) scale(0.9); }
        }
        .animate-blob {
          animation: blob 8s infinite alternate ease-in-out;
        }
      `}</style>
    </div>
  );
};

export default LiquidPortal;
