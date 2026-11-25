# Cloudflare Lead-Capture Worker

Turn any website into a lead machine without touching the site itself. This Cloudflare Worker sits in front of your existing pages and adds:

- **A 60-second qualifying quiz** at `/clia-quiz` that gives visitors an instant answer (this example decides which CLIA certificate a lab needs; swap in your own questions)
- **A dismissible call-to-action bar** on every HTML page, injected with `HTMLRewriter`
- **Lead capture** at `/api/lead`: honeypot and timing spam checks, "HOT LEAD" flagging, and an email to your inbox through Cloudflare Email Routing, with Reply-To set to the lead
- **Optional KV storage** of every lead

It works with any origin: WordPress, Webflow, Hostinger, Cloudflare Pages, anything behind Cloudflare.

## Deploy in five minutes

1. Install Wrangler and log in: `npm i -g wrangler && wrangler login`
2. Edit the constants at the top of `src/worker.js` (brand, booking link, phone) and the vars in `wrangler.toml`.
3. In the Cloudflare dashboard, enable **Email Routing** on your domain and verify the destination address in `LEAD_TO`.
4. Uncomment the `routes` line in `wrangler.toml` for your domain.
5. `wrangler deploy`

Set `CTA_OFF = "1"` to hide the bar without redeploying.

## A free, open-source marketing stack around it

| Job | Open-source option | Notes |
|---|---|---|
| Booking | [Cal.com](https://github.com/calcom/cal.com) | Put its link in `BOOKING_URL` |
| Email campaigns | [Listmonk](https://github.com/knadh/listmonk) | Single binary plus Postgres; send follow-ups to captured leads |
| Analytics | [Umami](https://github.com/umami-software/umami) or [Plausible CE](https://github.com/plausible/community-edition) | Privacy-friendly; or use free Cloudflare Web Analytics |
| CRM | [Twenty](https://github.com/twentyhq/twenty) | Pipe leads in with a webhook from `handleLead` |

## Need it customized?

This template was built by [Sound Software Development](https://soundsoftwaredev.com) for a 50-site network. We build custom Workers, lead funnels, dashboards and integrations. Get in touch through the site.

MIT License.
