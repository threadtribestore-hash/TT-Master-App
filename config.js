// Thread Tribe Master Center — settings for this deployment.
// Both projects (Master Center and every Partner app copy) must point at the same database.
window.TT_CONFIG = {
  supabaseUrl: 'https://aeshadnzutizlpayhtnf.supabase.co',
  supabaseKey: 'sb_publishable_tunpMMqpGPgRQreweefjTA_nBO7fXId',  // publishable key: safe to be public
  partnerAppUrl: 'https://threadtribestore-hash.github.io/TT-Partner-App/',  // optional, e.g. 'https://tt-partners.netlify.app/' — can also be set inside the app
  buyerAppUrl: 'https://threadtribestore-hash.github.io/TT-Buyer-App/'  // the Buyer app; its own repo, so it installs as its own app
};
