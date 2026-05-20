import React, { useMemo, useState } from 'react';
import {
  BudgetRange,
  GroupType,
  PlanningInput,
  SpecialNeed,
  Vibe,
} from '../types';
import {
  Calendar,
  Loader2,
  Navigation,
  Users,
} from 'lucide-react';

interface PlanningFormProps {
  loading: boolean;
  onSubmit: (input: PlanningInput) => void;
}

const VIBES: { value: Vibe; label: string }[] = [
  { value: 'nature', label: '自然' },
  { value: 'culture', label: '人文' },
  { value: 'food', label: '美食' },
  { value: 'shopping', label: '购物' },
  { value: 'leisure', label: '休闲' },
  { value: 'adventure', label: '探险' },
];

const GROUP_TYPES: { value: GroupType; label: string }[] = [
  { value: 'solo', label: '独行' },
  { value: 'couple', label: '情侣' },
  { value: 'family', label: '家庭' },
  { value: 'friends', label: '朋友' },
];

const SPECIAL_NEEDS: { value: SpecialNeed; label: string }[] = [
  { value: 'accessibility', label: '无障碍' },
  { value: 'vegetarian', label: '素食' },
  { value: 'baby', label: '带婴儿' },
  { value: 'pet', label: '宠物友好' },
];

const BUDGET_MIN = 100;
const BUDGET_MAX = 5000;
const BUDGET_STEP = 100;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return 0;
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

export function isBudgetValid(b: BudgetRange): boolean {
  return Number.isFinite(b.min) && Number.isFinite(b.max) && b.min >= 0 && b.max >= b.min;
}

export function isPlanningInputValid(input: PlanningInput): boolean {
  if (!input.destination.trim()) return false;
  if (!input.startDate || !input.endDate) return false;
  if (diffDays(input.startDate, input.endDate) < 1) return false;
  if (input.people < 1) return false;
  if (input.vibes.length === 0) return false;
  if (!isBudgetValid(input.budget)) return false;
  return true;
}

export default function PlanningForm({ loading, onSubmit }: PlanningFormProps) {
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addDaysISO(todayISO(), 4));
  const [people, setPeople] = useState(2);
  const [groupType, setGroupType] = useState<GroupType>('couple');
  const [vibes, setVibes] = useState<Vibe[]>(['food']);
  const [budget, setBudget] = useState<BudgetRange>({ min: 300, max: 1500 });
  const [specialNeeds, setSpecialNeeds] = useState<SpecialNeed[]>([]);

  const days = useMemo(() => diffDays(startDate, endDate), [startDate, endDate]);

  const input: PlanningInput = {
    destination: destination.trim(),
    startDate,
    endDate,
    people,
    groupType,
    vibes,
    budget,
    specialNeeds,
  };

  const valid = isPlanningInputValid(input);

  const toggleVibe = (v: Vibe) => {
    setVibes(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  };

  const toggleNeed = (n: SpecialNeed) => {
    setSpecialNeeds(prev => (prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit(input);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8" data-testid="planning-form">
      <div className="space-y-6">
        {/* Destination */}
        <div>
          <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
            目的地
          </label>
          <div className="relative">
            <Navigation className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              required
              placeholder="例如：京都 / Oaxaca"
              value={destination}
              onChange={e => setDestination(e.target.value)}
              data-testid="field-destination"
              className="w-full bg-bg-base border border-border rounded-lg py-3 pl-12 pr-4 text-text-main placeholder-text-muted/50 focus:outline-none focus:border-accent transition-colors font-sans text-sm"
            />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
              出发
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="date"
                required
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  if (e.target.value && endDate && e.target.value > endDate) {
                    setEndDate(e.target.value);
                  }
                }}
                data-testid="field-start-date"
                className="w-full bg-bg-base border border-border rounded-lg py-3 pl-12 pr-3 text-text-main focus:outline-none focus:border-accent transition-colors font-sans text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
              结束
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="date"
                required
                min={startDate}
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                data-testid="field-end-date"
                className="w-full bg-bg-base border border-border rounded-lg py-3 pl-12 pr-3 text-text-main focus:outline-none focus:border-accent transition-colors font-sans text-sm"
              />
            </div>
          </div>
        </div>
        {days > 0 && (
          <p className="text-xs text-text-muted -mt-4" data-testid="days-summary">
            共 {days} 天
          </p>
        )}

        {/* People + Group Type */}
        <div className="grid grid-cols-5 gap-4">
          <div className="col-span-2">
            <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
              人数
            </label>
            <div className="relative">
              <Users className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="number"
                min={1}
                max={20}
                value={people}
                onChange={e => setPeople(Math.max(1, parseInt(e.target.value) || 1))}
                data-testid="field-people"
                className="w-full bg-bg-base border border-border rounded-lg py-3 pl-12 pr-3 text-text-main focus:outline-none focus:border-accent transition-colors font-sans text-sm"
              />
            </div>
          </div>
          <div className="col-span-3">
            <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
              出行类型
            </label>
            <div className="flex gap-2 flex-wrap">
              {GROUP_TYPES.map(g => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGroupType(g.value)}
                  data-testid={`group-${g.value}`}
                  className={`px-3 py-2 rounded-full text-xs tracking-wide border transition-all ${
                    groupType === g.value
                      ? 'bg-text-main text-bg-base border-text-main font-medium'
                      : 'bg-transparent text-text-muted border-border hover:border-accent'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Vibes */}
        <div>
          <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
            旅行 Vibe
          </label>
          <div className="flex flex-wrap gap-2">
            {VIBES.map(v => (
              <button
                key={v.value}
                type="button"
                onClick={() => toggleVibe(v.value)}
                data-testid={`vibe-${v.value}`}
                className={`px-4 py-2 rounded-full text-xs tracking-wide transition-all border ${
                  vibes.includes(v.value)
                    ? 'bg-text-main text-bg-base border-text-main font-medium'
                    : 'bg-transparent text-text-muted border-border hover:border-accent'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Budget */}
        <div>
          <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
            预算 ¥{budget.min} – ¥{budget.max} / 人 · 天
          </label>
          <div className="space-y-3 px-1">
            <input
              type="range"
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              step={BUDGET_STEP}
              value={budget.min}
              onChange={e => {
                const v = parseInt(e.target.value);
                setBudget(b => ({ min: v, max: Math.max(v, b.max) }));
              }}
              data-testid="field-budget-min"
              className="w-full accent-accent"
            />
            <input
              type="range"
              min={BUDGET_MIN}
              max={BUDGET_MAX}
              step={BUDGET_STEP}
              value={budget.max}
              onChange={e => {
                const v = parseInt(e.target.value);
                setBudget(b => ({ min: Math.min(b.min, v), max: v }));
              }}
              data-testid="field-budget-max"
              className="w-full accent-accent"
            />
          </div>
        </div>

        {/* Special needs */}
        <div>
          <label className="text-xs font-mono uppercase tracking-widest text-text-muted mb-3 block">
            特殊需求 <span className="text-text-muted/70 normal-case">(选填)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {SPECIAL_NEEDS.map(n => (
              <button
                key={n.value}
                type="button"
                onClick={() => toggleNeed(n.value)}
                data-testid={`need-${n.value}`}
                className={`px-3 py-2 rounded-full text-xs tracking-wide border transition-all ${
                  specialNeeds.includes(n.value)
                    ? 'bg-text-main text-bg-base border-text-main font-medium'
                    : 'bg-transparent text-text-muted border-border hover:border-accent'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !valid}
        data-testid="submit-plan"
        className="mt-2 w-full bg-accent hover:opacity-90 text-white rounded-lg py-4 flex items-center justify-center gap-2 transition-all disabled:opacity-50 tracking-widest text-sm uppercase font-medium"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> 生成中
          </>
        ) : (
          <>生成行程</>
        )}
      </button>
    </form>
  );
}
