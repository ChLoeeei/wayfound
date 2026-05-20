import { createClient, Session, User } from '@supabase/supabase-js';
import { Itinerary } from './types';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const hasValidSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key'
);

export const loginWithGoogle = async () => {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) throw error;
  } catch (err) {
    console.error('Login failed', err);
  }
};

export const logout = async () => {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error('Logout failed', err);
  }
};

export const onAuthStateChanged = (cb: (user: User | null) => void) => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    cb(session?.user ?? null);
  });

  const { data } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
    cb(session?.user ?? null);
  });

  return () => data.subscription.unsubscribe();
};

export const saveItinerary = async (itinerary: Itinerary) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('itineraries')
    .insert({
      user_id: user.id,
      payload: itinerary,
      created_at: now,
      updated_at: now,
      is_public: false,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    throw error;
  }

  return data?.id ?? null;
};

export const loadUserItineraries = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('itineraries')
    .select('id, payload, created_at, updated_at, is_public')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Supabase select error:', error);
    return [];
  }

  return (data ?? []).map(row => ({
    id: row.id,
    ...(row.payload as Itinerary),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isPublic: row.is_public,
  }));
};

/**
 * Persist an itinerary as public and return its id for the share link.
 * Allowed without login (RLS policy permits anon insert when is_public=true).
 */
export const shareItinerary = async (itinerary: Itinerary) => {
  const { data: { user } } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('itineraries')
    .insert({
      user_id: user?.id ?? null,
      payload: itinerary,
      created_at: now,
      updated_at: now,
      is_public: true,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Supabase share error:', error);
    throw error;
  }

  return data?.id ?? null;
};

/** Read-only fetch of a public itinerary by id. */
export const loadPublicItinerary = async (id: string): Promise<Itinerary | null> => {
  const { data, error } = await supabase
    .from('itineraries')
    .select('id, payload, is_public')
    .eq('id', id)
    .eq('is_public', true)
    .maybeSingle();

  if (error) {
    console.error('Supabase load public error:', error);
    return null;
  }
  if (!data) return null;
  return data.payload as Itinerary;
};
