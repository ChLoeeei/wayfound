import React, { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import type { GroupType, PlaceType, SpecialNeed, Vibe } from '../types';
import {
  BUDGET_LEANS,
  PACES,
  type BudgetLean,
  type MemoryTextField,
  type Pace,
  type TravelMemory,
  clearScalar,
  editListItem,
  isMemoryEmpty,
  removeDislikedType,
  removeListItem,
  setScalar,
} from '../lib/memory';
import { GROUP_TYPES } from './PlanningForm';
import { useT } from '../i18n';

interface PreferencesTabProps {
  memory: TravelMemory;
  onChange: (next: TravelMemory) => void;
  onClearMemory: () => void;
  /** Signed-in user's email, or null for a guest. */
  userEmail?: string | null;
  /** One-line status: migrated on login, or what the extraction step just remembered. */
  notice?: string | null;
}

/**
 * Agent panel → "My preferences": every remembered item, each one editable
 * or deletable on its own, plus "clear all". Guests see the browser-only
 * note; signed-in users see the account note.
 */
export default function PreferencesTab({ memory, onChange, onClearMemory, userEmail, notice }: PreferencesTabProps) {
  const t = useT();
  const empty = isMemoryEmpty(memory);
  const avoided = (Object.entries(memory.dislikedTypeCounts) as Array<[PlaceType, number | undefined]>).filter(([, n]) => (n ?? 0) >= 2).map(([type]) => type);

  return (
    <div className="flex flex-col gap-3 flex-1" data-testid="panel-preferences">
      <p className="m-0 text-text-muted text-[13px]">{t('panel.preferences.intro')}</p>
      {notice && (
        <p className="m-0 text-[13px] px-3 py-2 rounded-[10px] bg-accent-soft border border-accent-line text-accent-deep" data-testid="memory-notice">
          {notice}
        </p>
      )}

      {empty ? (
        <p className="m-0 text-[13px] text-text-muted" data-testid="preferences-empty">
          {t('panel.preferences.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {memory.preferredVibes.length > 0 && (
            <Group label={t('panel.preferences.interests')} testId="preference-interests">
              <Chips
                items={memory.preferredVibes.map(v => ({ value: v, label: t(`form.vibes.${v}`) }))}
                onRemove={v => onChange(removeListItem(memory, 'preferredVibes', v))}
                field="interests"
              />
            </Group>
          )}

          {memory.groupType && (
            <ScalarRow
              label={t('panel.preferences.tripType')}
              testId="preference-tripType"
              display={t(`form.groups.${memory.groupType}`)}
              onDelete={() => onChange(clearScalar(memory, 'groupType'))}
              editor={close => (
                <select
                  defaultValue={memory.groupType}
                  data-testid="preference-tripType-select"
                  onChange={e => {
                    onChange(setScalar(memory, { groupType: e.target.value as GroupType }));
                    close();
                  }}
                  className="bg-surface border border-border-strong rounded-md px-2 py-1"
                >
                  {GROUP_TYPES.map(g => (
                    <option key={g} value={g}>
                      {t(`form.groups.${g}`)}
                    </option>
                  ))}
                </select>
              )}
            />
          )}

          {memory.lastBudget && (
            <BudgetRow
              memory={memory}
              onChange={onChange}
              onDelete={() => onChange(clearScalar(memory, 'lastBudget'))}
            />
          )}

          {memory.budgetLean && (
            <ScalarRow
              label={t('panel.preferences.budgetLean')}
              testId="preference-budgetLean"
              display={t(`panel.preferences.lean.${memory.budgetLean}`)}
              onDelete={() => onChange(clearScalar(memory, 'budgetLean'))}
              editor={close => (
                <select
                  defaultValue={memory.budgetLean}
                  data-testid="preference-budgetLean-select"
                  onChange={e => {
                    onChange(setScalar(memory, { budgetLean: e.target.value as BudgetLean }));
                    close();
                  }}
                  className="bg-surface border border-border-strong rounded-md px-2 py-1"
                >
                  {BUDGET_LEANS.map(l => (
                    <option key={l} value={l}>
                      {t(`panel.preferences.lean.${l}`)}
                    </option>
                  ))}
                </select>
              )}
            />
          )}

          {memory.pace && (
            <ScalarRow
              label={t('panel.preferences.pace')}
              testId="preference-pace"
              display={t(`panel.preferences.paces.${memory.pace}`)}
              onDelete={() => onChange(clearScalar(memory, 'pace'))}
              editor={close => (
                <select
                  defaultValue={memory.pace}
                  data-testid="preference-pace-select"
                  onChange={e => {
                    onChange(setScalar(memory, { pace: e.target.value as Pace }));
                    close();
                  }}
                  className="bg-surface border border-border-strong rounded-md px-2 py-1"
                >
                  {PACES.map(p => (
                    <option key={p} value={p}>
                      {t(`panel.preferences.paces.${p}`)}
                    </option>
                  ))}
                </select>
              )}
            />
          )}

          {memory.specialNeeds.length > 0 && (
            <Group label={t('panel.preferences.specialNeeds')} testId="preference-specialNeeds">
              <Chips
                items={memory.specialNeeds.map(n => ({ value: n, label: t(`form.needs.${n}`) }))}
                onRemove={v => onChange(removeListItem(memory, 'specialNeeds', v as SpecialNeed))}
                field="specialNeeds"
              />
            </Group>
          )}

          {memory.avoid.length > 0 && (
            <TextList label={t('panel.preferences.avoid')} testId="preference-avoid" field="avoid" items={memory.avoid} memory={memory} onChange={onChange} />
          )}

          {memory.visitedDestinations.length > 0 && (
            <TextList
              label={t('panel.preferences.pastTrips')}
              testId="preference-pastTrips"
              field="visitedDestinations"
              items={memory.visitedDestinations}
              memory={memory}
              onChange={onChange}
            />
          )}

          {avoided.length > 0 && (
            <Group label={t('panel.preferences.avoids')} testId="preference-avoids">
              <Chips
                items={avoided.map(type => ({ value: type, label: t(`place.types.${type}`) }))}
                onRemove={v => onChange(removeDislikedType(memory, v as PlaceType))}
                field="avoids"
              />
            </Group>
          )}

          {memory.notes.length > 0 && (
            <TextList label={t('panel.preferences.notes')} testId="preference-notes" field="notes" items={memory.notes} memory={memory} onChange={onChange} />
          )}
        </div>
      )}

      <div className="flex-1" />
      {!empty && (
        <button
          type="button"
          onClick={onClearMemory}
          data-testid="memory-clear"
          className="min-h-[40px] border border-delete-line rounded-lg bg-surface text-delete font-medium hover:bg-delete-tint"
        >
          {t('panel.preferences.clearAll')}
        </button>
      )}
      <div className="text-[12px] text-text-muted" data-testid="memory-scope">
        {userEmail ? t('panel.preferences.signedIn', { email: userEmail }) : t('panel.preferences.signedOut')}
      </div>
    </div>
  );
}

function Group({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="p-3 border border-border rounded-[10px] flex flex-col gap-1.5" data-testid={testId}>
      <div className="text-[12px] text-text-muted">{label}</div>
      {children}
    </div>
  );
}

function Chips({ items, onRemove, field }: { items: Array<{ value: string; label: string }>; onRemove: (value: string) => void; field: string }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(it => (
        <span key={it.value} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-bg-base border border-border text-[13px] font-medium" data-testid={`preference-item-${field}-${it.value}`}>
          {it.label}
          <button
            type="button"
            aria-label={t('panel.preferences.remove', { value: it.label })}
            onClick={() => onRemove(it.value)}
            data-testid={`preference-remove-${field}-${it.value}`}
            className="w-5 h-5 rounded-full flex items-center justify-center text-text-muted hover:text-delete hover:bg-delete-tint"
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

function ScalarRow({ label, testId, display, onDelete, editor }: { label: string; testId: string; display: string; onDelete: () => void; editor: (close: () => void) => React.ReactNode }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  return (
    <div className="p-3 border border-border rounded-[10px] flex items-center gap-2" data-testid={testId}>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-text-muted">{label}</div>
        {editing ? <div className="mt-1 text-[13px]">{editor(() => setEditing(false))}</div> : <div className="font-medium">{display}</div>}
      </div>
      <IconButton label={editing ? t('panel.preferences.cancel') : t('panel.preferences.edit')} onClick={() => setEditing(v => !v)} testId={`${testId}-edit`}>
        {editing ? <X size={14} /> : <Pencil size={14} />}
      </IconButton>
      <IconButton label={t('panel.preferences.delete')} onClick={onDelete} testId={`${testId}-delete`} danger>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function BudgetRow({ memory, onChange, onDelete }: { memory: TravelMemory; onChange: (m: TravelMemory) => void; onDelete: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [min, setMin] = useState(String(memory.lastBudget?.min ?? ''));
  const [max, setMax] = useState(String(memory.lastBudget?.max ?? ''));
  const save = () => {
    const lo = Number(min);
    const hi = Number(max);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi >= lo) {
      onChange(setScalar(memory, { lastBudget: { min: lo, max: hi } }));
      setEditing(false);
    }
  };
  return (
    <div className="p-3 border border-border rounded-[10px] flex items-center gap-2" data-testid="preference-dailyBudget">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-text-muted">{t('panel.preferences.dailyBudget')}</div>
        {editing ? (
          <div className="mt-1 flex items-center gap-2 text-[13px]">
            <label className="flex items-center gap-1">
              {t('panel.preferences.budgetMin')}
              <input type="number" value={min} onChange={e => setMin(e.target.value)} data-testid="preference-budget-min" className="w-20 bg-surface border border-border-strong rounded-md px-2 py-1" />
            </label>
            <label className="flex items-center gap-1">
              {t('panel.preferences.budgetMax')}
              <input type="number" value={max} onChange={e => setMax(e.target.value)} data-testid="preference-budget-max" className="w-20 bg-surface border border-border-strong rounded-md px-2 py-1" />
            </label>
          </div>
        ) : (
          <div className="font-medium">{t('panel.preferences.budgetValue', { min: memory.lastBudget!.min, max: memory.lastBudget!.max })}</div>
        )}
      </div>
      {editing ? (
        <IconButton label={t('panel.preferences.save')} onClick={save} testId="preference-dailyBudget-save">
          <Check size={14} />
        </IconButton>
      ) : (
        <IconButton label={t('panel.preferences.edit')} onClick={() => setEditing(true)} testId="preference-dailyBudget-edit">
          <Pencil size={14} />
        </IconButton>
      )}
      <IconButton label={t('panel.preferences.delete')} onClick={onDelete} testId="preference-dailyBudget-delete" danger>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}

function TextList({
  label,
  testId,
  field,
  items,
  memory,
  onChange,
}: {
  label: string;
  testId: string;
  field: MemoryTextField;
  items: string[];
  memory: TravelMemory;
  onChange: (m: TravelMemory) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  return (
    <Group label={label} testId={testId}>
      <ul className="m-0 p-0 list-none flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={`${item}-${i}`} className="flex items-center gap-2" data-testid={`preference-item-${field}-${i}`}>
            {editing === item ? (
              <>
                <input
                  value={draft}
                  autoFocus
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      onChange(editListItem(memory, field, item, draft));
                      setEditing(null);
                    }
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  data-testid={`preference-edit-input-${field}-${i}`}
                  className="flex-1 min-w-0 bg-surface border border-border-strong rounded-md px-2 py-1 text-[13px]"
                />
                <IconButton
                  label={t('panel.preferences.save')}
                  onClick={() => {
                    onChange(editListItem(memory, field, item, draft));
                    setEditing(null);
                  }}
                  testId={`preference-save-${field}-${i}`}
                >
                  <Check size={14} />
                </IconButton>
                <IconButton label={t('panel.preferences.cancel')} onClick={() => setEditing(null)} testId={`preference-cancel-${field}-${i}`}>
                  <X size={14} />
                </IconButton>
              </>
            ) : (
              <>
                <span className="flex-1 min-w-0 font-medium break-words">{item}</span>
                <IconButton
                  label={t('panel.preferences.edit')}
                  onClick={() => {
                    setEditing(item);
                    setDraft(item);
                  }}
                  testId={`preference-edit-${field}-${i}`}
                >
                  <Pencil size={14} />
                </IconButton>
                <IconButton label={t('panel.preferences.delete')} onClick={() => onChange(removeListItem(memory, field, item))} testId={`preference-delete-${field}-${i}`} danger>
                  <Trash2 size={14} />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
    </Group>
  );
}

function IconButton({ label, onClick, testId, danger, children }: { label: string; onClick: () => void; testId: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      className={`w-8 h-8 rounded-lg border border-border-strong bg-surface flex items-center justify-center shrink-0 ${
        danger ? 'text-delete hover:bg-delete-tint hover:border-delete-line' : 'text-text-main hover:bg-bg-base'
      }`}
    >
      {children}
    </button>
  );
}
