/**
 * Where user memory lives (v2 feature A): localStorage for guests, the
 * Supabase `user_memory` row for a signed-in user, keyed by their user id.
 *
 * On login: if the account has no row yet, the browser's guest memory is
 * uploaded as the account's memory and the local copy is cleared (the
 * one-time migration). If a row exists, it wins and the guest copy is left
 * alone for the next signed-out visit.
 */
import { supabase } from '../supabase';
import { type TravelMemory, clearMemory, isMemoryEmpty, normalizeMemory, saveMemory } from './memory';

const TABLE = 'user_memory';

export async function loadRemoteMemory(userId: string): Promise<TravelMemory | null> {
  const { data, error } = await supabase.from(TABLE).select('memory').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? normalizeMemory(data.memory) : null;
}

export async function saveRemoteMemory(userId: string, memory: TravelMemory): Promise<void> {
  const { error } = await supabase.from(TABLE).upsert({ user_id: userId, memory }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function deleteRemoteMemory(userId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId);
  if (error) throw error;
}

export interface LoginMemoryResult {
  memory: TravelMemory;
  /** True when the guest memory was copied to the account on this login. */
  migrated: boolean;
}

/** Memory to use once `userId` is signed in; migrates the guest copy on the account's first login. */
export async function resolveMemoryOnLogin(userId: string, local: TravelMemory): Promise<LoginMemoryResult> {
  const remote = await loadRemoteMemory(userId);
  if (remote) return { memory: remote, migrated: false };
  if (isMemoryEmpty(local)) return { memory: local, migrated: false };
  await saveRemoteMemory(userId, local);
  clearMemory();
  return { memory: local, migrated: true };
}

/** Saves to the right place for the current session. Remote failures fall back to localStorage so nothing is lost. */
export async function persistMemory(userId: string | null, memory: TravelMemory): Promise<void> {
  if (!userId) {
    saveMemory(memory);
    return;
  }
  try {
    await saveRemoteMemory(userId, memory);
  } catch (err) {
    console.error('[memory] remote save failed, keeping a local copy', err);
    saveMemory(memory);
  }
}

/** "Clear all": empties the account row too when signed in. */
export async function wipeMemory(userId: string | null): Promise<void> {
  clearMemory();
  if (userId) {
    try {
      await deleteRemoteMemory(userId);
    } catch (err) {
      console.error('[memory] remote delete failed', err);
    }
  }
}
