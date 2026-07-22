const SUPABASE_URL = 'https://zkrnjdsnuyjaxxnluzmn.supabase.co'
const SUPABASE_KEY = 'sb_publishable_nde3IHFs-CJqqY0w5gV77g_FbtKtH7z'
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

window.SUPABASE_URL = SUPABASE_URL
window.SUPABASE_KEY = SUPABASE_KEY
window.db = db
