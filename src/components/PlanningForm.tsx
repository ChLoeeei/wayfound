import React, { useMemo, useState } from 'react';
import {
  BudgetRange,
  GroupType,
  PlanningInput,
  SpecialNeed,
  Vibe,
} from '../types';
import { Calendar, Loader2, Navigation, Users } from 'lucide-react';
import { emptyMemory, type TravelMemory } from '../lib/memory';
import { useT } from '../i18n';

interface PlanningFormProps {
  loading: boolean;
  onSubmit: (input: PlanningInput) => void;
  /** Cross-session memory used to prefill defaults. */
  memory?: TravelMemory;
}

export const VIBES: Vibe[] = ['nature', 'culture', 'food', 'shopping', 'leisure', 'adventure'];
export const GROUP_TYPES: GroupType[] = ['solo', 'couple', 'family', 'friends'];
export const SPECIAL_NEEDS: SpecialNeed[] = ['accessibility', 'vegetarian', 'baby', 'pet'];

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

const LABEL = 'text-[13px] text-text-muted mb-2 block';
const FIELD =
  'w-full bg-surface border border-border-strong rounded-lg py-2.5 pl-10 pr-3 text-text-main placeholder-text-muted/60 focus:outline-none focus:border-accent transition-colors text-sm';
const ICON = 'absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted';

function Chip({ active, onClick, testId, children }: { active: boolean; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`min-h-[34px] px-3.5 rounded-full text-[13px] border transition-colors ${
        active ? 'bg-text-main text-white border-text-main font-medium' : 'bg-surface text-text-main border-border-strong hover:bg-bg-base'
      }`}
    >
      {children}
    </button>
  );
}

export default function PlanningForm({ loading, onSubmit, memory = emptyMemory() }: PlanningFormProps) {
  const t = useT();
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(addDaysISO(todayISO(), 4));
  const [people, setPeople] = useState(2);
  // Prefilled from remembered preferences when a returning visitor has any;
  // these are lazy initializers so they only apply on first mount.
  const [groupType, setGroupType] = useState<GroupType>(() => memory.groupType ?? 'couple');
  const [vibes, setVibes] = useState<Vibe[]>(() =>
    memory.preferredVibes.length > 0 ? memory.preferredVibes.slice(0, 3) : ['food'],
  );
  const [budget, setBudget] = useState<BudgetRange>(() => memory.lastBudget ?? { min: 300, max: 1500 });
  const [specialNeeds, setSpecialNeeds] = useState<SpecialNeed[]>(() => [...memory.specialNeeds]);

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" data-testid="planning-form">
      {/* Destination */}
      <div>
        <label className={LABEL} htmlFor="destination">
          {t('form.destination')}
        </label>
        <div className="relative">
          <Navigation className={ICON} />
          <input
            id="destination"
            type="text"
            required
            placeholder={t('form.destinationPlaceholder')}
            value={destination}
            onChange={e => setDestination(e.target.value)}
            data-testid="field-destination"
            className={FIELD}
          />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="start-date">
            {t('form.start')}
          </label>
          <div className="relative">
            <Calendar className={ICON} />
            <input
              id="start-date"
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
              className={FIELD}
            />
          </div>
        </div>
        <div>
          <label className={LABEL} htmlFor="end-date">
            {t('form.end')}
          </label>
          <div className="relative">
            <Calendar className={ICON} />
            <input
              id="end-date"
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              data-testid="field-end-date"
              className={FIELD}
            />
          </div>
        </div>
      </div>
      {days > 0 && (
        <p className="text-xs text-text-muted -mt-3" data-testid="days-summary">
          {t('form.daysTotal', { count: days })}
        </p>
      )}

      {/* People + Group Type */}
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-2">
          <label className={LABEL} htmlFor="people">
            {t('form.travelers')}
          </label>
          <div className="relative">
            <Users className={ICON} />
            <input
              id="people"
              type="number"
              min={1}
              max={20}
              value={people}
              onChange={e => setPeople(Math.max(1, parseInt(e.target.value) || 1))}
              data-testid="field-people"
              className={FIELD}
            />
          </div>
        </div>
        <div className="col-span-3">
          <span className={LABEL}>{t('form.tripType')}</span>
          <div className="flex gap-1.5 flex-wrap">
            {GROUP_TYPES.map(g => (
              <Chip key={g} active={groupType === g} onClick={() => setGroupType(g)} testId={`group-${g}`}>
                {t(`form.groups.${g}`)}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* Vibes */}
      <div>
        <span className={LABEL}>{t('form.vibe')}</span>
        <div className="flex flex-wrap gap-1.5">
          {VIBES.map(v => (
            <Chip key={v} active={vibes.includes(v)} onClick={() => toggleVibe(v)} testId={`vibe-${v}`}>
              {t(`form.vibes.${v}`)}
            </Chip>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div>
        <span className={LABEL}>{t('form.budget', { min: budget.min, max: budget.max })}</span>
        <div className="space-y-2 px-1">
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
        <span className={LABEL}>
          {t('form.specialNeeds')} <span className="text-text-muted/70">{t('form.optional')}</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SPECIAL_NEEDS.map(n => (
            <Chip key={n} active={specialNeeds.includes(n)} onClick={() => toggleNeed(n)} testId={`need-${n}`}>
              {t(`form.needs.${n}`)}
            </Chip>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !valid}
        data-testid="submit-plan"
        className="min-h-[40px] w-full bg-accent hover:bg-accent-deep text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 font-medium"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> {t('form.generating')}
          </>
        ) : (
          t('form.generate')
        )}
      </button>
    </form>
  );
}
