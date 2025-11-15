import { useState } from 'react';
import { Transition, Clip, Project } from '../types';
import { createTransition } from '../utils/transitionUtils';

interface TransitionsPanelProps {
  project: Project;
  selectedClips: Clip[];
  onAddTransition: (transition: Transition) => void;
  onUpdateTransition: (transitionId: string, updates: Partial<Transition>) => void;
  onRemoveTransition: (transitionId: string) => void;
}

export function TransitionsPanel({
  project,
  selectedClips,
  onAddTransition,
  onUpdateTransition,
  onRemoveTransition,
}: TransitionsPanelProps) {
  const [transitionDuration, setTransitionDuration] = useState(0.5);

  const handleAddTransition = (type: Transition['type'], position: 'start' | 'end' | 'between') => {
    if (selectedClips.length === 0) return;
    
    const clip = selectedClips[0];
    const transition = createTransition(type, clip.id, transitionDuration, position);
    onAddTransition(transition);
  };

  const clipTransitions = project.transitions.filter(t =>
    selectedClips.some(c => c.id === t.clipId)
  );

  return (
    <div className="transitions-panel">
      <h3>Transitions</h3>

      {selectedClips.length === 0 ? (
        <p className="empty-message">Select a clip to add transitions</p>
      ) : (
        <>
          <div className="control-group">
            <label>Duration (seconds):</label>
            <input
              type="number"
              min="0.1"
              max="5"
              step="0.1"
              value={transitionDuration}
              onChange={(e) => setTransitionDuration(parseFloat(e.target.value))}
            />
          </div>

          <div className="transition-buttons">
            <button onClick={() => handleAddTransition('fade-in', 'start')}>
              Fade In
            </button>
            <button onClick={() => handleAddTransition('fade-out', 'end')}>
              Fade Out
            </button>
            {selectedClips.length >= 2 && (
              <button onClick={() => handleAddTransition('crossfade', 'between')}>
                Crossfade
              </button>
            )}
          </div>

          <div className="applied-transitions">
            <h4>Applied Transitions</h4>
            {clipTransitions.map(transition => (
              <div key={transition.id} className="transition-item">
                <div className="transition-info">
                  <span>{transition.type}</span>
                  <span>{transition.duration}s</span>
                </div>
                <div className="transition-controls">
                  <input
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={transition.duration}
                    onChange={(e) =>
                      onUpdateTransition(transition.id, {
                        duration: parseFloat(e.target.value),
                      })
                    }
                  />
                  <button onClick={() => onRemoveTransition(transition.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

