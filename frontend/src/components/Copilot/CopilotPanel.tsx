import {useWorkspaceApi} from "../../api/WorkspaceApi";
import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "../../types";
import { aiChat } from "../../api/ai";

interface CopilotPanelProps {
  open: boolean;
  onClose: () => void;
}

const SUGGESTIONS = [
  "Combien de TVA je dois probablement ce trimestre ?",
  "Quels sont mes plus gros postes de dépense ?",
  "Quels abonnements ai-je en cours ?",
  "Quel est l'état de ma trésorerie ?",
];

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-purple-700 flex items-center justify-center text-xs shrink-0 mr-2 mt-0.5">
          ✨
        </div>
      )}
      <div
        className={`max-w-[80%] text-xs px-3 py-2 rounded-lg whitespace-pre-wrap leading-relaxed ${
          isUser
            ? "bg-vscode-accent text-white rounded-br-none"
            : "bg-vscode-panel border border-vscode-border text-vscode-text rounded-bl-none"
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}

export function CopilotPanel({ open, onClose }: CopilotPanelProps) {
  const {api}=useWorkspaceApi();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const userMsg: ChatMessage = { role: "user", content };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setLoading(true);

    try {
      const answer = await aiChat(updated,api);
      setMessages([...updated, { role: "assistant", content: answer }]);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : "Erreur inconnue";
      setMessages([
        ...updated,
        {
          role: "assistant",
          content: `❌ Erreur : ${errMsg}\n\nVérifiez que la clé ANTHROPIC_API_KEY est configurée dans le fichier \`.env\` du backend.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-6 right-6 w-[420px] h-[560px] bg-vscode-sidebar border border-vscode-border rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-vscode-panel border-b border-vscode-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-purple-400 text-sm">✨</span>
          <span className="text-vscode-text text-xs font-semibold">Copilote ComptaOS</span>
          <span className="text-[10px] text-vscode-muted bg-vscode-border px-1.5 py-0.5 rounded">Claude</span>
        </div>
        <div className="flex gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="text-vscode-muted hover:text-vscode-text text-xs"
              title="Nouvelle conversation"
            >
              ↺
            </button>
          )}
          <button
            onClick={onClose}
            className="text-vscode-muted hover:text-vscode-text text-sm leading-none"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-vscode-muted text-xs text-center mb-3">
              Posez une question sur vos finances
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-left text-xs text-vscode-muted hover:text-vscode-text bg-vscode-panel hover:bg-vscode-border border border-vscode-border rounded-lg px-3 py-2 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-purple-700 flex items-center justify-center text-xs shrink-0">
              ✨
            </div>
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-vscode-muted rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-vscode-muted rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-vscode-muted rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-vscode-border shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Posez une question… (Entrée pour envoyer)"
            className="flex-1 bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-vscode-accent placeholder-vscode-muted"
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="bg-vscode-accent hover:bg-blue-600 disabled:opacity-40 text-white text-xs px-3 py-2 rounded-lg shrink-0 h-[52px] transition-colors"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
