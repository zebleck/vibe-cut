import { useState, useCallback } from 'react';
import { Command } from '../types';

export function useUndoRedo() {
  const [history, setHistory] = useState<Command[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [maxHistorySize] = useState(50);

  const executeCommand = useCallback((command: Command) => {
    command.execute();
    
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push(command);
      
      // Limit history size
      if (newHistory.length > maxHistorySize) {
        return newHistory.slice(-maxHistorySize);
      }
      
      return newHistory;
    });
    
    setHistoryIndex(prev => Math.min(prev + 1, maxHistorySize - 1));
  }, [historyIndex, maxHistorySize]);

  const undo = useCallback(() => {
    if (historyIndex >= 0) {
      const command = history[historyIndex];
      command.undo();
      setHistoryIndex(prev => prev - 1);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const command = history[historyIndex + 1];
      command.execute();
      setHistoryIndex(prev => prev + 1);
    }
  }, [history, historyIndex]);

  const canUndo = historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  return {
    executeCommand,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}

