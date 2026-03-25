/**
 * store.js — State management & Supabase data operations — v2.0
 * Supports variants, waiting periods, indemnity periods, client choice
 */

const Store = {
  dbRisks: [],
  dbInsurers: [],
  dbClients: [],

  // Current offer state
  state: {
    offerId: null,
    offerName: '',
    clientName: '',       // display name
    clientId: null,       // link to ud_clients
    brokerMessage: '',
    insurers: [],         // [{id, name, short_name}]
    risks: [],            // [{id, name, category, sort_order, weight}]
    // variants: array of variant objects
    variants: [
      // { id: 'v1', label: 'Wariant 1', matrixData: {riskId:{insurerId:{su:''}}}, totals: {insurerId:''}, waitAccident:{insurerId:14}, waitIllness:{insurerId:21}, indemnity:{insurerId:24} }
    ],
    activeVariantIdx: 0,
    clientChoice: null,   // {variant_id, insurer_id, insurer_name, chosen_at, exclusions_accepted_at}
  },

  resetState() {
    Store.state = {
      offerId: null,
      offerName: '',
      clientName: '',
      clientId: null,
      brokerMessage: '',
      insurers: [],
      risks: [],
      variants: [Store.createEmptyVariant('Wariant 1')],
      activeVariantIdx: 0,
      clientChoice: null,
    };
  },

  createEmptyVariant(label) {
    return {
      id: 'v_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      label: label || 'Wariant',
      matrixData: {},
      totals: {},
      waitAccident: {},
      waitIllness: {},
      indemnity: {},
    };
  },

  getActiveVariant() {
    return Store.state.variants[Store.state.activeVariantIdx] || Store.state.variants[0];
  },

  // Reference data
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

  // Clients
  async loadClients() {
    const { data, error } = await sb.from('ud_clients').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    Store.dbClients = data || [];
    return data || [];
  },

  // Offers
  async loadOffers() {
    const { data, error } = await sb.from('ud_offers')
      .select('id, name, client_name, client_id, version, created_at, updated_at, user_id, share_token, client_choice')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async loadOffer(id) {
    const { data, error } = await sb.from('ud_offers').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async loadOfferByToken(token) {
    const { data, error } = await sb.from('ud_offers').select('*').eq('share_token', token).single();
    if (error) throw error;
    return data;
  },

  async saveOffer(generateLink) {
    const s = Store.state;
    if (!s.offerName) {
      const initials = s.insurers.map(tu => tu.short_name || tu.name.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase()).join('')).join('-');
      s.offerName = initials ? `${initials}_${new Date().toISOString().slice(0, 10)}` : `Oferta_${new Date().toISOString().slice(0, 10)}`;
    }

    const payload = {
      name: s.offerName,
      client_name: s.clientName || null,
      client_id: s.clientId || null,
      data: { insurers: s.insurers, risks: s.risks, variants: s.variants, activeVariantIdx: s.activeVariantIdx },
      broker_message: s.brokerMessage || null,
      version: CONFIG.APP_VERSION,
      user_id: Auth.currentUser.id,
      updated_at: new Date().toISOString(),
    };

    if (generateLink && !s.offerId) payload.share_token = generateShareToken();

    let result;
    if (s.offerId) {
      const updateData = { ...payload };
      if (generateLink) {
        const existing = await Store.loadOffer(s.offerId);
        if (!existing.share_token) updateData.share_token = generateShareToken();
      }
      const { data, error } = await sb.from('ud_offers').update(updateData).eq('id', s.offerId).select().single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await sb.from('ud_offers').insert([payload]).select().single();
      if (error) throw error;
      result = data;
      s.offerId = result.id;
    }
    return result;
  },

  async deleteOffer(id) {
    const { error } = await sb.from('ud_offers').delete().eq('id', id);
    if (error) throw error;
  },

  // Save client choice (from client view)
  async saveClientChoice(offerId, choice) {
    const { data, error } = await sb.from('ud_offers').update({ client_choice: choice }).eq('id', offerId).select().single();
    if (error) throw error;
    return data;
  },

  hydrateState(offerRow) {
    Store.state.offerId = offerRow.id;
    Store.state.offerName = offerRow.name || '';
    Store.state.clientName = offerRow.client_name || '';
    Store.state.clientId = offerRow.client_id || null;
    Store.state.brokerMessage = offerRow.broker_message || '';
    Store.state.clientChoice = offerRow.client_choice || null;

    const d = offerRow.data || {};
    Store.state.insurers = d.insurers || [];
    Store.state.risks = d.risks || [];
    Store.state.variants = d.variants || [Store.createEmptyVariant('Wariant 1')];
    Store.state.activeVariantIdx = d.activeVariantIdx || 0;

    // Backward compat: old offers without variants
    if (d.matrixData && (!d.variants || d.variants.length === 0)) {
      Store.state.variants = [{
        id: 'v_migrated',
        label: 'Wariant 1',
        matrixData: d.matrixData,
        totals: d.totals || {},
        waitAccident: {},
        waitIllness: {},
        indemnity: {},
      }];
      Store.state.activeVariantIdx = 0;
    }
  },

  ensureVariantConsistency() {
    const s = Store.state;
    const v = Store.getActiveVariant();
    if (!v) return;
    s.risks.forEach(r => {
      if (!v.matrixData[r.id]) v.matrixData[r.id] = {};
      s.insurers.forEach(tu => {
        if (!v.matrixData[r.id][tu.id]) v.matrixData[r.id][tu.id] = { su: '' };
      });
    });
    s.insurers.forEach(tu => {
      if (v.totals[tu.id] === undefined) v.totals[tu.id] = '';
      if (v.waitAccident[tu.id] === undefined) v.waitAccident[tu.id] = 14;
      if (v.waitIllness[tu.id] === undefined) v.waitIllness[tu.id] = 21;
      if (v.indemnity[tu.id] === undefined) {
        const name = (tu.short_name || tu.name).toLowerCase();
        v.indemnity[tu.id] = name.includes('leadenhall') ? 24 : 24;
      }
    });
  },

  getCategoryWeight(cat) {
    const c = (cat || '').toLowerCase();
    if (c.includes('życi') || c.includes('zyci')) return 1;
    if (c.includes('niezdoln')) return 2;
    return 50;
  },

  // Admin
  async loadUsers() {
    const { data, error } = await sb.from('ud_user_profiles').select('*').order('created_at');
    if (error) throw error;
    return data || [];
  },

  async updateUserProfile(userId, updates) {
    const { data, error } = await sb.from('ud_user_profiles').update(updates).eq('id', userId).select().single();
    if (error) throw error;
    return data;
  }
};
