// Vercel Serverless Function — Sends a Telegram notification to the admin,
// and (optionally) also cross-posts to the Facebook Page — reads the bot
// token/chat id from the shared server DB (set once in the admin panel) and
// the Facebook Page token from Vercel env vars, so any page (customer or
// admin) can trigger a broadcast without needing to know either secret.

const { sendOnce, ticketEvent, hash } = require('./_telegram-notices');
const TicketOrderContext = require('../ticket-order-context');
const { providerDraft } = require('./_provider-ticket-draft');
const { getAuth } = require('./_auth');
const SITE = 'https://afghanfollowers.online';
const { dbHeaders, DB_SERVICE_KEY, API_BASE, fetchInternal, resolveAdminBot } = require('./_dbkey');

// Vercel only gives a 2-letter ISO country code — spell out the ones most
// relevant to this site's audience so the notification reads naturally;
// anything else falls back to the raw code (still useful, just terser).
const COUNTRY_NAMES = {
  AF: 'افغانستان', IR: 'ایران', PK: 'پاکستان', TR: 'ترکیه', DE: 'آلمان',
  US: 'آمریکا', GB: 'انگلستان', AE: 'امارات', SA: 'عربستان', TJ: 'تاجیکستان',
  UZ: 'ازبکستان', IN: 'هند', CA: 'کانادا', AU: 'استرالیا', NL: 'هلند',
  SE: 'سوئد', FR: 'فرانسه', RU: 'روسیه', QA: 'قطر', KW: 'کویت'
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Previously wide open — anyone on the internet could POST any message and
  // spam the admin's Telegram bot/public channel. Gated with the same shared
  // key every first-party page already carries. The anonymous "new visitor"
  // beacon (index.html/blog.html/auth.html) uses navigator.sendBeacon(),
  // which cannot set custom headers, so the key is also accepted via a
  // query param for that one call path — this key already lives in public
  // page source either way, so a query string doesn't weaken it further.
  const suppliedKey = req.headers['x-db-key'] || (req.query && req.query['db-key']);
  if (DB_SERVICE_KEY && suppliedKey !== DB_SERVICE_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let message = body.message;
    if (!message && !body.ticketId) return res.status(200).json({ ok: false, error: 'No message provided' });

    // Vercel's edge network geolocates every request by IP and passes it
    // along as headers — free, no external API call, and reflects whoever's
    // browser actually triggered this request (visitor, customer, etc.).
    // Useful for security-style alerts (new signup/login), but wrong for
    // broadcasts the admin triggers themselves (e.g. service-update posts),
    // where it would just leak the admin's own city — those callers pass
    // skipGeo to opt out.
    const country = req.headers['x-vercel-ip-country'];
    const city = req.headers['x-vercel-ip-city'];
    if (country && !body.skipGeo) {
      const countryName = COUNTRY_NAMES[country] || country;
      const cityDecoded = city ? decodeURIComponent(city) : null;
      message += '\n🌍 ' + (cityDecoded ? cityDecoded + ', ' : '') + countryName;
    }

    const dbResp = await fetchInternal(API_BASE + '/api/db', { headers: dbHeaders() });
    const db = await dbResp.json();
    const cfg = db.smm_tg_bot || {};
    let notificationEvent;
    let preparedDraft;
    let relatedTicket;
    // Older open tabs still post formatted ticket messages. Resolve known
    // IDs to the same canonical notification as the current structured API.
    if(!body.ticketId&&typeof message==='string'){
      const legacy=message.match(/(?:Ticket\s*#?|تیکت\s*:?\s*)([A-Za-z]*\d[\w-]*)/i);
      if(legacy&&(db.smm_tickets||[]).some(t=>String(t.id)===legacy[1]))body.ticketId=legacy[1];
    }
    if(body.ticketId){
      const auth=getAuth(req);
      if(!auth)return res.status(401).json({ok:false,error:'Login required'});
      const ticket=(db.smm_tickets||[]).find(t=>String(t.id)===String(body.ticketId));
      if(!ticket||(auth.role!=='admin'&&String(ticket.userId)!==String(auth.sub))){
        return res.status(403).json({ok:false,error:'Ticket not found'});
      }
      notificationEvent=ticketEvent(ticket);
      relatedTicket=ticket;
      const context=TicketOrderContext.resolve(ticket,db.smm_orders,db.smm_providers,db.smm_svc);
      const relatedOrder=context&&!context.missing?(db.smm_orders||[]).find(o=>String(o.id)===String(context.orderId)):null;
      preparedDraft=providerDraft(ticket,context,relatedOrder);
      message='🎫 <b>Ticket / تیکت: '+TicketOrderContext.escape(ticket.id)+'</b>\n'
        +'Request / درخواست: '+TicketOrderContext.escape(ticket.requestType||'support')+'\n'
        +'User / کاربر: '+TicketOrderContext.escape(ticket.user||'—')+'\n'
        +'Subject / موضوع: '+TicketOrderContext.escape(ticket.subject||'')+'\n'
        +TicketOrderContext.telegram(context)+'\n'
        +'Message / پیام: '+TicketOrderContext.escape(String(ticket.message||ticket.msg||'').slice(0,600))+'\n'
        +'Reply: <code>/reply '+TicketOrderContext.escape(ticket.id)+' message</code>';
    }

    // Callers (e.g. the "broadcast to public channel" feature) can target a
    // different chat than the admin notification chat by passing chatId —
    // still requires the same server-configured bot token either way.
    const adminBot=body.ticketId?await resolveAdminBot():null;
    const botToken=adminBot&&adminBot.token?adminBot.token:cfg.token;
    const targetChatId = body.ticketId?(adminBot&&adminBot.chatId||cfg.chatId):(body.chatId||cfg.chatId);

    let result = { ok: false, error: 'Telegram bot not configured on server' };
    if (botToken && targetChatId) {
      const tgResult=await sendOnce({
        chatId:targetChatId,event:notificationEvent||'message:'+hash(String(body.message||message)),
        ttl:notificationEvent?90*24*60*60:24*60*60
      },async()=>{
        const tgResp=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({chat_id:targetChatId,text:message,parse_mode:'HTML',disable_web_page_preview:false})
        });
        return tgResp.json();
      });
      result=tgResult&&tgResult.ok?{ok:true,duplicate:!!tgResult.duplicate}:{ok:false,error:'Telegram notification could not be confirmed'};
      // A separate, independently reserved message: copy the code block to
      // the supplier. Never include internal provider replies or customer PII.
      if(preparedDraft&&relatedTicket){
        const header='📋 <b>متن آماده برای پروایدر</b>\n'
          +'🎫 تیکت: '+TicketOrderContext.escape(relatedTicket.id)+'\n'
          +'🏢 پروایدر: '+TicketOrderContext.escape(preparedDraft.provider)+'\n'
          +(preparedDraft.ready?'متن داخل کادر را کپی و برای پروایدر ارسال کنید.':'⚠️ '+TicketOrderContext.escape(preparedDraft.reason))+'\n\n';
        const draftResult=await sendOnce({
          chatId:targetChatId,event:'provider-draft:'+String(relatedTicket.id)+':'+hash(preparedDraft.text),
          ttl:90*24*60*60
        },async()=>{
          const response=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({chat_id:targetChatId,parse_mode:'HTML',
              text:header+'<pre>'+TicketOrderContext.escape(preparedDraft.text)+'</pre>',disable_web_page_preview:true})
          });
          return response.json();
        });
        result.providerDraft={ok:!!(draftResult&&draftResult.ok),duplicate:!!(draftResult&&draftResult.duplicate),ready:preparedDraft.ready};
      }


    }

    // Optional: also post a plain-text version to the Facebook Page (Telegram's
    // HTML formatting doesn't apply there — callers pass a separate fbMessage).
    let facebook = null;
    if (body.fbMessage) {
      if (process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) {
        const fbResp = await fetch(`https://graph.facebook.com/v21.0/${process.env.FB_PAGE_ID}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: body.fbMessage, access_token: process.env.FB_PAGE_TOKEN })
        });
        const fbData = await fbResp.json();
        facebook = fbData.id ? { ok: true, id: fbData.id } : { ok: false, error: fbData.error || fbData };
      } else {
        facebook = { ok: false, error: 'Facebook not configured on server' };
      }
    }

    return res.status(200).json(Object.assign({}, result, { facebook }));
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
