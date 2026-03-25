/**
 * store.js — State management & Supabase data operations
 */

const Store = {
  // Reference data from Supabase
  dbRisks: [],
  dbInsurers: [],

  // Current offer state
  state: {
    offerId: null,       // Supabase UUID (null for new)
    offerName: '',
    clientName: '',
    brokerMessage: '',
    insurers: [],        // [{id, name, short_name}]
    risks: [],           // [{id, name, category, sort_order, weight}]
    matrixData: {},      // {riskId: {insurerId: {su: ''}}}
    totals: {},          // {insurerId: ''} — premium per insurer
  },

  resetState() {
    Store.state = {
      offerId: null,
      offerName: '',
      clientName: '',
      brokerMessage: '',
      insurers: [],
      risks: [],
      matrixData: {},
      totals: {},
    };
  },

  // Load reference data
  async loadReferenceData() {
    const [risksRes, insurersRes] = await Promise.all([
      sb.from('ud_risks').select('*').eq('active', true).order('sort_order'),
      sb.from('ud_insurers').select('*').eq('active', true).order('name'),
    ]);

    if (risksRes.error) throw risksRes.error;
    if (insurersRes.error) throw insurersRes.error;

    Store.dbRisks = risksRes.data || [];
    Store.dbInsurers = insurersRes.data || [];
  },

  // Load user's offers
  async loadOffers() {
    const { data, error } = await sb
      .from('ud_offers')
      .select('id, name, client_name, version, created_at, updated_at, user_id, share_token')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  // Load single offer
  async loadOffer(id) {
    const { data, error } = await sb
      .from('ud_offers')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  // Load offer by share token (for client view)
  async loadOfferByToken(token) {
    const { data, error } = await sb
      .from('ud_offers')
      .select('*')
      .eq('share_token', token)
      .single();

    if (error) throw error;
    return data;
  },

  // Save offer (insert or update)
  async saveOffer(generateLink) {
    const s = Store.state;

    // Auto-generate name
    if (!s.offerName) {
      const initials = s.insurers.map(tu => 
        tu.short_name || tu.name.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase()).join('')
      ).join('-');
      const dateStr = new Date().toISOString().slice(0, 10);
      s.offerName = initials ? `${initials}_${dateStr}` : `Oferta_${dateStr}`;
    }

    const payload = {
      name: s.offerName,
      client_name: s.clientName || null,
      data: {
        insurers: s.insurers,
        risks: s.risks,
        matrixData: s.matrixData,
        totals: s.totals,
      },
      broker_message: s.brokerMessage || null,
      version: CONFIG.APP_VERSION,
      user_id: Auth.currentUser.id,
      updated_at: new Date().toISOString(),
    };

    if (generateLink && !s.offerId) {
      payload.share_token = generateShareToken();
    }

    let result;

    if (s.offerId) {
      // Update existing
      const updateData = { ...payload };
      if (generateLink) {
        // Add share token if not already present
        const existing = await Store.loadOffer(s.offerId);
        if (!existing.share_token) {
          updateData.share_token = generateShareToken();
        }
      }
      const { data, error } = await sb
        .from('ud_offers')
        .update(updateData)
        .eq('id', s.offerId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      // Insert new
      const { data, error } = await sb
        .from('ud_offers')
        .insert([payload])
        .select()
        .single();

      if (error) throw error;
      result = data;
      s.offerId = result.id;
    }

    return result;
  },

  // Delete offer
  async deleteOffer(id) {
    const { error } = await sb
      .from('ud_offers')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  // Hydrate state from saved offer data
  hydrateState(offerRow) {
    Store.state.offerId = offerRow.id;
    Store.state.offerName = offerRow.name || '';
    Store.state.clientName = offerRow.client_name || '';
    Store.state.brokerMessage = offerRow.broker_message || '';

    const d = offerRow.data || {};
    Store.state.insurers = d.insurers || [];
    Store.state.risks = d.risks || [];
    Store.state.matrixData = d.matrixData || {};
    Store.state.totals = d.totals || {};
  },

  // Ensure matrix data is consistent
  ensureMatrixConsistency() {
    const s = Store.state;
    s.risks.forEach(r => {
      if (!s.matrixData[r.id]) s.matrixData[r.id] = {};
      s.insurers.forEach(tu => {
        if (!s.matrixData[r.id][tu.id]) s.matrixData[r.id][tu.id] = { su: '' };
      });
    });
    s.insurers.forEach(tu => {
      if (s.totals[tu.id] === undefined) s.totals[tu.id] = '';
    });
  },

  // Category sorting
  getCategoryWeight(cat) {
    const c = (cat || '').toLowerCase();
    if (c.includes('życi') || c.includes('zyci')) return 1;
    if (c.includes('niezdoln')) return 2;
    if (c.includes('inwalid')) return 3;
    if (c.includes('inn')) return 99;
    return 50;
  },

  // Admin: load all user profiles
  async loadUsers() {
    const { data, error } = await sb
      .from('ud_user_profiles')
      .select('*')
      .order('created_at');

    if (error) throw error;
    return data || [];
  },

  // Admin: update user profile
  async updateUserProfile(userId, updates) {
    const { data, error } = await sb
      .from('ud_user_profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
};
