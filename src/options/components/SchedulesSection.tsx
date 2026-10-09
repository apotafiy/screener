import React from 'react';
import type { Schedule } from '../../types';
import { ScheduleCard } from './ScheduleCard';

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function blankSchedule(): Schedule {
  return {
    id: uid(),
    name: 'New schedule',
    enabled: false,
    days: [1, 2, 3, 4, 5],
    startMinutes: 9 * 60,
    endMinutes: 17 * 60,
    allowCriteria: '',
    blockCriteria: '',
    allowKeywords: [],
    blockKeywords: [],
  };
}

function swap<T>(arr: T[], i: number, j: number): void {
  const tmp = arr[i]!;
  arr[i] = arr[j]!;
  arr[j] = tmp;
}

interface Props {
  schedules: Schedule[];
  setSchedules: (s: Schedule[]) => void;
}

export function SchedulesSection({
  schedules,
  setSchedules,
}: Props) {
  const handleUpdate = (index: number, updates: Partial<Schedule>) => {
    const next = [...schedules];
    next[index] = { ...next[index]!, ...updates };
    setSchedules(next);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const next = [...schedules];
    swap(next, index, index - 1);
    setSchedules(next);
  };

  const handleMoveDown = (index: number) => {
    if (index === schedules.length - 1) return;
    const next = [...schedules];
    swap(next, index, index + 1);
    setSchedules(next);
  };

  const handleDelete = (index: number) => {
    const next = [...schedules];
    next.splice(index, 1);
    setSchedules(next);
  };

  const handleAdd = () => {
    setSchedules([...schedules, blankSchedule()]);
  };

  return (
    <>
      {schedules.map((s, i) => (
        <ScheduleCard
          key={s.id || i}
          schedule={s}
          index={i}
          isFirst={i === 0}
          isLast={i === schedules.length - 1}
          onUpdate={handleUpdate}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onDelete={handleDelete}
        />
      ))}
      <div>
        <button className="primary" onClick={handleAdd}>
          + Add Schedule
        </button>
      </div>
    </>
  );
}