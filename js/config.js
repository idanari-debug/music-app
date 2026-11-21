// כתובת הפרויקט והמפתח הציבורי. שניהם ציבוריים מעצם הגדרתם:
// הגישה לנתונים מוגנת בהרשאות ברמת השורה, והתוכן עצמו מוצפן במכשיר.
export const CONFIG = {
  url: 'https://nxhxxujhcvvbbrydjopl.supabase.co',
  key: 'sb_publishable_oPMo-bKYHx05DO4tYXOeVQ_NY0bD2S2',
  bucket: 'recordings',
  kdfIterations: 600000,
  storageLimitBytes: 1024 * 1024 * 1024,
  trashDays: 30,
  // מפתח ציבורי לשליחת התראות (החלק הפרטי שמור רק בשרת)
  vapid: 'BEpbdWDi54vnCwwRgA5oq4mHOsBLp-OfOWRYubSDr9EY3b5qwDxhIj8T3NwVkTrQMjB1LIoU6hig92vbQhVI9as'
};
