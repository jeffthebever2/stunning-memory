// Matches the shipped src/shared/todos.ts semantics, including clearing on a new user turn.
export function taskOutput(snapshot) {
  const messages = snapshot.messages ?? [];
  let checklist = null;
  outer: for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'user' && !message.steering) break;
    if (message.role !== 'assistant') continue;
    for (const part of [...(message.parts ?? [])].reverse()) {
      if (part.kind !== 'tool' || !['write_todos', 'TodoWrite'].includes(part.toolName) || !Array.isArray(part.input?.todos)) continue;
      const todos = part.input.todos.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const text = (typeof item.task === 'string' ? item.task : typeof item.content === 'string' ? item.content : '').trim();
        return text ? [{ text, state: item.completed === true || item.status === 'completed' ? 'done' : item.status === 'in_progress' ? 'active' : 'pending' }] : [];
      }).slice(0, 50);
      if (part.input.todos.length && !todos.length) continue;
      checklist = todos.length ? todos : null;
      break outer;
    }
  }
  return {
    thread: snapshot.thread, messages, items: snapshot.items ?? [], checklist,
    text: messages.filter(m => m.role === 'assistant').flatMap(m => (m.parts ?? []).filter(p => p.kind === 'text').map(p => p.text)).join('\n'),
    tools: messages.flatMap(m => (m.parts ?? []).filter(p => p.kind === 'tool')),
  };
}
