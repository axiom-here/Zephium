// Sites as Zephium names them: one registrable domain, so `m.youtube.com` and
// `www.youtube.com` are the same site. Hosts without a known suffix, such as
// `localhost` or `127.0.0.1`, stay whole — and are never counted or shut.

/** Two-letter and common multi-label public suffixes. Anything else with at
 *  least two labels is read as `label.suffix`, which is what a browser's own
 *  Public Suffix List gives for almost every real site. */
const SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "ad.jp", "ed.jp", "gr.jp", "lg.jp",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au", "asn.au",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz", "geek.nz", "school.nz",
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in", "mil.in", "nic.in", "res.in",
  "com.br", "net.br", "org.br", "gov.br", "edu.br", "art.br", "blog.br", "eco.br",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn", "bj.cn", "sh.cn",
  "com.hk", "net.hk", "org.hk", "edu.hk", "gov.hk", "idv.hk",
  "com.tw", "net.tw", "org.tw", "edu.tw", "gov.tw", "idv.tw",
  "co.kr", "ne.kr", "or.kr", "re.kr", "pe.kr", "go.kr", "ac.kr",
  "com.sg", "net.sg", "org.sg", "edu.sg", "gov.sg", "per.sg",
  "co.id", "net.id", "org.id", "web.id", "ac.id", "go.id", "mil.id", "sch.id",
  "co.za", "net.za", "org.za", "gov.za", "ac.za", "web.za",
  "com.mx", "net.mx", "org.mx", "edu.mx", "gob.mx",
  "com.ar", "net.ar", "org.ar", "gov.ar", "edu.ar", "int.ar",
  "com.tr", "net.tr", "org.tr", "gov.tr", "edu.tr", "av.tr", "bel.tr",
  "co.il", "net.il", "org.il", "ac.il", "gov.il", "muni.il",
  "com.ua", "net.ua", "org.ua", "gov.ua", "edu.ua", "in.ua", "kiev.ua",
  "co.th", "net.th", "org.th", "ac.th", "go.th", "in.th", "or.th",
  "com.vn", "net.vn", "org.vn", "edu.vn", "gov.vn", "ac.vn",
  "com.my", "net.my", "org.my", "edu.my", "gov.my",
  "com.ph", "net.ph", "org.ph", "edu.ph", "gov.ph",
  "com.pk", "net.pk", "org.pk", "edu.pk", "gov.pk", "web.pk",
  "com.bd", "net.bd", "org.bd", "edu.bd", "gov.bd", "ac.bd",
  "com.ng", "net.ng", "org.ng", "edu.ng", "gov.ng", "sch.ng",
  "com.eg", "net.eg", "org.eg", "edu.eg", "gov.eg",
  "co.ke", "or.ke", "ne.ke", "go.ke", "ac.ke", "sc.ke",
  "com.sa", "net.sa", "org.sa", "edu.sa", "gov.sa", "med.sa", "pub.sa",
  "com.ae", "net.ae", "org.ae", "ac.ae", "gov.ae", "sch.ae",
  "com.qa", "net.qa", "org.qa", "edu.qa", "gov.qa",
  "co.at", "or.at", "ac.at", "gv.at", "priv.at",
  "com.pl", "net.pl", "org.pl", "edu.pl", "gov.pl", "info.pl", "biz.pl",
  "com.ru", "net.ru", "org.ru", "msk.ru", "spb.ru", "edu.ru", "gov.ru",
  "com.es", "nom.es", "org.es", "gob.es", "edu.es",
  "com.pt", "org.pt", "edu.pt", "gov.pt",
  "com.gr", "net.gr", "org.gr", "edu.gr", "gov.gr",
  "com.ro", "org.ro", "nt.ro", "edu.ro", "gov.ro",
  "com.cy", "net.cy", "org.cy", "ac.cy", "gov.cy",
  "com.mt", "net.mt", "org.mt", "edu.mt", "gov.mt",
  "com.hr", "net.hr", "org.hr", "edu.hr", "gov.hr",
  "com.lv", "net.lv", "org.lv", "edu.lv", "gov.lv",
  "com.ee", "net.ee", "org.ee", "edu.ee", "gov.ee", "pri.ee",
  "com.lt", "net.lt", "org.lt", "edu.lt", "gov.lt",
  "com.al", "net.al", "org.al", "edu.al", "gov.al",
  "co.ve", "com.ve", "net.ve", "org.ve", "edu.ve", "gob.ve",
  "com.co", "net.co", "org.co", "edu.co", "gov.co", "nom.co",
  "com.pe", "net.pe", "org.pe", "edu.pe", "gob.pe", "nom.pe",
  "com.ec", "net.ec", "org.ec", "edu.ec", "gob.ec",
  "com.uy", "net.uy", "org.uy", "edu.uy", "gub.uy",
  "com.py", "net.py", "org.py", "edu.py", "gov.py",
  "com.bo", "net.bo", "org.bo", "edu.bo", "gob.bo",
  "com.do", "net.do", "org.do", "edu.do", "gob.do",
  "com.gt", "net.gt", "org.gt", "edu.gt", "gob.gt",
  "com.sv", "net.sv", "org.sv", "edu.sv", "gob.sv",
  "co.cr", "com.cr", "net.cr", "org.cr", "edu.cr", "go.cr",
  "com.pa", "net.pa", "org.pa", "edu.pa", "gob.pa",
  "com.ni", "net.ni", "org.ni", "edu.ni", "gob.ni",
  "com.hn", "net.hn", "org.hn", "edu.hn", "gob.hn",
  "com.af", "net.af", "org.af", "edu.af", "gov.af",
  "com.lk", "net.lk", "org.lk", "edu.lk", "gov.lk", "ltd.lk", "web.lk",
  "com.np", "net.np", "org.np", "edu.np", "gov.np",
  "com.kh", "net.kh", "org.kh", "edu.kh", "gov.kh",
  "com.mm", "net.mm", "org.mm", "edu.mm", "gov.mm",
  "co.uz", "com.uz", "net.uz", "org.uz",
  "com.kz", "net.kz", "org.kz", "edu.kz", "gov.kz",
  "com.by", "net.by", "org.by", "edu.by", "gov.by",
  "com.ge", "net.ge", "org.ge", "edu.ge", "gov.ge",
  "com.az", "net.az", "org.az", "edu.az", "gov.az",
  "com.am", "net.am", "org.am", "edu.am", "gov.am",
  "co.mz", "net.mz", "org.mz", "edu.mz", "gov.mz",
  "co.tz", "net.tz", "org.tz", "edu.tz", "go.tz",
  "co.ug", "net.ug", "org.ug", "edu.ug", "gov.ug",
  "co.zw", "net.zw", "org.zw", "edu.zw", "gov.zw",
  "co.zm", "net.zm", "org.zm", "edu.zm", "gov.zm",
  "co.bw", "net.bw", "org.bw", "edu.bw", "gov.bw",
  "co.ma", "net.ma", "org.ma", "edu.ma", "gov.ma",
  "co.tn", "net.tn", "org.tn", "edu.tn", "gov.tn",
  "co.dz", "net.dz", "org.dz", "edu.dz", "gov.dz",
  "com.gh", "net.gh", "org.gh", "edu.gh", "gov.gh",
  "com.et", "net.et", "org.et", "edu.et", "gov.et",
  "com.sd", "net.sd", "org.sd", "edu.sd", "gov.sd",
  "com.jo", "net.jo", "org.jo", "edu.jo", "gov.jo",
  "com.lb", "net.lb", "org.lb", "edu.lb", "gov.lb",
  "com.sy", "net.sy", "org.sy", "edu.sy", "gov.sy",
  "com.iq", "net.iq", "org.iq", "edu.iq", "gov.iq",
  "com.kw", "net.kw", "org.kw", "edu.kw", "gov.kw",
  "com.bh", "net.bh", "org.bh", "edu.bh", "gov.bh",
  "com.om", "net.om", "org.om", "edu.om", "gov.om",
  "com.ye", "net.ye", "org.ye", "edu.ye", "gov.ye",
  "github.io", "githubusercontent.com", "gitlab.io", "bitbucket.io",
  "netlify.app", "vercel.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com",
  "herokuapp.com", "fly.dev", "onrender.com", "railway.app", "glitch.me", "repl.co",
  "blogspot.com", "appspot.com", "cloudfront.net", "s3.amazonaws.com",
  "notion.site", "substack.com", "ghost.io", "wixsite.com", "myshopify.com",
  "azurewebsites.net", "cloudapp.net", "blob.core.windows.net",
  "translate.goog", "blogspot.co.uk", "co.com", "ne.com",
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/u;
const MAX_SITE_BYTES = 253;

/** Whether `host` is `site` or one of its subdomains. */
export function siteCovers(site, host) {
  return host === site || (host.endsWith(site) && host[host.length - site.length - 1] === ".");
}

/** A page's registrable domain, or null when the URL is not a web page. */
export function siteOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/\.$/u, "").toLowerCase();
  if (!host || IPV4.test(host) || host.includes(":") || host.startsWith("[")) return null;
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return null;
  let site = host;
  for (let take = Math.min(3, labels.length - 1); take >= 2; take -= 1) {
    const candidate = labels.slice(-take).join(".");
    if (SUFFIXES.has(candidate)) {
      site = labels.slice(-(take + 1)).join(".");
      break;
    }
  }
  if (site === host && !SUFFIXES.has(labels.slice(-2).join("."))) {
    site = labels.slice(-2).join(".");
  }
  return site.length > 0 && site.length <= MAX_SITE_BYTES ? site : null;
}

/** Normalizes a typed site the way focus matches it: `https://www.X.com/a`
 *  becomes `x.com`. Null when it is not a site that can be shut. */
export function normalizeSite(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  let host = parsed.hostname.replace(/\.$/u, "").toLowerCase();
  if (host.startsWith("[") || IPV4.test(host) || host.includes(":")) return null;
  if (host.startsWith("www.")) host = host.slice(4);
  return host.includes(".") && host.length <= MAX_SITE_BYTES ? host : null;
}

/** Where a shut page is taken: the cover, with the site it stands for. */
export function coverUrl(site) {
  return chrome.runtime.getURL(`src/pages/cover/cover.html?site=${encodeURIComponent(site)}`);
}
