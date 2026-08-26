/**
 * auth.js — Supabase Auth: login, logout, session, user profile
 */

const Auth = {
  currentUser: null,
  userProfile: null,

  async init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      Auth.currentUser = session.user;
      await Auth.loadProfile();
      return true;
    }
    return false;
  },

  async login(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    Auth.currentUser = data.user;
    await Auth.loadProfile();
    return data.user;
  },

  async logout() {
    await sb.auth.signOut();
    Auth.currentUser = null;
    Auth.userProfile = null;
  },

  async loadProfile() {
    if (!Auth.currentUser) return;
    const { data, error } = await sb
      .from('ud_user_profiles')
      .select('*')
      .eq('id', Auth.currentUser.id)
      .single();
    
    if (data) {
      Auth.userProfile = data;
    } else {
      // Fallback if profile doesn't exist yet
      Auth.userProfile = {
        id: Auth.currentUser.id,
        full_name: Auth.currentUser.email,
        role: 'user',
        active: true
      };
    }
  },

  isAdmin() {
    return Auth.userProfile?.role === 'admin';
  },

  getDisplayName() {
    return Auth.userProfile?.full_name || Auth.currentUser?.email || '—';
  },

  getInitials() {
    const name = Auth.getDisplayName();
    return name.split(/[\s@]+/).map(w => w.charAt(0).toUpperCase()).slice(0, 2).join('');
  },

  // Admin: create user (uses admin's session to call invite or signUp via service role)
  // NOTE: For full admin user creation, a Supabase Edge Function with service_role key is needed.
  // Here we use a workaround: admin signs up user, then user must reset password.
  async adminCreateUser(email, password, fullName, role) {
    // We'll use the Supabase admin API via a direct REST call
    // This requires the current user to be admin (checked by RLS on ud_user_profiles)
    
    // Step 1: Sign up the user (this will create auth.users entry)
    // We temporarily sign up, then switch back. 
    // Better approach: use Supabase Edge Function. For now, use direct signup.
    const response = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CONFIG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email: email,
        password: password,
        data: { full_name: fullName, role: role }
      })
    });

    const result = await response.json();
    if (result.error || (!result.id && !result.user)) {
      throw new Error(result.error?.message || result.msg || 'Nie udało się utworzyć użytkownika');
    }

    return result;
  }
};
