/**
 * config.js — Supabase config & globals
 * 
 * WAŻNE: Klucz anon jest bezpieczny do użycia po stronie klienta.
 * Cała ochrona danych opiera się na Row Level Security (RLS) w Supabase.
 * Service Role Key NIE jest nigdzie ujawniony.
 */

const CONFIG = {
  SUPABASE_URL: 'https://kukvgsjrmrqtzhkszzum.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Znc2pybXJxdHpoa3N6enVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTI0NzYsImV4cCI6MjA4ODQ4ODQ3Nn0.wOB-4CJTcRksSUY7WD7CXEccTKNxPIVF8AT8hczS5zY',
  APP_VERSION: 'v1.0',
  RATE_LIMIT_MS: 1000, // minimum ms between API calls
};

// Supabase client singleton
const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Currency formatter
const currencyFmt = new Intl.NumberFormat('pl-PL', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

function parseNum(val) {
  if (!val) return 0;
  let cleaned = val.toString().replace(/[^\d,.-]/g, '').replace(',', '.');
  let parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function formatCurrency(num) {
  if (!num || num === 0) return '';
  return currencyFmt.format(num);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function generateShareToken() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 24; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
  return token;
}
