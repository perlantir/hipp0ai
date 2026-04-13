import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, MessageCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useProject } from '../App';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function AskAnything() {
  const { post } = useApi();
  const { projectId } = useProject();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: Message = { role: 'user', content: question, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const data = await post<{ answer?: string; response?: string }>('/api/distill/ask', {
        question,
        project_id: projectId,
      });
      const answer = data.answer ?? data.response ?? JSON.stringify(data);
      setMessages((prev) => [...prev, { role: 'assistant', content: answer, timestamp: Date.now() }]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message || 'Failed to get response'}`, timestamp: Date.now() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-3.5rem)] md:max-h-screen">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--border-light)]">
        <h1 className="text-3xl font-bold tracking-tight">Ask Anything</h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1">Ask questions about your project's decisions and context</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle size={32} className="text-[var(--text-tertiary)] mb-3" />
            <p className="text-sm text-[var(--text-secondary)]">Ask a question about your project's decisions</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">e.g. "Why did we choose PostgreSQL over MongoDB?"</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'rounded-xl bg-[#063ff9] text-white shadow-[0_0_20px_rgba(6,63,249,0.4)]'
                  : 'rounded-2xl'
              }`}
              style={msg.role === 'assistant' ? { background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 20px 40px rgba(0,0,0,0.05)' } : undefined}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 20px 40px rgba(0,0,0,0.05)' }}>
              <Loader2 size={16} className="animate-spin text-[var(--text-secondary)]" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-6 py-4">
        <div className="flex items-end gap-3 p-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.4)', boxShadow: '0 20px 40px rgba(0,0,0,0.05)' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question…"
            rows={1}
            className="input flex-1 resize-none min-h-[40px] max-h-[120px]"
            style={{ fieldSizing: 'content' } as any}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="p-2.5 shrink-0 bg-[#063ff9] text-white rounded-xl shadow-[0_0_20px_rgba(6,63,249,0.4)] hover:bg-[#063ff9]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
