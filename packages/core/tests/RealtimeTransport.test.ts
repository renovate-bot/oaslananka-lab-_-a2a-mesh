import { describe, expect, it, vi } from 'vitest';
import { VoiceSessionManager, type MultimodalSession } from '../src/server/RealtimeTransport.js';

describe('VoiceSessionManager', () => {
  it('tracks sessions, emits lifecycle events and routes text by task id', () => {
    const manager = new VoiceSessionManager();
    const started = vi.fn();
    const ended = vi.fn();
    manager.on('session_started', started);
    manager.on('session_ended', ended);

    const matching: MultimodalSession = {
      sessionId: 'session-1',
      taskId: 'task-1',
      close: vi.fn(),
      sendAudio: vi.fn(),
      sendText: vi.fn(),
    };
    const other: MultimodalSession = {
      sessionId: 'session-2',
      taskId: 'task-2',
      close: vi.fn(),
      sendAudio: vi.fn(),
      sendText: vi.fn(),
    };

    manager.registerSession(matching);
    manager.registerSession(other);
    manager.publishText('task-1', 'hello');
    manager.endSession('session-1');
    manager.endSession('missing');

    expect(started).toHaveBeenCalledWith(matching);
    expect(started).toHaveBeenCalledWith(other);
    expect(matching.sendText).toHaveBeenCalledWith('hello');
    expect(other.sendText).not.toHaveBeenCalled();
    expect(matching.close).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledWith('session-1');
  });
});
