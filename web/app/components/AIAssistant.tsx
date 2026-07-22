"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const updatedMessages = [
      ...messages,
      {
        role: "user" as const,
        content: input,
      },
    ];

    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages,
        }),
      });

      const data = await res.json();

      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content: data.message,
        },
      ]);
    } catch {
      setMessages([
        ...updatedMessages,
        {
          role: "assistant",
          content: "Sorry, something went wrong.",
        },
      ]);
    }

    setLoading(false);
  }

  return (
    <section className="mx-auto mt-10 max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-6">
      <h2 className="mb-6 text-3xl font-bold text-white">
        🤖 Aurora AI
      </h2>

      <div className="mb-6 h-96 overflow-y-auto rounded-xl bg-slate-950 p-4">
        {messages.length === 0 && (
          <p className="text-slate-400">
            Ask Aurora for recommendations, trivia, or help finding something to watch.
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`mb-4 ${
              message.role === "user" ? "text-right" : "text-left"
            }`}
          >
            <div
              className={`inline-block max-w-[80%] rounded-2xl px-4 py-3 ${
                message.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-white"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="text-slate-400 animate-pulse">
            🤖 Aurora is thinking...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        }}
        rows={3}
        placeholder="Ask Aurora anything..."
        className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-white"
      />

      <button
        onClick={sendMessage}
        disabled={loading}
        className="rounded-lg bg-blue-600 px-6 py-2 hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Thinking..." : "Send"}
      </button>
    </section>
  );
}