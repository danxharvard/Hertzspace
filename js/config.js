// Hertzspace settings. This is the only file you need to edit to switch payments on.
window.HERTZSPACE_CONFIG = {
  // Stripe Payment Link for Hertzspace Plus. In the Stripe dashboard, set the
  // link's "After payment" redirect to:
  //   https://YOUR-SITE/?session_id={CHECKOUT_SESSION_ID}
  stripePaymentLink: "",

  // URL of the deployed Cloudflare Worker in /server (no trailing slash),
  // e.g. "https://hertzspace-api.yourname.workers.dev"
  apiBase: "",
};
