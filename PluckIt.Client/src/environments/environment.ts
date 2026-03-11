export const environment = {
  production: false,
  apiUrl: '', // proxy.conf.json forwards /api/* (wardrobe/profile/collections/etc) to localhost:7072 during local dev
  chatApiUrl: '', // proxy.conf.json forwards /api/chat, /api/digest, /api/scraper, /api/taste, /api/insights, /api/moods, /api/process-image to localhost:7071 during local dev
  googleClientId: '20801742779-oihk5jfkcio2ulf9uk36ebvgnejbdv0l.apps.googleusercontent.com'
};
