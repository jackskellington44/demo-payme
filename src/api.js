import { supabase } from './supabase-config.js';

const PFP_BUCKET = 'group0-pfps';
// Supabase Auth needs an email; users only ever see/type their username.
const AUTH_EMAIL_DOMAIN = (import.meta.env.VITE_AUTH_EMAIL_DOMAIN || '4thworld.army').trim();
const USER_COLUMNS = 'id, username, pfp, pfp_url';

function toErrorMessage(error) {
  if (!error) return null;
  return String(error.message || error.error_description || error);
}

function buildInternalEmail(username) {
  return `${String(username).trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

function cacheUser(user) {
  try {
    if (user) localStorage.setItem('auth_user', JSON.stringify(user));
  } catch {
    // Ignore storage errors in private browsing contexts.
  }
}

async function fetchUserRow(userId) {
  const { data, error } = await supabase
    .from('users')
    .select(USER_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const api = {
  auth: {
    signUp: async ({ username, password, pfp }) => {
      const email = buildInternalEmail(username);
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { data: null, error: toErrorMessage(error) };

      const authUser = data?.user;
      if (!authUser?.id) {
        return { data: null, error: 'Signup failed: user account was not created.' };
      }
      if (!data.session) {
        return { data: null, error: 'Signup needs "Confirm email" disabled in Supabase Auth settings.' };
      }

      const userRow = { id: authUser.id, username, email, pfp: pfp || null, pfp_url: null };
      const { error: insertError } = await supabase.from('users').insert([userRow]);
      if (insertError) return { data: null, error: toErrorMessage(insertError) };

      const user = { id: userRow.id, username, pfp: userRow.pfp, pfp_url: null };
      cacheUser(user);
      return { data: { user }, error: null };
    },

    signIn: async ({ username, password }) => {
      const { data: row, error: lookupError } = await supabase
        .from('users')
        .select('id, email')
        .eq('username', username)
        .maybeSingle();
      if (lookupError) return { data: null, error: toErrorMessage(lookupError) };
      if (!row?.email) return { data: null, error: 'Username not found' };

      const { data, error } = await supabase.auth.signInWithPassword({ email: row.email, password });
      if (error) return { data: null, error: toErrorMessage(error) };

      try {
        const user = await fetchUserRow(data.user.id);
        cacheUser(user);
        return { data: { user }, error: null };
      } catch (err) {
        return { data: null, error: toErrorMessage(err) };
      }
    },

    changePassword: async ({ newPassword }) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { data: null, error: toErrorMessage(error) };
      return { data: { success: true }, error: null };
    },

    signOut: async () => {
      await supabase.auth.signOut();
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    },

    getUser: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) {
        return { data: null, error: 'unauthorized: ' + (toErrorMessage(error) || 'no session') };
      }
      try {
        const row = await fetchUserRow(data.user.id);
        const user = row || { id: data.user.id, username: null, pfp: null, pfp_url: null };
        cacheUser(user);
        return { data: { user }, error: null };
      } catch (err) {
        return { data: null, error: toErrorMessage(err) };
      }
    },

    uploadPfp: async (file) => {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) return { data: null, error: 'Not authenticated' };

      const ext = (file?.name?.split('.').pop() || 'webp').toLowerCase();
      const path = `${userId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(PFP_BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: true });
      if (uploadError) return { data: null, error: toErrorMessage(uploadError) };

      const { data: urlData } = supabase.storage.from(PFP_BUCKET).getPublicUrl(path);
      const url = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from('users')
        .update({ pfp_url: url, pfp: null })
        .eq('id', userId);
      if (updateError) return { data: null, error: toErrorMessage(updateError) };

      return { data: { url }, error: null };
    },
  },

  users: {
    getByUsername: async (username) => {
      const { data, error } = await supabase
        .from('users')
        .select(USER_COLUMNS)
        .eq('username', username)
        .maybeSingle();
      return { data: data || null, error: toErrorMessage(error) };
    },
  },
};
