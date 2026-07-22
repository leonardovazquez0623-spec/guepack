if (typeof SUPABASE_URL === 'undefined') {
  var SUPABASE_URL = 'https://zkrnjdsnuyjaxxnluzmn.supabase.co'
  var SUPABASE_KEY = 'sb_publishable_nde3IHFs-CJqqY0w5gV77g_FbtKtH7z'
  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
  })
}

window.SUPABASE_URL = SUPABASE_URL
window.SUPABASE_KEY = SUPABASE_KEY
window.db = db
