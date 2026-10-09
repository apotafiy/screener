import React from 'react';
import type { Schedule } from '../../types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

function lines(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

interface Props {
  schedule: Schedule;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (index: number, updates: Partial<Schedule>) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onDelete: (index: number) => void;
}

export function ScheduleCard({
  schedule,
  index,
  isFirst,
  isLast,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onDelete,
}: Props) {
  const handleDayToggle = (day: number) => {
    const newDays = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day].sort();
    onUpdate(index, { days: newDays });
  };

  return (
    <div className="schedule-card">
      <div className="sc-header">
        <input
          type="text"
          className="sc-name-input"
          value={schedule.name}
          placeholder="Schedule name"
          onChange={(e) => onUpdate(index, { name: e.target.value })}
        />
        <button
          className="sc-move move-up"
          disabled={isFirst}
          title="Move up"
          type="button"
          onClick={() => onMoveUp(index)}
        >
          ↑
        </button>
        <button
          className="sc-move move-down"
          disabled={isLast}
          title="Move down"
          type="button"
          onClick={() => onMoveDown(index)}
        >
          ↓
        </button>
        <button
          className="sc-delete small danger"
          type="button"
          onClick={() => onDelete(index)}
        >
          Delete
        </button>
      </div>

      <div className="sc-chk">
        <label>
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => onUpdate(index, { enabled: e.target.checked })}
          />{' '}
          Enabled
        </label>
      </div>

      <div className="sc-chk">
        <label>Days</label>
        <div className="day-toggles">
          {DAY_LABELS.map((lbl, d) => (
            <button
              key={d}
              className={`day-btn ${schedule.days.includes(d) ? 'active' : ''}`}
              type="button"
              onClick={() => handleDayToggle(d)}
            >
              {lbl.charAt(0)}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <div>
          <label>Start</label>
          <input
            type="time"
            value={minutesToTime(schedule.startMinutes)}
            onChange={(e) =>
              onUpdate(index, { startMinutes: timeToMinutes(e.target.value) })
            }
          />
        </div>
        <div>
          <label>End</label>
          <input
            type="time"
            value={minutesToTime(schedule.endMinutes)}
            onChange={(e) =>
              onUpdate(index, { endMinutes: timeToMinutes(e.target.value) })
            }
          />
        </div>
      </div>

      {schedule.endMinutes <= schedule.startMinutes && (
        <div className="midnight-hint">Spans midnight</div>
      )}

      <div className="field-row">
        <div>
          <label>Allow Criteria</label>
          <textarea
            rows={2}
            placeholder="e.g. Software engineering, Linux, mathematics…"
            value={schedule.allowCriteria}
            onChange={(e) =>
              onUpdate(index, { allowCriteria: e.target.value })
            }
          />
        </div>
        <div>
          <label>Block Criteria</label>
          <textarea
            rows={2}
            placeholder="e.g. Gaming, vlogs, reaction content…"
            value={schedule.blockCriteria}
            onChange={(e) =>
              onUpdate(index, { blockCriteria: e.target.value })
            }
          />
        </div>
      </div>

      <div className="field-row">
        <div>
          <label>Allow Keywords (one per line)</label>
          <textarea
            rows={2}
            placeholder={'linux\nprogramming'}
            value={schedule.allowKeywords.join('\n')}
            onChange={(e) =>
              onUpdate(index, { allowKeywords: lines(e.target.value) })
            }
          />
        </div>
        <div>
          <label>Block Keywords (one per line)</label>
          <textarea
            rows={2}
            placeholder={'minecraft\nchannel:GamerDude'}
            value={schedule.blockKeywords.join('\n')}
            onChange={(e) =>
              onUpdate(index, { blockKeywords: lines(e.target.value) })
            }
          />
        </div>
      </div>
    </div>
  );
}
